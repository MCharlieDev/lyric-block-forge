import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { useAdapters } from '../context/AdapterContext'
import { useEditorStore } from '../stores/editorStore'
import { useSettingsStore } from '../stores/settingsStore'
import { pauseAudioOnGesture } from '../utils/editorCommands'
import {
  PLAYHEAD_HINT_ARROW_HEIGHT_PX,
  PLAYHEAD_HINT_ARROW_WIDTH_PX,
  PLAYHEAD_HINT_EDGE_OFFSET_PX,
  PLAYHEAD_HINT_RESET_SIZE_PX,
} from './constants'
import { timeToX, xToTime } from './timeMap'
import { useTimelineFrame, type TimelineFrame } from './useTimelineViewport'
import { useTimelineViewportContext } from './viewportContext'

/**
 * 屏幕外播放头提示 —— 播放头跑出视口时贴在那一侧的箭头 + 归位按钮。
 *
 * ## 出现条件
 * 只要播放头不在视窗内就出现（无论是因为拖块挂起、B 模式暂停跟随、
 * 还是手动把视口拖走），跑出哪一侧就贴哪一侧；回到视窗内立即消失。
 *
 * ## 箭头被按下之后
 * 播放头瞬移到指针处、箭头随即让位（透明但仍挂载，避免丢失 pointer capture），
 * 之后就是普通播放头拖动：跟手，且被夹在 `[0, 视口宽]`，只能往视窗内拖。
 *
 * ## 归位按钮
 * 与箭头同时出现。点击 = 视口拉回播放头（带动画），并在 B 模式下恢复跟随。
 */
export function PlayheadOffscreenHint() {
  const adapters = useAdapters()
  const { kernel, durationMs } = useTimelineViewportContext()
  const setPlayhead = useEditorStore((state) => state.setPlayhead)

  const arrowRef = useRef<HTMLButtonElement | null>(null)
  const resetRef = useRef<HTMLButtonElement | null>(null)
  /** 拖动期间跳过帧更新：元素必须保持挂载，否则 pointer capture 会丢。 */
  const draggingRef = useRef(false)
  const pointerIdRef = useRef<number | null>(null)

  /** 提示元素的宿主：图层容器，用于把指针横坐标换算成视口内 x。 */
  const hostRect = (): DOMRect | null => {
    const parent = arrowRef.current?.parentElement
    return parent === undefined || parent === null ? null : parent.getBoundingClientRect()
  }

  const handleFrame = useCallback(
    (frame: TimelineFrame) => {
      const arrow = arrowRef.current
      const reset = resetRef.current
      if (arrow === null || reset === null) return
      // 拖动中不做可见性判断：保持箭头挂载（透明），由指针事件驱动播放头
      if (draggingRef.current) return

      const widthPx = kernel.getViewportSize().widthPx
      if (widthPx <= 0) {
        arrow.style.display = 'none'
        reset.style.display = 'none'
        return
      }

      const x = timeToX(adapters.audio.getCurrentTimeMs(), frame.view)
      if (x >= 0 && x <= widthPx) {
        arrow.style.display = 'none'
        reset.style.display = 'none'
        return
      }

      const side: 'left' | 'right' = x < 0 ? 'left' : 'right'
      // 以最宽的提示元素为准算贴边的左边缘，两个元素共用一条基准线
      const box = PLAYHEAD_HINT_RESET_SIZE_PX
      const baseLeft =
        side === 'left' ? PLAYHEAD_HINT_EDGE_OFFSET_PX : widthPx - box - PLAYHEAD_HINT_EDGE_OFFSET_PX
      arrow.style.left = `${baseLeft + (box - PLAYHEAD_HINT_ARROW_WIDTH_PX) / 2}px`
      reset.style.left = `${baseLeft}px`
      arrow.textContent = side === 'left' ? '◀' : '▶'

      arrow.style.display = 'flex'
      reset.style.display = 'flex'
    },
    [adapters, kernel],
  )

  useTimelineFrame(kernel, handleFrame)

  /** 把指针横坐标夹进视窗，换算成时间并定位播放头。 */
  const seekToClientX = (clientX: number): void => {
    const rect = hostRect()
    if (rect === null || rect.width <= 0) return
    const inViewX = Math.min(rect.width, Math.max(0, clientX - rect.left))
    const frame = kernel.getFrame()
    const timeMs = xToTime(inViewX, { startMs: frame.view.startMs, pixelsPerMs: frame.view.pixelsPerMs })
    const clamped = Math.min(durationMs, Math.max(0, timeMs))
    setPlayhead(clamped)
    void adapters.audio.seek(clamped)
  }

  const handleArrowDown = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    draggingRef.current = true
    pointerIdRef.current = event.pointerId
    // 箭头让位给播放头，但保持挂载以免丢失 pointer capture
    event.currentTarget.style.opacity = '0'
    event.currentTarget.setPointerCapture(event.pointerId)
    // 先真暂停再 seek：pause 后 wasPlaying=false，seek 不会重建 source 节点
    pauseAudioOnGesture(adapters, useSettingsStore.getState().settings.pauseAudioOnSeek)
    seekToClientX(event.clientX)
  }

  const handleArrowMove = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (pointerIdRef.current !== event.pointerId) return
    seekToClientX(event.clientX)
  }

  const handleArrowUp = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (pointerIdRef.current !== event.pointerId) return
    draggingRef.current = false
    pointerIdRef.current = null
    event.currentTarget.style.opacity = '1'
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    // 松手后交给帧回调按 x 决定可见性
    kernel.invalidate()
  }

  const handleReset = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    // 归位 = 拉回播放头（带动画）+ 恢复跟随
    kernel.snapViewToPlayhead(adapters.audio.getCurrentTimeMs())
  }

  return (
    <>
      <button
        ref={arrowRef}
        type="button"
        onPointerDown={handleArrowDown}
        onPointerMove={handleArrowMove}
        onPointerUp={handleArrowUp}
        onPointerCancel={handleArrowUp}
        className="absolute top-1/2 z-10 -translate-y-1/2 cursor-col-resize touch-none select-none items-center justify-center rounded-sm bg-accent/90 leading-none text-white shadow"
        style={{
          display: 'none',
          width: `${PLAYHEAD_HINT_ARROW_WIDTH_PX}px`,
          height: `${PLAYHEAD_HINT_ARROW_HEIGHT_PX}px`,
          fontSize: '9px',
        }}
        aria-label="跳转到屏幕外的播放头"
      />
      <button
        ref={resetRef}
        type="button"
        onPointerDown={handleReset}
        className="absolute z-10 cursor-pointer touch-none select-none items-center justify-center rounded-sm border border-white/20 bg-panel leading-none text-white/80 hover:text-white"
        style={{
          display: 'none',
          top: `calc(50% + ${PLAYHEAD_HINT_ARROW_HEIGHT_PX / 2 + 4}px)`,
          width: `${PLAYHEAD_HINT_RESET_SIZE_PX}px`,
          height: `${PLAYHEAD_HINT_RESET_SIZE_PX}px`,
          fontSize: '11px',
        }}
        aria-label="归位到播放头"
      >
        ⌖
      </button>
    </>
  )
}
