import { useEffect } from 'react'
import { useAdapters } from '../context/AdapterContext'
import { useEditorStore } from '../stores/editorStore'

/**
 * 播放头写回 store 的最小间隔。
 *
 * 音频 tick 约每 16ms 一次，若每次都写 store，播放控制条会跟着 60fps 重渲染。
 * store 里的 `playheadMs` 只服务"读数"（播放控制条的秒数 / 滑块），
 * 真正的逐帧位置由各图层直接从音频端口取，因此 10Hz 足够。
 */
const PLAYHEAD_WRITE_INTERVAL_MS = 100

/**
 * 把音频端口与编辑器状态对接起来（架构文档 §6.4）。
 *
 * ## 方向：音频是源，store 是镜像
 * - `onStateChange` → `setPlaying`：播放 / 暂停由音频真实状态决定，不由按钮翻转；
 * - `onTick` → `setPlayhead`（节流到 10Hz）：仅供读数；
 * - `rate` / `volume` → 端口：用户调节后下发。
 *
 * 播放头位置与视口跟随不在这里处理 —— 它们每帧都要动，
 * 由 `TimelineStrip` 直接读音频时钟，避免绕一圈 store 造成抖动。
 */
export function useAudioPlayback(): void {
  const adapters = useAdapters()
  const rate = useEditorStore((state) => state.playback.rate)
  const volume = useEditorStore((state) => state.playback.volume)

  useEffect(() => {
    return adapters.audio.onStateChange((state) => {
      useEditorStore.getState().setPlaying(state === 'playing')
    })
  }, [adapters])

  useEffect(() => {
    let lastWriteMs = 0
    return adapters.audio.onTick((timeMs) => {
      const now = performance.now()
      if (now - lastWriteMs < PLAYHEAD_WRITE_INTERVAL_MS) return
      lastWriteMs = now
      useEditorStore.getState().setPlayhead(timeMs)
    })
  }, [adapters])

  useEffect(() => {
    adapters.audio.setPlaybackRate(rate)
  }, [adapters, rate])

  useEffect(() => {
    adapters.audio.setVolume(volume)
  }, [adapters, volume])
}
