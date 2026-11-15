import { LyricBlockPanel } from '../components/LyricBlockPanel'
import { PlaybackBar } from '../components/PlaybackBar'
import { TimelineStrip } from '../timeline/TimelineStrip'

interface LeftColumnProps {
  /**
   * 窄视口：把播放条从布局页脚移进本列，插在波形图与歌词列表之间。
   *
   * 只在本列为 true 时渲染，保证全页始终只有一个 `[data-volume-control]`
   * 实例（拒绝 CSS 双份渲染）。桌面端仍由布局页脚渲染。
   */
  showPlaybackBar?: boolean
}

/**
 * 左侧主区域：时间轴条 + 歌词块清单，纵向约 1.4 : 1 分割。
 *
 * 组件语义是「主内容列」：由于设置项 `sidebarPosition` 可把侧栏切到左侧，
 * 本列的视觉位置也可能在右侧（此时名字与实际方位不符）。
 * 待全部 UI 重构（2c / 轮 3）闭环后统一改名，本轮不动。
 *
 * 自身 `flex-1 min-w-0`：只要还在父级 flex 行里，就无条件吃掉剩余宽度，
 * 右侧侧栏（展开 / 收起）如何变化都不影响它拿满剩余空间。
 * 两个子组件的高度比例仍由它们自身的 `flex-[1.4]` / `flex-1` 决定。
 */
export function LeftColumn({ showPlaybackBar = false }: LeftColumnProps) {
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      {/* 左上：时间轴条（自身带 flex-[1.4] 卡片样式，约 58% 高度） */}
      <TimelineStrip />
      {/* 窄视口：播放条占用原本页脚的位置，把屏幕最底部让给歌词列表 */}
      {showPlaybackBar && <PlaybackBar />}
      {/* 左下：歌词块清单，吃掉剩余高度（PanelFrame 自带卡片样式与内部滚动） */}
      <LyricBlockPanel />
    </section>
  )
}
