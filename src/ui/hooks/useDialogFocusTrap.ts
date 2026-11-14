import { useEffect } from 'react'

/**
 * 弹窗内可聚焦元素选择器（focus trap 用）。
 *
 * 覆盖范围 = 六个弹窗实际出现的可聚焦元素类型：button / input / textarea /
 * select / a[href] / [contenteditable] / [tabindex]。其中 textarea 来自
 * `TextImportDialog` 的主输入框——只写 button/input 会把回环首元素算错。
 * 新增弹窗引入新类型（如 `video[controls]`、`audio[controls]`）时须同步补。
 */
const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  'a[href]',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

/**
 * 元素是否可见。
 *
 * 用 `getClientRects()` 而非 `offsetParent !== null`：`position: fixed` 元素的
 * `offsetParent` 恒为 `null`，用后者会把所有弹窗遮罩直接滤掉。
 */
function isVisible(element: HTMLElement): boolean {
  return element.getClientRects().length > 0
}

/**
 * 全局 Tab 焦点循环：把焦点限制在「最上层弹窗」内。
 *
 * 最上层 = DOM 中最后一个可见 `[role="dialog"]`。该判据成立的前提是：
 * 所有弹窗以 portal 挂到 body、后挂载者层级更高，且 `TextImportDialog` 这类
 * 内联弹窗不与 portal 弹窗同时打开。新增弹窗时必须复核此前提，
 * 否则本判据会静默选错层。
 *
 * 只处理 Tab：Esc、打开时的首焦、关闭后归还焦点都归各弹窗自己。
 * 挂在 window 的 capture 阶段，先于弹窗内 React 的冒泡处理。
 */
export function useDialogFocusTrap(): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return

      const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).filter(
        isVisible,
      )
      const dialog = dialogs[dialogs.length - 1]
      if (dialog === undefined) return

      const focusables = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        isVisible,
      )

      // 弹窗内没有任何可聚焦元素：把焦点收到面板本身（面板没设 tabindex 时补 -1）
      if (focusables.length === 0) {
        event.preventDefault()
        if (dialog.getAttribute('tabindex') === null) dialog.tabIndex = -1
        dialog.focus()
        return
      }

      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement

      // 焦点在弹窗之外（刚打开、落在 body、或被点到遮罩上）：进入弹窗
      if (active === null || !dialog.contains(active)) {
        event.preventDefault()
        if (event.shiftKey) last.focus()
        else first.focus()
        return
      }

      if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
        return
      }
      if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [])
}
