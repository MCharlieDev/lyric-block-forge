import { useEffect, useRef } from 'react'
import { LABEL_MIN_GAP_PX, RULER_HEIGHT_PX } from './constants'
import { formatTimecode } from '../utils/format'
import { adaptiveGridMs, timeToX } from './timeMap'
import { useTimelineSnapshot, type TimelineFrame } from './useTimelineViewport'
import { useTimelineViewportContext } from './viewportContext'

/**
 * 时间刻度尺（架构文档 §6.1 第二层）。
 *
 * 与波形共用同一个 `frame.view`，因此刻度线与波形网格天然重合。
 * 本层**只负责绘制**：「按尺子任意处抓播放头拖动」已统一到
 * {@link ./PlayheadLayer} 的尺子带热区（原擦洗手势已删除）。
 */
export function TimeRuler() {
  const { kernel } = useTimelineViewportContext()
  const snapshot = useTimelineSnapshot(kernel)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const widthRef = useRef(0)

  const widthPx = snapshot.viewportWidthPx

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return
    const width = Math.max(1, Math.round(widthPx))
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.round(width * dpr))
    canvas.height = Math.max(1, Math.round(RULER_HEIGHT_PX * dpr))
    canvas.style.width = `${width}px`
    canvas.style.height = `${RULER_HEIGHT_PX}px`
    widthRef.current = width
    kernel.invalidate()
  }, [widthPx, kernel])

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas === null ? null : canvas.getContext('2d')
    if (canvas === null || context === null) return

    const draw = (frame: TimelineFrame): void => {
      const width = widthRef.current
      if (width <= 0) return

      const dpr = window.devicePixelRatio || 1
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      context.clearRect(0, 0, width, RULER_HEIGHT_PX)

      /*
        字体与基线必须每帧重设：只要 canvas.width 被重新赋值（宽度/dpr 变化时），
        2D 上下文就会被重置回默认值（textBaseline 从 'top' 打回 'alphabetic'），
        文字以 y=3 为基线会把 10px 字形的上半截画到位图外，看起来就是"数字被裁掉"。
      */
      context.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace'
      context.textBaseline = 'top'

      const stepMs = adaptiveGridMs(frame.view.pixelsPerMs, LABEL_MIN_GAP_PX)
      const firstTickMs = Math.ceil(frame.view.startMs / stepMs) * stepMs

      context.fillStyle = 'rgba(255, 255, 255, 0.16)'
      context.strokeStyle = 'rgba(255, 255, 255, 0.16)'

      for (let time = firstTickMs; ; time += stepMs) {
        const x = timeToX(time, frame.view)
        if (x > width) break
        if (x < -60) continue
        const rounded = Math.round(x) + 0.5
        context.beginPath()
        context.moveTo(rounded, RULER_HEIGHT_PX - 8)
        context.lineTo(rounded, RULER_HEIGHT_PX)
        context.stroke()
        context.fillText(formatTimecode(time), Math.round(x) + 3, 3)
      }

      // 底部压边线，把刻度尺与波形分开
      context.fillStyle = 'rgba(255, 255, 255, 0.08)'
      context.fillRect(0, RULER_HEIGHT_PX - 1, width, 1)
    }

    const unsubscribe = kernel.subscribeFrame(draw)
    kernel.invalidate()
    return unsubscribe
  }, [kernel])

  // canvas 的 cursor-col-resize class 保留：仅供 harness rulerRect() 定位；canvas 已不再接手势。
  return (
    <canvas
      ref={canvasRef}
      className="block w-full shrink-0 cursor-col-resize touch-none"
      style={{ height: `${RULER_HEIGHT_PX}px` }}
    />
  )
}
