import { useEffect, useState } from 'react'
import { LyricBlockPanel } from '../components/LyricBlockPanel'
import { LogPanel } from '../components/LogPanel'
import { PlaybackBar } from '../components/PlaybackBar'
import { TimelineStrip } from '../timeline/TimelineStrip'

/**
 * 主界面布局（架构文档 §6.1）。
 *
 * - 左上：时间轴条，波形 / 刻度 / 歌词块三层共享同一毫秒坐标系；
 * - 左下：歌词块清单，与时间轴条按约 1.4 : 1 分割高度；
 * - 右侧：工作日志（随文档保存，不是控制台日志），可收起成窄栏；
 * - 底部：播放控制条，音频时钟是唯一播放基准。
 *
 * ## 为什么用 flex 而不是 grid
 * 左侧主区域必须**无条件**吃掉剩余宽度。grid 里 `1fr` 的轨道下限是 `auto`
 * （即内容的 min-content），只要任何一层漏掉 `min-w-0`，轨道就会被内容撑开。
 * 换成 flex 后：左侧主区域 `flex-1 min-w-0`（下限 0），右侧日志
 * `w-80 shrink-0 grow-0`（固定宽、不参与伸缩），两者互不侵犯；
 * 日志收起时左侧靠 `flex-1` 自动向右扩展占满空间。
 *
 * ## 高度与留白
 * 本组件位于 App 的 `main`（其上还有工具栏 header），因此沿用 `h-full`
 * 贴合视口——写 `min-h-screen` 会把 footer 顶出视口。最外层 `p-3` 保证
 * 所有板块（含底部 PlaybackBar）都不紧贴浏览器边界。
 */

/** 右侧日志面板的固定宽度：20rem，正好是 `w-80`。 */
const LOG_PANEL_WIDTH_CLASS = 'w-80'

/** 收起态的图标栏宽度。 */
const LOG_PANEL_RAIL_WIDTH_CLASS = 'w-9'

/**
 * 视口窄于该宽度时右侧日志默认收起成图标栏，把空间让给主编辑区。
 * 用 `min-width` 查询，宽屏时才展开。
 */
const WIDE_VIEWPORT_QUERY = '(min-width: 1100px)'

export function ThreeColumnLayout() {
  const [logPanelOpen, setLogPanelOpen] = useState(
    () => window.matchMedia(WIDE_VIEWPORT_QUERY).matches,
  )

  // 跨过断点时跟随默认策略；用户手动收起 / 展开也走同一个状态
  useEffect(() => {
    const query = window.matchMedia(WIDE_VIEWPORT_QUERY)
    const handleChange = (event: MediaQueryListEvent): void => setLogPanelOpen(event.matches)
    query.addEventListener('change', handleChange)
    return () => query.removeEventListener('change', handleChange)
  }, [])

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-3 overflow-hidden bg-canvas p-3">
      <div className="flex min-h-0 min-w-0 flex-1 gap-3">
        {/* 左侧主区域：`flex-1` + `min-w-0`，任何情况下都优先拿满剩余宽度 */}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
          {/* 左上：时间轴条（自身带 flex-[1.4] 卡片样式，约 58% 高度） */}
          <TimelineStrip />
          {/* 左下：歌词块清单，吃掉剩余高度（PanelFrame 自带卡片样式与内部滚动） */}
          <LyricBlockPanel />
        </section>

        {/* 右侧日志：固定宽 + `shrink-0 grow-0`，绝不挤压左侧主区域 */}
        {logPanelOpen ? (
          <aside
            className={`flex min-h-0 ${LOG_PANEL_WIDTH_CLASS} min-w-0 shrink-0 grow-0 flex-col`}
          >
            {/* 透明控制条：不占卡片视觉，只承载"收起"入口 */}
            <div className="flex h-6 shrink-0 items-center justify-end">
              <button
                type="button"
                title="收起日志面板"
                onClick={() => setLogPanelOpen(false)}
                className="rounded px-1.5 text-[11px] leading-none text-neutral-500 hover:text-accent"
              >
                收起 ›
              </button>
            </div>
            <LogPanel />
          </aside>
        ) : (
          <aside
            className={`flex min-h-0 ${LOG_PANEL_RAIL_WIDTH_CLASS} shrink-0 grow-0 flex-col items-center gap-2 rounded-lg border border-divider bg-panel/50 py-2`}
          >
            <button
              type="button"
              title="展开日志面板"
              onClick={() => setLogPanelOpen(true)}
              className="rounded border border-divider px-1 py-0.5 text-[11px] leading-none text-neutral-400 hover:border-accent/60 hover:text-accent"
            >
              ‹
            </button>
            <span className="text-[10px] tracking-widest text-neutral-600 [writing-mode:vertical-rl]">
              日志
            </span>
          </aside>
        )}
      </div>

      {/* 底部：播放控制，位于最外层 padding 之内 */}
      <footer className="shrink-0">
        <PlaybackBar />
      </footer>
    </div>
  )
}
