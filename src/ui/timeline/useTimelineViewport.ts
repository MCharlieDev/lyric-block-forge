import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import {
  FOLLOW_ANIMATION_MS,
  FOLLOW_TARGET_RATIO,
  FOLLOW_TRIGGER_RATIO,
  OVERSCAN_RATIO,
  REWINDOW_RATIO,
} from './constants'
import { clampPixelsPerMs, fitPixelsPerMs, timeToX, xToTime, type TimeView } from './timeMap'

/**
 * 时间轴同步内核 —— 整套"同生共死"的唯一真相源。
 *
 * ## 为什么不用原生滚动
 * 原生滚动容器里，波形（canvas）与歌词块（DOM）各自滚动，浏览器对两者
 * 的合成时机与亚像素取整并不一致，缩放到字级时会看到波形与歌词错开半像素。
 * 这里把三层的定位统一成一次 `translate3d` 写入，天然对齐。
 *
 * ## 模型
 * - `viewStartMs`（视口左边缘时间）与 `pixelsPerMs`（缩放）是**唯一状态**；
 * - 所有图层从 {@link TimelineViewportKernel.getFrame} 取同一帧的换算结果；
 * - 平移、缩放只改这两个值，再 `invalidate()`，由内核自己的 rAF 统一广播，
 *   因此同一帧内所有图层看到的是同一份数值 —— 这就是"同生共死"。
 *
 * ## 两级订阅
 * - {@link TimelineViewportKernel.subscribeFrame}：每帧命令式回调，
 *   用于写 `transform` 与重绘 canvas，**不触发 React 重渲染**；
 * - {@link TimelineViewportKernel.subscribe}：仅当"渲染窗口"变化时才通知，
 *   供 `useSyncExternalStore` 驱动 React 重渲染列表。
 *
 * 滚动过程中绝大多数帧只走前者，这也是零重渲染滚动的关键。
 */

/** 渲染窗口：视口外扩一圈 overscan 后的时间区间，列表只需渲染这一段。 */
export interface RenderWindow {
  /** 窗口起点（毫秒） */
  startMs: number
  /** 窗口终点（毫秒） */
  endMs: number
}

/** 供 React 消费的快照：窗口 + 缩放。 */
export interface TimelineSnapshot {
  /** 渲染窗口起点（毫秒） */
  windowStartMs: number
  /** 渲染窗口终点（毫秒） */
  windowEndMs: number
  /** 缩放：每毫秒像素 */
  pixelsPerMs: number
  /** 内容总时长（毫秒） */
  durationMs: number
  /** 缩放下限（铺满视口），用于限制缩放控件 */
  minPixelsPerMs: number
  /** 视口宽度（像素） */
  viewportWidthPx: number
}

/** 每帧广播的帧状态。**用同一个对象复用**，回调里不要长期持有。 */
export interface TimelineFrame {
  /** 当前时间映射 */
  view: TimeView
  /** 当前渲染窗口 */
  window: RenderWindow
}

/** 帧回调。 */
export type TimelineFrameListener = (frame: TimelineFrame) => void

/** 进行中的跟随动画状态。 */
interface FollowAnimation {
  fromStartMs: number
  toStartMs: number
  /** 动画起始时间（`performance.now()` 时基，与 rAF 时间戳同源）。 */
  startedAtMs: number
  /** 独立 rAF 句柄（不能复用一次性 `scheduleFrame`）。 */
  handle: number
}

/** 时间轴同步内核。 */
export interface TimelineViewportKernel {
  /** 绑定视口元素（负责测量尺寸与监听尺寸变化）；传 `null` 解绑。 */
  attachViewport(element: HTMLElement | null): void
  /** 设置内容总时长（毫秒）。首次设置会自动缩放至铺满。 */
  setDuration(durationMs: number): void

  /** 读取 React 快照。未变化时返回同一对象引用。 */
  getSnapshot(): TimelineSnapshot
  /** 读取当前帧状态。回调内不要长期持有。 */
  getFrame(): TimelineFrame
  /** 读取视口尺寸。 */
  getViewportSize(): { widthPx: number }

  /** 订阅窗口变化（驱动 React 重渲染）。 */
  subscribe(listener: () => void): () => void
  /** 订阅每帧（命令式写 transform / 重绘 canvas）。 */
  subscribeFrame(listener: TimelineFrameListener): () => void
  /** 标记需要重绘一帧。 */
  invalidate(): void

  /** 在时间轴上平移：正数表示视口向未来方向移动。 */
  panByPixels(dxPx: number): void
  /** 以视口内某个横坐标为锚点缩放。 */
  zoomAt(anchorXPx: number, factor: number): void
  /** 缩放到完整显示全部内容。 */
  zoomToFit(): void
  /** 播放中自动跟随播放头（越过视口右侧阈值才推动）。 */
  followPlayhead(timeMs: number): void
  /** 立即取消进行中的跟随动画（用户手势打断时调用）。 */
  cancelFollowAnimation(): void
  /** 挂起跟随（拖歌词块期间），并取消进行中的动画。 */
  suspendFollow(): void
  /** 仅解除挂起，不改动跟随状态（用于"按块但未真正拖动"的点击）。 */
  clearFollowSuspension(): void
  /**
   * 按设置恢复跟随。
   *
   * - `snap`：立即拉回（带动画）；`pause`：进入跟随暂停态（B 模式）。
   */
  resumeFollow(mode: 'snap' | 'pause', timeMs: number): void
  /** 设置或清除"跟随暂停"（B 模式下手动平移即进入暂停）。 */
  setFollowPaused(paused: boolean): void
  /** 把视口拉回播放头（带动画）并恢复跟随（"归位"按钮）。 */
  snapViewToPlayhead(timeMs: number): void
  /** 释放内部资源。 */
  destroy(): void
}

/** 初始缩放：20 像素 / 秒。首次拿到时长后会被 `zoomToFit` 覆盖。 */
const INITIAL_PIXELS_PER_MS = 0.02

/**
 * 创建时间轴同步内核。
 *
 * @returns 内核实例
 */
export function createTimelineViewportKernel(): TimelineViewportKernel {
  let viewportEl: HTMLElement | null = null
  let resizeObserver: ResizeObserver | null = null

  let viewportWidthPx = 0

  let durationMs = 0
  let viewStartMs = 0
  let pixelsPerMs = INITIAL_PIXELS_PER_MS
  let minPixelsPerMs = INITIAL_PIXELS_PER_MS

  let window_: RenderWindow = { startMs: 0, endMs: 0 }
  /** 首次拿到"宽度 + 时长"时自动铺满，只做一次 */
  let needsFit = true

  const snapshotListeners = new Set<() => void>()
  const frameListeners = new Set<TimelineFrameListener>()

  let frameHandle: number | null = null

  /* ------------------------------------------------------------------ *
   * 跟随控制
   * ------------------------------------------------------------------ */

  /** B 模式：手动平移后进入"跟随暂停"，视口不再自动移动。 */
  let followPaused = false
  /** 拖歌词块期间挂起跟随（无论何种模式），避免拖不准。 */
  let followSuspended = false

  /** 进行中的跟随动画；非空时 `followPlayhead` 直接返回，避免重复翻页。 */
  let animation: FollowAnimation | null = null

  // 帧状态复用同一个对象，避免 60fps 下持续分配
  const frame: TimelineFrame = { view: { startMs: 0, pixelsPerMs: INITIAL_PIXELS_PER_MS }, window: window_ }

  let snapshot: TimelineSnapshot = {
    windowStartMs: 0,
    windowEndMs: 0,
    pixelsPerMs: INITIAL_PIXELS_PER_MS,
    durationMs: 0,
    minPixelsPerMs: INITIAL_PIXELS_PER_MS,
    viewportWidthPx: 0,
  }

  /** 视口宽度换算成的时间长度（毫秒）。 */
  const visibleMs = (): number => (pixelsPerMs > 0 ? viewportWidthPx / pixelsPerMs : 0)

  /** 重算渲染窗口（含 overscan）。 */
  const computeWindow = (): RenderWindow => {
    const span = visibleMs()
    const overscan = span * OVERSCAN_RATIO
    return { startMs: viewStartMs - overscan, endMs: viewStartMs + span + overscan }
  }

  /**
   * 视口相对窗口锚点漂移过多、或窗口已容不下当前视口时重算窗口。
   *
   * 窗口 = 视口左右各外扩 `OVERSCAN_RATIO × 视口宽度`，
   * 因此只要视口没有跑到窗口边缘附近，就不必重建 —— 这是"滚动不重渲染"的前提。
   */
  const rewindowIfNeeded = (): void => {
    const span = visibleMs()
    const overscan = span * OVERSCAN_RATIO
    const windowSpan = window_.endMs - window_.startMs
    const requiredSpan = span * (1 + 2 * OVERSCAN_RATIO)
    const drift = viewStartMs - (window_.startMs + overscan)
    const tooSmall = windowSpan < requiredSpan * 0.999
    const drifted = Math.abs(drift) > overscan * REWINDOW_RATIO
    if (tooSmall || drifted) window_ = computeWindow()
  }

  const scheduleFrame = (): void => {
    if (frameHandle !== null) return
    frameHandle = window.requestAnimationFrame(() => {
      frameHandle = null
      frame.view.startMs = viewStartMs
      frame.view.pixelsPerMs = pixelsPerMs
      frame.window = window_
      for (const listener of frameListeners) listener(frame)
    })
  }

  /** 提交一次状态变更：修窗口 → 视需要通知 React → 广播一帧。 */
  const commit = (): void => {
    // 视口变宽（例如右侧面板收起）后，原来的 viewStartMs 可能已经越过末尾，
    // 会把内容推到左边、右边留一片空白，所以每次提交前先夹一次。
    const maxStartMs = Math.max(0, durationMs - visibleMs())
    if (viewStartMs > maxStartMs) viewStartMs = maxStartMs
    rewindowIfNeeded()
    minPixelsPerMs = viewportWidthPx > 0 && durationMs > 0 ? fitPixelsPerMs(durationMs, viewportWidthPx) : minPixelsPerMs
    if (
      snapshot.windowStartMs !== window_.startMs ||
      snapshot.windowEndMs !== window_.endMs ||
      snapshot.pixelsPerMs !== pixelsPerMs ||
      snapshot.durationMs !== durationMs ||
      snapshot.minPixelsPerMs !== minPixelsPerMs ||
      snapshot.viewportWidthPx !== viewportWidthPx
    ) {
      snapshot = {
        windowStartMs: window_.startMs,
        windowEndMs: window_.endMs,
        pixelsPerMs,
        durationMs,
        minPixelsPerMs,
        viewportWidthPx,
      }
      for (const listener of snapshotListeners) listener()
    }
    scheduleFrame()
  }

  /** 把视口起点夹进合法范围 `[0, durationMs - 视口时长]`。 */
  const clampStartMs = (nextStartMs: number): number => {
    const maxStart = Math.max(0, durationMs - visibleMs())
    return Math.min(maxStart, Math.max(0, nextStartMs))
  }

  /** 应用一组新的视口参数（含边界裁剪）。 */
  const applyView = (nextStartMs: number, nextPixelsPerMs: number): void => {
    pixelsPerMs = Math.max(nextPixelsPerMs, 1e-9)
    viewStartMs = clampStartMs(nextStartMs)
    commit()
  }

  /** 跟随目标：把 `timeMs` 放到视口 `FOLLOW_TARGET_RATIO` 处所需的视口起点。 */
  const followTargetStartMs = (timeMs: number): number =>
    timeMs - (viewportWidthPx * FOLLOW_TARGET_RATIO) / pixelsPerMs

  /** 停止进行中的跟随动画（幂等）。 */
  const stopFollowAnimation = (): void => {
    if (animation === null) return
    window.cancelAnimationFrame(animation.handle)
    animation = null
  }

  /**
   * 启动一段平滑跟随动画。
   *
   * 用**独立 rAF 循环**（`scheduleFrame` 是一次性去重帧，不能当循环用），
   * 每帧 `applyView` → `commit`，因此所有图层在同一帧看到同一份数值。
   */
  const startFollowAnimation = (targetStartMs: number): void => {
    stopFollowAnimation()
    const target = clampStartMs(targetStartMs)
    if (Math.abs(target - viewStartMs) < 0.5) return
    const anim: FollowAnimation = {
      fromStartMs: viewStartMs,
      toStartMs: target,
      startedAtMs: performance.now(),
      handle: 0,
    }
    animation = anim
    const step = (now: number): void => {
      if (animation !== anim) return
      const t = Math.min(1, (now - anim.startedAtMs) / FOLLOW_ANIMATION_MS)
      const eased = t * t * (3 - 2 * t) // smoothstep：起止平缓
      if (t >= 1) {
        animation = null
        // 结束对齐精确目标，避免浮点残差
        applyView(anim.toStartMs, pixelsPerMs)
        return
      }
      applyView(anim.fromStartMs + (anim.toStartMs - anim.fromStartMs) * eased, pixelsPerMs)
      anim.handle = window.requestAnimationFrame(step)
    }
    anim.handle = window.requestAnimationFrame(step)
  }

  const maybeFit = (): void => {
    if (!needsFit || viewportWidthPx <= 0 || durationMs <= 0) return
    needsFit = false
    applyView(0, fitPixelsPerMs(durationMs, viewportWidthPx))
  }

  const syncViewportSize = (): void => {
    viewportWidthPx = viewportEl === null ? 0 : viewportEl.clientWidth
  }

  return {
    attachViewport(element) {
      if (viewportEl === element) return
      resizeObserver?.disconnect()
      resizeObserver = null
      viewportEl = element
      if (element === null) {
        syncViewportSize()
        commit()
        return
      }
      resizeObserver = new ResizeObserver(() => {
        syncViewportSize()
        maybeFit()
        commit()
      })
      resizeObserver.observe(element)
      syncViewportSize()
      maybeFit()
      commit()
    },

    setDuration(next) {
      const value = Math.max(0, next)
      if (value === durationMs) return
      durationMs = value
      // 换了音频就重新铺满，随后用户自己缩放
      needsFit = true
      minPixelsPerMs = viewportWidthPx > 0 && durationMs > 0 ? fitPixelsPerMs(durationMs, viewportWidthPx) : minPixelsPerMs
      maybeFit()
      commit()
    },

    getSnapshot: () => snapshot,
    getFrame: () => frame,
    getViewportSize: () => ({ widthPx: viewportWidthPx }),

    subscribe(listener) {
      snapshotListeners.add(listener)
      return () => snapshotListeners.delete(listener)
    },

    subscribeFrame(listener) {
      frameListeners.add(listener)
      return () => frameListeners.delete(listener)
    },

    invalidate: scheduleFrame,

    panByPixels(dxPx) {
      // 手势打断：动画立即停在当前位置
      stopFollowAnimation()
      applyView(viewStartMs + dxPx / pixelsPerMs, pixelsPerMs)
    },

    zoomAt(anchorXPx, factor) {
      stopFollowAnimation()
      const anchorTimeMs = xToTime(anchorXPx, { startMs: viewStartMs, pixelsPerMs })
      const nextPixelsPerMs = clampPixelsPerMs(pixelsPerMs * factor, minPixelsPerMs)
      if (nextPixelsPerMs === pixelsPerMs) return
      applyView(anchorTimeMs - anchorXPx / nextPixelsPerMs, nextPixelsPerMs)
    },

    zoomToFit() {
      stopFollowAnimation()
      needsFit = false
      if (viewportWidthPx <= 0 || durationMs <= 0) return
      applyView(0, fitPixelsPerMs(durationMs, viewportWidthPx))
    },

    followPlayhead(timeMs) {
      if (viewportWidthPx <= 0) return
      // 跟随暂停 / 拖块挂起 / 动画进行中，一律不推动视口
      if (followPaused || followSuspended || animation !== null) return
      const x = timeToX(timeMs, { startMs: viewStartMs, pixelsPerMs })
      // 视口左侧安全区内，无需跟随
      if (x >= 0 && x <= viewportWidthPx * FOLLOW_TRIGGER_RATIO) return
      const targetStartMs = followTargetStartMs(timeMs)
      // 播放头已在屏幕外：直接跳（不加动画）
      if (x < 0 || x > viewportWidthPx) {
        applyView(targetStartMs, pixelsPerMs)
        return
      }
      // 屏内越过触发点：平滑推进
      startFollowAnimation(targetStartMs)
    },

    cancelFollowAnimation() {
      stopFollowAnimation()
    },

    suspendFollow() {
      stopFollowAnimation()
      followSuspended = true
    },

    clearFollowSuspension() {
      followSuspended = false
    },

    resumeFollow(mode, timeMs) {
      stopFollowAnimation()
      followSuspended = false
      if (mode === 'pause') {
        followPaused = true
        return
      }
      // snap：立即拉回（屏内带动画 / 屏外直接跳）
      followPaused = false
      if (viewportWidthPx <= 0) return
      const x = timeToX(timeMs, { startMs: viewStartMs, pixelsPerMs })
      if (x >= 0 && x <= viewportWidthPx * FOLLOW_TRIGGER_RATIO) return
      const targetStartMs = followTargetStartMs(timeMs)
      if (x < 0 || x > viewportWidthPx) {
        applyView(targetStartMs, pixelsPerMs)
        return
      }
      startFollowAnimation(targetStartMs)
    },

    setFollowPaused(paused) {
      followPaused = paused
      if (paused) stopFollowAnimation()
    },

    snapViewToPlayhead(timeMs) {
      // 归位 = 拉回 + 恢复跟随
      followPaused = false
      followSuspended = false
      if (viewportWidthPx <= 0) return
      startFollowAnimation(followTargetStartMs(timeMs))
    },

    destroy() {
      stopFollowAnimation()
      resizeObserver?.disconnect()
      resizeObserver = null
      viewportEl = null
      if (frameHandle !== null) {
        window.cancelAnimationFrame(frameHandle)
        frameHandle = null
      }
      snapshotListeners.clear()
      frameListeners.clear()
    },
  }
}

/**
 * 创建并持有内核实例（组件卸载时释放）。
 *
 * @returns 内核实例，整个生命周期内引用稳定
 */
export function useTimelineViewportKernel(): TimelineViewportKernel {
  const [kernel] = useState(createTimelineViewportKernel)
  useEffect(() => () => kernel.destroy(), [kernel])
  return kernel
}

/**
 * 订阅内核快照。
 *
 * @param kernel 内核
 * @returns 当前快照
 */
export function useTimelineSnapshot(kernel: TimelineViewportKernel): TimelineSnapshot {
  const subscribe = useCallback((listener: () => void) => kernel.subscribe(listener), [kernel])
  const getSnapshot = useCallback(() => kernel.getSnapshot(), [kernel])
  return useSyncExternalStore(subscribe, getSnapshot)
}

/**
 * 取得绑定到视口元素的 ref 回调。
 *
 * @param kernel 内核
 * @returns 传给 `ref` 的稳定回调
 */
export function useViewportRef(kernel: TimelineViewportKernel): (element: HTMLElement | null) => void {
  return useCallback((element: HTMLElement | null) => kernel.attachViewport(element), [kernel])
}

/**
 * 订阅每帧回调。
 *
 * @param kernel 内核
 * @param listener 帧回调
 */
export function useTimelineFrame(kernel: TimelineViewportKernel, listener: TimelineFrameListener): void {
  useEffect(() => kernel.subscribeFrame(listener), [kernel, listener])
}
