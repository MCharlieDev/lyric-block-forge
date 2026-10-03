import type { ReactNode } from 'react'

/** 面板容器属性。 */
interface PanelFrameProps {
  /** 面板标题 */
  title: string
  /** 标题右侧的补充说明 */
  hint?: string
  /** 标题栏右侧的操作区 */
  actions?: ReactNode
  /** 追加的样式类 */
  className?: string
  /** 面板内容 */
  children: ReactNode
}

/**
 * 面板外壳：统一卡片容器（圆角 / 边框 / 半透明背景）与标题栏，避免各面板重复写样式。
 * 内容区自带 `overflow-auto`，滚动条只出现在面板内部。
 * 属于纯展示组件，不含任何业务逻辑。
 */
export function PanelFrame({ title, hint, actions, className = '', children }: PanelFrameProps) {
  return (
    <div
      className={`flex min-h-0 flex-col overflow-hidden rounded-lg border border-divider bg-panel/50 ${className}`}
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-divider px-3 py-1.5">
        <div className="flex items-baseline gap-2">
          <h2 className="text-xs font-medium text-neutral-200">{title}</h2>
          {hint ? <span className="text-[11px] text-neutral-500">{hint}</span> : null}
        </div>
        {actions ? <div className="flex items-center gap-1">{actions}</div> : null}
      </header>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </div>
  )
}
