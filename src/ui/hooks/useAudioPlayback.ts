import { useEffect } from 'react'
import { useAdapters } from '../context/AdapterContext'
import { useEditorStore } from '../stores/editorStore'
import { isScrubbing } from '../utils/editorCommands'

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
      // 暂停 / 结束时把端口位置同步一次进 store：暂停态下 `resolvePlayheadMs`
      // 改读 store（才能停在尾巴区），而 tick 在暂停时不再发射，store 会
      // 滞后于端口，故在此补一次精确写入。无音频时不写：订阅会立即触发一次，
      // 此时 `getCurrentTimeMs()` 恒为 0，会把 store 误写为 0。
      if (state !== 'playing' && adapters.audio.getDurationMs() > 0) {
        useEditorStore.getState().setPlayhead(adapters.audio.getCurrentTimeMs())
      }
    })
  }, [adapters])

  useEffect(() => {
    let lastWriteMs = 0
    return adapters.audio.onTick((timeMs) => {
      // 拖动播放头期间不回灌 store：位置由拖动会话独占（`resolvePlayheadMs`
      // 会读会话值），否则 10Hz 镜像会把播放头往回拽。放在节流判断之前。
      if (isScrubbing()) return
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
