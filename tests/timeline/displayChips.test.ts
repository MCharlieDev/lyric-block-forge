/**
 * 字级显示 chip 派生（`deriveDisplayChips`）纯函数测试。
 *
 * 数据全部自造：现有 fixture 没有严格相等 / 乱序的字级时间，
 * 因此这里显式覆盖排序、合并、range 保真与入参不可变。
 */

import { describe, expect, test } from 'vitest'
import type { WordTimestamp } from '@core'
import { deriveDisplayChips } from '@ui/timeline/displayChips'

/** 造一个字级时间戳；显示时间由 `wordTimes` 单独注入，这里只关心文本/range/精度。 */
function word(text: string, start: number, end: number, precisionMs = 100): WordTimestamp {
  return {
    kind: 'word',
    timeMs: 0,
    precisionMs,
    range: { start, end },
    source: 'import',
    text,
  }
}

describe('deriveDisplayChips · 基本形态', () => {
  test('a. 空 wordTimestamps → 空数组', () => {
    expect(deriveDisplayChips([], [])).toEqual([])
  })

  test('b. 全 null → 全部保留、按 index 升序、不合并', () => {
    const words = [word('甲', 0, 1), word('乙', 1, 2), word('丙', 2, 3)]
    const chips = deriveDisplayChips(words, [null, null, null])

    expect(chips).toHaveLength(3)
    expect(chips.map((chip) => chip.text)).toEqual(['甲', '乙', '丙'])
    expect(chips.map((chip) => chip.indices)).toEqual([[0], [1], [2]])
    expect(chips.map((chip) => chip.timeMs)).toEqual([null, null, null])
  })

  test('c. 单字 → 1 个 chip', () => {
    const chips = deriveDisplayChips([word('你', 0, 1)], [1000])

    expect(chips).toEqual([
      {
        text: '你',
        timeMs: 1000,
        indices: [0],
        range: { start: 0, end: 1 },
        precisionMs: 100,
      },
    ])
  })

  test('d. 乱序时间 → 按 timeMs 升序', () => {
    const words = [word('甲', 0, 1), word('乙', 1, 2), word('丙', 2, 3)]
    const chips = deriveDisplayChips(words, [300, 100, 200])

    expect(chips.map((chip) => chip.text)).toEqual(['乙', '丙', '甲'])
    expect(chips.map((chip) => chip.timeMs)).toEqual([100, 200, 300])
    expect(chips.map((chip) => chip.indices)).toEqual([[1], [2], [0]])
  })
})

describe('deriveDisplayChips · 严格相等合并', () => {
  test('e. 排序后相邻且严格相等 → 合并为 1 个，text 按 index 升序拼', () => {
    const words = [word('甲', 0, 1), word('乙', 1, 2), word('丙', 2, 3)]
    const chips = deriveDisplayChips(words, [100, 100, 200])

    expect(chips).toHaveLength(2)
    expect(chips[0]).toEqual({
      text: '甲乙',
      timeMs: 100,
      indices: [0, 1],
      range: { start: 0, end: 2 },
      precisionMs: 100,
    })
    expect(chips[1].text).toBe('丙')
    expect(chips[1].indices).toEqual([2])
  })

  test('f. 相等但原 index 不相邻 → 排序后仍相邻并合并，组内按 index 拼 text', () => {
    const words = [word('甲', 0, 1), word('乙', 1, 2), word('丙', 2, 3)]
    const chips = deriveDisplayChips(words, [100, 200, 100])

    expect(chips).toHaveLength(2)
    expect(chips[0]).toEqual({
      text: '甲丙',
      timeMs: 100,
      indices: [0, 2],
      range: { start: 0, end: 3 },
      precisionMs: 100,
    })
    // 中间的字仍独立保留，不会被吞进相等组
    expect(chips[1]).toEqual({
      text: '乙',
      timeMs: 200,
      indices: [1],
      range: { start: 1, end: 2 },
      precisionMs: 100,
    })
  })
})

describe('deriveDisplayChips · range / 空格 / 精度', () => {
  test('g. 带前缀（range 从非 0 起）→ range 保真，text 只含 word 片段', () => {
    const words = [word('你好', 2, 5), word('世界', 5, 8)]
    const chips = deriveDisplayChips(words, [1000, 2000])

    expect(chips.map((chip) => chip.text)).toEqual(['你好', '世界'])
    expect(chips.map((chip) => chip.range)).toEqual([
      { start: 2, end: 5 },
      { start: 5, end: 8 },
    ])
  })

  test('h. 带空格片段 → 合并文本保留空格', () => {
    const words = [word('夜色渐深', 0, 4), word(' 风穿过长街', 4, 9)]
    const chips = deriveDisplayChips(words, [100, 100])

    expect(chips).toHaveLength(1)
    expect(chips[0].text).toBe('夜色渐深 风穿过长街')
    expect(chips[0].range).toEqual({ start: 0, end: 9 })
  })

  test('i. precisionMs 组内不一致 → 取最小非 null', () => {
    const words = [word('甲', 0, 1, 50), word('乙', 1, 2, 10), word('丙', 2, 3, 20)]
    const chips = deriveDisplayChips(words, [100, 100, 100])

    expect(chips).toHaveLength(1)
    expect(chips[0].precisionMs).toBe(10)
  })

  test('j. 不同时间不合并，各自保留 precisionMs', () => {
    const words = [word('甲', 0, 1, 50), word('乙', 1, 2, 10)]
    const chips = deriveDisplayChips(words, [100, 200])

    expect(chips.map((chip) => chip.precisionMs)).toEqual([50, 10])
  })
})

describe('deriveDisplayChips · null 与入参不可变', () => {
  test('k. null 与有值混合 → null 排最后', () => {
    const words = [word('甲', 0, 1), word('乙', 1, 2), word('丙', 2, 3)]
    const chips = deriveDisplayChips(words, [200, null, 100])

    expect(chips.map((chip) => chip.text)).toEqual(['丙', '甲', '乙'])
    expect(chips.map((chip) => chip.timeMs)).toEqual([100, 200, null])
  })

  test('l. 多个 null → 按 index 升序且不合并', () => {
    const words = [word('甲', 0, 1), word('乙', 1, 2), word('丙', 2, 3)]
    const chips = deriveDisplayChips(words, [null, null, null])

    expect(chips.map((chip) => chip.indices)).toEqual([[0], [1], [2]])
  })

  test('m. wordTimes 长度不足 → 缺项按 null 处理，不报错', () => {
    const words = [word('甲', 0, 1), word('乙', 1, 2)]
    const chips = deriveDisplayChips(words, [100])

    expect(chips).toHaveLength(2)
    expect(chips[0].timeMs).toBe(100)
    expect(chips[1].timeMs).toBeNull()
    expect(chips[1].indices).toEqual([1])
  })

  test('n. 不修改 wordTimestamps / wordTimes，返回新数组', () => {
    const words = [word('甲', 0, 1), word('乙', 1, 2)]
    const times = [100, 100]
    const wordsSnapshot = structuredClone(words)
    const timesSnapshot = [...times]

    const chips = deriveDisplayChips(words, times)

    expect(words).toEqual(wordsSnapshot)
    expect(times).toEqual(timesSnapshot)
    expect(chips).not.toBe(words)
    expect(chips[0].indices).not.toBe(words)
  })
})
