/**
 * 歌词块两阶段排版（纯函数，无 DOM / Canvas / React 依赖）。
 *
 * 第一阶段只定行号：用「无下一块」的内容上界作为占位宽，保证第二阶段的最终宽
 * 只可能收缩、不会变宽，因此行号一旦定下就不会被推翻。
 * 第二阶段只看同一行内的邻居：用同行下一块起点压缩宽度，并按同行前一块的最终
 * 右边缘判定是否重叠。
 *
 * 不变式：块左边缘恒等于 `startMs × pixelsPerMs`，本模块只决定行号与宽度。
 */

import { layoutBlock, type BlockCardMode, type WordChipBox } from './blockLayout'

/** `layoutRows` 的输入：测量宽已由调用方准备好，单位 CSS px。 */
export interface RowLayoutItem {
  /** 块起点（毫秒）。 */
  startMs: number
  /** 正文自然宽，不含 padding / border。 */
  bodyWidthPx: number
  /** 信息行自然宽，不含 padding / border。 */
  infoRowWidthPx: number
  /** 译文自然宽，没有译文时传 null。 */
  translationWidthPx: number | null
  /** 字级行自然宽，没有字级时间戳时传 null。 */
  wordRowWidthPx: number | null
  /** 微型时间轴上的字级卡片盒，原样透传给 `layoutBlock`。 */
  wordChips?: readonly WordChipBox[] | null
  /** 卡片形态，缺省 `'line'`；原样透传给 `layoutBlock`。 */
  mode?: BlockCardMode
  /** 是否允许降级，缺省取全局开关；原样透传给 `layoutBlock`。 */
  degradeEnabled?: boolean
}

/** `layoutRows` 的输出，按输入顺序一一对应。 */
export interface RowLayoutEntry {
  /** 落在第几行（0 / 1）。 */
  rowIndex: number
  /** 块左边缘（像素，轨道坐标）。 */
  startPx: number
  /** 块宽（像素）。 */
  widthPx: number
  /** 块右边缘（像素，轨道坐标）。 */
  endPx: number
  /** 是否与同行前一块有像素交叠（按第二阶段的最终几何判定）。 */
  overlapsPrev: boolean
  /** 是否降级为极窄块（只会发生在第二阶段的 word 模式）。 */
  isDegraded: boolean
}

/**
 * 两阶段计算所有歌词块的行号与宽度。
 *
 * 第一阶段：
 * - 按 `startMs` 稳定排序；
 * - 占位宽取 `layoutBlock(nextStartMs = null).widthPx`，即内容上界；
 * - 首行空位优先；两行都占时比较两行当前占位右边缘，选结束更早的一行，
 *   以最小化下一次重叠。
 *
 * 第二阶段：
 * - 逐行按时间顺序扫描，用同行下一块起点作为 `nextStartMs`；
 * - 行内末块仍以 `durationMs` 作为虚拟右边界；
 * - 按同行前一块的最终 `endPx` 判定 `overlapsPrev`。
 *
 * 复杂度：排序 O(n log n) 主导，两次线性扫描 O(n)。
 *
 * @param items 已测量好宽度的块，顺序即调用方的文档序
 * @param pixelsPerMs 当前缩放（毫秒 → CSS px）
 * @param durationMs 时间轴总时长（毫秒）
 * @param rowCount 可用行数
 * @returns 与 `items` 同序的排版结果
 */
export function layoutRows(
  items: RowLayoutItem[],
  pixelsPerMs: number,
  durationMs: number,
  rowCount: number,
): RowLayoutEntry[] {
  const startPxs = new Array<number>(items.length).fill(0)
  const rowIndexOf = new Array<number>(items.length).fill(0)
  const results = new Array<RowLayoutEntry>(items.length)

  const ordered = items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.startMs - b.item.startMs || a.index - b.index)

  /* ---------------- 第一阶段：只定行号 ---------------- */

  const lastEndPx = new Array<number>(rowCount).fill(Number.NEGATIVE_INFINITY)
  const rowMembers: number[][] = Array.from({ length: rowCount }, () => [])

  for (const { item, index } of ordered) {
    const startPx = item.startMs * pixelsPerMs
    startPxs[index] = startPx

    // 内容上界：任意 nextStartMs 下最终宽都不会超过它。
    // 此阶段没有 cap，降级结构性不可达（isDegraded 恒 false），只取宽度定行号。
    const placeholderWidthPx = layoutBlock({
      ...item,
      nextStartMs: null,
      pixelsPerMs,
    }).widthPx

    let target = -1
    for (let candidate = 0; candidate < rowCount; candidate += 1) {
      if (lastEndPx[candidate] <= startPx) {
        target = candidate
        break
      }
    }
    if (target === -1) {
      // 两行都占：占位右边缘是真实内容上界，选结束更早的一行，以最小化重叠量
      target = lastEndPx[0] <= lastEndPx[1] ? 0 : 1
    }

    rowIndexOf[index] = target
    rowMembers[target].push(index)
    lastEndPx[target] = Math.max(lastEndPx[target], startPx + placeholderWidthPx)
  }

  /* ---------------- 第二阶段：只看同行邻居 ---------------- */

  for (let row = 0; row < rowCount; row += 1) {
    const members = rowMembers[row]
    let prevEndPx: number | null = null

    for (let cursor = 0; cursor < members.length; cursor += 1) {
      const index = members[cursor]
      const item = items[index]
      const startPx = startPxs[index]

      // 同行末块仍以时间轴总长作虚拟右边界；起点已在总长之外则不限宽
      const nextStartMs =
        cursor + 1 < members.length
          ? items[members[cursor + 1]].startMs
          : item.startMs < durationMs
            ? durationMs
            : null

      const { widthPx, isDegraded } = layoutBlock({
        ...item,
        nextStartMs,
        pixelsPerMs,
      })
      const endPx = startPx + widthPx

      results[index] = {
        rowIndex: rowIndexOf[index],
        startPx,
        widthPx,
        endPx,
        overlapsPrev: prevEndPx !== null && startPx < prevEndPx,
        isDegraded,
      }
      prevEndPx = endPx
    }
  }

  return results
}
