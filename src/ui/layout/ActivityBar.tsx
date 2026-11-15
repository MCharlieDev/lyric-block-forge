/** 活动栏固定宽度：3rem（48px），比原收起态窄栏宽 12px，为触控目标留出余量。 */
export const ACTIVITY_BAR_WIDTH_CLASS = 'w-12'

interface ActivityBarProps {
  /** 右侧面板当前是否展开 */
  isPanelOpen: boolean
  /** 点击图标：开 / 合面板 */
  onToggle: () => void
}

/**
 * 右侧常驻活动栏（Activity Bar）。
 *
 * 图标常驻屏幕右缘，点击切换右侧面板的开合；展开态图标高亮并在左缘
 * （贴面板的一侧）显示 2px 强调条。非展开态用 `border-transparent`
 * 占住同样的 2px，避免开合时图标横向跳动。
 *
 * 本轮（2a）固定渲染在右侧；轮 2b 将新增 `position` 支持左右切换。
 * 图标为内联 SVG，未引入任何图标库依赖。
 */
export function ActivityBar({ isPanelOpen, onToggle }: ActivityBarProps) {
  return (
    <aside
      className={`flex min-h-0 ${ACTIVITY_BAR_WIDTH_CLASS} shrink-0 grow-0 flex-col items-center gap-1 border border-divider bg-panel/50 py-2`}
    >
      <button
        type="button"
        title="工作日志"
        aria-pressed={isPanelOpen}
        onClick={onToggle}
        className={`flex h-9 w-9 items-center justify-center rounded border-l-2 transition-colors ${
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
