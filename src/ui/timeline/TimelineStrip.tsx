import { useCallback, useEffect, useMemo, useRef } from 'react'
import { getReplayedLineTimes, getReplayedWordTime } from '@core'
import { useAdapters } from '../context/AdapterContext'
import { useEditorStore } from '../stores/editorStore'
import { useSettingsStore } from '../stores/settingsStore'
import { pauseAudioOnGesture } from '../utils/editorCommands'
import { AnalysisTrack } from './AnalysisTrack'
import { HorizontalScrollbar } from './Scrollbar'
import { LyricTrack } from './LyricTrack'
import { PlayheadLayer } from './PlayheadLayer'
import { PlayheadOffscreenHint } from './PlayheadOffscreenHint'
import { TimeRuler } from './TimeRuler'
import { WaveformLayer } from './WaveformLayer'
import { useTimelineViewportKernel, useViewportRef } from './useTimelineViewport'
import { TimelineViewportContext } from './viewportContext'

/** 内容时长的兜底下限：没有音频也没有歌词时，时间轴仍要有一段可缩放的空白。 */
const MIN_DURATION_MS = 30_000

/** 时间轴尾部留白：让最后一个时间戳不至于贴死在右边界。 */
const DURATION_TAIL_MS = 5_000

/** 滚轮缩放灵敏度：`factor = exp(-deltaY × ZOOM_SPEED)`。 */
const ZOOM_SPEED = 0.0015

/**
 * 时间轴条 —— 波形 / 刻度 / 歌词块的唯一装配点，也是"同生共死"的宿主。
 *
 * ## 图层划分（架构文档 §6.1）
 * 自上而下：刻度尺 → 分析轨 → 波形 → 歌词轨道；播放头是**独立贯穿层**，
 * 叠在整条之上。所有图层都从同一个内核取当前帧，谁也不许自己算时间。
 *
 * ## 为什么尺寸由内核测量
 * 视口宽度决定了"一屏能看多少毫秒"，因此宽度必须喂给内核，
 * 由它统一换算并广播。这里只把根元素交给 `attachViewport`。
 *
 * ## 交互入口
 * - 滚轮：`ctrl/meta` → 以指针为锚点缩放；其余一律 → 横向平移；
 * - 播放进度：订阅音频 tick，只 `invalidate()` 触发重绘，播放中才推动视口跟随。
 */
export function TimelineStrip() {
  const adapters = useAdapters()
  const kernel = useTimelineViewportKernel()
  const attachViewport = useViewportRef(kernel)

  const rootRef = useRef<HTMLDivElement | null>(null)
  const lines = useEditorStore((state) => state.document.lines)
  const replay = useEditorStore((state) => state.replay)
  const audioDurationMs = useEditorStore((state) => state.audioAsset?.durationMs ?? 0)

  // 根元素同时交给 ref 与内核：内核负责测量，ref 供滚轮监听取绑定目标
  const setRootRef = useCallback(
    (element: HTMLDivElement | null) => {
      rootRef.current = element
      attachViewport(element)
    },
    [attachViewport],
  )

  // 时长 = 音频时长与全部时间戳（含字级）的最大值，再留一段尾巴
  const durationMs = useMemo(() => {
    let maxTimeMs = 0
    for (const line of lines) {
      for (const timeMs of getReplayedLineTimes(replay, line.id)) {
        if (timeMs > maxTimeMs) maxTimeMs = timeMs
      }
      for (let index = 0; index < line.wordTimestamps.length; index += 1) {
        const wordMs = getReplayedWordTime(replay, line.id, index)
        if (wordMs !== null && wordMs > maxTimeMs) maxTimeMs = wordMs
      }
    }
    return Math.max(audioDurationMs, maxTimeMs, MIN_DURATION_MS) + DURATION_TAIL_MS
  }, [lines, replay, audioDurationMs])

  useEffect(() => {
    kernel.setDuration(durationMs)
  }, [kernel, durationMs])

  useEffect(() => {
    const element = rootRef.current
    if (element === null) return

    const handleWheel = (event: WheelEvent): void => {
      // 拦下默认行为：否则 ctrl+wheel 会缩放整个页面
      event.preventDefault()
      if (event.ctrlKey || event.metaKey) {
        const rect = element.getBoundingClientRect()
        kernel.zoomAt(event.clientX - rect.left, Math.exp(-event.deltaY * ZOOM_SPEED))
        return
      }
      // 其余滚轮一律横向平移：Shift + 滚轮时浏览器会把纵向滚转成 deltaX，
      // 普通滚轮的纵向分量也直接当作平移，保证"滚轮永远是横向移动"。
      // 平移手势起始：按设置真暂停音频；B 模式下手动平移即进入暂停跟随态。
      const settings = useSettingsStore.getState().settings
      pauseAudioOnGesture(adapters, settings.pauseAudioOnPan)
      if (settings.followResumeMode === 'pause') kernel.setFollowPaused(true)
      kernel.panByPixels(event.deltaX !== 0 ? event.deltaX : event.deltaY)
    }

    element.addEventListener('wheel', handleWheel, { passive: false })
    return () => element.removeEventListener('wheel', handleWheel)
  }, [adapters, kernel])

  // 播放进度：音频时钟是唯一基准，这里只负责让内核重绘，播放中顺带推动视口
  useEffect(() => {
    return adapters.audio.onTick((timeMs) => {
      kernel.invalidate()
      if (useEditorStore.getState().playback.isPlaying) kernel.followPlayhead(timeMs)
    })
  }, [adapters, kernel])

  const contextValue = useMemo(() => ({ kernel, durationMs }), [kernel, durationMs])

  return (
    <TimelineViewportContext.Provider value={contextValue}>
      {/*
        根容器即布局里的"左上卡片"：`flex-[1.4]` 与下方歌词块的 `flex-1`
        按约 1.4 : 1 分割左侧主区域高度（约 58% / 42%）。
      */}
      <div
        ref={setRootRef}
        className="flex min-h-0 min-w-0 flex-[1.4] flex-col overflow-hidden rounded-lg border border-divider bg-panel/50"
      >
        {/*
          图层容器：横向滚动由内核 + 自绘滚动条负责，因此这里**不能**出现
          原生滚动条。`overflow-y: hidden` 保证纵向永不溢出，`overflow-x: auto`
          只是兜底（所有图层的宽度都跟随视口，正常不会产生原生横向滚动），
          并且禁止换行，避免内容被挤成多行。
        */}
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <TimeRuler />
          <AnalysisTrack />
          <WaveformLayer />
          <LyricTrack />
          <PlayheadLayer />
          <PlayheadOffscreenHint />
        </div>
        <HorizontalScrollbar />
      </div>
    </TimelineViewportContext.Provider>
  )
}
