import { useEffect, useRef, useState } from 'react'
import { PlaybackBar } from '../components/PlaybackBar'
import { useSettingsStore } from '../stores/settingsStore'
import { ActivityBar } from './ActivityBar'
import { LeftColumn } from './LeftColumn'
import { RightSidebar } from './RightSidebar'

/**
 * 主界面布局（架构文档 §6.1）。
 *
 * - 左侧：`LeftColumn`（时间轴条 + 歌词块清单，约 1.4 : 1 分割高度）；
 * - 右侧：`RightSidebar`（工作日志，展开时才渲染）+ `ActivityBar`（常驻图标栏）；
 *   `ActivityBar` / `RightSidebar` 这一组的停靠侧由设置项 `sidebarPosition` 决定
 *   （默认右侧；切到左侧时整组镜像到主内容列之前，开合状态保持不变）；
 * - 底部：播放控制条，音频时钟是唯一播放基准。
 *
 * ## 为什么用 flex 而不是 grid
 * 左侧主区域必须**无条件**吃掉剩余宽度。grid 里 `1fr` 的轨道下限是 `auto`
 * （即内容的 min-content），只要任何一层漏掉 `min-w-0`，轨道就会被内容撑开。
 * 换成 flex 后：左侧主区域 `flex-1 min-w-0`（下限 0），右侧侧栏
 * `w-80 shrink-0 grow-0`（固定宽、不参与伸缩），两者互不侵犯；
 * 侧栏收起时左侧靠 `flex-1` 自动向右扩展占满空间，只剩常驻的 `w-12` 活动栏。
 *
 * ## 高度与留白
 * 本组件位于 App 的 `main`（其上还有工具栏 header），因此沿用 `h-full`
 * 贴合视口——写 `min-h-screen` 会把 footer 顶出视口。最外层 `p-3` 保证
 * 所有板块（含底部 PlaybackBar）都不紧贴浏览器边界。
 *
 * ## 侧栏开合的状态归属
 * 默认策略看视口宽度：宽屏展开、窄屏收起。**用户一旦手动点过活动栏图标**，
 * 就记在 `userToggledRef` 里，此后跨断点不再覆盖用户选择（尊重用户意图）。
 */

/**
 * 视口窄于该宽度时右侧日志默认收起成图标栏，把空间让给主编辑区。
 * 用 `min-width` 查询，宽屏时才展开。
 */
const WIDE_VIEWPORT_QUERY = '(min-width: 1100px)'

export function ThreeColumnLayout() {
  const [isCollapsed, setIsCollapsed] = useState(
    () => !window.matchMedia(WIDE_VIEWPORT_QUERY).matches,
  )
  // 用户手动开合过之后，断点变化不再接管状态
  const userToggledRef = useRef(false)

  // 跨过断点时跟随默认策略；用户手动收起 / 展开过则不再生效
  useEffect(() => {
    const query = window.matchMedia(WIDE_VIEWPORT_QUERY)
    const handleChange = (event: MediaQueryListEvent): void => {
      if (userToggledRef.current) return
      setIsCollapsed(!event.matches)
    }
    query.addEventListener('change', handleChange)
    return () => query.removeEventListener('change', handleChange)
  }, [])

  const handleToggle = (): void => {
    userToggledRef.current = true
    setIsCollapsed((collapsed) => !collapsed)
  }

  // 侧栏停靠侧（默认右侧）：只改变渲染顺序，不重置 isCollapsed
  const sidebarPosition = useSettingsStore((state) => state.settings.sidebarPosition)

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-3 overflow-hidden bg-canvas p-3">
      <div className="flex min-h-0 min-w-0 flex-1 gap-3">
        {sidebarPosition === 'left' ? (
          <>
            <ActivityBar side="left" isPanelOpen={!isCollapsed} onToggle={handleToggle} />
            {!isCollapsed && <RightSidebar />}
            <LeftColumn />
          </>
        ) : (
          <>
            <LeftColumn />
            {!isCollapsed && <RightSidebar />}
            <ActivityBar side="right" isPanelOpen={!isCollapsed} onToggle={handleToggle} />
          </>
        )}
      </div>

      {/* 底部：播放控制，位于最外层 padding 之内 */}
      <footer className="shrink-0">
        <PlaybackBar />
      </footer>
    </div>
  )
}
