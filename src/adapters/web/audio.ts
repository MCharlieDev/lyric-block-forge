import type { AudioAsset } from '@core/types'
import type {
  AudioPeakState,
  AudioPeakStateListener,
  AudioPlaybackState,
  AudioPort,
  AudioSpec,
  AudioStateListener,
  AudioTickListener,
  PeakRange,
  Unsubscribe,
} from '../ports'
import type { PeakBuildHandle, PeakPyramid } from './waveform-peaks'
import { buildPeakPyramid, PeakBuildCancelledError, queryPeaks } from './waveform-peaks'

/**
 * Web 端音频端口实现（Web Audio API）。
 *
 * 设计取舍：
 * - 用 `AudioBufferSourceNode` 而不是 `<audio>`，因为解码后的 `AudioBuffer`
 *   是任务 2 计算波形峰值的输入，一次解码同时服务播放与波形；
 * - `AudioBufferSourceNode` 是一次性的，暂停 / 定位都通过"丢弃旧节点 + 按新偏移重建"实现；
 * - 播放头位置由 `AudioContext.currentTime` 推算，是编辑器唯一可信的时钟；
 * - `load` 完成后，若来源是 object URL 会立刻 revoke，字节流已进入内存，无需再持有。
 */

/** 默认的进度回调节流间隔（毫秒）。 */
const TICK_INTERVAL_MS = 16

/** 把任意值吞掉，用于"只关心完成、不关心结果"的分支。 */
const ignore = (): void => undefined

/**
 * 创建 Web 端音频端口。
 *
 * @returns 音频端口实例
 */
export function createWebAudioPort(): AudioPort {
  let context: AudioContext | null = null
  let gain: GainNode | null = null
  let buffer: AudioBuffer | null = null
  let source: AudioBufferSourceNode | null = null

  let state: AudioPlaybackState = 'idle'
  /** 当前播放头（毫秒）。播放中该值会被 `context.currentTime` 推算覆盖 */
  let positionMs = 0
  /** 本段播放开始时的 `context.currentTime` */
  let startedAtContextTime = 0
  let playbackRate = 1
  let volume = 1

  /** 峰值金字塔。与 `buffer` 同生命周期，换音频即丢弃 */
  let pyramid: PeakPyramid | null = null
  let peakState: AudioPeakState = 'idle'
  let peakBuild: PeakBuildHandle | null = null

  const tickListeners = new Set<AudioTickListener>()
  const stateListeners = new Set<AudioStateListener>()
  const peakListeners = new Set<AudioPeakStateListener>()
  let tickTimer: number | null = null

  const setState = (next: AudioPlaybackState): void => {
    if (state === next) return
    state = next
    for (const listener of stateListeners) listener(next)
  }

  const setPeakState = (next: AudioPeakState): void => {
    if (peakState === next) return
    peakState = next
    for (const listener of peakListeners) listener(next)
  }

  const resetPeaks = (): void => {
    peakBuild?.cancel()
    peakBuild = null
    pyramid = null
    setPeakState('idle')
  }

  const durationMs = (): number => (buffer === null ? 0 : buffer.duration * 1000)

  const currentTimeMs = (): number => {
    if (state === 'playing' && context !== null) {
      const elapsed = (context.currentTime - startedAtContextTime) * 1000 * playbackRate
      return Math.min(durationMs(), Math.max(0, positionMs + elapsed))
    }
    return positionMs
  }

  const emitTick = (): void => {
    const time = currentTimeMs()
    for (const listener of tickListeners) listener(time)
  }

  const stopTicking = (): void => {
    if (tickTimer !== null) {
      window.clearInterval(tickTimer)
      tickTimer = null
    }
  }

  const startTicking = (): void => {
    stopTicking()
    tickTimer = window.setInterval(() => {
      if (state !== 'playing') return
      emitTick()
    }, TICK_INTERVAL_MS)
  }

  const ensureContext = (): AudioContext => {
    // context 一旦进入 closed / interrupted，decodeAudioData 会直接 reject，
    // 必须重建才能恢复；suspended 是 autoplay 的正常态，可在其上正常解码，不重建。
    // Safari 的私有态 interrupted 不在 TS 的 AudioContextState 联合类型内，故用 string 比较。
    const rawState = context === null ? null : (context.state as string)
    if (context === null || rawState === 'closed' || rawState === 'interrupted') {
      const created = new AudioContext()
      context = created
      // 会话级异常（context 死亡）是波形空白的可疑触发源，这里留下观测点。
      // warn 仅在真正不可用态触发，suspended 不 warn；旧的 created 被替换后监听器随其 GC。
      created.addEventListener('statechange', () => {
        const next = created.state as string
        if (next === 'closed' || next === 'interrupted') {
          console.warn('[audio] AudioContext 状态异常:', next)
        }
      })
      gain = context.createGain()
      gain.gain.value = volume
      gain.connect(context.destination)
    }
    return context
  }

  const releaseSource = (): void => {
    if (source !== null) {
      source.onended = null
      try {
        source.stop()
      } catch {
        // 尚未 start 或已停止时 stop 会抛错，忽略
      }
      source.disconnect()
      source = null
    }
  }

  const startSource = (offsetMs: number): void => {
    const ctx = ensureContext()
    const node = ctx.createBufferSource()
    node.buffer = buffer
    node.playbackRate.value = playbackRate
    node.connect(gain as GainNode)
    node.onended = () => {
      // 只有自然播完才会走到这里：手动 stop 前已解绑
      if (source !== node) return
      source = null
      positionMs = durationMs()
      stopTicking()
      emitTick()
      setState('ended')
    }
    node.start(0, Math.max(0, offsetMs) / 1000)
    source = node
    positionMs = Math.max(0, offsetMs)
    startedAtContextTime = ctx.currentTime
  }

  return {
    async load(asset: AudioAsset): Promise<void> {
      setState('loading')
      releaseSource()
      positionMs = 0

      // 原子切换：先解码到临时变量，成功后才替换共享 buffer / pyramid。
      // 这样解码失败时端口保持 load 前状态，维持
      // "store 有 asset ⇒ 端口有 buffer" 的不变量（App 侧失败不会 attachAudio）。
      let decoded: AudioBuffer
      try {
        const response = await fetch(asset.source.uri)
        const arrayBuffer = await response.arrayBuffer()
        const ctx = ensureContext()
        decoded = await ctx.decodeAudioData(arrayBuffer)
      } catch (error) {
        console.error('[audio] 解码失败', {
          message: error instanceof Error ? error.message : String(error),
          contextState: context?.state ?? null,
        })
        setState('error')
        throw error instanceof Error ? error : new Error('音频解码失败')
      } finally {
        // object URL 的字节流已进入内存，及时释放
        if (asset.source.kind === 'object-url') URL.revokeObjectURL(asset.source.uri)
      }

      resetPeaks()
      buffer = decoded
      positionMs = 0
      setState('ready')
      emitTick()
    },

    async unload(): Promise<void> {
      stopTicking()
      releaseSource()
      resetPeaks()
      buffer = null
      positionMs = 0
      setState('idle')
      emitTick()
    },

    async play(): Promise<void> {
      if (buffer === null || state === 'playing') return
      const ctx = ensureContext()
      if (ctx.state === 'suspended') await ctx.resume()
      if (state === 'ended') positionMs = 0
      startSource(positionMs)
      startTicking()
      setState('playing')
    },

    async pause(): Promise<void> {
      if (state !== 'playing') return
      positionMs = currentTimeMs()
      releaseSource()
      stopTicking()
      setState('paused')
      emitTick()
    },

    async seek(timeMs: number): Promise<void> {
      const clamped = Math.min(durationMs(), Math.max(0, timeMs))
      const wasPlaying = state === 'playing'
      releaseSource()
      positionMs = clamped
      if (wasPlaying) startSource(clamped)
      emitTick()
    },

    getCurrentTimeMs: currentTimeMs,

    getDurationMs: durationMs,

    getSpec(): AudioSpec | null {
      if (buffer === null) return null
      return {
        sampleRate: buffer.sampleRate,
        channelCount: buffer.numberOfChannels,
        durationMs: buffer.duration * 1000,
      }
    },

    setPlaybackRate(rate: number): void {
      const next = rate > 0 ? rate : 1
      // 变速会改变"已播放时长"的换算，先固化当前位置再切速率
      if (state === 'playing' && context !== null) {
        positionMs = currentTimeMs()
        startedAtContextTime = context.currentTime
      }
      playbackRate = next
      if (source !== null) source.playbackRate.value = next
    },

    setVolume(next: number): void {
      volume = Math.min(1, Math.max(0, next))
      if (gain !== null) gain.gain.value = volume
    },

    onTick(listener: AudioTickListener): Unsubscribe {
      tickListeners.add(listener)
      return () => tickListeners.delete(listener)
    },

    onStateChange(listener: AudioStateListener): Unsubscribe {
      stateListeners.add(listener)
      listener(state)
      return () => stateListeners.delete(listener)
    },

    getPeakState: (): AudioPeakState => peakState,

    preparePeaks(): Promise<void> {
      if (buffer === null) return Promise.resolve()
      if (peakBuild !== null) return peakBuild.promise.then(ignore, ignore)

      const target = buffer
      const handle = buildPeakPyramid(target)
      peakBuild = handle
      setPeakState('building')

      return handle.promise.then(
        (built) => {
          if (peakBuild !== handle) return
          peakBuild = null
          pyramid = built
          setPeakState('ready')
        },
        (error: unknown) => {
          if (peakBuild !== handle) return
          peakBuild = null
          if (error instanceof PeakBuildCancelledError) return
          pyramid = null
          setPeakState('error')
        },
      )
    },

    getPeaks(startMs: number, endMs: number, bucketCount: number): PeakRange | null {
      if (pyramid === null || pyramid.levels.length === 0) return null
      return queryPeaks(pyramid, startMs, endMs, bucketCount)
    },

    onPeaksChange(listener: AudioPeakStateListener): Unsubscribe {
      peakListeners.add(listener)
      listener(peakState)
      return () => peakListeners.delete(listener)
    },
  }
}
