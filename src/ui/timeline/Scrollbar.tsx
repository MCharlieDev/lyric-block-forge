import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { useAdapters } from '../context/AdapterContext'
import { useEditorStore } from '../stores/editorStore'
import { useSettingsStore } from '../stores/settingsStore'
import { pauseAudioOnGesture } from '../utils/editorCommands'
import {
  EDGE_PAN_MAX_SPEED_PX_PER_S,
  EDGE_ZONE_PX,
  SCROLLBAR_MIN_THUMB_PX,
  SCROLLBAR_SIZE_PX,
} from './constants'
import { useTimelineFrame, useTimelineSnapshot, type TimelineFrame } from './useTimelineViewport'
import { useTimelineViewportContext } from './viewportContext'

/**
 * 自绘滚动条（架构文档 §13：滚动条由内核驱动）。
 *
 * 因为滚动是"自研 transform 虚拟滚动"而非原生滚动，浏览器不会替我们画滚动条，
 * 只能自己画。拇指位置在**帧回调里命令式写**，不参与 React 重渲染，
 * 这样滚动时整条轨道上是零 React 开销的。
 *
 * 轨道与拇指都用带底色的实心块，保证在纯深色背景上也能一眼看见 ——
 * 滚动条"看不见"等于"没有滚动机制"。
 */

/** 计算拇指几何：位置与长度都按比例映射到轨道上。 */
function thumbGeometry(
  trackSizePx: number,
  contentSizePx: number,
  viewportSizePx: number,
  scrollPx: number,
): { sizePx: number; offsetPx: number } {
  if (trackSizePx <= 0 || contentSizePx <= 0) return { sizePx: 0, offsetPx: 0 }
  const ratio = Math.min(1, viewportSizePx / contentSizePx)
  const sizePx = Math.max(SCROLLBAR_MIN_THUMB_PX, trackSizePx * ratio)
  const maxScroll = Math.max(0, contentSizePx - viewportSizePx)
  const maxOffset = Math.max(0, trackSizePx - sizePx)
  const progress = maxScroll > 0 ? Math.min(1, Math.max(0, scrollPx / maxScroll)) : 0
  return { sizePx, offsetPx: progress * maxOffset }
}

/** 横向滚动条：位置与拇指长度都由内核帧状态驱动。 */
export function HorizontalScrollbar() {
  const { kernel, durationMs } = useTimelineViewportContext()
  const adapters = useAdapters()
  const snapshot = useTimelineSnapshot(kernel)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const thumbRef = useRef<HTMLDivElement | null>(null)
  const trackWidthRef = useRef(0)
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startScroll: number
    /** 本次拖拽是否发生过位移（用于松手时区分"点一下"与"真拖动"）。 */
    moved: boolean
    /** 指针是否处于轨道边缘区（进入即冻结位移映射，改由自动滚驱动）。 */
    inEdgeZone: boolean
  } | null>(null)

  useEffect(() => {
    const track = trackRef.current
    if (track === null) return
    const observer = new ResizeObserver(() => {
      trackWidthRef.current = track.clientWidth
      kernel.invalidate()
    })
    observer.observe(track)
    trackWidthRef.current = track.clientWidth
    return () => observer.disconnect()
  }, [kernel])

  const handleFrame = useCallback(
    (frame: TimelineFrame) => {
      const thumb = thumbRef.current
      if (thumb === null) return
      const trackSize = trackWidthRef.current
      const content = durationMs * frame.view.pixelsPerMs
      const viewport = kernel.getViewportSize().widthPx
      const geometry = thumbGeometry(trackSize, content, viewport, frame.view.startMs * frame.view.pixelsPerMs)
      thumb.style.width = `${geometry.sizePx}px`
      thumb.style.transform = `translate3d(${geometry.offsetPx}px, 0, 0)`
    },
    [durationMs, kernel],
  )

  useTimelineFrame(kernel, handleFrame)

  const ratio = (): number => {
    const viewport = kernel.getViewportSize().widthPx
    const content = durationMs * snapshot.pixelsPerMs
    return content > 0 ? Math.min(1, viewport / content) : 1
  }

  // 平移手势起始：按设置真暂停音频；B 模式下手动平移即进入暂停跟随态。
  const beginPanGesture = (): void => {
    const settings = useSettingsStore.getState().settings
    pauseAudioOnGesture(adapters, settings.pauseAudioOnPan)
    if (settings.followResumeMode === 'pause') kernel.setFollowPaused(true)
  }

  const handleThumbDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.stopPropagation()
    beginPanGesture()
    // 挂起跟随（只放这里，不能放 beginPanGesture：点轨共用它且无 pointerup 收尾，
    // 挂起会永久卡死）
    kernel.suspendFollow()
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startScroll: kernel.getFrame().view.startMs * kernel.getFrame().view.pixelsPerMs,
      moved: false,
      inEdgeZone: false,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handleThumbMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (drag === null || drag.pointerId !== event.pointerId) return
    const factor = ratio()
    if (factor <= 0) return
    const track = trackRef.current
    if (track === null) return
    const rect = track.getBoundingClientRect()
    const leftZone = event.clientX < rect.left + EDGE_ZONE_PX
    const rightZone = event.clientX > rect.right - EDGE_ZONE_PX

    if (leftZone || rightZone) {
      // 进入边缘区：冻结位移映射，改由内核按"超出边缘的距离"比例驱动自动滚
      drag.inEdgeZone = true
      const overshoot = leftZone
        ? rect.left + EDGE_ZONE_PX - event.clientX
        : event.clientX - (rect.right - EDGE_ZONE_PX)
      const t = Math.min(1, Math.max(0, overshoot / EDGE_ZONE_PX))
      const velocity = t * EDGE_PAN_MAX_SPEED_PX_PER_S
      kernel.startAutoPan(leftZone ? -velocity : velocity)
      drag.moved = true
      return
    }

    if (drag.inEdgeZone) {
      // 离开边缘区：停自动滚，并以"当前位置"重设基线，避免映射回跳
      drag.inEdgeZone = false
      kernel.stopAutoPan()
      drag.startX = event.clientX
      drag.startScroll = kernel.getFrame().view.startMs * kernel.getFrame().view.pixelsPerMs
    }

    const target = drag.startScroll + (event.clientX - drag.startX) / factor
    const current = kernel.getFrame().view.startMs * kernel.getFrame().view.pixelsPerMs
    kernel.panByPixels(target - current)
    drag.moved = true
  }

  const handleThumbUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (drag === null || drag.pointerId !== event.pointerId) return
    kernel.stopAutoPan()
    const settings = useSettingsStore.getState().settings
    const playing = useEditorStore.getState().playback.isPlaying
    // 真拖动过才按口径恢复；点一下（无位移）只解除挂起。
    // 且仅当手势结束时仍在播放才 snap 拉回，否则视口留在原地。
    if (drag.moved && settings.followResumeMode === 'snap' && playing) {
      kernel.resumeFollow('snap', adapters.audio.getCurrentTimeMs())
    } else {
      kernel.clearFollowSuspension()
    }
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const handleTrackDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const track = trackRef.current
    if (track === null) return
    const factor = ratio()
    if (factor <= 0 || factor >= 1) return
    beginPanGesture()
    const rect = track.getBoundingClientRect()
    // 点击轨道空白：把拇指居中到点击处
    const thumbSize = track.clientWidth * factor
    const target = (event.clientX - rect.left - thumbSize / 2) / factor / snapshot.pixelsPerMs
    kernel.panByPixels(target * snapshot.pixelsPerMs - kernel.getFrame().view.startMs * snapshot.pixelsPerMs)
  }

  return (
    <div
      ref={trackRef}
      onPointerDown={handleTrackDown}
      className="relative w-full shrink-0 border-t border-divider bg-white/[0.06]"
      style={{ height: `${SCROLLBAR_SIZE_PX}px` }}
    >
      <div
        ref={thumbRef}
        onPointerDown={handleThumbDown}
        onPointerMove={handleThumbMove}
        onPointerUp={handleThumbUp}
        onPointerCancel={handleThumbUp}
        className="absolute left-0 top-0 h-full rounded-full bg-neutral-600 hover:bg-neutral-500 active:bg-accent"
        style={{ width: '0px' }}
      />
    </div>
  )
}
