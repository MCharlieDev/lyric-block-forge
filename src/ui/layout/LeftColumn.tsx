import { useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { LyricBlockPanel } from '../components/LyricBlockPanel'
import { PlaybackBar } from '../components/PlaybackBar'
import { TimelineStrip } from '../timeline/TimelineStrip'

/** 上区（波形 + 播放条）默认占本列高度的比例：保持原有 1.4 : 1 的观感。 */
const DEFAULT_RATIO = 0.58
/** 上区最少占比：低于它波形挤没了。 */
const MIN_RATIO = 0.2
/** 上区最多占比：留出下区至少 20% 给歌词列表（由 `MAX_RATIO - extras` 反推）。 */
const MAX_RATIO = 0.8

/** 拖动期间按下的起点快照；`extras` = 分割线高度 + 两段 gap。 */
interface DragSnapshot {
  startY: number
  startTopPx: number
  sectionH: number
  extras: number
}

interface LeftColumnProps {
  /**
   * 窄视口：把播放条从布局页脚移进本列，插在波形图与歌词列表之间。
   *
   * 只在本列为 true 时渲染，保证全页始终只有一个 `[data-volume-control]`
   * 实例（拒绝 CSS 双份渲染）。桌面端仍由布局页脚渲染。
   *
   * 同时充当「移动端高度分割线」的闸门：该分割线只在窄屏有价值，
   * 桌面端高度充裕，多一条可拖的横线只会增加手势冲突面。
   */
  showPlaybackBar?: boolean
}

/**
 * 左侧主区域：时间轴条 + 歌词块清单。
 *
 * 组件语义是「主内容列」：由于设置项 `sidebarPosition` 可把侧栏切到左侧，
 * 本列的视觉位置也可能在右侧（此时名字与实际方位不符）。
 * 待全部 UI 重构（2c / 轮 3）闭环后统一改名，本轮不动。
 *
 * 自身 `flex-1 min-w-0`：只要还在父级 flex 行里，就无条件吃掉剩余宽度，
 * 右侧侧栏（展开 / 收起）如何变化都不影响它拿满剩余空间。
 *
 * ## 高度分配
 * 上区（`data-column-top`：时间轴条 + 窄屏播放条）用内联 `flex-basis` 百分比
 * 锁死，下区 `LyricBlockPanel` 靠自身的 `flex-1` 吃掉剩余高度。
 *
 * 这里刻意**不引入 grid**：`grid-template-rows` 的 `1fr` 轨道下限是 `auto`，
 * 任何一层漏掉 `min-h-0` 都会被内容撑开（同 `ThreeColumnLayout` 的取向）。
 * 存「比例」而不是「像素」，旋转 / 地址栏收起 / 软键盘弹起后无需任何
 * `ResizeObserver` 也能保持占比。
 */
export function LeftColumn({ showPlaybackBar = false }: LeftColumnProps) {
  const [ratio, setRatio] = useState(DEFAULT_RATIO)
  const [isDragging, setIsDragging] = useState(false)
  const sectionRef = useRef<HTMLElement | null>(null)
  const dragRef = useRef<DragSnapshot>({ startY: 0, startTopPx: 0, sectionH: 0, extras: 0 })

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const section = sectionRef.current
    const top = section?.querySelector<HTMLElement>('[data-column-top]') ?? null
    if (section === null || top === null) return
    event.preventDefault()
    // 捕获指针：手指拖出分割线后 move / up 仍然回到这里，不会落到时间轴或列表上
    event.currentTarget.setPointerCapture(event.pointerId)
    const rowGap = Number.parseFloat(getComputedStyle(section).rowGap) || 0
    const splitterH = section.querySelector('[data-column-splitter]')?.getBoundingClientRect().height ?? 0
    dragRef.current = {
      startY: event.clientY,
      startTopPx: top.getBoundingClientRect().height,
      sectionH: section.clientHeight,
      // 分割线自身高度 + 上下两段 gap 都不参与「上下两区」的高度分配
      extras: splitterH + rowGap * 2,
    }
    setIsDragging(true)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!isDragging) return
    const { startY, startTopPx, sectionH, extras } = dragRef.current
    if (sectionH <= 0) return
    const rawTop = startTopPx + (event.clientY - startY)
    const minH = sectionH * MIN_RATIO
    // 上限要减去 extras，才能保证下区仍然拿到 20%
    const maxH = sectionH * MAX_RATIO - extras
    const clampedTop = Math.max(minH, Math.min(maxH, rawTop))
    setRatio(clampedTop / sectionH)
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setIsDragging(false)
  }

  return (
    <section ref={sectionRef} className="flex min-h-0 min-w-0 flex-1 flex-col gap-1 md:gap-3">
      {/* 左上：时间轴条（+ 窄屏播放条），高度由 `ratio` 决定 */}
      <div
        data-column-top
        className="flex min-h-0 flex-col"
        style={{ flex: `0 0 ${ratio * 100}%` }}
      >
        <TimelineStrip />
        {/* 窄视口：播放条占用原本页脚的位置，把屏幕最底部让给歌词列表 */}
        {showPlaybackBar && <PlaybackBar />}
      </div>
      {/* 窄视口：拖拽分割线，调整上区 / 歌词列表的高度占比 */}
      {showPlaybackBar && (
        <div
          data-column-splitter
          role="separator"
          aria-orientation="horizontal"
          aria-label="调整歌词列表高度"
          className="flex shrink-0 cursor-row-resize touch-none select-none items-center justify-center py-2"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <div
            className={`h-0.5 w-8 rounded-full transition-colors ${
              isDragging ? 'bg-accent' : 'bg-divider'
            }`}
          />
        </div>
      )}
      {/* 左下：歌词块清单，吃掉剩余高度（PanelFrame 自带卡片样式与内部滚动） */}
      <LyricBlockPanel />
    </section>
  )
}
