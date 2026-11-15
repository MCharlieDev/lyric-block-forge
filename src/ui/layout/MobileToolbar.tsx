import { useState } from 'react'
import { BottomSheet } from '../components/BottomSheet'
import { OperationPanel } from '../components/OperationPanel'

/**
 * 窄屏底部常驻工具栏。
 *
 * 两个入口均打开底部抽屉（`BottomSheet`）：「日志」显示日志面板，「操作」显示操作面板。
 *
 * 布局口径：作为 `ThreeColumnLayout` 根 flex 列的**流内子项**（`shrink-0`），
 * 由 Flex 压缩主内容行的高度，而不是 fixed 悬浮覆盖。因此：
 * - 主内容不需要额外 `padding-bottom` 让位；
 * - 安全区（`env(safe-area-inset-bottom)`）仍由 `index.css` 的根节点内边距承担，
 *   本组件**不再叠加** `padding-bottom`，避免双份留白。
 *
 * 图标沿用 `ActivityBar` 的内联 SVG 风格（`currentColor` + 线性描边），
 * 不引入图标库；按钮提示用 `title`，窄屏下面板空间优先，不写可见文字。
 */
export function MobileToolbar() {
  const [isLogOpen, setIsLogOpen] = useState(false)
  const [isOpOpen, setIsOpOpen] = useState(false)

  return (
    <>
      <nav
        data-mobile-toolbar
        className="flex h-12 shrink-0 items-center border-t border-divider bg-panel"
      >
        <button
          type="button"
          title="日志"
          onClick={() => setIsLogOpen(true)}
          className="flex h-full flex-1 items-center justify-center text-neutral-400 transition-colors hover:text-neutral-200 active:text-accent"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-5 w-5"
          >
            {/* 日志 / 列表图标：三个列表项 + 行首圆点（与 ActivityBar 同源） */}
            <path d="M9 6h11M9 12h11M9 18h11" />
            <path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" />
          </svg>
        </button>

        <button
          type="button"
          title="操作"
          onClick={() => setIsOpOpen(true)}
          className="flex h-full flex-1 items-center justify-center text-neutral-400 transition-colors hover:text-neutral-200 active:text-accent"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-5 w-5"
          >
            {/* 四向键 / 十字准星：外圈准星 + 四向刻度 */}
            <circle cx="12" cy="12" r="3.2" />
            <path d="M12 3v4.2M12 16.8V21M3 12h4.2M16.8 12H21" />
          </svg>
        </button>
      </nav>

      <BottomSheet open={isLogOpen} onClose={() => setIsLogOpen(false)}>
        <div className="text-neutral-300">日志面板内容（开发中）</div>
      </BottomSheet>

      <BottomSheet open={isOpOpen} onClose={() => setIsOpOpen(false)}>
        <OperationPanel />
      </BottomSheet>
    </>
  )
}
