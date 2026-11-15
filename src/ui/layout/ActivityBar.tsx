/** 活动栏固定宽度：2.25rem（36px），与内部图标按钮同宽，视觉上更轻。 */
export const ACTIVITY_BAR_WIDTH_CLASS = 'w-9'

interface ActivityBarProps {
  /** 侧栏停靠侧：决定强调条贴在活动栏的哪一侧（贴面板的一侧） */
  side: 'left' | 'right'
  /** 右侧面板当前是否展开 */
  isPanelOpen: boolean
  /** 点击图标：开 / 合面板 */
  onToggle: () => void
}

/**
 * 常驻活动栏（Activity Bar）。
 *
 * 图标常驻屏幕边缘，点击切换侧栏面板的开合；展开态图标高亮并在
 * **贴面板的一侧**显示 2px 强调条（`side === 'right'` 用 `border-l-2`，
 * `side === 'left'` 用 `border-r-2`）。非展开态用 `border-transparent`
 * 占住同样的 2px，避免开合或左右切换时图标横向跳动。
 *
 * 停靠侧由设置项 `sidebarPosition` 决定，默认右侧。
 * 图标为内联 SVG，未引入任何图标库依赖。
 */
export function ActivityBar({ side, isPanelOpen, onToggle }: ActivityBarProps) {
  // 强调条永远贴面板：面板在右则高亮左缘，面板在左则高亮右缘
  const highlightEdgeClass = side === 'right' ? 'border-l-2' : 'border-r-2'

  return (
    <aside
      className={`flex min-h-0 ${ACTIVITY_BAR_WIDTH_CLASS} shrink-0 grow-0 flex-col items-center gap-1 rounded-lg border border-divider bg-panel/50 py-2`}
    >
      <button
        type="button"
        title="工作日志"
        aria-pressed={isPanelOpen}
        onClick={onToggle}
        className={`flex h-9 w-full items-center justify-center rounded ${highlightEdgeClass} transition-colors ${
          isPanelOpen
            ? 'border-accent text-neutral-100'
            : 'border-transparent text-neutral-500 hover:text-neutral-300'
        }`}
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
          {/* 日志 / 列表图标：三个列表项 + 行首圆点 */}
          <path d="M9 6h11M9 12h11M9 18h11" />
          <path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" />
        </svg>
      </button>
    </aside>
  )
}
