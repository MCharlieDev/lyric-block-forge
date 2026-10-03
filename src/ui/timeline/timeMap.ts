import { GRID_STEPS_MS, MAX_PIXELS_PER_MS, MIN_PIXELS_PER_MS } from './constants'

/**
 * 时间轴唯一的时间↔像素换算层。
 *
 * 三层（波形 / 刻度 / 歌词块）必须"同生共死"，做法就是：**只在这里做换算**。
 * 任何图层都不许自己乘系数，只允许调用这里，并共享同一个 {@link TimeView}。
 *
 * 换算公式（架构文档 §6.1）：
 * ```
 * x = (timeMs - view.startMs) * view.pixelsPerMs
 * ```
 */

/** 视口的时间映射。 */
export interface TimeView {
  /** 视口左边缘对应的时间（毫秒） */
  startMs: number
  /** 缩放：每毫秒占多少像素 */
  pixelsPerMs: number
}

/**
 * 时间 → 像素。
 *
 * @param timeMs 时间（毫秒）
 * @param view 时间映射
 * @returns 相对视口左边缘的像素坐标
 */
export function timeToX(timeMs: number, view: TimeView): number {
  return (timeMs - view.startMs) * view.pixelsPerMs
}

/**
 * 像素 → 时间。
 *
 * @param x 相对视口左边缘的像素坐标
 * @param view 时间映射
 * @returns 时间（毫秒）
 */
export function xToTime(x: number, view: TimeView): number {
  return view.startMs + x / view.pixelsPerMs
}

/**
 * 时长 → 像素宽度。
 *
 * @param durationMs 时长（毫秒）
 * @param view 时间映射
 * @returns 像素宽度
 */
export function durationToWidthPx(durationMs: number, view: TimeView): number {
  return durationMs * view.pixelsPerMs
}

/**
 * 把缩放限制在合法区间内。
 *
 * @param pixelsPerMs 期望缩放
 * @param minPixelsPerMs 下限（通常由 `fitPixelsPerMs` 给出）
 * @returns 裁剪后的缩放
 */
export function clampPixelsPerMs(pixelsPerMs: number, minPixelsPerMs: number): number {
  const lower = Math.max(MIN_PIXELS_PER_MS, minPixelsPerMs)
  return Math.min(MAX_PIXELS_PER_MS, Math.max(lower, pixelsPerMs))
}

/**
 * 计算"完整显示全部内容"所需的缩放。
 *
 * @param durationMs 内容总时长（毫秒）
 * @param viewportWidthPx 视口宽度（像素）
 * @returns 恰好铺满视口的缩放；内容为 0 时返回默认下限
 */
export function fitPixelsPerMs(durationMs: number, viewportWidthPx: number): number {
  if (durationMs <= 0 || viewportWidthPx <= 0) return MIN_PIXELS_PER_MS
  return viewportWidthPx / durationMs
}

/**
 * 挑选当前缩放下最合适的时间网格步长。
 *
 * 规则：在预置档位里选**最细的、且相邻线间距不小于 `minGapPx`** 的那一档；
 * 若最粗档仍不满足（极端缩小），则按 2 倍继续放大，保证刻度不会糊成一片。
 *
 * @param pixelsPerMs 当前缩放
 * @param minGapPx 相邻网格线最小像素间距
 * @returns 网格步长（毫秒）
 */
export function adaptiveGridMs(pixelsPerMs: number, minGapPx: number): number {
  for (const step of GRID_STEPS_MS) {
    if (step * pixelsPerMs >= minGapPx) return step
  }
  let step = GRID_STEPS_MS[GRID_STEPS_MS.length - 1]
  while (step * pixelsPerMs < minGapPx) step *= 2
  return step
}
