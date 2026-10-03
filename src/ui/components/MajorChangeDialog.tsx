import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useSettingsStore } from '../stores/settingsStore'

/** 弹窗里展示的一条受影响行。 */
export interface MajorChangeLine {
  /** 1 起的显示行号（可见行序） */
  index: number
  /** 行文本 */
  text: string
}

/** 重大改变确认框属性。 */
export interface MajorChangeDialogProps {
  /** 是否展示 */
  open: boolean
  /** 受影响的行（参与本次位移的行，按可见行序） */
  lines: MajorChangeLine[]
  /** 变化量（毫秒），正数向后（变晚）、负数向前（变早） */
  deltaMs: number
  /** 确认：提交本次改变 */
  onConfirm: () => void
  /** 取消：放弃本次改变 */
  onCancel: () => void
}

/** 关闭按钮的 ×（就地自实现，理由同 LineActionSheet 的 CloseIcon）。 */
function CloseIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M5.5 5.5 14.5 14.5" />
      <path d="M14.5 5.5 5.5 14.5" />
    </svg>
  )
}

/**
 * 重大改变确认框（自研居中模态）。
 *
 * 用 `createPortal` 挂到 `document.body`，避免被轨道容器的 `overflow-hidden` 裁剪；
 * 遮罩 `z-40` 盖在保留临时位移的歌词块（`zIndex=10`）之上——所见即所确认。
 *
 * 带 `role="dialog"` + `aria-modal="true"`，供 `useEditorHotkeys` 的
 * `hasOpenDialog()` 停用全局快捷键。
 *
 * 关闭路径：Esc、右上角 × 均为**取消**；**点遮罩不关闭**（重大改变不做误触即弃）。
 * `autoFocus` 落在「取消」按钮上（默认动作是最安全的那个）。本轮不做完整 focus trap。
 *
 * 内容含：受影响的行（行号 + 文本）、变化量（±deltaMs）、可撤销性说明。
 *
 * 不抽通用 modal，也不复用 `LineActionSheet` / `TextImportDialog`：它们已定稿，
 * 这里按同一模式自实现一份。
 */
export function MajorChangeDialog({ open, lines, deltaMs, onConfirm, onCancel }: MajorChangeDialogProps) {
  // 勾选是本地状态、初始 false；换一次开合即复位（渲染期调整状态，无额外渲染、无闪烁）
  const [dontShowAgain, setDontShowAgain] = useState(false)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    setDontShowAgain(false)
  }

  // Esc = 取消。用 window 监听而非焦点绑定：弹窗内容可能没有可聚焦元素。
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onCancel])

  if (!open) return null

  const deltaLabel = `${deltaMs > 0 ? '+' : ''}${deltaMs} ms`

  // 仅「确认」时写设置（且仅当勾选）；取消 / Esc / × 一律不写
  const handleConfirm = () => {
    if (dontShowAgain) useSettingsStore.getState().update({ confirmMajorChange: false })
    onConfirm()
  }

  return createPortal(
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="确认重大改变"
        className="flex max-h-full w-[420px] max-w-full flex-col overflow-hidden rounded-lg border border-divider bg-panel shadow-xl"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 px-4 pt-3 pb-2">
          <h2 className="text-xs text-neutral-400">确认重大改变</h2>
          <button
            type="button"
            aria-label="关闭"
            title="关闭"
            onClick={onCancel}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-neutral-400 transition-colors hover:bg-white/10 hover:text-neutral-100"
          >
            <CloseIcon />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2">
          <p className="mb-2 text-[11px] text-neutral-300">
            将把下列 <span className="text-neutral-100">{lines.length}</span> 行整组平移{' '}
            <span className="text-neutral-100">{deltaLabel}</span>：
          </p>

          <ul className="mb-3 max-h-40 overflow-y-auto rounded border border-divider bg-canvas px-2 py-1 text-[11px] text-neutral-300">
            {lines.map((line) => (
              <li key={line.index} className="truncate py-0.5">
                第 {line.index} 行{line.text === '' ? '' : ` · ${line.text}`}
              </li>
            ))}
          </ul>

          <p className="text-[11px] text-neutral-500">
            这是一条 selection-offset 记录，可在操作日志中撤销或恢复。
          </p>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-divider px-4 py-3">
          <label className="flex items-center gap-2 text-[11px] text-neutral-300">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(event) => setDontShowAgain(event.target.checked)}
              className="accent-accent"
            />
            以后不再显示
          </label>

          <div className="flex items-center gap-2">
            <button
              type="button"
              autoFocus
              onClick={onCancel}
              className="rounded border border-divider px-3 py-1 text-[11px] text-neutral-300 hover:border-accent/60 hover:text-accent"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              className="rounded border border-accent/60 bg-accent/10 px-3 py-1 text-[11px] text-accent hover:bg-accent/20"
            >
              确认
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
