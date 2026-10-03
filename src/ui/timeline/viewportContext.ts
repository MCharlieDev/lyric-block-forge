import { createContext, useContext } from 'react'
import type { TimelineViewportKernel } from './useTimelineViewport'

/**
 * 时间轴视口上下文。
 *
 * 单独成文件而不是放进 `TimelineStrip.tsx`，是为了让各图层能直接 import 这里，
 * 而不必 import `TimelineStrip` —— 否则会形成"外壳 → 图层 → 外壳"的循环依赖。
 */

/** 上下文值。 */
export interface TimelineViewportContextValue {
  /** 同步内核，三层共享 */
  kernel: TimelineViewportKernel
  /** 内容总时长（毫秒），用于刻度与滚动条 */
  durationMs: number
}

/** 时间轴视口上下文。 */
export const TimelineViewportContext = createContext<TimelineViewportContextValue | null>(null)

/**
 * 读取时间轴视口上下文。
 *
 * @returns 上下文值
 * @throws 不在 `TimelineStrip` 内使用时抛出
 */
export function useTimelineViewportContext(): TimelineViewportContextValue {
  const value = useContext(TimelineViewportContext)
  if (value === null) {
    throw new Error('useTimelineViewportContext 必须在 TimelineViewportContext.Provider 内使用')
  }
  return value
}
