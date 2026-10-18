import type { WordTimestamp } from '@core'

/**
 * 放大态字级 chip 的显示层派生结果。
 *
 * 只描述「怎么显示」，不承载写回语义；写回时按 `indices` 回原始
 * `wordTimestamps` 数组。`range` 是回到 `line.text` 的钥匙，
 * 不能假设 `text` 拼接后等于整行原文（首个标签前可能有前缀）。
 */
export interface DisplayChip {
  /** 组内按原 index 升序拼接的文本 */
  text: string
  /** 排序与合并用的时间；未打轴为 `null` */
  timeMs: number | null
  /** 组内原始 `wordTimestamps` 下标，按升序排列 */
  indices: number[]
  /** 组内文本区间的并集：最小 start / 最大 end */
  range: { start: number; end: number }
  /** 组内非 null 精度的最小值；全 null 时为 null */
  precisionMs: number | null
}

/**
 * 把文本顺序的字级时间戳派生为「按时间升序、严格相等合并」的显示 chip。
 *
 * 规则：
 * - 排序：`timeMs` 升序；`null` 排最后；时间相等（含同为 `null`）按原 index 升序。
 * - 合并：排序后相邻且 `timeMs !== null` 且严格相等才合并；`null` 永不合并。
 * - 合并文本与 `indices` 均按原 index 升序；`range` 取组内 min start / max end。
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

  const result: DisplayChip[] = []

  for (const item of sorted) {
    const last = result[result.length - 1]

    // 只有「相邻 + 非 null + 严格相等」才合并
    if (last !== undefined && item.timeMs !== null && last.timeMs === item.timeMs) {
      last.text += item.text
      last.indices.push(item.index)
      last.range.start = Math.min(last.range.start, item.range.start)
      last.range.end = Math.max(last.range.end, item.range.end)
      if (item.precisionMs !== null) {
        last.precisionMs =
          last.precisionMs === null ? item.precisionMs : Math.min(last.precisionMs, item.precisionMs)
      }
      continue
    }

    result.push({
      text: item.text,
      timeMs: item.timeMs,
      indices: [item.index],
      range: { start: item.range.start, end: item.range.end },
      precisionMs: item.precisionMs,
    })
  }

  return result
}
