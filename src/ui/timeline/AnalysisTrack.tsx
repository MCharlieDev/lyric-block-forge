import { useCallback, useRef } from 'react'
import type { TimeRange } from '@core'
import { ANALYSIS_TRACK_HEIGHT_PX } from './constants'
import { useEditorStore } from '../stores/editorStore'
import { useTimelineFrame, useTimelineSnapshot, type TimelineFrame } from './useTimelineViewport'
import { useTimelineViewportContext } from './viewportContext'

/**
 * 分析轨（架构文档 §6.2）。
 *
 * 人声 / 间奏这类"结论性标记"**不许画进波形本体**，必须在波形之外另起一条
 * 窄轨，且用线型区分可信度：虚线 = 建议（算法给出，待确认），实线 = 已确认。
 *
 * 目前 `AudioAnalysisPort` 尚未实现，`audioAsset.analysis` 恒为 `null`，
 * 因此这里直接不渲染 —— 宁可留白，也不摆假数据。
 */
export function AnalysisTrack() {
  const { kernel } = useTimelineViewportContext()
  const snapshot = useTimelineSnapshot(kernel)
  const analysis = useEditorStore((state) => state.audioAsset?.analysis ?? null)
  const planeRef = useRef<HTMLDivElement | null>(null)

  // 平面只负责平移：块的 left 在 React 里按 pixelsPerMs 算，缩放才重算
  const handleFrame = useCallback((frame: TimelineFrame) => {
    const plane = planeRef.current
    if (plane === null) return
    plane.style.transform = `translate3d(${-frame.view.startMs * frame.view.pixelsPerMs}px, 0, 0)`
  }, [])

  useTimelineFrame(kernel, handleFrame)

  if (analysis === null) return null

  const { pixelsPerMs } = snapshot

  const segments: Array<{ key: string; range: TimeRange; tone: string }> = [
    ...analysis.silenceRanges.map((range, index) => ({
      key: `silence-${index}`,
      range,
      tone: 'border-neutral-500/70 bg-neutral-500/10',
    })),
    ...analysis.vocalRanges.map((range, index) => ({
      key: `vocal-${index}`,
      range,
      tone: 'border-accent/60 bg-accent/10',
    })),
  ]

  return (
    <div
      className="relative shrink-0 overflow-hidden border-b border-divider bg-canvas"
      style={{ height: `${ANALYSIS_TRACK_HEIGHT_PX}px` }}
    >
      <div ref={planeRef} className="absolute left-0 top-0 h-full w-full">
        {segments.map(({ key, range, tone }) => (
          <div
            key={key}
            className={`absolute top-1 h-2 rounded-sm border border-dashed ${tone}`}
            style={{
              left: `${range.startMs * pixelsPerMs}px`,
              width: `${Math.max(2, (range.endMs - range.startMs) * pixelsPerMs)}px`,
            }}
          />
        ))}
      </div>
    </div>
  )
}
