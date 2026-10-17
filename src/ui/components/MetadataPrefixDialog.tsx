import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { DEFAULT_METADATA_PREFIX_RULES, type MetadataPrefixRule } from '@core'

/** 弹窗内可聚焦元素选择器（focus trap 用）。 */
const FOCUSABLE_SELECTOR =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
/** 前缀中不允许出现的分隔符：与内核 `METADATA_PREFIX_SEPARATORS` 保持一致。 */
const PREFIX_SEPARATORS = '：: \t'

const fieldClass =
  'w-full rounded border bg-canvas px-1.5 py-1 text-[11px] text-neutral-200 outline-none focus:border-accent/60'

/** 过滤掉前缀里的分隔符（中文冒号 / 英文冒号 / 空格 / Tab）。 */
function sanitizePrefix(value: string): string {
  return Array.from(value)
    .filter((char) => !PREFIX_SEPARATORS.includes(char))
    .join('')
}

/** 标签名只允许英文字母，保证导出后仍能被导入正则识别。 */
function sanitizeTag(value: string): string {
  return value.replace(/[^a-zA-Z]/g, '')
}

/** 克隆一份默认规则表，避免与内核常量共享引用。 */
function cloneDefaultRules(): MetadataPrefixRule[] {
  return DEFAULT_METADATA_PREFIX_RULES.map((rule) => ({ ...rule }))
}

interface RuleFeedback {
  tone: 'error' | 'warning'
  text: string
}

/** 计算单条规则的行内反馈；重复前缀只警告，不阻断。 */
function getRuleFeedback(
  rule: MetadataPrefixRule,
  index: number,
  rules: readonly MetadataPrefixRule[],
): RuleFeedback | null {
  if (rule.prefix.trim() === '') return { tone: 'error', text: '前缀不能为空' }
  if (rule.tag.trim() === '') return { tone: 'error', text: '目标标签不能为空' }
  if (rules.slice(0, index).some((item) => item.prefix === rule.prefix)) {
    return { tone: 'warning', text: `与上方规则「${rule.prefix}」重复，实际生效的是上方那条` }
  }
  return null
}

export interface MetadataPrefixDialogProps {
  /** 当前规则表（来自设置存储） */
  rules: MetadataPrefixRule[]
  /** 规则变更回调；每次编辑即时写回设置 */
  onChange: (rules: MetadataPrefixRule[]) => void
  /** 是否允许点击遮罩关闭（独立设置项，默认关闭） */
  closeOnBackdropClick: boolean
  /** 关闭弹窗 */
  onClose: () => void
}

/**
 * 元数据前缀规则编辑弹窗。
 *
 * 居中独立模态：编辑即时写回设置；支持 Esc 关闭，遮罩关闭由独立设置项控制，
 * 并自行实现 Tab 焦点循环与关闭后的焦点还原。
 */
export function MetadataPrefixDialog({
  rules,
  onChange,
  closeOnBackdropClick,
  onClose,
}: MetadataPrefixDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const addButtonRef = useRef<HTMLButtonElement>(null)
  const prefixInputRefs = useRef<Array<HTMLInputElement | null>>([])
  /** 待聚焦的行号；`-1` 表示聚焦「+ 添加规则」。 */
  const pendingFocusIndex = useRef<number | null>(null)

  // 打开时记录原焦点并移入弹窗；卸载时还原
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const firstInput = prefixInputRefs.current[0]
    if (firstInput) firstInput.focus()
    else addButtonRef.current?.focus()
    return () => previous?.focus()
  }, [])

  // 规则数组变化（新增 / 删除）后把焦点送到目标输入框
  useEffect(() => {
    const target = pendingFocusIndex.current
    if (target === null) return
    pendingFocusIndex.current = null
    if (target === -1) addButtonRef.current?.focus()
    else prefixInputRefs.current[target]?.focus()
  }, [rules])

  // Esc 关闭
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  /** Tab / Shift+Tab 在弹窗内首尾回环。 */
  const handleTrapKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return
    const dialog = dialogRef.current
    if (!dialog) return

    const focusables = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
      (element) => element.offsetParent !== null,
    )
    if (focusables.length === 0) return

    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    const active = document.activeElement
    const inside = active instanceof Node && dialog.contains(active)

    if (event.shiftKey) {
      if (!inside || active === first) {
        event.preventDefault()
        last.focus()
      }
    } else if (!inside || active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const updateRule = (index: number, patch: Partial<MetadataPrefixRule>) => {
    onChange(rules.map((rule, current) => (current === index ? { ...rule, ...patch } : rule)))
  }

  const handleAdd = () => {
    pendingFocusIndex.current = rules.length
    onChange([...rules, { prefix: '', tag: '', action: 'meta' }])
  }

  const handleRemove = (index: number) => {
    const next = rules.filter((_, current) => current !== index)
    pendingFocusIndex.current = next.length === 0 ? -1 : Math.min(index, next.length - 1)
    onChange(next)
  }

  return createPortal(
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      onClick={(event) => {
        if (closeOnBackdropClick && event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="metadata-prefix-dialog-title"
        onKeyDown={handleTrapKeyDown}
        className="flex max-h-[80vh] w-[720px] max-w-[calc(100vw-24px)] flex-col rounded border border-divider bg-panel shadow-xl"
      >
        {/* 头部 */}
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-divider p-3">
          <div>
            <p id="metadata-prefix-dialog-title" className="text-xs font-medium text-neutral-200">
              前缀规则
            </p>
            <p className="mt-1 text-[11px] text-neutral-500">
              导入时，行首匹配前缀且后跟冒号（：或 :）才生效；从上到下匹配，先命中者优先。
            </p>
          </div>
          <button
            type="button"
            aria-label="关闭前缀规则弹窗"
            onClick={onClose}
            className="shrink-0 rounded border border-divider px-1.5 py-0.5 text-[11px] text-neutral-400 hover:border-accent/60 hover:text-accent"
          >
            ×
          </button>
        </div>

        {/* 表头 */}
        <div className="grid shrink-0 grid-cols-[1fr_1fr_140px_72px] gap-2 border-b border-divider px-3 py-2 text-[10px] text-neutral-500">
          <span>前缀</span>
          <span>目标标签</span>
          <span>动作</span>
          <span className="text-right">操作</span>
        </div>

        {/* 规则区：唯一滚动区域 */}
        <div data-metadata-prefix-rules className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          {rules.length === 0 ? (
            <p className="py-8 text-center text-[11px] text-neutral-600">暂无规则，当前不会识别任何前缀</p>
          ) : (
            rules.map((rule, index) => {
              const prefixInvalid = rule.prefix.trim() === ''
              const tagInvalid = rule.tag.trim() === ''
              const feedback = getRuleFeedback(rule, index, rules)
              return (
                <div key={index} className="border-b border-divider/60 py-1.5 last:border-b-0">
                  <div className="grid grid-cols-[1fr_1fr_140px_72px] items-center gap-2">
                    <input
                      ref={(element) => {
                        prefixInputRefs.current[index] = element
                      }}
                      value={rule.prefix}
                      onChange={(event) => updateRule(index, { prefix: sanitizePrefix(event.target.value) })}
                      onBlur={() => {
                        const trimmed = rule.prefix.trim()
                        if (trimmed !== rule.prefix) updateRule(index, { prefix: trimmed })
                      }}
                      aria-label={`第 ${index + 1} 条规则的前缀`}
                      className={`${fieldClass} ${prefixInvalid ? 'border-red-500/70' : 'border-divider'}`}
                    />
                    <input
                      value={rule.tag}
                      onChange={(event) => updateRule(index, { tag: sanitizeTag(event.target.value) })}
                      onBlur={() => {
                        const trimmed = rule.tag.trim()
                        if (trimmed !== rule.tag) updateRule(index, { tag: trimmed })
                      }}
                      aria-label={`第 ${index + 1} 条规则的目标标签`}
                      className={`${fieldClass} ${tagInvalid ? 'border-red-500/70' : 'border-divider'}`}
                    />
                    <select
                      value={rule.action ?? 'meta'}
                      onChange={(event) =>
                        updateRule(index, { action: event.target.value === 'line' ? 'line' : 'meta' })
                      }
                      aria-label={`第 ${index + 1} 条规则的动作`}
                      className={`${fieldClass} border-divider`}
                    >
                      <option value="meta">转元数据</option>
                      <option value="line">保留歌词行</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => handleRemove(index)}
                      aria-label={`删除第 ${index + 1} 条规则`}
                      className="rounded border border-divider px-1.5 py-1 text-[11px] text-neutral-400 hover:border-red-500/60 hover:text-red-400"
                    >
                      删除
                    </button>
                  </div>
                  {feedback ? (
                    <p
                      className={`mt-1 text-[10px] ${
                        feedback.tone === 'error' ? 'text-red-400' : 'text-amber-400'
                      }`}
                    >
                      {feedback.text}
                    </p>
                  ) : null}
                </div>
              )
            })
          )}
        </div>

        {/* 底部操作栏 */}
        <div className="flex shrink-0 items-center justify-between border-t border-divider p-3">
          <div className="flex items-center gap-2">
            <button
              ref={addButtonRef}
              type="button"
              onClick={handleAdd}
              className="rounded border border-divider px-2 py-1 text-[11px] text-neutral-300 hover:border-accent/60 hover:text-accent"
            >
              + 添加规则
            </button>
            <button
              type="button"
              onClick={() => onChange(cloneDefaultRules())}
              className="rounded border border-divider px-2 py-1 text-[11px] text-neutral-300 hover:border-accent/60 hover:text-accent"
            >
              恢复默认规则
            </button>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-accent/60 px-2 py-1 text-[11px] text-accent"
          >
            完成
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
