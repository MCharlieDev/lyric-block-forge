import { create } from 'zustand'
import {
  DEFAULT_METADATA_PREFIX_RULES,
  type BilingualLanguage,
  type BilingualMergeOptions,
  type MetadataPrefixRule,
  type ParseOptions,
} from '@core'

/** 设置持久化所用的存储键（StoragePort）。 */
export const SETTINGS_STORAGE_KEY = 'lrc-editor/settings'

/** 可用的主语言预设（与 core 的 `BilingualLanguage` 保持一致）。 */
export const BILINGUAL_LANGUAGES: BilingualLanguage[] = [
  'auto',
  'zh',
  'ja',
  'ko',
  'ru',
  'en',
  'es',
  'fr',
  'de',
  'pt',
  'it',
]

/** 主语言预设的展示名。 */
export const PRIMARY_LANGUAGE_LABEL: Record<BilingualLanguage, string> = {
  auto: '自动（按原文顺序）',
  zh: '中文',
  ja: '日文',
  ko: '韩文',
  ru: '俄文',
  en: '英文',
  es: '西班牙文',
  fr: '法文',
  de: '德文',
  pt: '葡萄牙文',
  it: '意大利文',
}

/**
 * 影响导入解析的用户预设。
 *
 * 目前只承载双语识别相关选项：分隔符、主语言、合并方式与容差。
 */
export interface AppSettings {
  /** 是否启用双语识别合并，默认开启 */
  bilingualEnabled: boolean
  /** 双语识别分隔符；空字符串表示不做行内拆分 */
  bilingualSeparator: string
  /** 主语言预设，决定合并后哪一行作文本 */
  primaryLanguage: BilingualLanguage
  /** 合并容差（毫秒），`0` 表示时间戳严格相等 */
  mergeToleranceMs: number
  /**
   * 元数据前缀识别的三态模式：`off` / `meta` / `meta+line`。
   *
   * - `off`：不识别，导入行为与未开启时完全一致（默认）。
   * - `meta`：把歌词前的介绍行（如「作词：张三」）转为文档元数据，该行不进歌词列表。
   * - `meta+line`：除转元数据外，额外保留一条 `[00:00.000]` 普通歌词行，
   *   兜底给不认元数据标签的播放器显示。
   *
   * 到内核选项的映射见 `toMetadataPrefixOptions`。注意本项与 `applyRecognizers`
   * 是两个独立默认，组合起来才是用户实际看到的默认行为。
   */
  metadataPrefixMode: 'off' | 'meta' | 'meta+line'
  /**
   * 元数据前缀规则表（整表替换内核默认表）。
   *
   * 非法条目在 `normalizeMetadataPrefixRules` 中丢弃；空数组表示「不识别任何前缀」，
   * 不会回退默认表。
   */
  metadataPrefixRules: MetadataPrefixRule[]
  /**
   * 行操作弹窗是否支持"点击遮罩关闭"。
   *
   * 默认关闭：误触遮罩会丢掉弹窗里正在编辑的内容，代价太高；
   * 想要这条捷径的用户可在设置里主动开启。
   */
  closeDialogOnBackdropClick: boolean
  /**
   * 元数据前缀规则弹窗是否支持"点击遮罩关闭"。
   *
   * 与 `closeDialogOnBackdropClick` 相互独立：前缀弹窗是独立模态，
   * 误触遮罩丢掉正在输入字段的代价同样高，故默认关闭。
   */
  closeMetadataPrefixDialogOnBackdropClick: boolean
  /**
   * 导出时统一使用的行级 / 字级时间戳精度（毫秒）。
   *
   * `10` = 两位小数（mm:ss.xx），`1` = 三位小数（mm:ss.xxx）。
   * 默认三位；导入识别精度不受此项影响。
   */
  timestampPrecisionMs: 10 | 1
  /**
   * 多选拖动这类"重大改变"提交前是否弹确认框。
   *
   * 默认开启：一次多选拖动会整组等量位移，改错代价高；
   * 想要拖动后立即落盘的用户可在设置里关掉（弹窗内勾选「以后不再显示」亦写此项）。
   */
  confirmMajorChange: boolean
  /** 改正文前是否弹窗确认；false = 仅 toast 提示 */
  confirmTextChange: boolean
  /** 清空行级时间前是否弹窗确认；false = 仅 toast 提示 */
  confirmClearLineTime: boolean
  /**
   * 视口跟随的恢复方式。
   *
   * - `snap`：手动平移、拖歌词块松手后，下一拍把视口拉回播放头（默认）。
   * - `pause`：手动平移 / 拖块后进入"跟随暂停"，视口不再自动移动，
   *   只能点「归位」按钮恢复跟随。
   */
  followResumeMode: 'snap' | 'pause'
  /**
   * 平移视窗（滚动条拖拽 + 滚轮平移，不含 ctrl+滚轮缩放）时是否暂停音频。
   *
   * 默认开启：真暂停，松手不自动续播，需用户再按播放。
   */
  pauseAudioOnPan: boolean
  /**
   * 移动播放头（尺子擦洗 + 屏外箭头拖动，不含缩放 / 打轴）时是否暂停音频。
   *
   * 默认开启：真暂停，松手不自动续播；关闭则回到"拖到哪从那继续播"。
   */
  pauseAudioOnSeek: boolean
  /** 吸附总开关；关掉后三个分目标一律不吸，分目标开关置灰。 */
  snapEnabled: boolean
  /** 吸附到播放头（分目标之一）。 */
  snapToPlayhead: boolean
  /** 吸附到其他行的时间戳（分目标之一）。 */
  snapToLineTimes: boolean
  /** 吸附到刻度尺网格（分目标之一，默认关闭）。 */
  snapToGrid: boolean
}

/** 前缀与值之间的合法分隔符：中文冒号 / 英文冒号 / 半角空格 / Tab。 */
const METADATA_PREFIX_SEPARATORS = '：: \t'
/** 合法标签名：导出写回 `[tag:value]`，而导入只识别字母标签，故限制为纯字母。 */
const METADATA_TAG_PATTERN = /^[a-zA-Z]+$/

/** 克隆一份默认前缀规则表，避免与 `DEFAULT_SETTINGS` 共享数组或条目引用。 */
function cloneDefaultMetadataPrefixRules(): MetadataPrefixRule[] {
  return DEFAULT_METADATA_PREFIX_RULES.map((rule) => ({ ...rule }))
}

/**
 * 规范化持久化读回的前缀规则表。
 *
 * 非数组回退默认表 clone；数组逐条校验，非法条目静默丢弃。
 * 空数组保持 `[]`（用户可能主动删光规则），不回退默认。
 *
 * @param value 存储中读到的原始值
 * @returns 合法规则表
 */
function normalizeMetadataPrefixRules(value: unknown): MetadataPrefixRule[] {
  if (!Array.isArray(value)) return cloneDefaultMetadataPrefixRules()

  const rules: MetadataPrefixRule[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as Record<string, unknown>
    const prefix = typeof record.prefix === 'string' ? record.prefix.trim() : ''
    const tag = typeof record.tag === 'string' ? record.tag.trim() : ''
    if (prefix === '' || tag === '') continue
    if (!METADATA_TAG_PATTERN.test(tag)) continue
    if (Array.from(prefix).some((char) => METADATA_PREFIX_SEPARATORS.includes(char))) continue
    const action =
      record.action === 'off' || record.action === 'meta+line' ? record.action : 'meta'
    rules.push({ prefix, tag, action })
  }
  return rules
}

/** 生成一份全新的默认设置（前缀规则表为独立 clone）。 */
function createDefaultSettings(): AppSettings {
  return { ...DEFAULT_SETTINGS, metadataPrefixRules: cloneDefaultMetadataPrefixRules() }
}

/** 默认预设。 */
export const DEFAULT_SETTINGS: AppSettings = {
  bilingualEnabled: true,
  bilingualSeparator: '',
  primaryLanguage: 'auto',
  mergeToleranceMs: 0,
  metadataPrefixMode: 'off',
  metadataPrefixRules: cloneDefaultMetadataPrefixRules(),
  closeDialogOnBackdropClick: false,
  closeMetadataPrefixDialogOnBackdropClick: false,
  timestampPrecisionMs: 1,
  confirmMajorChange: true,
  confirmTextChange: true,
  confirmClearLineTime: true,
  followResumeMode: 'snap',
  pauseAudioOnPan: true,
  pauseAudioOnSeek: true,
  snapEnabled: true,
  snapToPlayhead: true,
  snapToLineTimes: true,
  snapToGrid: false,
}

/**
 * 把持久化读回的未知数据规范化为合法设置。
 *
 * 存储里的数据可能来自旧版本或被手工篡改，因此逐项校验、非法值回退默认，
 * 避免脏数据把解析流程带偏。
 *
 * @param stored 存储中读到的原始值
 * @returns 合法设置
 */
function normalizeSettings(stored: unknown): AppSettings {
  if (typeof stored !== 'object' || stored === null) return createDefaultSettings()
  const record = stored as Record<string, unknown>

  const language = record.primaryLanguage
  const tolerance = record.mergeToleranceMs

  return {
    bilingualEnabled:
      typeof record.bilingualEnabled === 'boolean' ? record.bilingualEnabled : DEFAULT_SETTINGS.bilingualEnabled,
    bilingualSeparator:
      typeof record.bilingualSeparator === 'string' ? record.bilingualSeparator : DEFAULT_SETTINGS.bilingualSeparator,
    primaryLanguage:
      typeof language === 'string' && (BILINGUAL_LANGUAGES as string[]).includes(language)
        ? (language as BilingualLanguage)
        : DEFAULT_SETTINGS.primaryLanguage,
    mergeToleranceMs:
      typeof tolerance === 'number' && Number.isFinite(tolerance) && tolerance >= 0
        ? Math.round(tolerance)
        : DEFAULT_SETTINGS.mergeToleranceMs,
    metadataPrefixMode:
      record.metadataPrefixMode === 'off' ||
      record.metadataPrefixMode === 'meta' ||
      record.metadataPrefixMode === 'meta+line'
        ? record.metadataPrefixMode
        : record.metadataPrefixEnabled === true
          ? 'meta'
          : 'off',
    metadataPrefixRules: normalizeMetadataPrefixRules(record.metadataPrefixRules),
    // 本函数是白名单：新增设置项必须在这里补一条，否则刷新后会被静默丢回默认值
    closeDialogOnBackdropClick:
      typeof record.closeDialogOnBackdropClick === 'boolean'
        ? record.closeDialogOnBackdropClick
        : DEFAULT_SETTINGS.closeDialogOnBackdropClick,
    closeMetadataPrefixDialogOnBackdropClick:
      typeof record.closeMetadataPrefixDialogOnBackdropClick === 'boolean'
        ? record.closeMetadataPrefixDialogOnBackdropClick
        : DEFAULT_SETTINGS.closeMetadataPrefixDialogOnBackdropClick,
    timestampPrecisionMs:
      record.timestampPrecisionMs === 10 || record.timestampPrecisionMs === 1
        ? record.timestampPrecisionMs
        : DEFAULT_SETTINGS.timestampPrecisionMs,
    confirmMajorChange:
      typeof record.confirmMajorChange === 'boolean'
        ? record.confirmMajorChange
        : DEFAULT_SETTINGS.confirmMajorChange,
    confirmTextChange:
      typeof record.confirmTextChange === 'boolean'
        ? record.confirmTextChange
        : DEFAULT_SETTINGS.confirmTextChange,
    confirmClearLineTime:
      typeof record.confirmClearLineTime === 'boolean'
        ? record.confirmClearLineTime
        : DEFAULT_SETTINGS.confirmClearLineTime,
    followResumeMode:
      record.followResumeMode === 'snap' || record.followResumeMode === 'pause'
        ? record.followResumeMode
        : DEFAULT_SETTINGS.followResumeMode,
    pauseAudioOnPan:
      typeof record.pauseAudioOnPan === 'boolean' ? record.pauseAudioOnPan : DEFAULT_SETTINGS.pauseAudioOnPan,
    pauseAudioOnSeek:
      typeof record.pauseAudioOnSeek === 'boolean' ? record.pauseAudioOnSeek : DEFAULT_SETTINGS.pauseAudioOnSeek,
    snapEnabled:
      typeof record.snapEnabled === 'boolean' ? record.snapEnabled : DEFAULT_SETTINGS.snapEnabled,
    snapToPlayhead:
      typeof record.snapToPlayhead === 'boolean' ? record.snapToPlayhead : DEFAULT_SETTINGS.snapToPlayhead,
    snapToLineTimes:
      typeof record.snapToLineTimes === 'boolean' ? record.snapToLineTimes : DEFAULT_SETTINGS.snapToLineTimes,
    snapToGrid: typeof record.snapToGrid === 'boolean' ? record.snapToGrid : DEFAULT_SETTINGS.snapToGrid,
  }
}

/**
 * 把设置转换为 core 的双语合并选项。
 *
 * @param settings 用户预设
 * @returns 传给 `parseLrc` 的 `bilingual` 选项
 */
export function toBilingualOptions(settings: AppSettings): BilingualMergeOptions {
  return {
    enabled: settings.bilingualEnabled,
    separator: settings.bilingualSeparator === '' ? null : settings.bilingualSeparator,
    primaryLanguage: settings.primaryLanguage,
    toleranceMs: settings.mergeToleranceMs,
  }
}

/**
 * 把设置的三态模式转换为 core 的元数据前缀选项。
 *
 * @param settings 用户预设
 * @returns 传给 `parseLrc` 的 `metadataPrefix` 选项
 */
export function toMetadataPrefixOptions(
  settings: AppSettings,
): NonNullable<ParseOptions['metadataPrefix']> {
  switch (settings.metadataPrefixMode) {
    case 'meta':
      return { enabled: true, keepLyricLine: false, rules: settings.metadataPrefixRules }
    case 'meta+line':
      return { enabled: true, keepLyricLine: true, rules: settings.metadataPrefixRules }
    default:
      return { enabled: false, keepLyricLine: false, rules: settings.metadataPrefixRules }
  }
}

/** 设置状态与动作。 */
export interface SettingsState {
  /** 当前预设 */
  settings: AppSettings
  /** 是否已从持久化存储读取过；未读取前不回写，避免默认值覆盖已有设置 */
  hydrated: boolean
  /** 用存储读回的值初始化预设 */
  hydrate: (stored: unknown) => void
  /** 合并式更新预设 */
  update: (patch: Partial<AppSettings>) => void
  /** 恢复默认预设 */
  reset: () => void
}

export const useSettingsStore = create<SettingsState>()((set, get) => ({
  settings: createDefaultSettings(),
  hydrated: false,

  hydrate: (stored) => set({ settings: normalizeSettings(stored), hydrated: true }),

  update: (patch) => set({ settings: { ...get().settings, ...patch } }),

  reset: () => set({ settings: createDefaultSettings() }),
}))
