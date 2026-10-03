import { useEffect, useRef, useState } from 'react'
import type { AudioPeakState } from '@adapters'
import { useAdapters } from '../context/AdapterContext'
import { GRID_MIN_GAP_PX, WAVEFORM_HEIGHT_PX } from './constants'
import { adaptiveGridMs, timeToX } from './timeMap'
import { useTimelineSnapshot, type TimelineFrame } from './useTimelineViewport'
import { useTimelineViewportContext } from './viewportContext'

/**
 * 波形层（架构文档 §6.1 第一层）。
 *
 * 只画**音频本体**：峰值柱 + 极淡的时间网格。
 * 人声 / 间奏等"结论性标记"一律不许画在这里（§6.2），它们属于分析轨。
 *
 * ## 为什么是 canvas
 * 一屏最多几百根柱子，但每一帧都要重画，DOM 节点数会随缩放急剧膨胀。
 * canvas 一次 `fillRect` 循环即可，且天然与"每帧命令式广播"的内核契合：
 * 只在 `subscribeFrame` 回调里重绘，**不触发 React 重渲染**。
 *
 * ## 为什么不会阻塞主线程
 * 峰值来自 Worker 预先建好的金字塔，`getPeaks()` 只读取与**屏幕像素数**
 * 成正比的桶，工作量与音频总长无关（§13 大文件策略）。
 */
export function WaveformLayer() {
  const adapters = useAdapters()
  const { kernel } = useTimelineViewportContext()
  const snapshot = useTimelineSnapshot(kernel)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const widthRef = useRef(0)
  const heightRef = useRef(WAVEFORM_HEIGHT_PX)
  const [peakState, setPeakState] = useState<AudioPeakState>(() => adapters.audio.getPeakState())

  const widthPx = snapshot.viewportWidthPx

  // 峰值准备完成后需要重绘一帧，否则波形会一直空着
  useEffect(() => {
    return adapters.audio.onPeaksChange((state) => {
      setPeakState(state)
      kernel.invalidate()
    })
  }, [adapters, kernel])

  /*
    容器高度不再写死（改由 flex-1 拉伸），因此用 ResizeObserver 实测后写回
    heightRef 并重设位图高度；画布位图尺寸只能靠 JS 写死，CSS 的 h-full 管不了它。
  */
  useEffect(() => {
    const container = containerRef.current
    if (container === null) return
    const observer = new ResizeObserver(() => {
      const height = Math.max(1, Math.round(container.clientHeight))
      if (height === heightRef.current) return
      heightRef.current = height
      const canvas = canvasRef.current
      if (canvas === null) return
      const dpr = window.devicePixelRatio || 1
      canvas.height = Math.max(1, Math.round(height * dpr))
      canvas.style.height = `${height}px`
      kernel.invalidate()
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [kernel])

  // 画布尺寸随视口宽度 / dpr 变化，只在这里做一次重设
  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return
    const width = Math.max(1, Math.round(widthPx))
    const height = heightRef.current
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.round(width * dpr))
    canvas.height = Math.max(1, Math.round(height * dpr))
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    widthRef.current = width
    kernel.invalidate()
  }, [widthPx, kernel])

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas === null ? null : canvas.getContext('2d')
    if (canvas === null || context === null) return

    const draw = (frame: TimelineFrame): void => {
      const width = widthRef.current
      const height = heightRef.current
      if (width <= 0) return

      const dpr = window.devicePixelRatio || 1
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      context.clearRect(0, 0, width, height)

      const center = height / 2
      const amplitude = height / 2 - 2

      // 中线
      context.fillStyle = 'rgba(255, 255, 255, 0.06)'
      context.fillRect(0, center, width, 1)

      // 极淡网格：与刻度尺共用同一个步长算法，保证两层线条严格重合
      const stepMs = adaptiveGridMs(frame.view.pixelsPerMs, GRID_MIN_GAP_PX)
      const firstTickMs = Math.ceil(frame.view.startMs / stepMs) * stepMs
      context.fillStyle = 'rgba(255, 255, 255, 0.03)'
      for (let time = firstTickMs; ; time += stepMs) {
        const x = timeToX(time, frame.view)
        if (x > width) break
        if (x >= 0) context.fillRect(Math.round(x), 0, 1, height)
      }

      // 峰值柱：查询区间取"可见范围"而非渲染窗口，避免为屏幕外的像素做无用功
      const spanMs = width / frame.view.pixelsPerMs
      const startMs = Math.max(0, frame.view.startMs)
      const endMs = frame.view.startMs + spanMs
      const bucketCount = Math.max(1, Math.round(width))
      const peaks = adapters.audio.getPeaks(startMs, endMs, bucketCount)
      if (peaks === null) return

      const count = Math.min(peaks.min.length, peaks.max.length)
      context.fillStyle = 'rgba(76, 141, 255, 0.66)'
      for (let index = 0; index < count; index += 1) {
        const bucketMs = peaks.startMs + (index + 0.5) * peaks.msPerBucket
        const x = timeToX(bucketMs, frame.view)
        if (x < -2 || x > width + 2) continue
        const top = center - peaks.max[index] * amplitude
        const bottom = center - peaks.min[index] * amplitude
        const barHeight = Math.max(1, bottom - top)
        context.fillRect(Math.round(x), top, 1, barHeight)
      }
    }

    const unsubscribe = kernel.subscribeFrame(draw)
    kernel.invalidate()
    return unsubscribe
  }, [adapters, kernel])

  const placeholder =
    peakState === 'building'
      ? '波形准备中…'
      : peakState === 'error'
        ? '波形生成失败'
        : null

  return (
    <div ref={containerRef} className="relative min-h-0 flex-1 bg-panel/25">
      <canvas ref={canvasRef} className="block h-full w-full" />
      {placeholder !== null ? (
        <span className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[11px] text-neutral-500">
          {placeholder}
        </span>
      ) : null}
    </div>
  )
}
