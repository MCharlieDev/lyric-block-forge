/**
 * 字块切分几何与时间生成器测试。
 *
 * 覆盖 `wordTimes` 的六个纯函数：字符拆分、缝隙 → 块、块 → 缝隙、
 * 初始字级时间生成、三层锚点回退。全部为纯函数，不触碰 store / DOM。
 */

import { describe, expect, test } from 'vitest'
import {
  WORD_CUT_DEFAULT_GAP_MS,
  charsFromText,
  cutsToSegments,
  deriveInitialWordTimes,
  resolveCutAnchor,
  segmentsToCuts,
} from '@core/lyrics/wordTimes'

/** 由文本与切缝直接生成块，减少重复样板。 */
function cut(text: string, cuts: number[]) {
  return cutsToSegments(text, charsFromText(text), new Set(cuts))
}

describe('charsFromText · 按码点拆分', () => {
  test('中文逐字', () => {
    expect(charsFromText('你好世界')).toEqual(['你', '好', '世', '界'])
  })

  test('英文逐字母', () => {
    expect(charsFromText('abc')).toEqual(['a', 'b', 'c'])
  })

  test('空格保留为元素', () => {
    expect(charsFromText('a b')).toEqual(['a', ' ', 'b'])
  })

  test('标点保留为元素', () => {
    expect(charsFromText('你好，世界')).toEqual(['你', '好', '，', '世', '界'])
  })

  test('emoji 代理对算一个元素', () => {
    expect(charsFromText('🙂a')).toEqual(['🙂', 'a'])
  })

  test('空串返回空数组', () => {
    expect(charsFromText('')).toEqual([])
  })
})

describe('cutsToSegments · 缝隙切块', () => {
  test('无切缝时整行一块', () => {
    expect(cut('你好世界', [])).toEqual([{ start: 0, end: 4, text: '你好世界' }])
  })

  test('全缝切开时逐字一块', () => {
    expect(cut('你好世界', [1, 2, 3])).toEqual([
      { start: 0, end: 1, text: '你' },
      { start: 1, end: 2, text: '好' },
      { start: 2, end: 3, text: '世' },
      { start: 3, end: 4, text: '界' },
    ])
  })

  test('emoji 前后的 start / end 是 UTF-16 偏移', () => {
    // '🙂a🙂'：码元长度 2 + 1 + 2 = 5，块边界 0 / 2 / 3 / 5
    expect(cut('🙂a🙂', [2, 3])).toEqual([
      { start: 0, end: 2, text: '🙂' },
      { start: 2, end: 3, text: 'a' },
      { start: 3, end: 5, text: '🙂' },
    ])
  })

  test('空文本返回空数组', () => {
    expect(cut('', [])).toEqual([])
  })

  test('混合串：首尾相接、全覆盖、升序不重叠', () => {
    const text = 'ab🙂cd'
    const segments = cut(text, [1, 2, 4, 5])
    expect(segments).toHaveLength(5)
    expect(segments.map((segment) => segment.text).join('')).toBe(text)
    expect(segments[0].start).toBe(0)
    expect(segments.at(-1)?.end).toBe(text.length)
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index]
      if (index > 0) expect(segment.start).toBe(segments[index - 1].end)
      expect(segment.end).toBeGreaterThan(segment.start)
      expect(segment.text).toBe(text.slice(segment.start, segment.end))
    }
  })
})

describe('segmentsToCuts · 反向还原', () => {
  test('取除首块外的全部块起点', () => {
    expect(segmentsToCuts(cut('你好世界', [1, 3]))).toEqual(new Set([1, 3]))
  })

  test('整行一块时没有切缝', () => {
    expect(segmentsToCuts(cut('你好世界', []))).toEqual(new Set())
  })

  test('与 cutsToSegments 互逆（同输入往返一致）', () => {
    const text = 'ab🙂cd'
    const cuts = new Set([1, 2, 4, 5])
    const segments = cutsToSegments(text, charsFromText(text), cuts)
    expect(segmentsToCuts(segments)).toEqual(cuts)
    expect(cutsToSegments(text, charsFromText(text), segmentsToCuts(segments))).toEqual(segments)
  })
})

describe('deriveInitialWordTimes · 初始字级时间', () => {
  test('首块等于锚点，后续按 200ms 顺延', () => {
    expect(WORD_CUT_DEFAULT_GAP_MS).toBe(200)
    expect(deriveInitialWordTimes(1000, 3)).toEqual([1000, 1200, 1400])
  })

  test('count 为 0 返回空数组', () => {
    expect(deriveInitialWordTimes(1000, 0)).toEqual([])
  })

  test('count 为 1 只有锚点', () => {
    expect(deriveInitialWordTimes(1000, 1)).toEqual([1000])
  })

  test('支持自定义步长', () => {
    expect(deriveInitialWordTimes(500, 3, 50)).toEqual([500, 550, 600])
  })

  test('允许越界到下一行，不封顶', () => {
    expect(deriveInitialWordTimes(59_500, 5)).toEqual([59_500, 59_700, 59_900, 60_100, 60_300])
  })
})

describe('resolveCutAnchor · 三层回退', () => {
  test('行级时间优先', () => {
    expect(resolveCutAnchor(1000, 500, 250)).toEqual({ anchorMs: 1000, source: 'line' })
  })

  test('行级为空时退到首字', () => {
    expect(resolveCutAnchor(null, 500, 250)).toEqual({ anchorMs: 500, source: 'word' })
  })

  test('行级与首字都空时退到时间轴占位', () => {
    expect(resolveCutAnchor(null, null, 250)).toEqual({ anchorMs: 250, source: 'placement' })
  })

  test('三层全空返回 null', () => {
    expect(resolveCutAnchor(null, null, null)).toBeNull()
  })
})
