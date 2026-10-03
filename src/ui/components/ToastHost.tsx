import { useEffect } from 'react'
import { useToastStore } from '../stores/toastStore'

/** 提示自动消失的时间（毫秒）。 */
const AUTO_DISMISS_MS = 3500

/** 关闭按钮的 ×（不抽公共组件，就地自实现，理由同 LineActionSheet 的 CloseIcon）。 */
function CloseIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="h-3.5 w-3.5"
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
 * 提示宿主（自研，非模态）。
 *
 * 挂在 `App.tsx` 顶层，位置在工具栏下方居中，**不压歌词块**。
 * 容器 `pointer-events-none` 让提示之外不拦截点击，卡片自身 `pointer-events-auto`
 * 保证 × 可点。
 *
 * 行为：`role="status"` + `aria-live="polite"`（读屏可播报，且不带
 * `role="dialog"` / `aria-modal`，不会触发 `useEditorHotkeys` 的"有弹窗"停用）；
 * 3500ms 自动消失、右上角 × 手动关闭；单槽替换、不堆叠。
 */
export function ToastHost() {
  const message = useToastStore((state) => state.message)
  const seq = useToastStore((state) => state.seq)
  const dismissToast = useToastStore((state) => state.dismissToast)

  // 每次"真正展示"（seq 变化）重置自动消失计时；被去重丢弃时不增 seq、不重置
  useEffect(() => {
    if (message === null) return
    const timer = window.setTimeout(() => dismissToast(), AUTO_DISMISS_MS)
    return () => window.clearTimeout(timer)
  }, [message, seq, dismissToast])

  if (message === null) return null

  return (
    <div className="pointer-events-none fixed left-1/2 top-[3.25rem] z-50 -translate-x-1/2">
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-auto flex max-w-md items-center gap-3 rounded border border-divider bg-panel px-3 py-2 text-xs text-neutral-200 shadow-lg"
      >
        <span>{message}</span>
        <button
          type="button"
          aria-label="关闭提示"
          title="关闭提示"
          onClick={dismissToast}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-neutral-400 transition-colors hover:bg-white/10 hover:text-neutral-100"
        >
          <CloseIcon />
        </button>
      </div>
    </div>
  )
}
