import type { LyricLine } from '@core'
import { LYRIC_ROW_HEIGHT_PX, WORD_CHIP_MIN_WIDTH_PX } from './constants'
import type { BlockCardMode, WordChipBox } from './blockLayout'
import type { DisplayChip } from './displayChips'
import { formatMiniTime, formatTimecode } from '../utils/format'

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
  /** 块宽（像素），由轨道按内容宽与下一行间距算好 */
  widthPx: number
  /**
   * 块相对**歌词轨道**的纵向偏移（像素）。
   * 由轨道按行号算出（`行号 × 行距`），块自己不推算行位置。
   */
  topPx: number
  /** 是否与同排前一块有像素交叠（由轨道按几何边界判定） */
  overlapsPrev: boolean
  /** 卡片形态：放大态且有字级时为 `word`，其余为 `line` */
  mode: BlockCardMode
  /** 字级显示 chip（已按时间升序、同时间合并），仅 `word` 模式渲染 */
  chips: DisplayChip[]
  /** 字级 chip 的块内绝对坐标（与 `chips` 一一对应），仅 `word` 模式有值 */
  wordChips: WordChipBox[] | null
  /** 是否降级为极窄的菱形关键帧（整块即拖动把手） */
  isDegraded: boolean
}

/** 块相对行顶部的内缩，避免块与行的底纹贴边。 */
const BLOCK_INSET_PX = 2

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
  widthPx,
  topPx,
  overlapsPrev,
  mode,
  chips,
  wordChips,
  isDegraded,
}: LyricBlockProps) {
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

  /** 叠压接缝：用内阴影标记左边缘，不占布局、不改块宽，选中/多选态同样保留。 */
  const seamClass = overlapsPrev ? 'shadow-[inset_2px_0_0_0_rgba(76,141,255,0.5)]' : ''

  return (
    <div
      // 不在 Tab 序列内：键盘选中由下方歌词块列表承担，避免空格被浏览器默认行为吃掉
      tabIndex={-1}
      // 供轨道事件委托判定「点到的是块还是空白」（closest 查这个属性）
      data-lyric-block=""
      // 降级块整块即拖动把手；word 模式由顶部横条带该属性
      data-drag-handle={isDegraded ? '' : undefined}
      // 供轨道事件委托定位具体行（拖动 / 点选都靠它取行 ID）
      data-line-id={line.id}
      title={`${line.text}${isUntimed ? '（未打轴）' : ` · ${formatTimecode(startMs)}`}`}
      className={`absolute flex cursor-grab ${
        mode === 'word' ? 'flex-row items-stretch px-0' : 'flex-col justify-center px-1.5'
      } ${
        // word 模式允许字级卡片按时间轴溢出块外（含负向），降级菱形仍需裁剪
        mode === 'word' && !isDegraded ? 'overflow-visible' : 'overflow-hidden'
      } rounded border text-left transition-colors select-none touch-none ${
        // 强调优先：选中态覆盖未打轴的虚线底纹；层级 选中 9 > hover 8 > 普通 auto
        isActive
          ? `z-[9] border-accent bg-[#253450] ${seamClass}`
          : inSelection
            ? `z-[9] border-accent/60 bg-[#20293a] ${seamClass}`
            : isUntimed
              ? `border-dashed border-divider hover:z-[8] ${
                  overlapsPrev
                    ? 'bg-panel/80 backdrop-blur-[1px] shadow-[inset_2px_0_0_0_rgba(76,141,255,0.5)] hover:bg-panel'
                    : 'bg-panel/70 hover:bg-panel'
                }`
              : // 重叠块压在上层：降透明度让下层卡片轮廓透出，hover 时回实色保证可读性
                `border-divider hover:z-[8] ${
                  overlapsPrev
                    ? 'bg-panel/85 backdrop-blur-[1px] shadow-[inset_2px_0_0_0_rgba(76,141,255,0.5)] hover:bg-panel'
                    : 'bg-panel hover:bg-[#23272f]'
                }`
      }`}
      style={{
        left: `${startMs * pixelsPerMs}px`,
        top: `${topPx + BLOCK_INSET_PX}px`,
        width: `${widthPx}px`,
        height: `${LYRIC_ROW_HEIGHT_PX - BLOCK_INSET_PX * 2}px`,
      }}
    >
      {isDegraded ? (
        // 降级态：极窄块只留一个菱形关键帧，块的其余内容一概不渲染
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span
            className="block rotate-45 rounded-[1px] bg-accent"
            style={{ width: 8, height: 8 }}
          />
        </span>
      ) : mode === 'word' ? (
        // 放大态：顶部横条即拖动把手 + 迷你卡（上排时间戳、下排歌词）
        <>
          <span
            data-drag-handle=""
            aria-hidden
            className="absolute inset-x-0 top-0 z-[1] h-1 cursor-grab rounded-t bg-white/10"
          />
          <div className="relative h-full w-full overflow-visible pt-1">
            {chips.map((chip, index) => {
              const box = wordChips?.[index]
              return (
                <div
                  key={`${line.id}-c${index}`}
                  data-word-chip=""
                  data-chip-indices={chip.indices.join(',')}
                  data-chip-time-ms={chip.timeMs ?? ''}
                  className="absolute top-1 bottom-0 flex flex-col items-start justify-center gap-0.5 overflow-hidden rounded-sm bg-white/5 px-1 ring-1 ring-inset ring-white/10 transition-colors hover:bg-white/10"
                  style={{
                    left: `${box?.leftPx ?? 0}px`,
                    width: `${box?.widthPx ?? WORD_CHIP_MIN_WIDTH_PX}px`,
                  }}
                >
                  <span className="w-full truncate text-left font-mono text-[9px] leading-none text-neutral-500">
                    {formatMiniTime(chip.timeMs)}
                  </span>
                  <span className="w-full truncate text-left text-xs leading-none text-neutral-200">
                    {chip.text}
                  </span>
                </div>
              )
            })}
          </div>
        </>
      ) : (
        <>
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
        </>
      )}
    </div>
  )
}
