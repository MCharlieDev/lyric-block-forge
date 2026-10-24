import type { WordTimestamp } from '@core'

/**
 * 放大态字级 chip 的显示层派生结果。
 *
 * 只描述「怎么显示」，不承载写回语义；写回时按 `indices` 回原始
 * `wordTimestamps` 数组。`range` 是回到 `line.text` 的钥匙，
 * 不能假设 `text` 拼接后等于整行原文（首个标签前可能有前缀）。
 *
 * 同时间不再合并：每条 chip 恒为单个字，`indices` 恒为单元素数组，
 * 但类型保留数组形态，避免改写消费端（命中 / 拖动 / 写回）。
 */
export interface DisplayChip {
  /** 该 chip 的文本（同时间不合并，恒为单字） */
  text: string
  /** 排序用的时间；未打轴为 `null` */
  timeMs: number | null
  /** 原始 `wordTimestamps` 下标（单元素数组；消费端仍按数组解析） */
  indices: number[]
  /** 该字在 `line.text` 中的区间 */
  range: { start: number; end: number }
  /** 该字的打轴精度；未打轴为 `null` */
  precisionMs: number | null
}

/**
 * 把文本顺序的字级时间戳派生为「按时间升序、逐字成卡」的显示 chip。
 *
 * 规则：
 * - 排序：`timeMs` 升序；`null` 排最后；时间相等（含同为 `null`）按原 index 升序。
 *   **排序是阶梯分组的前提**：渲染层依赖「同时间的字相邻」来识别多元素组，不能动。
 * - 不合并：同时间相邻的字各自成卡；同时间的相邻关系由上述排序保证，
 *   供渲染层做阶梯（每张卡左缘同位、宽度累计）。
 * - 不修改入参；`wordTimes` 长度不足时按 `null` 处理。
 *
 * @param wordTimestamps 文本顺序的字级时间戳
 * @param wordTimes 回放后的逐字时间，下标与 `wordTimestamps` 对齐
 * @returns 新的显示 chip 数组
 */
export function deriveDisplayChips(
  wordTimestamps: readonly WordTimestamp[],
  wordTimes: readonly (number | null)[],
): DisplayChip[] {
  const items = wordTimestamps.map((word, index) => ({
    index,
    text: word.text,
    timeMs: wordTimes[index] ?? null,
    precisionMs: word.precisionMs,
    range: { start: word.range.start, end: word.range.end },
  }))

  // 显式 tiebreak，不依赖 JS sort 的稳定性
  const sorted = items.slice().sort((a, b) => {
    if (a.timeMs === null && b.timeMs === null) return a.index - b.index
    if (a.timeMs === null) return 1
    if (b.timeMs === null) return -1
    if (a.timeMs !== b.timeMs) return a.timeMs - b.timeMs
    return a.index - b.index
  })

  // 逐字成卡：同时间不合并，只保留排序后的顺序
  return sorted.map((item) => ({
    text: item.text,
    timeMs: item.timeMs,
    indices: [item.index],
    range: { start: item.range.start, end: item.range.end },
    precisionMs: item.precisionMs,
  }))
}
