import { LogPanel } from '../components/LogPanel'

/** 右侧面板的固定宽度：20rem，正好是 `w-80`。 */
export const RIGHT_SIDEBAR_WIDTH_CLASS = 'w-80'

/**
 * 右侧展开态面板：只负责装配宽度与 `LogPanel`。
 *
 * 开合由外壳 `ThreeColumnLayout` 条件渲染控制，入口在 `ActivityBar`；
 * 本组件不再持有收起态形态，也不再渲染任何开合按钮。
 * `shrink-0 grow-0` 保证它永不挤压左侧主区域。
 */
export function RightSidebar() {
  return (
    <aside
      className={`flex min-h-0 ${RIGHT_SIDEBAR_WIDTH_CLASS} min-w-0 shrink-0 grow-0 flex-col`}
    >
      <LogPanel />
    </aside>
  )
}
