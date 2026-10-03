import { useEffect, useMemo, useState } from 'react'
import { parseLrc } from '@core'
import { toBilingualOptions, useSettingsStore } from '../stores/settingsStore'

/** 手动输入弹窗属性。 */
export interface TextImportDialogProps {
  /** 是否打开 */
  open: boolean
  /** 关闭弹窗（取消） */
  onClose: () => void
  /**
   * 确认导入。
   *
   * 弹窗只负责编辑与预览，"纯文本 → 文档"由调用方的管道执行，
   * 与文件导入、剪贴板导入共用同一套解析语义。
   *
   * @param text 待导入的纯文本
   */
  onConfirm: (text: string) => void
}

/**
 * 手动输入歌词弹窗。
 *
 * 纯文本导入最需要"确认前看一眼"：编辑区下方实时显示解析后会得到多少行、
 * 其中多少行带时间戳，让用户在确认前就知道结果。统计直接复用 {@link parseLrc}，
 * 因此与真实导入结果一致（含双语合并等预设处理）。
 */
export function TextImportDialog({ open, onClose, onConfirm }: TextImportDialogProps) {
  const settings = useSettingsStore((state) => state.settings)
  const [text, setText] = useState('')

  // 每次打开都从空白开始，避免上一次的内容被误导入
  useEffect(() => {
    if (open) setText('')
  }, [open])

  const preview = useMemo(() => {
    if (text.trim() === '') return { lines: 0, timed: 0 }
    const result = parseLrc(text, { bilingual: toBilingualOptions(settings) })
    const lines = result.document?.lines ?? []
    return {
      lines: lines.length,
      timed: lines.filter((line) => line.timestamps.length > 0).length,
    }
  }, [text, settings])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="手动输入歌词"
        className="flex w-[34rem] max-w-[90vw] flex-col gap-2 rounded border border-divider bg-panel p-4 shadow-xl"
      >
        <p className="text-xs font-medium text-neutral-200">手动输入歌词</p>
        <p className="text-[11px] text-neutral-500">
          带 [mm:ss.xx] 时间戳的按 LRC 解析；不带时间戳的每行作为一条未打轴歌词。
        </p>
        <textarea
          autoFocus
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={'[00:12.00]夜色渐深 风穿过长街\n或直接粘贴不带时间戳的纯歌词'}
          className="h-64 w-full resize-none rounded border border-divider bg-canvas px-2 py-1.5 font-mono text-[11px] text-neutral-200 outline-none focus:border-accent/60"
        />
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-neutral-500">
            检测到 {preview.lines} 行，其中 {preview.timed} 行带时间戳
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-divider px-2 py-0.5 text-[11px] text-neutral-300 hover:border-accent/60 hover:text-accent"
            >
              取消
            </button>
            <button
              type="button"
              disabled={preview.lines === 0}
              onClick={() => onConfirm(text)}
              className="rounded border border-divider px-2 py-0.5 text-[11px] text-neutral-300 enabled:hover:border-accent/60 enabled:hover:text-accent disabled:opacity-40"
            >
              导入
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
