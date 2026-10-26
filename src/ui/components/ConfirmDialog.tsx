import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** 保存前确认弹窗属性。 */
export interface ConfirmDialogProps {
  /** 标题，同时作为面板的 `aria-label` */
  title: string
  /** 正文：可传富文本（如多条后果列表） */
  description: ReactNode
  /** 确认按钮文案 */
  confirmLabel?: string
  /** 取消按钮文案 */
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
  /** 勾选框文案；不传则不渲染勾选框 */
  dontAskLabel?: string
  /** 点确认且已勾选时回调（值为 true）；取消不触发 */
  onDontAsk?: (checked: boolean) => void
}

/**
 * 保存前确认弹窗（二级模态，叠在行操作弹窗之上）。
 *
 * 纯展示组件：不读 store、不调 action，开关由父组件条件渲染控制。
 * 层级 `z-[45]`：高于行操作弹窗的 `z-40` 遮罩，低于 Toast 的 `z-50`。
 * Esc 在 window 的 **capture** 阶段拦截并 `stopPropagation`，只关自身，
 * 不会连带触发 `LineActionSheet` 的 window 冒泡监听。
 * 点击遮罩不关闭：Esc 与「取消」是仅有的两条取消路径。
 */
export function ConfirmDialog({
  title,
  description,
  confirmLabel = '继续保存',
  cancelLabel = '取消',
  onConfirm,
  onCancel,
  dontAskLabel,
  onDontAsk,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  // 勾选框是弹窗内临时态：默认不勾，取消 / Esc 不写设置
  const [dontAsk, setDontAsk] = useState(false)

  // 打开时聚焦「取消」而非确认键（避免 Enter 误触数据丢失），关闭时把焦点还给触发按钮
  useEffect(() => {
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    cancelRef.current?.focus()
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

  return createPortal(
    <div className="fixed inset-0 z-[45] flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        data-confirm-dialog=""
        className="w-[420px] max-w-full rounded-lg border border-divider bg-panel p-4 shadow-xl outline-none"
      >
        <h2 className="text-xs text-neutral-300">{title}</h2>
        <div className="mt-2 text-[11px] leading-relaxed text-neutral-400">{description}</div>
        {dontAskLabel ? (
          <label className="mt-3 flex items-center gap-2 text-[11px] text-neutral-400">
            <input
              type="checkbox"
              checked={dontAsk}
              onChange={(e) => setDontAsk(e.target.checked)}
              data-confirm-dont-ask=""
              className="accent-accent"
            />
            {dontAskLabel}
          </label>
        ) : null}
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            data-confirm-cancel=""
            onClick={onCancel}
            className="rounded border border-divider px-2 py-0.5 text-[11px] text-neutral-300 hover:border-accent/60 hover:text-accent"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            data-confirm-ok=""
            onClick={() => {
              // 先写设置再执行确认，保证 onConfirm 触发卸载也不丢设置
              if (dontAsk && onDontAsk) onDontAsk(true)
              onConfirm()
            }}
            className="rounded border border-accent bg-accent/20 px-2 py-0.5 text-[11px] text-accent transition-colors enabled:hover:bg-accent/30"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
