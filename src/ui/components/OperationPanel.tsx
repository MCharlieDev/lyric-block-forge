import { useState } from 'react'
import { useAdapters } from '../context/AdapterContext'
import { useEditorStore } from '../stores/editorStore'
import { moveSelection, nudgeSelection, stampActiveLine, togglePlayback } from '../utils/editorCommands'
import { zoomActiveTimeline } from '../timeline/useTimelineViewport'

/**
 * 移动端「操作」面板。
 *
 * 装在 `MobileToolbar` 的 `BottomSheet` 里，把桌面端散落在播放条 / 时间轴上的
 * 关键动作收拢成一块触屏友好的面板：音量、速率、缩放、方向键、播放、打轴。
 *
 * ## 与桌面入口等价
 * 所有动作都调 `editorCommands` 里的**同一个函数**（不在这里另写一套逻辑），
 * 因此按钮与快捷键 / 桌面按钮的行为不会分叉。
 *
 * ## 缩放的桥接
 * 时间轴内核由 `TimelineStrip` 私有持有，本组件拿不到实例，
 * 故走 `zoomActiveTimeline`（模块级桥接，锚点为当前播放头）。
 */

/** 可选的播放速率（与 `PlaybackBar` 同口径，刻意不跨组件导出以免耦合）。 */
const RATE_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2]

/** 按钮公共样式：触屏目标 ≥ 44px，禁掉长按选中文字与双击缩放。 */
const BUTTON_CLASS =
  'select-none touch-manipulation rounded-lg border border-divider bg-canvas text-sm text-neutral-200 transition-colors active:bg-panel disabled:opacity-40'

/**
 * 移动端操作面板。
 */
export function OperationPanel() {
  const adapters = useAdapters()
  const playback = useEditorStore((state) => state.playback)
  const audioAsset = useEditorStore((state) => state.audioAsset)
  const setRate = useEditorStore((state) => state.setRate)
  const setVolume = useEditorStore((state) => state.setVolume)

  /** 速率 chip 排是否展开 */
  const [isRateOpen, setIsRateOpen] = useState(false)

  return (
    <div data-operation-panel className="flex flex-col gap-3 text-neutral-200">
      {/* 顶排：音量图标 + 音量滑块 + 速率按钮 */}
      <div className="flex items-center gap-3">
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-5 w-5 shrink-0 text-neutral-400"
        >
          {/* 喇叭 + 两道声波 */}
          <path d="M11 5 6.5 9H3v6h3.5L11 19z" />
          <path d="M15.5 8.8a4.5 4.5 0 0 1 0 6.4M18.5 6a8.5 8.5 0 0 1 0 12" />
        </svg>
        <input
          type="range"
          data-op-volume
          min={0}
          max={1}
          step={0.01}
          value={playback.volume}
          onChange={(event) => setVolume(Number(event.target.value))}
          className="min-w-0 flex-1 accent-accent"
          aria-label="音量"
        />
        <button
          type="button"
          data-op-action="rate"
          onClick={() => setIsRateOpen((open) => !open)}
          aria-expanded={isRateOpen}
          aria-label="播放速率"
          className={`${BUTTON_CLASS} shrink-0 px-3 py-2 tabular-nums`}
        >
          {playback.rate}x
        </button>
      </div>

      {/* 速率档位：内联展开（抽屉内容区 overflow-y-auto 会裁掉绝对定位弹层） */}
      {isRateOpen && (
        <div data-op-rate-menu className="grid grid-cols-6 gap-2">
          {RATE_OPTIONS.map((rate) => (
            <button
              key={rate}
              type="button"
              data-op-rate={rate}
              onClick={() => {
                setRate(rate)
                setIsRateOpen(false)
              }}
              className={`${BUTTON_CLASS} py-2 text-xs tabular-nums ${
                rate === playback.rate ? 'border-accent text-accent' : ''
              }`}
            >
              {rate}x
            </button>
          ))}
        </div>
      )}

      {/* 缩放排 */}
      <div className="flex gap-2">
        <button
          type="button"
          data-op-action="zoom-out"
          onClick={() => zoomActiveTimeline(1 / 1.5)}
          className={`${BUTTON_CLASS} flex-1 py-2`}
        >
          － 缩小
        </button>
        <button
          type="button"
          data-op-action="zoom-in"
          onClick={() => zoomActiveTimeline(1.5)}
          className={`${BUTTON_CLASS} flex-1 py-2`}
        >
          ＋ 放大
        </button>
      </div>

      {/* 方向键：← / → 跨两行贴在两侧，↑ / ↓ 居中成列 */}
      <div className="grid h-40 grid-cols-3 grid-rows-2 gap-2">
        <button
          type="button"
          data-op-action="left"
          onClick={() => nudgeSelection(-10)}
          aria-label="选中行前移"
          className={`${BUTTON_CLASS} col-start-1 row-span-2 row-start-1 text-xl`}
        >
          ←
        </button>
        <button
          type="button"
          data-op-action="up"
          onClick={() => moveSelection(-1)}
          aria-label="上一行"
          className={`${BUTTON_CLASS} col-start-2 row-start-1 text-xl`}
        >
          ↑
        </button>
        <button
          type="button"
          data-op-action="down"
          onClick={() => moveSelection(1)}
          aria-label="下一行"
          className={`${BUTTON_CLASS} col-start-2 row-start-2 text-xl`}
        >
          ↓
        </button>
        <button
          type="button"
          data-op-action="right"
          onClick={() => nudgeSelection(10)}
          aria-label="选中行后移"
          className={`${BUTTON_CLASS} col-start-3 row-span-2 row-start-1 text-xl`}
        >
          →
        </button>
      </div>

      {/* 底部两个大按键：播放 / 暂停、打轴 */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          data-op-action="play"
          onClick={() => togglePlayback(adapters)}
          disabled={audioAsset === null}
          className={`${BUTTON_CLASS} py-3 font-medium`}
        >
          {playback.isPlaying ? '暂停' : '播放'}
        </button>
        <button
          type="button"
          data-op-action="stamp"
          onClick={() => stampActiveLine(adapters)}
          className={`${BUTTON_CLASS} py-3 font-medium`}
        >
          打轴
        </button>
      </div>
    </div>
  )
}
