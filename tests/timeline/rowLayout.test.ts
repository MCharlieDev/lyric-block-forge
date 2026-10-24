/**
 * 歌词块两阶段排版（`layoutRows`）纯函数测试。
 *
 * 只验证两个阶段的契约：
 * - 第一阶段：占位宽取内容上界，行号一旦定下不会被第二阶段推翻；
 * - 第二阶段：只按同行邻居压缩宽度，并按同行最终几何判定重叠。
 *
 * 测量宽由测试直接注入，全部是确定性算术，不访问 DOM / Canvas。
 */

import { describe, expect, test } from 'vitest'
import { layoutRows, type RowLayoutItem } from '@ui/timeline/rowLayout'

/**
 * 造一份默认块：正文 86 + chrome 14 = 内容宽 100；保底宽 40。
 * 便于在下方用 `pixelsPerMs = 1` 直接以毫秒当像素。
 */
function item(startMs: number, overrides: Partial<RowLayoutItem> = {}): RowLayoutItem {
  return {
    startMs,
    bodyWidthPx: 86,
    infoRowWidthPx: 20,
    translationWidthPx: null,
    wordRowWidthPx: null,
    ...overrides,
  }
}

describe('layoutRows · 行分配', () => {
  test('a. 五块密集起点 0/30/60/90/120：首行空位优先，两行都占时选结束更早的行', () => {
    const items = [0, 30, 60, 90, 120].map((startMs) => item(startMs))

    const entries = layoutRows(items, 1, 10_000, 2)

    // 占位宽均为 100（内容上界）：
    // 0→行0（空行）；30→行1（空行）；60 两行都占 → 行0 右缘 100 < 行1 右缘 130，选行0；
    // 90 两行都占 → 行0 右缘 160 > 行1 右缘 130，选行1；
    // 120 两行都占 → 行0 右缘 160 < 行1 右缘 190，选行0。
    // 本场景贪心恰好与 0/1 交替同形，但依据是右缘更早，不是交替游标。
    expect(entries.map((entry) => entry.rowIndex)).toEqual([0, 1, 0, 1, 0])
  })

  test('b. 等起点 0/0/50：稳定排序 + 右缘相同时优先首行，结果确定', () => {
    const items = [0, 0, 50].map((startMs) => item(startMs))

    const entries = layoutRows(items, 1, 10_000, 2)

    // 0→行0、0→行1（右缘同为 100）；50 两行都占且右缘相等 → `<=` 选行0
    expect(entries.map((entry) => entry.rowIndex)).toEqual([0, 1, 0])
  })

  test('c. 间隔充足 0/500/1000：全部落在首行', () => {
    const items = [0, 500, 1000].map((startMs) => item(startMs))

    const entries = layoutRows(items, 1, 10_000, 2)

    expect(entries.map((entry) => entry.rowIndex)).toEqual([0, 0, 0])
  })

  test('d. 四块连续重叠 0/10/20/30：两行都占时按右缘更早贪心', () => {
    const items = [0, 10, 20, 30].map((startMs) => item(startMs))

    const entries = layoutRows(items, 1, 10_000, 2)

    // 0→行0（右缘100）、10→行1（右缘110）；20 两行都占 → 100 < 110 选行0；
    // 30 两行都占 → 行0 右缘 120 > 行1 右缘 110，选行1
    expect(entries.map((entry) => entry.rowIndex)).toEqual([0, 1, 0, 1])
  })
})

describe('layoutRows · 同行宽度与重叠', () => {
  test('e. 五块密集起点：宽度只被同行邻居压缩', () => {
    const items = [0, 30, 60, 90, 120].map((startMs) => item(startMs))

    const entries = layoutRows(items, 1, 10_000, 2)

    // 行 0 = 0/60/120：0→60 间距 60，cap = 56；60→120 同样 56；末块 120 不压缩
    // 行 1 = 30/90：30→90 间距 60，cap = 56；90 是本行末块，不受同排邻居压缩 → 100
    // 任务书期望 [56,56,56,56,100] 与之不符：90 在行 1 已是末块，宽度只会回到内容上界
    // 对照：旧单遍用全局时间邻居，前四块被挤到保底宽 → [40, 40, 40, 40, 100]
    expect(entries.map((entry) => entry.widthPx)).toEqual([56, 56, 56, 100, 100])
    expect(entries.map((entry) => entry.endPx)).toEqual([56, 86, 116, 190, 220])
  })

  test('f. 三块 0/10/20：第三块回到首行并与第一块重叠', () => {
    const items = [0, 10, 20].map((startMs) => item(startMs))

    const entries = layoutRows(items, 1, 10_000, 2)

    expect(entries.map((entry) => entry.rowIndex)).toEqual([0, 1, 0])
    // 0 被 20 挤压到保底 40；10 独占第二行不压缩；20 是首行末块不压缩
    expect(entries.map((entry) => entry.widthPx)).toEqual([40, 100, 100])
    expect(entries.map((entry) => entry.overlapsPrev)).toEqual([false, false, true])
  })

  test('g. 相切边界：前块 endPx == 后块 startPx 时不算重叠', () => {
    // 正文 26 + chrome 14 = 内容宽 40；保底宽 40，因此前块刚好 40px
    const items = [0, 40].map((startMs) => item(startMs, { bodyWidthPx: 26 }))

    const entries = layoutRows(items, 1, 10_000, 2)

    expect(entries.map((entry) => entry.rowIndex)).toEqual([0, 0])
    expect(entries[0].endPx).toBe(entries[1].startPx)
    expect(entries[0].widthPx).toBe(40)
    expect(entries[1].overlapsPrev).toBe(false)
  })

  test('h. 行内末块仍受 durationMs 虚拟右边界约束', () => {
    const items = [item(9_990)]

    const entries = layoutRows(items, 1, 10_000, 2)

    // 虚拟下一块在 10000，cap = 10 - 4 = 6，退到保底宽 40
    expect(entries[0].widthPx).toBe(40)
    expect(entries[0].endPx).toBe(10_030)
  })

  test('i. 输入乱序时仍按输入顺序返回结果', () => {
    const items = [item(60), item(0), item(30)]

    const entries = layoutRows(items, 1, 10_000, 2)

    // 时间序 0→行0（右缘 100）、30→行1（右缘 130）、60 两行都占 → 100 < 130 选行 0
    expect(entries.map((entry) => entry.rowIndex)).toEqual([0, 0, 1])
    expect(entries.map((entry) => entry.startPx)).toEqual([60, 0, 30])
    // 行 0 = 0/60：0 被挤压到 56；60 为末块 100；行 1 的 30 为末块 100
    expect(entries.map((entry) => entry.widthPx)).toEqual([100, 56, 100])
  })
})

describe('layoutRows · word 模式与降级', () => {
  /** 绝对定位口径下的单个 chip 宽。 */
  const WORD_CHIP_WIDTH_PX = 82
  /** word 内容宽 = chip 最大右缘 + 左右 border 2 = 84。 */
  const WORD_CONTENT_PX = WORD_CHIP_WIDTH_PX + 2

  test('j. word 绝对定位 · 同行间距不足：不降级、不压缩，按真实几何标记重叠', () => {
    const wordChips = [{ leftPx: 0, widthPx: WORD_CHIP_WIDTH_PX }]
    const items = [
      item(0, { mode: 'word', wordChips, degradeEnabled: true }),
      item(20, { mode: 'word', wordChips, degradeEnabled: true }),
      item(30, { mode: 'word', wordChips, degradeEnabled: true }),
    ]

    const entries = layoutRows(items, 1, 10_000, 2)

    // 第一遍：0→行0、20→行1、30 两行都占且行0右缘 84 < 行1右缘 104 → 行0。
    expect(entries.map((entry) => entry.rowIndex)).toEqual([0, 1, 0])
    // 第二遍：绝对定位分支无 cap、不降级，宽度恒为真实内容宽 84。
    expect(entries.map((entry) => entry.widthPx)).toEqual([
      WORD_CONTENT_PX,
      WORD_CONTENT_PX,
      WORD_CONTENT_PX,
    ])
    expect(entries.map((entry) => entry.isDegraded)).toEqual([false, false, false])
    // 行 0 = 0/30：30 < 0 + 84 → 重叠；行 1 只有 20，无前块。
    expect(entries[2].overlapsPrev).toBe(true)
    expect(entries[1].overlapsPrev).toBe(false)
  })

  test('k. line / word 混排 · 绝对定位：行分配确定，word 块按真实内容宽', () => {
    const wordChips = [{ leftPx: 0, widthPx: WORD_CHIP_WIDTH_PX }]
    const items = [
      item(0, { mode: 'word', wordChips, degradeEnabled: true }),
      item(50),
      item(100, { mode: 'word', wordChips, degradeEnabled: true }),
    ]

    const entries = layoutRows(items, 1, 10_000, 2)

    expect(entries.map((entry) => entry.rowIndex)).toEqual([0, 1, 0])
    // row0：word@0 内容宽 84 < cap（100 - 4 = 96），不压缩；word@100 为末块 84。
    // row1：line@50 为末块，内容宽 = max(86,20)+14 = 100。
    expect(entries.map((entry) => entry.widthPx)).toEqual([
      WORD_CONTENT_PX,
      100,
      WORD_CONTENT_PX,
    ])
    expect(entries.map((entry) => entry.isDegraded)).toEqual([false, false, false])
  })
})
