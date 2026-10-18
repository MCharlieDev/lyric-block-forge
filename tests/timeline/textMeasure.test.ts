/**
 * 文本测量内核（`computeLineWidths`）纯函数测试。
 *
 * 只测可注入的纯函数部分，不在 node 环境访问 document / canvas。
 * 注入的 measure 为「每字符 10px」，所有期望值都是确定性算术。
 */

import { describe, expect, test } from 'vitest'
import {
  computeLineWidths,
  type LineMeasureInput,
  type MeasureTextFn,
  type TextStyleKey,
} from '@ui/timeline/textMeasure'
import { WORD_CHIP_MIN_WIDTH_PX } from '@ui/timeline/constants'

const CHAR_PX = 10

/** 确定性测量：每个字符 10px，返回时记录调用顺序。 */
function createMeasure(): { measure: MeasureTextFn; calls: Array<[string, TextStyleKey]> } {
  const calls: Array<[string, TextStyleKey]> = []
  const measure: MeasureTextFn = (text, style) => {
    calls.push([text, style])
    return text.length * CHAR_PX
  }
  return { measure, calls }
}

function input(overrides: Partial<LineMeasureInput> = {}): LineMeasureInput {
  return {
    text: '你好',
    translation: undefined,
    timecode: '00:01.000',
    extraCount: 0,
    hasWords: false,
    hasTranslation: false,
    ...overrides,
  }
}

describe('computeLineWidths · 正文与信息行', () => {
  test('a. 无徽标、无译文：信息行只含时间码，译文与字级行均为 null', () => {
    const { measure } = createMeasure()
    const result = computeLineWidths(input(), measure)

    expect(result.bodyWidthPx).toBe(2 * CHAR_PX)
    expect(result.infoRowWidthPx).toBe('00:01.000'.length * CHAR_PX)
    expect(result.translationWidthPx).toBeNull()
    expect(result.wordRowWidthPx).toBeNull()
  })

  test('b. 三段徽标齐全：信息行 = 时间码 + (+2 / 字级 / 双语) 的 gap+文字+padding', () => {
    const { measure } = createMeasure()
    const result = computeLineWidths(
      input({ extraCount: 2, hasWords: true, hasTranslation: true }),
      measure,
    )

    const badge = (text: string) => 4 + text.length * CHAR_PX + 8
    expect(result.infoRowWidthPx).toBe(
      '00:01.000'.length * CHAR_PX + badge('+2') + badge('字级') + badge('双语'),
    )
    expect(result.bodyWidthPx).toBe(2 * CHAR_PX)
  })

  test('c. 单个徽标：只有字级时不出现 +N 与双语', () => {
    const { measure, calls } = createMeasure()
    const result = computeLineWidths(input({ hasWords: true }), measure)

    expect(result.infoRowWidthPx).toBe('00:01.000'.length * CHAR_PX + 4 + 2 * CHAR_PX + 8)
    expect(calls.map(([text]) => text)).toEqual(['你好', '00:01.000', '字级'])
  })

  test('d. extraCount 为 0 时不产生 +0 徽标', () => {
    const { measure, calls } = createMeasure()
    computeLineWidths(input({ extraCount: 0 }), measure)

    expect(calls.map(([text]) => text)).toEqual(['你好', '00:01.000'])
  })
})

describe('computeLineWidths · 译文与字级行', () => {
  test('e. 有译文：translationWidthPx 为译文自然宽', () => {
    const { measure } = createMeasure()
    const result = computeLineWidths(input({ translation: 'Hello world' }), measure)

    expect(result.translationWidthPx).toBe('Hello world'.length * CHAR_PX)
  })

  test('f. 译文为空串：translationWidthPx 为 null', () => {
    const { measure } = createMeasure()
    const result = computeLineWidths(input({ translation: '' }), measure)

    expect(result.translationWidthPx).toBeNull()
  })

  test('g. 本轮 wordRowWidthPx 恒为 null（含字级时间戳场景）', () => {
    const { measure } = createMeasure()
    const result = computeLineWidths(input({ hasWords: true, translation: '译文' }), measure)

    expect(result.wordRowWidthPx).toBeNull()
  })
})

describe('computeLineWidths · word 模式 chip 行', () => {
  /** 指定每个文本的测量宽，未列出的回退到每字符 10px。 */
  function createFixedMeasure(widths: Record<string, number>): MeasureTextFn {
    return (text) => widths[text] ?? text.length * CHAR_PX
  }

  test('i. 三个 chip：每个取 max(文本宽 + 8, 22)，再加 2px 间隔', () => {
    const measure = createFixedMeasure({ a: 10, bb: 20, c: 5 })
    const result = computeLineWidths(input({ wordTexts: ['a', 'bb', 'c'] }), measure)

    // max(10+8,22)=22、max(20+8,22)=28、max(5+8,22)=22，加 2×2 间隔 = 76
    expect(result.wordRowWidthPx).toBe(76)
  })

  test('j. 空数组：wordRowWidthPx 为 null', () => {
    const { measure } = createMeasure()
    const result = computeLineWidths(input({ wordTexts: [] }), measure)

    expect(result.wordRowWidthPx).toBeNull()
  })

  test('k. 不传 wordTexts：wordRowWidthPx 为 null（回归）', () => {
    const { measure } = createMeasure()
    const result = computeLineWidths(input({ hasWords: true }), measure)

    expect(result.wordRowWidthPx).toBeNull()
  })

  test('l. 单个短文本：取下界 WORD_CHIP_MIN_WIDTH_PX', () => {
    const measure = createFixedMeasure({ a: 5 })
    const result = computeLineWidths(input({ wordTexts: ['a'] }), measure)

    expect(result.wordRowWidthPx).toBe(WORD_CHIP_MIN_WIDTH_PX)
  })
})

describe('computeLineWidths · 测量调用契约', () => {
  test('h. measure 的调用顺序为 body → timecode → 徽标（+N/字级/双语）→ translation', () => {
    const { measure, calls } = createMeasure()
    computeLineWidths(
      input({ extraCount: 3, hasWords: true, hasTranslation: true, translation: '译文' }),
      measure,
    )

    expect(calls).toEqual([
      ['你好', 'body'],
      ['00:01.000', 'timecode'],
      ['+3', 'badge'],
      ['字级', 'badge'],
      ['双语', 'badge'],
      ['译文', 'translation'],
    ])
  })
})
