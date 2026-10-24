/**
 * 字级显示 chip 派生（`deriveDisplayChips`）纯函数测试。
 *
 * 数据全部自造：现有 fixture 没有严格相等 / 乱序的字级时间，
 * 因此这里显式覆盖排序、逐字成卡（同时间不合并）、range 保真与入参不可变。
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

describe('deriveDisplayChips · 同时间不合并（逐字成卡）', () => {
  // 合并契约已删除；排序保证同时间相邻，供渲染层做阶梯
  test('e. 三字同时间不合并，按原 index 稳定排序', () => {
    const words = [word('甲', 0, 1), word('乙', 1, 2), word('丙', 2, 3)]
    const chips = deriveDisplayChips(words, [100, 100, 200])

    expect(chips).toHaveLength(3)
    expect(chips.map((chip) => chip.timeMs)).toEqual([100, 100, 200])
    expect(chips.map((chip) => chip.indices)).toEqual([[0], [1], [2]])
    expect(chips.map((chip) => chip.text)).toEqual(['甲', '乙', '丙'])
  })

  test('f. 同时间但原 index 不相邻也不合并：排序后仍按原 index 稳定', () => {
    const words = [word('甲', 0, 1), word('乙', 1, 2), word('丙', 2, 3)]
    const chips = deriveDisplayChips(words, [100, 200, 100])

    expect(chips).toHaveLength(3)
    // 时间 100 的两条在前，且原 index 0 先于 index 2；时间 200 的在最后
    expect(chips.map((chip) => chip.timeMs)).toEqual([100, 100, 200])
    expect(chips.map((chip) => chip.indices)).toEqual([[0], [2], [1]])
    expect(chips.map((chip) => chip.text)).toEqual(['甲', '丙', '乙'])
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

  test('h. 两字同时间各自成卡，文本原样保留前导空格', () => {
    const words = [word('夜色渐深', 0, 4), word(' 风穿过长街', 4, 9)]
    const chips = deriveDisplayChips(words, [100, 100])

    expect(chips).toHaveLength(2)
    expect(chips[0].text).toBe('夜色渐深')
    expect(chips[0].range).toEqual({ start: 0, end: 4 })
    expect(chips[1].text).toBe(' 风穿过长街')
    expect(chips[1].range).toEqual({ start: 4, end: 9 })
  })

  test('i. 三字同时间各自保留自己的 precisionMs（不再取 min）', () => {
    const words = [word('甲', 0, 1, 50), word('乙', 1, 2, 10), word('丙', 2, 3, 20)]
    const chips = deriveDisplayChips(words, [100, 100, 100])

    expect(chips).toHaveLength(3)
    expect(chips.map((chip) => chip.precisionMs)).toEqual([50, 10, 20])
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
