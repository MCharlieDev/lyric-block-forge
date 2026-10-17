import { useState, type ReactNode } from 'react'
import {
  BILINGUAL_LANGUAGES,
  PRIMARY_LANGUAGE_LABEL,
  useSettingsStore,
  type AppSettings,
} from '../stores/settingsStore'
import { MetadataPrefixDialog } from './MetadataPrefixDialog'

/** 表单项统一样式。 */
const fieldClass =
  'w-full rounded border border-divider bg-canvas px-1.5 py-0.5 text-[11px] text-neutral-200'
/** 标签统一样式。 */
const labelClass = 'flex flex-col gap-1 text-[11px] text-neutral-500'
/** 复选框行统一样式。 */
const checkboxRowClass = 'flex items-center gap-2 text-[11px] text-neutral-300'
/** 面板固定高度（像素）：内容超出时只让中间内容区滚动。 */
const SETTINGS_PANEL_HEIGHT_PX = 420

/** 渲染一项控件所需的上下文。 */
interface ControlCtx {
  settings: AppSettings
  update: (patch: Partial<AppSettings>) => void
  /** 打开元数据前缀规则编辑弹窗 */
  openPrefixDialog: () => void
}

/** 一项设置：`label` / `keywords` 供搜索匹配，`control` 负责完整渲染该行。 */
interface SettingsItem {
  id: string
  label: string
  keywords?: string
  control: (ctx: ControlCtx) => ReactNode
}

/** 一段设置：`title` / `keywords` 供搜索匹配。 */
interface SettingsSection {
  id: string
  title: string
  keywords?: string
  items: SettingsItem[]
}

/**
 * 设置项元数据（数据驱动）。新增设置只需在对应段里补一项，
 * 搜索过滤、渲染与 `data-*` 断言属性都由此自动派生。
 */
const SECTIONS: SettingsSection[] = [
  {
    id: 'import',
    title: '导入预设 · 双语识别',
    keywords: '导入 双语 解析 合并',
    items: [
      {
        id: 'bilingualEnabled',
        label: '时间戳相同时自动合并相邻双语行',
        keywords: '双语 合并 相邻',
        control: ({ settings, update }) => (
          <label className={checkboxRowClass}>
            <input
              type="checkbox"
              checked={settings.bilingualEnabled}
              onChange={(event) => update({ bilingualEnabled: event.target.checked })}
              className="accent-accent"
            />
            时间戳相同时自动合并相邻双语行
          </label>
        ),
      },
      {
        id: 'bilingualSeparator',
        label: '双语识别分隔符',
        keywords: '分隔符 拆分',
        control: ({ settings, update }) => (
          <label className={`${labelClass} mb-2`}>
            双语识别分隔符
            <input
              type="text"
              value={settings.bilingualSeparator}
              placeholder="如 / 或 |，留空则不按分隔符拆分"
              onChange={(event) => update({ bilingualSeparator: event.target.value })}
              className={fieldClass}
            />
          </label>
        ),
      },
      {
        id: 'primaryLanguage',
        label: '主文本语言',
        keywords: '语言 主文本 预设',
        control: ({ settings, update }) => (
          <label className={`${labelClass} mb-2`}>
            主文本语言
            <select
              value={settings.primaryLanguage}
              onChange={(event) =>
                update({ primaryLanguage: event.target.value as typeof settings.primaryLanguage })
              }
              className={fieldClass}
            >
              {BILINGUAL_LANGUAGES.map((language) => (
                <option key={language} value={language}>
                  {PRIMARY_LANGUAGE_LABEL[language]}
                </option>
              ))}
            </select>
          </label>
        ),
      },
      {
        id: 'mergeToleranceMs',
        label: '合并容差（毫秒）',
        keywords: '容差 毫秒 合并',
        control: ({ settings, update }) => (
          <label className={`${labelClass} mb-3`}>
            合并容差（毫秒）
            <input
              type="number"
              min={0}
              step={10}
              value={settings.mergeToleranceMs}
              onChange={(event) => {
                const value = Number(event.target.value)
                update({ mergeToleranceMs: Number.isFinite(value) && value >= 0 ? Math.round(value) : 0 })
              }}
              className={fieldClass}
            />
          </label>
        ),
      },
      {
        id: 'metadataPrefixMode',
        label: '识别歌词前的介绍行（如「作词：张三」）',
        keywords: '元数据 前缀 作词 作曲 介绍行 识别 保留',
        control: ({ settings, update, openPrefixDialog }) => (
          <div className="flex flex-col gap-1">
            <label className={labelClass}>
              识别歌词前的介绍行（如「作词：张三」）
              <select
                value={settings.metadataPrefixMode}
                onChange={(event) => {
                  const value = event.target.value
                  update({
                    metadataPrefixMode: value === 'meta' || value === 'meta+line' ? value : 'off',
                  })
                }}
                className={fieldClass}
              >
                <option value="off">关</option>
                <option value="meta">仅元数据</option>
                <option value="meta+line">元数据 + 保留歌词行</option>
              </select>
            </label>
            <button
              type="button"
              data-prefix-rules-trigger
              onClick={openPrefixDialog}
              className="self-start rounded border border-divider px-2 py-0.5 text-[11px] text-neutral-300 hover:border-accent/60 hover:text-accent"
            >
              配置前缀规则…
            </button>
          </div>
        ),
      },
    ],
  },
  {
    id: 'ui',
    title: '界面',
    keywords: '界面 交互 弹窗',
    items: [
      {
        id: 'closeDialogOnBackdropClick',
        label: '点击遮罩关闭行操作弹窗',
        keywords: '遮罩 弹窗 关闭',
        control: ({ settings, update }) => (
          <div className="flex flex-col gap-1">
            <label className={checkboxRowClass}>
              <input
                type="checkbox"
                checked={settings.closeDialogOnBackdropClick}
                onChange={(event) => update({ closeDialogOnBackdropClick: event.target.checked })}
                className="accent-accent"
              />
              点击遮罩关闭行操作弹窗
            </label>
            <label className={checkboxRowClass}>
              <input
                type="checkbox"
                checked={settings.closeMetadataPrefixDialogOnBackdropClick}
                onChange={(event) =>
                  update({ closeMetadataPrefixDialogOnBackdropClick: event.target.checked })
                }
                className="accent-accent"
              />
              点击遮罩关闭前缀规则弹窗
            </label>
          </div>
        ),
      },
      {
        id: 'confirmMajorChange',
        label: '重大改变前询问',
        keywords: '确认 询问 重大改变',
        control: ({ settings, update }) => (
          <label className={`${checkboxRowClass} mt-2`}>
            <input
              type="checkbox"
              checked={settings.confirmMajorChange}
              onChange={(event) => update({ confirmMajorChange: event.target.checked })}
              className="accent-accent"
            />
            重大改变前询问
          </label>
        ),
      },
    ],
  },
  {
    id: 'export',
    title: '导出 · 时间戳精度',
    keywords: '导出 时间戳 精度',
    items: [
      {
        id: 'timestampPrecisionMs',
        label: '导出精度（行级 / 字级统一）',
        keywords: '导出 精度 时间戳',
        control: ({ settings, update }) => (
          <label className={labelClass}>
            导出精度（行级 / 字级统一）
            <select
              value={settings.timestampPrecisionMs}
              onChange={(event) =>
                update({ timestampPrecisionMs: Number(event.target.value) === 10 ? 10 : 1 })
              }
              className={fieldClass}
            >
              <option value={10}>两位（mm:ss.xx）</option>
              <option value={1}>三位（mm:ss.xxx）</option>
            </select>
          </label>
        ),
      },
    ],
  },
  {
    id: 'follow',
    title: '时间轴 · 跟随',
    keywords: '时间轴 跟随 播放头 暂停',
    items: [
      {
        id: 'followResumeMode',
        label: '跟随恢复方式',
        keywords: '跟随 恢复 归位 暂停',
        control: ({ settings, update }) => (
          <label className={`${labelClass} mb-2`}>
            跟随恢复方式
            <select
              value={settings.followResumeMode}
              onChange={(event) =>
                update({ followResumeMode: event.target.value === 'pause' ? 'pause' : 'snap' })
              }
              className={fieldClass}
            >
              <option value="snap">A · 立刻拉回播放头</option>
              <option value="pause">B · 暂停跟随，用归位按钮恢复</option>
            </select>
          </label>
        ),
      },
      {
        id: 'pauseAudioOnPan',
        label: '平移视窗时暂停音频',
        keywords: '平移 暂停 音频',
        control: ({ settings, update }) => (
          <label className={checkboxRowClass}>
            <input
              type="checkbox"
              checked={settings.pauseAudioOnPan}
              onChange={(event) => update({ pauseAudioOnPan: event.target.checked })}
              className="accent-accent"
            />
            平移视窗时暂停音频
          </label>
        ),
      },
      {
        id: 'pauseAudioOnSeek',
        label: '移动播放头时暂停音频',
        keywords: '播放头 擦洗 暂停 音频',
        control: ({ settings, update }) => (
          <label className={`${checkboxRowClass} mt-2`}>
            <input
              type="checkbox"
              checked={settings.pauseAudioOnSeek}
              onChange={(event) => update({ pauseAudioOnSeek: event.target.checked })}
              className="accent-accent"
            />
            移动播放头时暂停音频
          </label>
        ),
      },
    ],
  },
  {
    id: 'snap',
    title: '时间轴 · 吸附',
    keywords: '时间轴 吸附 对齐 网格',
    items: [
      {
        id: 'snapEnabled',
        label: '启用吸附',
        keywords: '吸附 开关 总开关',
        control: ({ settings, update }) => (
          <label className={checkboxRowClass}>
            <input
              type="checkbox"
              checked={settings.snapEnabled}
              onChange={(event) => update({ snapEnabled: event.target.checked })}
              className="accent-accent"
            />
            启用吸附
          </label>
        ),
      },
      {
        id: 'snapToPlayhead',
        label: '播放头',
        keywords: '吸附 播放头',
        control: ({ settings, update }) => {
          const disabled = !settings.snapEnabled
          return (
            <label className={`${checkboxRowClass} ml-5 ${disabled ? 'opacity-40' : ''}`}>
              <input
                type="checkbox"
                checked={settings.snapToPlayhead}
                disabled={disabled}
                onChange={(event) => update({ snapToPlayhead: event.target.checked })}
                className="accent-accent"
              />
              播放头
            </label>
          )
        },
      },
      {
        id: 'snapToLineTimes',
        label: '其他行时间戳',
        keywords: '吸附 行时间戳 其他行',
        control: ({ settings, update }) => {
          const disabled = !settings.snapEnabled
          return (
            <label className={`${checkboxRowClass} ml-5 ${disabled ? 'opacity-40' : ''}`}>
              <input
                type="checkbox"
                checked={settings.snapToLineTimes}
                disabled={disabled}
                onChange={(event) => update({ snapToLineTimes: event.target.checked })}
                className="accent-accent"
              />
              其他行时间戳
            </label>
          )
        },
      },
      {
        id: 'snapToGrid',
        label: '刻度尺网格',
        keywords: '吸附 网格 刻度尺',
        control: ({ settings, update }) => {
          const disabled = !settings.snapEnabled
          return (
            <label className={`${checkboxRowClass} ml-5 ${disabled ? 'opacity-40' : ''}`}>
              <input
                type="checkbox"
                checked={settings.snapToGrid}
                disabled={disabled}
                onChange={(event) => update({ snapToGrid: event.target.checked })}
                className="accent-accent"
              />
              刻度尺网格
            </label>
          )
        },
      },
    ],
  },
]

/**
 * 导入预设菜单。
 *
 * 承载导入解析（双语识别）、界面、导出精度与时间轴相关设置，
 * 修改即时写入设置存储。面板顶部为常驻搜索框、底部为常驻操作栏（恢复默认），
 * 只有中间内容区滚动，保证这两处始终可见。
 */
export function SettingsMenu() {
  const settings = useSettingsStore((state) => state.settings)
  const update = useSettingsStore((state) => state.update)
  const reset = useSettingsStore((state) => state.reset)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [prefixDialogOpen, setPrefixDialogOpen] = useState(false)

  const q = query.trim().toLowerCase()
  // 搜索过滤：段标题命中则整段保留，否则按「项标签 + 关键词」逐项过滤；空段跳过
  const visibleSections = SECTIONS.map((section) => {
    if (q === '') return section
    if (section.title.toLowerCase().includes(q)) return section
    const items = section.items.filter((item) =>
      `${item.label} ${item.keywords ?? ''}`.toLowerCase().includes(q),
    )
    return { ...section, items }
  }).filter((section) => section.items.length > 0)

  const ctx: ControlCtx = {
    settings,
    update,
    openPrefixDialog: () => setPrefixDialogOpen(true),
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`rounded border px-2 py-0.5 text-[11px] ${
          open ? 'border-accent/60 text-accent' : 'border-divider text-neutral-300 hover:border-accent/60 hover:text-accent'
        }`}
      >
        设置
      </button>

      {open ? (
        <>
          {/* 点击面板外部关闭 */}
          <button
            type="button"
            aria-label="关闭设置"
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            data-settings-panel
            className="absolute left-0 top-full z-20 mt-1 flex w-72 flex-col rounded border border-divider bg-panel shadow-lg"
            style={{ height: SETTINGS_PANEL_HEIGHT_PX, maxHeight: '70vh' }}
          >
            {/* 顶部：常驻搜索框，不随内容滚动 */}
            <div className="shrink-0 border-b border-divider p-2">
              <input
                type="search"
                data-settings-search
                value={query}
                placeholder="搜索设置"
                onChange={(event) => setQuery(event.target.value)}
                className={fieldClass}
              />
            </div>

            {/* 内容区：唯一滚动区域 */}
            <div data-settings-scroll className="min-h-0 flex-1 overflow-y-auto p-3">
              {visibleSections.length === 0 ? (
                <p data-settings-empty className="py-6 text-center text-[11px] text-neutral-600">
                  无匹配设置
                </p>
              ) : (
                visibleSections.map((section, index) => (
                  <div
                    key={section.id}
                    data-settings-section={section.id}
                    className={index === 0 ? '' : 'mt-3 border-t border-divider pt-3'}
                  >
                    <p className="mb-2 text-[11px] font-medium text-neutral-300">{section.title}</p>
                    {section.items.map((item) => (
                      <div key={item.id} data-settings-item={item.id}>
                        {item.control(ctx)}
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>

            {/* 底部：常驻操作栏，不随内容滚动；恢复默认固定在右端 */}
            <div
              data-settings-footer
              className="flex shrink-0 items-center justify-between border-t border-divider p-2"
            >
              <span className="text-[11px] text-neutral-600">设置修改自动保存</span>
              <button
                type="button"
                onClick={reset}
                className="rounded border border-divider px-2 py-0.5 text-[11px] text-neutral-300 hover:border-accent/60 hover:text-accent"
              >
                恢复默认
              </button>
            </div>
          </div>
        </>
      ) : null}

      {prefixDialogOpen ? (
        <MetadataPrefixDialog
          rules={settings.metadataPrefixRules}
          onChange={(rules) => update({ metadataPrefixRules: rules })}
          closeOnBackdropClick={settings.closeMetadataPrefixDialogOnBackdropClick}
          onClose={() => setPrefixDialogOpen(false)}
        />
      ) : null}
    </div>
  )
}
