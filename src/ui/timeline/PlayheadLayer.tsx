import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { useAdapters } from '../context/AdapterContext'
import { useSettingsStore } from '../stores/settingsStore'
import {
  beginScrub,
  endScrub,
  getScrubMs,
  moveScrub,
  pauseAudioOnGesture,
  resolvePlayheadMs,
  seekPlayhead,
} from '../utils/editorCommands'
import { useEditorStore } from '../stores/editorStore'
import {
  EDGE_PAN_MAX_SPEED_PX_PER_S,
  EDGE_ZONE_PX,
  LYRIC_TRACK_HEIGHT_PX,
  RULER_HEIGHT_PX,
} from './constants'
import { timeToX, xToTime } from './timeMap'
import { useTimelineFrame, type TimelineFrame } from './useTimelineViewport'
import { useTimelineViewportContext } from './viewportContext'

/**
 * 播放头层 —— 贯穿波形与歌词区的独立层（架构文档 §13：播放头独立层）。
 *
 * ## 渲染源
 * 取 {@link resolvePlayheadMs}：拖动中是拖动会话值；有音频时是音频端口时钟
 * （每帧可读，§6.4 唯一基准）；无音频时退回 store 承载的播放头位置
 * （端口恒为 0，会把播放头钉死在 0 处）。
 *
 * 本层**不订阅 store**、不做 React 重渲染：只走命令式帧回调，
 * 否则 10Hz 的 `playheadMs` 会和音频时钟打架、来回跳。
 *
 * ## 命中区
 * 外层外壳 `absolute inset-0 pointer-events-none`（hostRect 宿主，与图层容器同矩形），
 * 内部两个热区共用同一套 pointer handler，构成全条时间轴的统一拖拽入口：
 * - **尺子带**：全宽、`0 ~ RULER_HEIGHT_PX`，覆盖整条刻度尺（原 canvas 擦洗手势已删除），
 *   `pointer-events-auto` 后可命中；
 * - **9px 竖条**：以 1px 线居中（`-left-[4px]`），纵向覆盖「分析轨 + 波形带」
 *   （`top: RULER_HEIGHT_PX`, `bottom: LYRIC_TRACK_HEIGHT_PX`），仅避开歌词带
 *   （那里要能拖歌词块）。
 * 被 transform 移动的根（1px 线 / 顶部块）与热区已在结构上分离：热区不随播放头移动。
 *
 * ## 拖动语义（产品定死）
 * 按住即接管（不等移动）；接管后播放头 1:1 跟鼠标、无平滑无补间；
 * 指针进入视口两侧 `EDGE_ZONE_PX` 触发带时改为**边缘自动滚**：视口按与
 * 越界深度成正比的速度持续前进，播放头钉在视口边缘（夹进 `[0, W]`，不留白）
 * 随视口前移（鼠标停住时间也持续走，沿用滚动条的边缘滚范式）。
 * 拖动期间每帧把当前时间镜像进 store（仅 store，不 seek），保证底部读数实时更新。
 */
export function PlayheadLayer() {
  const adapters = useAdapters()
  const { kernel, durationMs } = useTimelineViewportContext()
  const headRef = useRef<HTMLDivElement | null>(null)
  const pointerIdRef = useRef<number | null>(null)
  /** 边缘自动滚激活时钉住的播放头屏幕位（视口内 x）；非激活为 null。 */
  const edgeXRef = useRef<number | null>(null)

  const handleFrame = useCallback(
    (frame: TimelineFrame) => {
      const head = headRef.current
      if (head === null) return
      // 边缘自动滚激活时：播放头钉在固定屏幕位，随时间轴每帧前移重算时间
      const edgeX = edgeXRef.current
      if (edgeX !== null) {
        moveScrub(Math.min(durationMs, Math.max(0, xToTime(edgeX, frame.view))))
      }
      // 拖动期间每帧把当前时间镜像进 store（仅 store，不 seek）：
      // 边缘自动滚时鼠标不动、时间仍在走，只有每帧写才能让底部读数实时更新。
      // 门控本层热区拖动；正常播放走 useAudioPlayback 的 10Hz 节流镜像。
      if (pointerIdRef.current !== null) {
        useEditorStore.getState().setPlayhead(resolvePlayheadMs(adapters))
      }
      const x = timeToX(resolvePlayheadMs(adapters), {
        startMs: frame.view.startMs,
        pixelsPerMs: frame.view.pixelsPerMs,
      })
      head.style.transform = `translate3d(${x}px, 0, 0)`
    },
    [adapters, durationMs],
  )

  useTimelineFrame(kernel, handleFrame)

  /**
   * 热区宿主：`headRef.current.parentElement` 现为外层外壳（`absolute inset-0`），
   * 它与图层容器同矩形，故 x 换算与旧写法（父即容器）等价、无漂移。
   */
  const hostRect = (): DOMRect | null => {
    const parent = headRef.current?.parentElement
    return parent === undefined || parent === null ? null : parent.getBoundingClientRect()
  }

  /**
   * 按指针横坐标接管播放头（**跟手，无平滑**）。
   *
   * `view` 必须在 pan 之前读：`frame.view` 只在 rAF 内刷新，
   * pan 后立即读会滞后一帧。
   *
   * 指针落在视口两侧 `EDGE_ZONE_PX` 触发带内时，改为驱动内核**边缘自动滚**
   * （速度与越界深度成正比），播放头钉在视口边缘、随视口每帧前移
   * （每帧重算见 {@link handleFrame}）；否则停掉自动滚，播放头 1:1 跟手。
   */
  const applyPointer = (clientX: number): void => {
    const rect = hostRect()
    if (rect === null) return
    const rawX = clientX - rect.left
    const widthPx = kernel.getViewportSize().widthPx
    if (widthPx <= 0) return

    const view = kernel.getFrame().view
    const left = rawX < EDGE_ZONE_PX
    const right = rawX > widthPx - EDGE_ZONE_PX

    if (left || right) {
      // 越界越深 → 速度越快（与滚动条边缘自动滚同一范式）
      const overshoot = left ? EDGE_ZONE_PX - rawX : rawX - (widthPx - EDGE_ZONE_PX)
      const t = Math.min(1, Math.max(0, overshoot / EDGE_ZONE_PX))
      const velocity = t * EDGE_PAN_MAX_SPEED_PX_PER_S
      kernel.startAutoPan(left ? -velocity : velocity)
      // 播放头钉在视口边缘（夹进 [0, W]，不留白），时间按该固定屏幕位算
      const edgeX = Math.min(widthPx, Math.max(0, rawX))
      edgeXRef.current = edgeX
      moveScrub(Math.min(durationMs, Math.max(0, xToTime(edgeX, view))))
    } else {
      kernel.stopAutoPan()
      edgeXRef.current = null
      moveScrub(Math.min(durationMs, Math.max(0, xToTime(rawX, view))))
    }
    kernel.invalidate()
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    pointerIdRef.current = event.pointerId
    event.currentTarget.setPointerCapture(event.pointerId)
    // 先真暂停再 seek：pause 后 wasPlaying=false，seek 不会重建 source 节点
    pauseAudioOnGesture(adapters, useSettingsStore.getState().settings.pauseAudioOnSeek)
    // 按住即接管：先落会话初值，再按指针位置接管
    beginScrub(resolvePlayheadMs(adapters))
    kernel.suspendFollow()
    applyPointer(event.clientX)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (pointerIdRef.current !== event.pointerId) return
    applyPointer(event.clientX)
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (pointerIdRef.current !== event.pointerId) return
    pointerIdRef.current = null
    // 用松手坐标重算，避免最后一个 move 丢帧导致落点偏
    applyPointer(event.clientX)
    // 必须后于 applyPointer：它可能重新启动 autoPan
    kernel.stopAutoPan()
    edgeXRef.current = null
    // 顺序：先 seek 再清锁 —— 清锁后 resolvePlayheadMs 立刻退回时钟/store，
    // 若此时尚未写入会视觉跳回一帧
    seekPlayhead(adapters, getScrubMs() ?? resolvePlayheadMs(adapters))
    endScrub()
    kernel.clearFollowSuspension()
    kernel.invalidate()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      {/* 被 transform 移动的根：1px 线 / 顶部块 / 9px 竖条随播放头移动 */}
      <div
        ref={headRef}
        className="pointer-events-none absolute left-0 top-0 h-full w-0 will-change-transform"
      >
        <div className="absolute top-0 h-full w-px bg-accent" />
        <div className="absolute -left-[3px] top-0 h-1.5 w-[7px] rounded-b-sm bg-accent" />
        <div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className="-left-[4px] pointer-events-auto absolute w-[9px] cursor-col-resize touch-none select-none"
          style={{ top: RULER_HEIGHT_PX, bottom: LYRIC_TRACK_HEIGHT_PX }}
        />
      </div>
      {/* 全宽尺子带热区：不随播放头移动，覆盖整条刻度尺 */}
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="pointer-events-auto absolute left-0 top-0 w-full cursor-col-resize touch-none select-none"
        style={{ height: `${RULER_HEIGHT_PX}px` }}
      />
    </div>
  )
}
