import type { TimeRange } from './common'

/**
 * 字级定位引用：指向"某一行中的第几个字"。
 * 字级时间戳用下标而非内容定位，避免同字重复时产生歧义。
 */
export interface LineWordRef {
  /** 所属行 ID */
  lineId: string
  /** 字级时间戳在 `LyricLine.wordTimestamps` 中的下标 */
  wordIndex: number
}

/**
 * 编辑影响范围 —— 操作日志、建议、校验三方共用的统一坐标。
 *
 * 三种定位方式可同时存在，表示"这些行 / 这些字 / 这个时间段"都被影响。
 * 空数组与 `null` 表示该维度不受限。
 */
export interface EditScope {
  /** 受影响的行 ID 集合 */
  lineIds: string[]
  /** 受影响的字级引用集合 */
  wordRefs: LineWordRef[]
  /** 受影响的时间区间，无明确时间段时为 `null` */
  timeRange: TimeRange | null
}

/** 构造一个空的影响范围。 */
export function emptyEditScope(): EditScope {
  return { lineIds: [], wordRefs: [], timeRange: null }
}
