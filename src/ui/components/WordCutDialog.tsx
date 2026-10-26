import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { WordSegment } from '@core'
import { charsFromText, cutsToSegments, segmentsToCuts } from '@core/lyrics/wordTimes'

/** 文字行的左右内边距（px）；测宽时要一并从容器宽度里扣掉 */
const TEXT_ROW_PADDING_PX = 16
/** 缝的最小宽度（px）：可用宽不够时不再压缩，改为横向滚动 */
const SEAM_MIN_WIDTH_PX = 8
/** 缝的最大宽度（px）：短句不会被拉得过于松散 */
const SEAM_MAX_WIDTH_PX = 48

/** 切分字块弹窗属性。 */
export interface WordCutDialogProps {
  /** 行文本（只读；弹窗只能切缝，不能改字） */
  text: string
  /** 已有切分，用于回显旧缝；只取缝的位置，块内文字仍以 `text` 为准 */
  initialSegments?: WordSegment[]
  /** 取消：不回调任何结果 */
  onCancel: () => void
  /** 确定：回调按当前缝算出的块（UTF-16 码元偏移） */
  onConfirm: (segments: WordSegment[]) => void
}

/**
 * 切分字块弹窗（二级模态，叠在行操作弹窗之上）。
 *
 * 字符之间渲染可点击竖缝：点击 toggle，切了变亮、再点变暗。缝的宽度按
 * 「可用宽 - 文字总宽」/ 缝数分配并 clamp 到 [8, 48]，到下限后整行横向滚动。
 *
 * 层级 `z-[45]`：高于行操作弹窗的 `z-40` 遮罩，低于 Toast 的 `z-50`。
 * Esc 在 window 的 **capture** 阶段拦截并 `stopPropagation`，只关自身，
 * 不会连带触发 `LineActionSheet` 的 window 冒泡监听。
 */
export function WordCutDialog({ text, initialSegments, onCancel, onConfirm }: WordCutDialogProps) {
  const chars = useMemo(() => charsFromText(text), [text])
  // 每个字符的起始 UTF-16 码元偏移；第 i 条缝（字符 i 之后）的位置是 charOffsets[i + 1]
  const charOffsets = useMemo(() => {
    const offsets: number[] = []
    let offset = 0
    for (const char of chars) {
      offsets.push(offset)
      offset += char.length
    }
    return offsets
  }, [chars])

  const [cuts, setCuts] = useState<Set<number>>(() =>
    initialSegments === undefined ? new Set<number>() : segmentsToCuts(initialSegments),
  )

  const dialogRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const rulerRef = useRef<HTMLSpanElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const [widths, setWidths] = useState({ available: 0, text: 0 })

  // 打开时聚焦弹窗容器，关闭时把焦点还给触发按钮（打开前 recorded）
  useEffect(() => {
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialogRef.current?.focus()
    return () => restoreFocusRef.current?.focus()
  }, [])

  // Esc 只关自身：capture 阶段先于外层 LineActionSheet 的 window 冒泡监听
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onCancel()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onCancel])

  // 量容器可用宽与文字总宽；容器尺寸变化（窗口缩放）时重算
  useLayoutEffect(() => {
    const measure = () => {
      const available = Math.max(
        0,
        (containerRef.current?.clientWidth ?? 0) - TEXT_ROW_PADDING_PX * 2,
      )
      const textWidth = rulerRef.current?.getBoundingClientRect().width ?? 0
      setWidths((prev) =>
        prev.available === available && prev.text === textWidth
          ? prev
          : { available, text: textWidth },
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    const container = containerRef.current
    if (container !== null) observer.observe(container)
    return () => observer.disconnect()
  }, [text])

  const seamCount = Math.max(chars.length - 1, 1)
  const naturalSeam =
    widths.available > 0 ? (widths.available - widths.text) / seamCount : SEAM_MIN_WIDTH_PX
  const seamWidth = Math.floor(
    Math.min(SEAM_MAX_WIDTH_PX, Math.max(SEAM_MIN_WIDTH_PX, naturalSeam)),
  )

  const toggleCut = (offset: number) => {
    setCuts((prev) => {
      const next = new Set(prev)
      if (next.has(offset)) next.delete(offset)
      else next.add(offset)
      return next
    })
  }

  return createPortal(
    <div className="fixed inset-0 z-[45] flex items-center justify-center bg-black/40 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="切分字块"
        tabIndex={-1}
        className="relative flex max-h-full w-[560px] max-w-full flex-col overflow-hidden rounded-lg border border-divider bg-panel shadow-xl outline-none"
      >
        <div className="shrink-0 px-4 pt-3 pb-1">
          <h2 className="text-xs text-neutral-400">切分字块</h2>
          <p className="mt-1 text-[11px] text-neutral-600">点击字符之间的竖缝切分，再点一次取消</p>
        </div>
        <div ref={containerRef} className="min-h-0 flex-1 overflow-x-auto">
          <div
            className="flex w-max items-center py-3"
            style={{ paddingLeft: TEXT_ROW_PADDING_PX, paddingRight: TEXT_ROW_PADDING_PX }}
          >
            {chars.map((char, index) => {
              const cutOffset = charOffsets[index + 1]
              const cut = cutOffset !== undefined && cuts.has(cutOffset)
              return (
                <Fragment key={index}>
                  <span className="shrink-0 whitespace-pre text-xs text-neutral-200">{char}</span>
                  {cutOffset === undefined ? null : (
                    <button
                      type="button"
                      aria-pressed={cut}
                      aria-label={`在第 ${index + 1} 与第 ${index + 2} 个字符之间切分`}
                      onClick={() => toggleCut(cutOffset)}
                      style={{ width: seamWidth }}
                      className="group flex shrink-0 items-center justify-center self-stretch"
                    >
                      <span
                        className={`block h-5 w-px rounded-full transition-colors ${
                          cut ? 'bg-accent' : 'bg-neutral-600/70 group-hover:bg-neutral-400'
                        }`}
                      />
                    </button>
                  )}
                </Fragment>
              )
            })}
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-divider px-4 py-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-divider px-2 py-0.5 text-[11px] text-neutral-300 hover:border-accent/60 hover:text-accent"
          >
            取消
          </button>
          <button
            type="button"
            disabled={cuts.size === 0}
            onClick={() => onConfirm(cutsToSegments(text, chars, cuts))}
            className="rounded border border-accent bg-accent/20 px-2 py-0.5 text-[11px] text-accent transition-colors enabled:hover:bg-accent/30 disabled:cursor-not-allowed disabled:opacity-40"
          >
            确定
          </button>
        </div>
        {/* 测宽标尺：与字符同字号同字体，绝对定位到可视区外 */}
        <span
          ref={rulerRef}
          aria-hidden="true"
          className="pointer-events-none absolute top-0 -left-[9999px] whitespace-pre text-xs"
        >
          {text}
        </span>
      </div>
    </div>,
    document.body,
  )
}
