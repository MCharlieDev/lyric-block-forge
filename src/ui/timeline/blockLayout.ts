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

  let contentWidthPx: number
  let minWidthPx: number

  if (mode === 'word') {
    // 放大态：内容宽只由 chip 行决定，不得再纳入正文/信息行/译文。
    // 左边缘必须与 startMs 对齐：无左侧把手，chrome = 左 border 1 + 右 padding 6 + 右 border 1。
    const wordPad = BLOCK_PADDING_SIDE_PX + BLOCK_BORDER_SIDE_PX * 2
    contentWidthPx = (wordRowWidthPx ?? 0) + wordPad
    // 最小可用宽 = 最小 chip + chrome = max(40, 30) = 40。
    minWidthPx = Math.max(MIN_BLOCK_WIDTH_PX, WORD_CHIP_MIN_WIDTH_PX + wordPad)
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
  }
}
