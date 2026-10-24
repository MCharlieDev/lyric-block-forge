/**
 * 歌词块的尺寸内核（纯函数，无 DOM / Canvas / React 依赖）。
 *
 * 语义：块宽不再由时间跨度直接决定，而是「内容自然宽」与「到下一行的间距」共同约束。
 * 调用方负责把正文、信息行、译文、字级行的自然宽测好（单位 CSS px）后传进来，
 * 本模块只做像素运算，便于在 vitest 里用注入的固定宽度做确定性断言。
 *
 * 不变式：块左边缘恒等于 `startMs × pixelsPerMs`，本模块只决定宽度，绝不改位置。
 */

import {
  BLOCK_GAP_PX,
  MIN_BLOCK_WIDTH_PX,
  WORD_CARD_DEGRADED_WIDTH_PX,
  WORD_CARD_DEGRADE_CAP_PX,
  WORD_CARD_DEGRADE_ENABLED,
  WORD_CHIP_MIN_WIDTH_PX,
} from './constants'
import { CHIP_GAP_PX, CHIP_PADDING_X_PX } from './textMeasure'

/** 卡片形态：`line` 为缩小态行级卡片，`word` 为放大态字级卡片。 */
export type BlockCardMode = 'line' | 'word'

/** 单侧内边距（CSS px）：对应容器的 `px-1.5`，左右各 6px。 */
export const BLOCK_PADDING_SIDE_PX = 6

/** 单侧边框（CSS px）：对应容器的 `border`，左右各 1px。 */
export const BLOCK_BORDER_SIDE_PX = 1

/**
 * 左右装饰宽合计（CSS px）：`(单侧 padding + 单侧 border) × 2 = 14`。
 *
 * 容器的 `box-sizing` 是 `border-box`（Tailwind Preflight），因此写入的
 * `width` 已包含 padding 与 border；要让内容区等于测量宽，块宽必须加上本值。
 */
export const BLOCK_CHROME_X_PX = (BLOCK_PADDING_SIDE_PX + BLOCK_BORDER_SIDE_PX) * 2

/** 微型时间轴上的一个字级卡片盒：块内坐标，`leftPx` 可负。 */
export interface WordChipBox {
  leftPx: number
  widthPx: number
}

/**
 * 纯函数：把每个 chip 的宽度按时间戳映射为微型时间轴上的块内坐标。
 *
 * - 有时间戳：`leftPx = round((timeMs - startMs) × pixelsPerMs)`，允许负值，
 *   表示该字早于行起点、向左溢出。
 * - 无时间戳：按顺序紧贴当前已知最大右缘 + `CHIP_GAP_PX` 排布。
 *
 * 本函数不做任何碰撞截断：字与字之间允许重叠。
 */
export function layoutWordChips(
  widthsPx: readonly number[],
  timesMs: readonly (number | null)[],
  startMs: number,
  pixelsPerMs: number,
): WordChipBox[] {
  const boxes: WordChipBox[] = []
  let maxRightPx = 0

  for (let index = 0; index < widthsPx.length; index += 1) {
    const widthPx = widthsPx[index]
    const timeMs = timesMs[index]
    const leftPx =
      timeMs === null || timeMs === undefined
        ? maxRightPx + CHIP_GAP_PX
        : Math.round((timeMs - startMs) * pixelsPerMs)

    boxes.push({ leftPx, widthPx })
    maxRightPx = Math.max(maxRightPx, leftPx + widthPx)
  }

  return boxes
}

/** word 模式 chip 的单侧内边距（CSS px）：`CHIP_PADDING_X_PX / 2 = 4`。 */
const CHIP_PADDING_SIDE_PX = CHIP_PADDING_X_PX / 2

/**
 * 纯函数：把「同一时间的连续多字」的宽度改写为阶梯宽度。
 *
 * 只改宽度、不改左缘：左缘仍由 `layoutWordChips` 按时间算出，同组各卡 `leftPx` 完全相等，
 * 宽度递增即可形成「左边缘对齐、右缘逐级外露」的阶梯。内容靠渲染层的左内偏移推到
 * 前一张右缘之后（偏移量 = 前一张 `widthPx` + `CHIP_GAP_PX`）。
 *
 * 规则：
 * - 三入参等长，返回等长数组。
 * - `timesMs[i] === null` 的卡不参与阶梯，原样输出 `fullWidthsPx[i]`。
 * - 相邻且 `timeMs` 严格相等（非 null）的连续段为一组；不同时间的段各自独立。
 * - 单元素组原样输出 `fullWidthsPx[i]`（保留徽标宽与 `WORD_CHIP_MIN_WIDTH_PX` 下限）。
 * - 多元素组（组内序 0..N-1，内容宽为 `contentWidthsPx`）：
 *   `W_0 = 4 + c_0`；`W_i = W_{i-1} + 2 + c_i`（1 ≤ i ≤ N-2）；
 *   `W_{N-1} = W_{N-2} + 2 + c_{N-1} + 4`。
 *   即组总宽 = `8 + Σc + 2(N-1)`，与「只留左右各半 padding、组内用间隙拼接」的合并卡同宽。
 * - 组内成员不套 `WORD_CHIP_MIN_WIDTH_PX` 下限：下限只保护单卡可点，整组才是可点目标。
 *
 * @param fullWidthsPx 逐卡完整宽（含 padding / 时间戳徽标 / 最小宽下限）
 * @param contentWidthsPx 逐卡纯内容宽（`wordChipContentWidthsPx`）
 * @param timesMs 逐卡时间戳，与上面两个数组同下标
 * @returns 阶梯化后的逐卡宽度
 */
export function stackWordChipWidths(
  fullWidthsPx: readonly number[],
  contentWidthsPx: readonly number[],
  timesMs: readonly (number | null)[],
): number[] {
  const result = fullWidthsPx.slice()
  let index = 0

  while (index < fullWidthsPx.length) {
    const timeMs = timesMs[index]
    if (timeMs === null || timeMs === undefined) {
      index += 1
      continue
    }

    // 收集相邻且时间严格相等的连续段。
    let end = index + 1
    while (end < fullWidthsPx.length && timesMs[end] === timeMs) end += 1

    const last = end - 1
    if (last > index) {
      let cumulativePx = CHIP_PADDING_SIDE_PX + contentWidthsPx[index]
      result[index] = cumulativePx
      for (let cursor = index + 1; cursor <= last; cursor += 1) {
        cumulativePx += CHIP_GAP_PX + contentWidthsPx[cursor]
        if (cursor === last) cumulativePx += CHIP_PADDING_SIDE_PX
        result[cursor] = cumulativePx
      }
    }

    index = end
  }

  return result
}

/** `layoutBlock` 的输入：所有宽度均已测量，单位 CSS px。 */
export interface BlockLayoutInput {
  /** 正文自然宽，不含 padding / border。 */
  bodyWidthPx: number
  /** 信息行（时间码 + `+N` + 字级 + 双语徽标）自然宽，不含 padding / border。 */
  infoRowWidthPx: number
  /** 译文的自然宽，没有译文时传 null。 */
  translationWidthPx: number | null
  /** 字级 chip 行的自然宽，没有字级时间戳时传 null。 */
  wordRowWidthPx: number | null
  /**
   * 微型时间轴上的字级卡片盒（`layoutWordChips` 的输出）。
   * 传入非空数组时 word 模式改走绝对定位口径；缺省走旧的流式口径。
   */
  wordChips?: readonly WordChipBox[] | null
  /** 当前行起点（毫秒）。 */
  startMs: number
  /** 排序后的下一行起点（毫秒），包含同起点；没有下一行时传 null。 */
  nextStartMs: number | null
  /** 当前缩放（毫秒 → CSS px）。 */
  pixelsPerMs: number
  /** 卡片形态，缺省 `'line'`（生产默认路径）。 */
  mode?: BlockCardMode
  /** 是否允许降级，缺省取 `WORD_CARD_DEGRADE_ENABLED`；仅测试与未来设置用。 */
  degradeEnabled?: boolean
}

/** `layoutBlock` 的输出。 */
export interface BlockLayoutResult {
  /** 内容自然宽：line 取正文/信息行/译文的较大者，word 只取 chip 行；均加 padding / border。 */
  contentWidthPx: number
  /** 保底宽：line 至少装得下信息行，word 至少装得下最小 chip；均不小于 `MIN_BLOCK_WIDTH_PX`。 */
  minWidthPx: number
  /** 最终写入样式的块宽。 */
  widthPx: number
  /** 是否被下一行的间距压缩（`widthPx < contentWidthPx`）。 */
  isCompressed: boolean
  /** 保底宽是否越过了下一块起点（即与下一块真实重叠）。 */
  overlapsNext: boolean
  /** 是否降级为极窄块（只在 word 模式、有下一行且 cap 不足时发生）。 */
  isDegraded: boolean
  /** 字级卡片的最左偏移（含 0；负值表示向左溢出）。仅诊断/测试用，不参与宽度计算。 */
  wordMinLeftPx: number
  /** 字级卡片的最右缘（块内坐标）。仅诊断/测试用，不参与宽度计算。 */
  wordMaxRightPx: number
}

/**
 * 计算单个歌词块的宽度。
 *
 * 规则：
 * - 无下一行：`max(contentWidthPx, minWidthPx)`，不设上限。
 * - 有下一行：`max(minWidthPx, min(contentWidthPx, timeGapPx - BLOCK_GAP_PX))`。
 * - `timeGapPx` 可为负（数据乱序或同起点），此时必然退到保底宽并重叠。
 *
 * @param input 已测量好的宽度与时间信息
 * @returns 宽度结果；`widthPx` 单位为 CSS px
 */
export function layoutBlock(input: BlockLayoutInput): BlockLayoutResult {
  const {
    bodyWidthPx,
    infoRowWidthPx,
    translationWidthPx,
    wordRowWidthPx,
    startMs,
    nextStartMs,
    pixelsPerMs,
  } = input

  const mode = input.mode ?? 'line'
  const pad = BLOCK_CHROME_X_PX
  const wordChips = input.wordChips

  // 微型时间轴口径：只统计卡片盒的右缘，负向左溢不参与宽度。
  // 字级卡片允许越过下一行起点，因此这里不做 cap 压缩、也不降级。
  if (mode === 'word' && wordChips !== null && wordChips !== undefined && wordChips.length > 0) {
    // 右侧不留 padding：字级卡片直接贴住块右缘，块宽只补左右边框。
    const wordPad = BLOCK_BORDER_SIDE_PX * 2
    let wordMaxRightPx = Number.NEGATIVE_INFINITY
    let wordMinLeftPx = 0
    for (const box of wordChips) {
      wordMaxRightPx = Math.max(wordMaxRightPx, box.leftPx + box.widthPx)
      wordMinLeftPx = Math.min(wordMinLeftPx, box.leftPx)
    }

    const contentWidthPx = Math.max(0, wordMaxRightPx) + wordPad
    const minWidthPx = Math.max(MIN_BLOCK_WIDTH_PX, WORD_CHIP_MIN_WIDTH_PX + wordPad)
    const widthPx = Math.max(contentWidthPx, minWidthPx)
    const overlapsNext =
      nextStartMs === null
        ? false
        : widthPx > (nextStartMs - startMs) * pixelsPerMs - BLOCK_GAP_PX

    return {
      contentWidthPx,
      minWidthPx,
      widthPx,
      isCompressed: false,
      overlapsNext,
      isDegraded: false,
      wordMinLeftPx,
      wordMaxRightPx,
    }
  }

  let contentWidthPx: number
  let minWidthPx: number
  let wordMinLeftPx = 0
  let wordMaxRightPx = 0

  if (mode === 'word') {
    // 放大态：内容宽只由 chip 行决定，不得再纳入正文/信息行/译文。
    // 左边缘必须与 startMs 对齐：无左侧把手，chrome = 左 border 1 + 右 padding 6 + 右 border 1。
    const wordPad = BLOCK_PADDING_SIDE_PX + BLOCK_BORDER_SIDE_PX * 2
    contentWidthPx = (wordRowWidthPx ?? 0) + wordPad
    // 最小可用宽 = 最小 chip + chrome = max(40, 30) = 40。
    minWidthPx = Math.max(MIN_BLOCK_WIDTH_PX, WORD_CHIP_MIN_WIDTH_PX + wordPad)
    wordMaxRightPx = wordRowWidthPx ?? 0
  } else {
    const contentInner = Math.max(bodyWidthPx, infoRowWidthPx, translationWidthPx ?? 0)
    contentWidthPx = contentInner + pad
    minWidthPx = Math.max(infoRowWidthPx + pad, MIN_BLOCK_WIDTH_PX)
  }

  if (nextStartMs === null) {
    // 占位阶段没有 cap，无法降级；isDegraded 结构性恒为 false。
    return {
      contentWidthPx,
      minWidthPx,
      widthPx: Math.max(contentWidthPx, minWidthPx),
      isCompressed: false,
      overlapsNext: false,
      isDegraded: false,
      wordMinLeftPx,
      wordMaxRightPx,
    }
  }

  const timeGapPx = (nextStartMs - startMs) * pixelsPerMs
  const cap = timeGapPx - BLOCK_GAP_PX
  const degradeEnabled = input.degradeEnabled ?? WORD_CARD_DEGRADE_ENABLED

  // cap 连「最小可用总宽」都装不下时降级为极窄块（至少不越出时间间距）。
  const shouldDegrade =
    mode === 'word' &&
    degradeEnabled &&
    cap < WORD_CARD_DEGRADE_CAP_PX &&
    contentWidthPx > cap

  const widthPx = shouldDegrade
    ? WORD_CARD_DEGRADED_WIDTH_PX
    : Math.max(minWidthPx, Math.min(contentWidthPx, cap))

  return {
    contentWidthPx,
    minWidthPx,
    widthPx,
    isCompressed: shouldDegrade || widthPx < contentWidthPx,
    // 降级后若 cap < 14 仍会与下一块残余重叠；公式与 line 模式一致。
    overlapsNext: widthPx > cap,
    isDegraded: shouldDegrade,
    wordMinLeftPx,
    wordMaxRightPx,
  }
}
