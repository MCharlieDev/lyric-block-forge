import { useCallback, useRef } from 'react'
import { useAdapters } from '../context/AdapterContext'
import { timeToX } from './timeMap'
import { useTimelineFrame, type TimelineFrame } from './useTimelineViewport'
import { useTimelineViewportContext } from './viewportContext'

/**
 * 播放头层 —— 贯穿波形与歌词区的独立层（架构文档 §13：播放头独立层）。
 *
 * ## 为什么不订阅 store 的 `playheadMs`
 * store 里的播放头是给人读的（播放控制条），刷新率约 10Hz；
 * 而播放头位置每帧都要动。若这里跟着 store 走，就会和音频时钟打架、来回跳。
 * 因此本层**直接从音频端口取时钟**：音频时钟是播放的唯一基准（§6.4），
 * 其余一切显示都是它的从属。
 */
export function PlayheadLayer() {
  const adapters = useAdapters()
  const { kernel } = useTimelineViewportContext()
  const headRef = useRef<HTMLDivElement | null>(null)

  const handleFrame = useCallback(
    (frame: TimelineFrame) => {
      const head = headRef.current
      if (head === null) return
      const x = timeToX(adapters.audio.getCurrentTimeMs(), {
        startMs: frame.view.startMs,
        pixelsPerMs: frame.view.pixelsPerMs,
      })
      head.style.transform = `translate3d(${x}px, 0, 0)`
    },
    [adapters],
  )

  useTimelineFrame(kernel, handleFrame)

  return (
    <div
      ref={headRef}
      className="pointer-events-none absolute left-0 top-0 h-full w-0 will-change-transform"
      aria-hidden
    >
      <div className="absolute top-0 h-full w-px bg-accent" />
      <div className="absolute -left-[3px] top-0 h-1.5 w-[7px] rounded-b-sm bg-accent" />
    </div>
  )
}
