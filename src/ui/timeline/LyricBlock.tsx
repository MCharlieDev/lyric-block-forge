import type { LyricLine } from '@core'
import {
  BLOCK_GAP_PX,
  DEFAULT_BLOCK_MS,
  LYRIC_ROW_HEIGHT_PX,
  MIN_BLOCK_WIDTH_PX,
  WORD_CHIP_MIN_WIDTH_PX,
} from './constants'
import { formatTimecode } from '../utils/format'

/** 点选歌词块时按下的修饰键。由轨道从 PointerEvent 上取，交回选择语义分派。 */
export interface SelectModifiers {
  ctrl: boolean
  meta: boolean
  shift: boolean
}

/** 歌词块属性。 */
interface LyricBlockProps {
  /** 所属行 */
  line: LyricLine
  /** 该行回放后的行级时间戳（可能为空 = 未打轴） */
  times: number[]
  /** 该行回放后的字级时间戳，缺项为 `null` */
  wordTimes: Array<number | null>
  /** 块的起点（毫秒）：已打轴取首个时间戳，未打轴取 0 */
  startMs: number
  /** 块的时长（毫秒） */
  spanMs: number
  /** 是否未打轴 */
  isUntimed: boolean
  /** 是否选中（强高亮） */
  isActive: boolean
  /** 是否在多选集合内（次高亮；与 `isActive` 同时为真时以 `isActive` 为准） */
  inSelection: boolean
  /** 当前缩放 */
  pixelsPerMs: number
  /**
   * 块相对**歌词轨道**的纵向偏移（像素）。
   * 由轨道按行号算出（`行号 × 行距`），块自己不推算行位置。
   */
  topPx: number
}

/** 块相对行顶部的内缩，避免块与行的底纹贴边。 */
const BLOCK_INSET_PX = 2

/**
 * 歌词块宽度：`时长 × 缩放`，并从块宽里扣掉与相邻块的间隙。
 * 过长的块按 {@link DEFAULT_BLOCK_MS} 截断（避免一句长尾把整条轨道占满），
 * 过窄的块抬到 {@link MIN_BLOCK_WIDTH_PX}（保证仍可点中、可拖动）。
 *
 * 轨道用它做两行贪心分配，块用它写 `width`，两边共用同一份换算以保证像素对齐。
 */
export function lyricBlockWidthPx(spanMs: number, pixelsPerMs: number): number {
  return Math.max(MIN_BLOCK_WIDTH_PX, Math.min(spanMs, DEFAULT_BLOCK_MS) * pixelsPerMs - BLOCK_GAP_PX)
}

/**
 * 单个歌词块（纯展示，不含任何交互状态）。
 *
 * 块**绝对定位在歌词轨道的定位上下文里**：
 * - `left = startMs × pixelsPerMs`（横向 = 时间）
 * - `top  = 行号 × 行距`（纵向 = 第几行，由轨道传入）
 *
 * 因为这两个值都只随「缩放 / 行号」变化，块的几何在滚动时完全不动，
 * 滚动由外层平面的 `translate3d` 负责 —— 这就是"滚动零 React 重渲染"的来源。
 * 时间戳全部来自日志回放结果，块自身不做任何时间推算。
 *
 * ## 交互全部由轨道委托
 * 点选 / 拖动都由 {@link LyricTrack} 在**平面层**上以事件委托统一处理
 * （按 `data-lyric-block` 判定、`data-line-id` 取行 ID）。因此块本身
 * 不接任何 pointer 回调、不持有拖动状态，也**不声明 `transform`** ——
 * 拖动位移由轨道命令式写入 `style.transform`，React 从不声明该键，
 * 重渲染也就不会把它抹掉。
 *
 * 该元素**不在 Tab 序列内**（`tabIndex={-1}`）：键盘选中由下方的歌词块列表承担，
 * 避免焦点停留时空格被浏览器默认行为吃掉，与后续的全局快捷键冲突。
 */
export function LyricBlock({
  line,
  times,
  wordTimes,
  startMs,
  spanMs,
  isUntimed,
  isActive,
  inSelection,
  pixelsPerMs,
  topPx,
}: LyricBlockProps) {
  const widthPx = lyricBlockWidthPx(spanMs, pixelsPerMs)
  const hasWords = line.wordTimestamps.length > 0
  const extraCount = times.length > 1 ? times.length - 1 : 0

  /** 字级 chip 的时长：到下一个字为止，末字到行尾（或兜底宽度）为止。 */
  const chipSpans = line.wordTimestamps.map((_, index) => {
    const current = wordTimes[index]
    if (current === null) return 0
    const next = index + 1 < wordTimes.length ? wordTimes[index + 1] : null
    if (next !== null) return Math.max(0, next - current)
    return Math.max(0, (startMs + spanMs) - current)
  })

  return (
    <div
      // 不在 Tab 序列内：键盘选中由下方歌词块列表承担，避免空格被浏览器默认行为吃掉
      tabIndex={-1}
      // 供轨道事件委托判定「点到的是块还是空白」（closest 查这个属性）
      data-lyric-block=""
      // 供轨道事件委托定位具体行（拖动 / 点选都靠它取行 ID）
      data-line-id={line.id}
      title={`${line.text}${isUntimed ? '（未打轴）' : ` · ${formatTimecode(startMs)}`}`}
      className={`absolute flex cursor-grab flex-col justify-center overflow-hidden rounded border px-1.5 text-left transition-colors select-none touch-none ${
        // 强调优先：选中态覆盖未打轴的虚线底纹
        isActive
          ? 'border-accent bg-accent/20'
          : inSelection
            ? 'border-accent/60 bg-accent/10'
            : isUntimed
              ? 'border-dashed border-divider bg-panel/70 hover:bg-panel'
              : 'border-divider bg-panel hover:bg-white/5'
      }`}
      style={{
        left: `${startMs * pixelsPerMs}px`,
        top: `${topPx + BLOCK_INSET_PX}px`,
        width: `${widthPx}px`,
        height: `${LYRIC_ROW_HEIGHT_PX - BLOCK_INSET_PX * 2}px`,
      }}
    >
      <span className="flex w-full items-center gap-1 truncate font-mono text-[10px] leading-none text-neutral-400">
        <span className={isUntimed ? 'text-neutral-600' : 'text-neutral-300'}>
          {times.length === 0 ? '--:--.--' : formatTimecode(times[0])}
        </span>
        {extraCount > 0 ? (
          <span className="rounded bg-white/10 px-1 text-[9px] text-neutral-400">+{extraCount}</span>
        ) : null}
        {hasWords ? <span className="rounded bg-accent/20 px-1 text-[9px] text-accent">字级</span> : null}
        {line.translation !== undefined ? (
          <span className="rounded bg-white/10 px-1 text-[9px] text-neutral-400">双语</span>
        ) : null}
      </span>

      <span className="mt-0.5 w-full truncate text-xs leading-tight text-neutral-100">{line.text}</span>

      {hasWords ? (
        <span className="mt-0.5 flex w-full gap-0.5 overflow-hidden">
          {line.wordTimestamps.map((word, index) => (
            <span
              key={`${line.id}-w${index}`}
              className="truncate rounded-sm bg-white/5 px-1 text-[10px] leading-tight text-neutral-300"
              style={{
                flexGrow: chipSpans[index],
                flexBasis: 0,
                minWidth: `${WORD_CHIP_MIN_WIDTH_PX}px`,
              }}
            >
              {word.text}
            </span>
          ))}
        </span>
      ) : null}

      {line.translation !== undefined ? (
        <span className="w-full truncate text-[10px] leading-tight text-neutral-400">{line.translation}</span>
      ) : null}
    </div>
  )
}
