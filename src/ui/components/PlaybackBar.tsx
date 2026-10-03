import { useEffect, useRef } from 'react'
import { useAdapters } from '../context/AdapterContext'
import { useEditorStore } from '../stores/editorStore'
import { seekPlayhead, stampActiveLine, togglePlayback } from '../utils/editorCommands'
import { formatDuration } from '../utils/format'

/**
 * 底部播放控制条。
 *
 * 架构约定（架构文档 §6.4）：**音频时钟是播放的唯一基准**。
 * 因此这里的按钮不翻转本地状态，而是调用音频端口的 `play` / `pause`，
 * `isPlaying` 由端口的 `onStateChange` 回灌（见 `useAudioPlayback`）。
 */

/** 可选的播放速率。 */
const RATE_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2]

/** 滚轮一格对应的音量步进。 */
const WHEEL_STEP = 0.05

/** 累计多少像素滚轮位移换算成一格（约等于一次常规滚轮）。 */
const WHEEL_STEP_UNIT_PX = 100

/** `deltaMode === 1`（按行）时，一行折算的像素高度。 */
const WHEEL_LINE_HEIGHT_PX = 16

/**
 * 播放控制条。
 */
export function PlaybackBar() {
  const adapters = useAdapters()
  const playback = useEditorStore((state) => state.playback)
  const audioAsset = useEditorStore((state) => state.audioAsset)
  const setRate = useEditorStore((state) => state.setRate)
  const setVolume = useEditorStore((state) => state.setVolume)

  const durationMs = audioAsset?.durationMs ?? 0
  const hasAudio = audioAsset !== null && durationMs > 0

  const volumeLabelRef = useRef<HTMLLabelElement | null>(null)
  /** 滚轮累加器：同向累加、反向清零，跨事件保留余数。 */
  const wheelAccRef = useRef({ acc: 0, dir: 0 })

  useEffect(() => {
    const el = volumeLabelRef.current
    if (el === null) return
    const handleWheel = (event: WheelEvent): void => {
      // deltaMode 1 = 按行滚动，折算成像素；0 = 像素，2 = 按页（少见，按像素处理）
      const normalized = event.deltaMode === 1 ? event.deltaY * WHEEL_LINE_HEIGHT_PX : event.deltaY
      if (normalized === 0) return
      // React 17+ 的 onWheel 是 passive，preventDefault 无效，这里用原生监听
      event.preventDefault()
      event.stopPropagation()
      const sign = Math.sign(normalized)
      const acc = wheelAccRef.current
      if (sign !== acc.dir) {
        acc.acc = 0
        acc.dir = sign
      }
      acc.acc += normalized
      const steps = Math.trunc(acc.acc / WHEEL_STEP_UNIT_PX)
      if (steps === 0) return
      acc.acc -= steps * WHEEL_STEP_UNIT_PX
      // 从 store 现取最新音量，避免 effect 闭包读到陈旧值
      const { volume } = useEditorStore.getState().playback
      // 滚轮向上（deltaY < 0）→ steps < 0 → 减负数 → 音量增大
      setVolume(Math.min(1, Math.max(0, volume - steps * WHEEL_STEP)))
    }
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [setVolume])

  const handleSeek = (timeMs: number): void => {
    seekPlayhead(adapters, timeMs)
  }

  return (
    <div className="flex h-14 shrink-0 items-center gap-4 border-t border-divider bg-panel px-4">
      <button
        type="button"
        onClick={() => togglePlayback(adapters)}
        disabled={!hasAudio}
        title="播放/暂停（E）"
        className="w-20 rounded border border-divider px-3 py-1 text-xs text-neutral-200 enabled:hover:border-accent/60 enabled:hover:text-accent disabled:opacity-40"
      >
        {playback.isPlaying ? '暂停' : '播放'}
      </button>

      <button
        type="button"
        onClick={() => stampActiveLine(adapters)}
        title="打轴（空格）"
        className="w-20 rounded border border-divider px-3 py-1 text-xs text-neutral-200 hover:border-accent/60 hover:text-accent"
      >
        打轴
      </button>

      <span className="w-40 shrink-0 font-mono text-xs text-neutral-400">
        {formatDuration(playback.playheadMs)}
        <span className="text-neutral-600"> / {hasAudio ? formatDuration(durationMs) : '--:--.---'}</span>
      </span>

      <input
        type="range"
        min={0}
        max={hasAudio ? durationMs : 1}
        step={10}
        value={Math.min(playback.playheadMs, hasAudio ? durationMs : 1)}
        onChange={(event) => handleSeek(Number(event.target.value))}
        disabled={!hasAudio}
        className="min-w-0 flex-1 accent-accent disabled:opacity-40"
        aria-label="播放进度"
      />

      <label className="flex shrink-0 items-center gap-1.5 text-[11px] text-neutral-500">
        速率
        <select
          value={playback.rate}
          onChange={(event) => setRate(Number(event.target.value))}
          className="rounded border border-divider bg-canvas px-1.5 py-0.5 text-[11px] text-neutral-200"
        >
          {RATE_OPTIONS.map((rate) => (
            <option key={rate} value={rate}>
              {rate}x
            </option>
          ))}
        </select>
      </label>

      <label
        ref={volumeLabelRef}
        data-volume-control
        className="flex shrink-0 items-center gap-1.5 text-[11px] text-neutral-500"
      >
        音量
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={playback.volume}
          onChange={(event) => setVolume(Number(event.target.value))}
          className="w-24 accent-accent"
          aria-label="音量"
        />
      </label>

      {hasAudio ? (
        <span className="shrink-0 truncate text-[11px] text-neutral-500">{audioAsset.source.name}</span>
      ) : (
        <span className="shrink-0 text-[11px] text-amber-400/80">未加载音频</span>
      )}
    </div>
  )
}
