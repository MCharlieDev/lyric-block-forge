import { useEffect, useMemo, useState } from 'react'
import {
  countActiveByKind,
  createId,
  listRevertableKinds,
  parseLrc,
  type AudioAsset,
  type OperationKind,
} from '@core'
import { useAdapters } from './context/AdapterContext'
import { useAudioPlayback } from './hooks/useAudioPlayback'
import { useEditorHotkeys } from './hooks/useEditorHotkeys'
import { OPERATION_KIND_LABEL } from './labels'
import { ThreeColumnLayout } from './layout/ThreeColumnLayout'
import { SettingsMenu } from './components/SettingsMenu'
import { TextImportDialog } from './components/TextImportDialog'
import { ToastHost } from './components/ToastHost'
import { buildExportText, selectVisibleLines, useEditorStore } from './stores/editorStore'
import { SETTINGS_STORAGE_KEY, toBilingualOptions, toMetadataPrefixOptions, useSettingsStore } from './stores/settingsStore'

/** LRC 文件的导入 / 导出过滤器。 */
const LRC_FILTER = { name: 'LRC 歌词', extensions: ['lrc', 'txt'] }
/** 常见的伴奏文件扩展名。 */
const AUDIO_FILTER = { name: '音频文件', extensions: ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg'] }

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
 * 顶栏分三段：
 * - 左：文档身份（标题 / 演唱者 / 行数）+ 音频状态；
 * - 中：文件操作（导入 LRC / 导出 LRC / 导入音频）；
 * - 右：分级回退（按操作类型整体撤销，架构文档 §5.3）。
 */
export function App() {
  const adapters = useAdapters()
  useAudioPlayback()
  useEditorHotkeys()
  const doc = useEditorStore((state) => state.document)
  const replay = useEditorStore((state) => state.replay)
  // 顶栏行数与导出都必须以"可见行"为准：被删除的行不该出现在计数与导出文件里
  const visibleLines = useMemo(() => selectVisibleLines(doc, replay), [doc, replay])
  const log = useEditorStore((state) => state.log)
  const audioAsset = useEditorStore((state) => state.audioAsset)
  const importDocument = useEditorStore((state) => state.importDocument)
  const attachAudio = useEditorStore((state) => state.attachAudio)
  const undoByKindAction = useEditorStore((state) => state.undoByKindAction)
  const notice = useEditorStore((state) => state.notice)
  const clearNotice = useEditorStore((state) => state.clearNotice)
  const [pendingKind, setPendingKind] = useState<OperationKind | ''>('')
  const [importMenuOpen, setImportMenuOpen] = useState(false)
  const [manualInputOpen, setManualInputOpen] = useState(false)
  // 操作成功一律静默（歌词列表与日志面板已有反馈），只有失败才提示；
  // 提示放在右下角浮层且 2 秒后自动消失，不在工具栏常驻任何文字。
  const [errorText, setErrorText] = useState<string | null>(null)

  const settings = useSettingsStore((state) => state.settings)
  const settingsHydrated = useSettingsStore((state) => state.hydrated)
  const hydrateSettings = useSettingsStore((state) => state.hydrate)

  const revertableKinds = useMemo(() => listRevertableKinds(log), [log])
  const activeCounts = useMemo(() => countActiveByKind(log), [log])

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
   * @param encoding 源编码；剪贴板与手动输入是纯字符串，无编码概念
   * @returns 是否导入成功
   */
  const applyTextImport = (text: string, sourceName: string, encoding?: string): boolean => {
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

  const handleImportFromClipboard = async (): Promise<void> => {
    try {
      const text = await adapters.clipboard.readText()
      // 端口层把"被拒绝"和"剪贴板里没有文本"都表现为 null，无法区分，
      // 所以文案覆盖两种可能，并把用户直接送到手动输入
      if (text === null || text.trim() === '') {
        setErrorText('无法读取剪贴板（可能未授权或内容为空），请改用手动输入')
        setManualInputOpen(true)
        return
      }
      applyTextImport(text, '剪贴板')
    } catch (error) {
      setErrorText(`读取剪贴板失败：${describeError(error)}`)
      setManualInputOpen(true)
    }
  }

  const handleManualImport = (text: string): void => {
    // 失败时保留弹窗内容，让用户就地修改
    if (applyTextImport(text, '手动输入')) setManualInputOpen(false)
  }

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

  const handleImportAudio = async (): Promise<void> => {
    try {
      const content = await adapters.file.openAudioFile({ filters: [AUDIO_FILTER] })
      if (content === null) return

      const draft: AudioAsset = {
        id: createId('audio'),
        source: {
          // 文件端口把 object URL 作为 uri，音频端口解码后会自行 revoke
          kind: 'object-url',
          uri: content.ref.uri,
          name: content.ref.name,
          mimeType: content.ref.mimeType,
          sizeBytes: content.ref.sizeBytes,
        },
        durationMs: 0,
        sampleRate: 0,
        channelCount: 0,
        waveformCacheKey: null,
        fingerprint: null,
        analysis: null,
      }

      await adapters.audio.load(draft)
      const spec = adapters.audio.getSpec()
      const asset: AudioAsset =
        spec === null
          ? draft
          : {
              ...draft,
              durationMs: Math.round(spec.durationMs),
              sampleRate: spec.sampleRate,
              channelCount: spec.channelCount,
            }
      attachAudio(asset)
      // 峰值金字塔在后台建，不阻塞播放；建好后波形层会收到通知重绘
      void adapters.audio.preparePeaks()
    } catch (error) {
      setErrorText(`导入音频失败：${describeError(error)}`)
    }
  }

  const toolbarButton =
    'rounded border border-divider px-2 py-0.5 text-[11px] text-neutral-300 hover:border-accent/60 hover:text-accent'
  const menuItemClass =
    'block w-full px-3 py-1.5 text-left text-[11px] text-neutral-300 hover:bg-white/5 hover:text-accent'

  return (
    <div className="flex h-full flex-col bg-canvas text-neutral-200">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-divider bg-panel px-4">
        <h1 className="text-sm font-medium text-neutral-100">LRC 歌词编辑器</h1>
        <span className="text-[11px] text-neutral-600">|</span>
        <span className="truncate text-xs text-neutral-300">
          {doc.meta.title ?? '未命名'}
          {doc.meta.artist ? ` · ${doc.meta.artist}` : ''}
        </span>
        <span className="text-[11px] text-neutral-600">{visibleLines.length} 行</span>
        {/* 音频状态只在未加载时提示：已加载时该信息在播放条与日志里已有，顶栏不重复占位 */}
        {audioAsset === null ? (
          <span className="text-[11px] text-neutral-600">未加载音频</span>
        ) : null}

        <div className="flex items-center gap-2">
          {/* 三个入口本质都是"导入文本"，归在一个下拉里，避免顶栏继续横向膨胀 */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setImportMenuOpen((value) => !value)}
              className={`rounded border px-2 py-0.5 text-[11px] ${
                importMenuOpen
                  ? 'border-accent/60 text-accent'
                  : 'border-divider text-neutral-300 hover:border-accent/60 hover:text-accent'
              }`}
            >
              导入 LRC
            </button>

            {importMenuOpen ? (
              <>
                {/* 点击面板外部关闭 */}
                <button
                  type="button"
                  aria-label="关闭导入菜单"
                  className="fixed inset-0 z-10 cursor-default"
                  onClick={() => setImportMenuOpen(false)}
                />
                <div className="absolute left-0 top-full z-20 mt-1 w-40 rounded border border-divider bg-panel py-1 shadow-lg">
                  <button
                    type="button"
                    className={menuItemClass}
                    onClick={() => {
                      setImportMenuOpen(false)
                      void handleImportLrc()
                    }}
                  >
                    导入 LRC 文件
                  </button>
                  <button
                    type="button"
                    className={menuItemClass}
                    onClick={() => {
                      setImportMenuOpen(false)
                      void handleImportFromClipboard()
                    }}
                  >
                    从剪贴板导入
                  </button>
                  <button
                    type="button"
                    className={menuItemClass}
                    onClick={() => {
                      setImportMenuOpen(false)
                      setManualInputOpen(true)
                    }}
                  >
                    手动输入
                  </button>
                </div>
              </>
            ) : null}
          </div>
          <button type="button" className={toolbarButton} onClick={() => void handleExportLrc()}>
            导出 LRC
          </button>
          <button type="button" className={toolbarButton} onClick={() => void handleImportAudio()}>
            导入音频
          </button>
          <SettingsMenu />
        </div>

        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11px] text-neutral-500">
            分级回退
            <select
              value={pendingKind}
              onChange={(event) => setPendingKind(event.target.value as OperationKind | '')}
              className="rounded border border-divider bg-canvas px-1.5 py-0.5 text-[11px] text-neutral-200"
            >
              <option value="">选择操作类型…</option>
              {revertableKinds.map((kind) => (
                <option key={kind} value={kind}>
                  {OPERATION_KIND_LABEL[kind]}（生效 {activeCounts[kind] ?? 0} 条）
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={pendingKind === ''}
            onClick={() => {
              if (pendingKind === '') return
              undoByKindAction(pendingKind)
              setPendingKind('')
            }}
            className="rounded border border-divider px-2 py-0.5 text-[11px] text-neutral-300 enabled:hover:border-accent/60 enabled:hover:text-accent disabled:opacity-40"
          >
            撤销该类型全部记录
          </button>
          <span className="text-[11px] text-neutral-600">共 {log.entries.length} 条日志</span>
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

      {/* 拒绝提示 toast：工具栏下方居中，独立于右下角的失败 / 一次性提示 */}
      <ToastHost />
    </div>
  )
}
