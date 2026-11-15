import { useEffect, useMemo, useState } from 'react'
import { parseLrc } from '@core'
import { useAdapters } from './context/AdapterContext'
import { useAudioPlayback } from './hooks/useAudioPlayback'
import { useDialogFocusTrap } from './hooks/useDialogFocusTrap'
import { useEditorHotkeys } from './hooks/useEditorHotkeys'
import { useFileDropImport } from './hooks/useFileDropImport'
import { ThreeColumnLayout } from './layout/ThreeColumnLayout'
import { TextImportDialog } from './components/TextImportDialog'
import { TopBarActions } from './components/TopBarActions'
import { ToastHost } from './components/ToastHost'
import { buildExportText, selectVisibleLines, useEditorStore } from './stores/editorStore'
import { SETTINGS_STORAGE_KEY, toBilingualOptions, toMetadataPrefixOptions, useSettingsStore } from './stores/settingsStore'
import { showToast } from './stores/toastStore'
import { importAudioCommand } from './utils/editorCommands'

/** LRC 文件的导入 / 导出过滤器。 */
const LRC_FILTER = { name: 'LRC 歌词', extensions: ['lrc', 'txt', 'docx'] }

/** 拖拽导入识别的音频扩展名（与 `editorCommands` 的 `AUDIO_FILTER` 保持一致）。 */
const DROP_AUDIO_EXTENSIONS = ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg']

/** 取默认导出文件名，去掉路径分隔符等非法字符。 */
function defaultFileName(title: string | undefined): string {
  const base = (title ?? '').trim() === '' ? 'lyrics' : (title as string).trim()
  return `${base.replace(/[\\/:*?"<>|]/g, '_')}.lrc`
}

/** 统一把异常转成可展示的文案。 */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 应用根组件。
 *
 * 顶栏分两段：
 * - 左：文档身份（标题 / 演唱者 / 行数）+ 音频状态，仅桌面端展示；
 * - 右：三个纯图标（导入 / 导出 / 设置），桌面与窄屏共用 `TopBarActions`，
 *   窄屏不再单独维护 `⋯` 菜单。
 */
export function App() {
  const adapters = useAdapters()
  useAudioPlayback()
  useEditorHotkeys()
  useDialogFocusTrap()
  const doc = useEditorStore((state) => state.document)
  const replay = useEditorStore((state) => state.replay)
  // 顶栏行数与导出都必须以"可见行"为准：被删除的行不该出现在计数与导出文件里
  const visibleLines = useMemo(() => selectVisibleLines(doc, replay), [doc, replay])
  const importDocument = useEditorStore((state) => state.importDocument)
  const notice = useEditorStore((state) => state.notice)
  const clearNotice = useEditorStore((state) => state.clearNotice)
  const [manualInputOpen, setManualInputOpen] = useState(false)
  // 操作成功一律静默（歌词列表与日志面板已有反馈），只有失败才提示；
  // 提示放在右下角浮层且 2 秒后自动消失，不在工具栏常驻任何文字。
  const [errorText, setErrorText] = useState<string | null>(null)

  const settings = useSettingsStore((state) => state.settings)
  const settingsHydrated = useSettingsStore((state) => state.hydrated)
  const hydrateSettings = useSettingsStore((state) => state.hydrate)

  const { storage } = adapters

  // 预设随应用启动从存储读回；读到之前不回写，避免默认值覆盖用户设置
  useEffect(() => {
    let cancelled = false
    void storage.get(SETTINGS_STORAGE_KEY).then((stored) => {
      if (!cancelled) hydrateSettings(stored)
    })
    return () => {
      cancelled = true
    }
  }, [storage, hydrateSettings])

  // 预设变更即时持久化
  useEffect(() => {
    if (!settingsHydrated) return
    void storage.set(SETTINGS_STORAGE_KEY, settings)
  }, [storage, settings, settingsHydrated])

  // 失败提示 2 秒后自动消失
  useEffect(() => {
    if (errorText === null) return
    const timer = window.setTimeout(() => setErrorText(null), 2000)
    return () => window.clearTimeout(timer)
  }, [errorText])

  // 一次性提示同样 2 秒后自动消失
  useEffect(() => {
    if (notice === null) return
    const timer = window.setTimeout(() => clearNotice(), 2000)
    return () => window.clearTimeout(timer)
  }, [notice, clearNotice])

  /**
   * 「纯文本 → 文档」的唯一管道。
   *
   * 文件导入、剪贴板导入、手动输入三条入口都走这里，
   * 保证"带时间戳就按 LRC 解析、不带就每行一条未打轴歌词"只有一套语义
   * （由 `parseLrc` 自身按源文本是否含时间标签决定）。
   *
   * @param text 源文本
   * @param sourceName 来源名称，写进日志描述
   * @param encoding 源编码；剪贴板与手动输入是纯字符串，无编码概念；
   *   二进制容器（如 `.docx`）为 `null`，原样透传给解析器
   * @returns 是否导入成功
   */
  const applyTextImport = (text: string, sourceName: string, encoding?: string | null): boolean => {
    const result = parseLrc(text, {
      encoding,
      bilingual: toBilingualOptions(settings),
      metadataPrefix: toMetadataPrefixOptions(settings),
    })
    if (result.document === null || result.document.lines.length === 0) {
      setErrorText(`无法解析 ${sourceName}：未识别到任何歌词行`)
      return false
    }
    importDocument(result.document, sourceName, result.issues)
    return true
  }

  const handleImportLrc = async (): Promise<void> => {
    try {
      const content = await adapters.file.openTextFile({ filters: [LRC_FILTER] })
      if (content === null) return
      applyTextImport(content.text, content.ref.name, content.encoding)
    } catch (error) {
      setErrorText(`导入 LRC 失败：${describeError(error)}`)
    }
  }

  const handleManualImport = (text: string): void => {
    // 失败时保留弹窗内容，让用户就地修改
    if (applyTextImport(text, '手动输入')) setManualInputOpen(false)
  }

  /** 拖拽文本类文件：解码 / docx 解析复用 `readDroppedFile`，再进统一导入管道。 */
  const importDroppedText = async (file: File): Promise<void> => {
    try {
      const content = await adapters.file.readDroppedFile(file)
      applyTextImport(content.text, content.ref.name, content.encoding)
    } catch (error) {
      showToast(`导入文件失败：${describeError(error)}`)
    }
  }

  /**
   * 全局拖拽落点：只处理第一个文件。
   *
   * 多文件一次拖入时先给一条忽略提示，但**仍然照常导入第一个**，
   * 不因提示而中断，否则用户会以为整个操作被拒。
   */
  const handleDropFiles = (files: FileList): void => {
    if (files.length > 1) showToast('仅支持单次拖入一个文件，已忽略其余文件')
    const file = files[0]
    const dotIndex = file.name.lastIndexOf('.')
    const extension = dotIndex < 0 ? '' : file.name.slice(dotIndex + 1).toLowerCase()
    if (LRC_FILTER.extensions.includes(extension)) {
      void importDroppedText(file)
      return
    }
    if (DROP_AUDIO_EXTENSIONS.includes(extension)) {
      void importAudioCommand(adapters, file)
      return
    }
    showToast('不支持的文件格式')
  }

  const { isDragging } = useFileDropImport(handleDropFiles)

  const handleExportLrc = async (): Promise<void> => {
    try {
      // 导出走"可见文档 + 回放时间戳"：删除行不写、打轴/微调/拖动/偏移都反映；
      // 精度按设置统一（组装与序列化都收在 buildExportText 内，避免两处逻辑漂移）
      const text = buildExportText(doc, replay, settings.timestampPrecisionMs)
      const ref = await adapters.file.saveText({
        suggestedName: defaultFileName(doc.meta.title),
        text,
        filters: [{ name: 'LRC 歌词', extensions: ['lrc'] }],
      })
      if (ref === null) return
    } catch (error) {
      setErrorText(`导出 LRC 失败：${describeError(error)}`)
    }
  }

  return (
    <div className="flex h-full flex-col bg-canvas text-neutral-200">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-divider bg-panel px-4">
        {/* 窄屏顶栏只保留 Logo 作为品牌锚点，歌名 / 行数等冗余信息仅桌面端展示 */}
        <h1 className="shrink-0 whitespace-nowrap text-sm font-medium text-neutral-100">LRC 歌词编辑器</h1>
        <span className="hidden shrink-0 text-[11px] text-neutral-600 md:inline">|</span>
        <span
          className="hidden min-w-0 max-w-[200px] truncate text-xs text-neutral-300 md:inline-block"
          title={`${doc.meta.title ?? '未命名'}${doc.meta.artist ? ` · ${doc.meta.artist}` : ''}`}
        >
          {doc.meta.title ?? '未命名'}
          {doc.meta.artist ? ` · ${doc.meta.artist}` : ''}
        </span>
        <span className="hidden shrink-0 whitespace-nowrap text-[11px] text-neutral-600 md:inline">{visibleLines.length} 行</span>

        {/* 右侧操作区：桌面与窄屏共用同一套三图标，`data-topbar-right` 契约保留给 harness */}
        <div data-topbar-right className="ml-auto flex items-center">
          <TopBarActions
            onImportAudio={() => void importAudioCommand(adapters)}
            onImportText={() => void handleImportLrc()}
            onManualInput={() => setManualInputOpen(true)}
            onExport={() => void handleExportLrc()}
          />
        </div>
      </header>

      <main className="min-h-0 flex-1">
        <ThreeColumnLayout />
      </main>

      {/* 提示：右下角浮层，2 秒后自动消失（见上方 effect）。
          错误用红色，其余一次性提示（如"所选记录中无可撤销项"）用中性色。 */}
      {errorText !== null || notice !== null ? (
        <div
          className={`pointer-events-none fixed bottom-4 right-4 z-50 max-w-md rounded border bg-panel px-3 py-2 text-xs shadow-lg ${
            errorText !== null ? 'border-red-500/40 text-red-400' : 'border-divider text-neutral-300'
          }`}
        >
          {errorText ?? notice}
        </div>
      ) : null}

      <TextImportDialog
        open={manualInputOpen}
        onClose={() => setManualInputOpen(false)}
        onConfirm={handleManualImport}
      />

      {/* 全局拖拽蒙版：盖住整页（含 toast / 弹窗），松手或拖出窗口即卸载 */}
      {isDragging && (
        <div
          data-drop-mask
          className="fixed inset-0 z-[100] flex items-center justify-center bg-canvas/80 backdrop-blur-sm"
        >
          <div className="rounded-xl border-2 border-dashed border-accent/60 bg-panel px-8 py-6 text-sm text-accent shadow-2xl">
            松开鼠标导入文件
          </div>
        </div>
      )}

      {/* 拒绝提示 toast：工具栏下方居中，独立于右下角的失败 / 一次性提示 */}
      <ToastHost />
    </div>
  )
}
