/**
 * 歌词块尺寸内核（`layoutBlock`）纯函数测试。
 *
 * 本轮不接线 UI，输入是已测量好的像素宽度，因此测试全部是确定性算术：
 * 只验证「内容宽 / 保底宽 / 间距压缩 / 重叠标记」四个契约。
 */

import { describe, expect, test } from 'vitest'
import { layoutBlock, BLOCK_CHROME_X_PX } from '@ui/timeline/blockLayout'
import { BLOCK_GAP_PX, MIN_BLOCK_WIDTH_PX } from '@ui/timeline/constants'

/** 块左右两侧的装饰宽合计（padding + border，共 14px）。 */
const PAD = BLOCK_CHROME_X_PX

/** 造一份默认输入：正文 100、信息行 50、无译文，便于逐条覆盖。 */
function input(overrides: Partial<Parameters<typeof layoutBlock>[0]> = {}) {
  return {
    bodyWidthPx: 100,
    infoRowWidthPx: 50,
    translationWidthPx: null,
    wordRowWidthPx: null,
    startMs: 0,
    nextStartMs: null,
    pixelsPerMs: 0.1,
    ...overrides,
  }
}

describe('layoutBlock · 内容宽与保底宽', () => {
  test('a. 无下一行：宽度取 max(content, min)，不压缩、不重叠', () => {
    const result = layoutBlock(input())

    expect(result.contentWidthPx).toBe(100 + PAD)
    expect(result.minWidthPx).toBe(50 + PAD)
    expect(result.widthPx).toBe(100 + PAD)
    expect(result.isCompressed).toBe(false)
    expect(result.overlapsNext).toBe(false)
  })

  test('b. 下一行间距足够大：宽度等于内容宽，不压缩、不重叠', () => {
    // timeGap = 10000 × 0.1 = 1000px，远大于内容宽
    const result = layoutBlock(input({ nextStartMs: 10_000, pixelsPerMs: 0.1 }))

    expect(result.widthPx).toBe(100 + PAD)
    expect(result.isCompressed).toBe(false)
    expect(result.overlapsNext).toBe(false)
  })

  test('c. 下一行间距较小：压缩到 timeGap - BLOCK_GAP，不越过下一块', () => {
    // timeGap = 9000 × 0.01 = 90px；cap = 86px；min = 50 + PAD = 64px
    const result = layoutBlock(input({ nextStartMs: 9000, pixelsPerMs: 0.01 }))

    expect(result.widthPx).toBe(90 - BLOCK_GAP_PX)
    expect(result.widthPx).toBeGreaterThan(result.minWidthPx)
    expect(result.isCompressed).toBe(true)
    expect(result.overlapsNext).toBe(false)
  })

  test('d. timeGap 恰好等于 contentWidth + BLOCK_GAP：正好取内容宽，不压缩', () => {
    const content = 100 + PAD
    const result = layoutBlock(input({ nextStartMs: content + BLOCK_GAP_PX, pixelsPerMs: 1 }))

    expect(result.widthPx).toBe(content)
    expect(result.isCompressed).toBe(false)
    expect(result.overlapsNext).toBe(false)
  })

  test('e. timeGap 小于 minWidth：保底到 minWidth，并标记与下一块重叠', () => {
    // timeGap = 50px；cap = 46px；min = 64px
    const result = layoutBlock(input({ nextStartMs: 50, pixelsPerMs: 1 }))

    expect(result.widthPx).toBe(result.minWidthPx)
    expect(result.overlapsNext).toBe(true)
  })

  test('f. timeGap = 0（同起点）：保底到 minWidth，必然重叠', () => {
    const result = layoutBlock(input({ startMs: 2000, nextStartMs: 2000 }))

    expect(result.widthPx).toBe(result.minWidthPx)
    expect(result.overlapsNext).toBe(true)
  })

  test('g. timeGap 为负（下一行起点更早）：保底到 minWidth，必然重叠', () => {
    const result = layoutBlock(input({ startMs: 5000, nextStartMs: 3000, pixelsPerMs: 0.1 }))

    expect(result.widthPx).toBe(result.minWidthPx)
    expect(result.overlapsNext).toBe(true)
  })

  test('h. 内容宽小于保底宽：宽度抬到 minWidth', () => {
    // content = max(10, 5) + PAD = 24px；min = max(5 + PAD, 40) = 40px
    const result = layoutBlock(input({ bodyWidthPx: 10, infoRowWidthPx: 5, nextStartMs: null }))

    expect(result.contentWidthPx).toBe(10 + PAD)
    expect(result.minWidthPx).toBe(MIN_BLOCK_WIDTH_PX)
    expect(result.widthPx).toBe(MIN_BLOCK_WIDTH_PX)
  })

  test('i. 译文为 null 与不为 null：contentWidth 取三者的最大值', () => {
    const withoutTranslation = layoutBlock(input({ translationWidthPx: null, nextStartMs: null }))
    const withTranslation = layoutBlock(input({ translationWidthPx: 140, nextStartMs: null }))

    expect(withoutTranslation.contentWidthPx).toBe(100 + PAD)
    expect(withTranslation.contentWidthPx).toBe(140 + PAD)
  })

  test('j. 信息行宽于正文与译文：contentWidth 由信息行决定', () => {
    const result = layoutBlock(
      input({ bodyWidthPx: 20, infoRowWidthPx: 120, translationWidthPx: 30, nextStartMs: null }),
    )

    expect(result.contentWidthPx).toBe(120 + PAD)
    expect(result.minWidthPx).toBe(120 + PAD)
    expect(result.widthPx).toBe(120 + PAD)
  })

  test('k. MIN_BLOCK_WIDTH_PX 兜底：信息行极窄时保底仍为 40', () => {
    const result = layoutBlock(input({ bodyWidthPx: 5, infoRowWidthPx: 5, nextStartMs: 10_000 }))

    expect(result.minWidthPx).toBe(MIN_BLOCK_WIDTH_PX)
    expect(result.widthPx).toBe(MIN_BLOCK_WIDTH_PX)
  })
})
