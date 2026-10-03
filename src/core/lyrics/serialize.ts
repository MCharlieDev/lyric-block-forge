import type { LyricDocument, LyricLine, LyricMetadata } from '../types'

/** 序列化选项。 */
export interface SerializeOptions {
  /** 输出编码，缺省沿用文档 `format.encoding` */
  encoding?: string
  /** 输出换行符，缺省沿用文档 `format.lineEnding` */
  lineEnding?: '\n' | '\r\n'
  /** 是否输出 BOM，缺省沿用文档 `format.hasBOM` */
  withBOM?: boolean
  /** 是否按源文件写回未知标签，默认 `true`（无损原则） */
  preserveUnknownTags?: boolean
  /**
   * 统一时间戳精度（毫秒）。给出时，全部行级 / 字级时间戳都按该精度写出，
   * 不再逐条读取 `precisionMs`；缺省则沿用每条自身的精度。
   *
   * 注意：`[length:]` 元数据标签不参与统一，维持其就地精度。
   */
  uniformPrecisionMs?: number
}

/** 标准元数据标签的写回顺序。自定义标签追加在其后。 */
const STANDARD_META_ORDER = ['ti', 'ar', 'al', 'by', 'lyricist', 'composer', 'arranger', 'offset', 'length'] as const

/** 标准元数据标签名集合，用于区分标准标签与自定义（未知）标签。 */
const STANDARD_META_NAMES = new Set<string>(STANDARD_META_ORDER)

/**
 * 把精度（毫秒）换算为小数位数。
 *
 * 与解析端约定一致：1000 = 秒级、100 = 一位小数、10 = 两位小数、1 = 三位小数。
 *
 * @param precisionMs 精度（毫秒）
 * @returns 需要写出的小数位数（0 - 3）
 */
function digitsFromPrecision(precisionMs: number): 0 | 1 | 2 | 3 {
  if (precisionMs >= 1000) return 0
  if (precisionMs >= 100) return 1
  if (precisionMs >= 10) return 2
  return 3
}

/**
 * 按精度格式化时间戳。
 *
 * 时间先按精度对齐（四舍五入到最近的最小单位），再拆成 `mm:ss[.x{0,3}]`。
 * 这样 `[01:02.34]` 解析为 `62340ms / precision=10` 后能原样写回。
 *
 * @param timeMs 时间（毫秒）
 * @param precisionMs 精度（毫秒）
 * @returns `mm:ss` / `mm:ss.x` / `mm:ss.xx` / `mm:ss.xxx`
 */
export function formatTimestamp(timeMs: number, precisionMs: number): string {
  const digits = digitsFromPrecision(precisionMs)
  const unit = digits === 0 ? 1000 : digits === 1 ? 100 : digits === 2 ? 10 : 1
  const aligned = Math.round(Math.max(0, timeMs) / unit) * unit

  const totalSeconds = Math.floor(aligned / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  const mm = String(minutes).padStart(2, '0')
  const ss = String(seconds).padStart(2, '0')

  if (digits === 0) return `${mm}:${ss}`
  const fraction = aligned % 1000
  const fractionText = String(Math.floor(fraction / unit)).padStart(digits, '0')
  return `${mm}:${ss}.${fractionText}`
}

/**
 * 按字级时间戳重建增强型行文本。
 *
 * 字级标签管辖"它到下一个标签之间的文本"，因此按 `range` 顺序输出
 * `<标签>文本` 序列即可；首个标签之前的文本原样前置。
 *
 * @param line 歌词行
 * @param uniformPrecisionMs 统一时间戳精度（毫秒）；给出时覆盖字级自身精度
 * @returns 增强型行文本（不含行级时间标签）
 */
function renderWords(line: LyricLine, uniformPrecisionMs?: number): string {
  const words = [...line.wordTimestamps].sort((a, b) => a.range.start - b.range.start)
  let out = ''
  let cursor = 0
  for (const word of words) {
    if (word.range.start > cursor) out += line.text.slice(cursor, word.range.start)
    const timeTag = formatTimestamp(word.timeMs, uniformPrecisionMs ?? word.precisionMs)
    out += `<${timeTag}>${line.text.slice(word.range.start, word.range.end)}`
    cursor = word.range.end
  }
  return out + line.text.slice(cursor)
}

/**
 * 渲染单条歌词行。
 *
 * - 既无行级时间也无字级时间的行（正文行 / 未识别行）原样写回 `raw`；
 * - 一行有多个行级时间戳时全部写出（`[00:15.50][00:18.00]同一句`）；
 * - 有翻译时按原始承载方式写回：`translationSeparator` 非空则拼在同一行，
 *   否则写回为两条同时间戳的行（与 `mergeBilingualLines` 的合并规则对称）。
 *
 * @param line 歌词行
 * @param uniformPrecisionMs 统一时间戳精度（毫秒）；给出时覆盖行级/字级自身精度
 * @returns 该行对应的 LRC 文本（可能不止一行）
 */
function renderLine(line: LyricLine, uniformPrecisionMs?: number): string[] {
  const body = line.wordTimestamps.length > 0 ? renderWords(line, uniformPrecisionMs) : line.text

  if (line.timestamps.length === 0 && line.wordTimestamps.length === 0) {
    return [line.raw ?? line.text]
  }

  const prefix = line.timestamps
    .map((timestamp) => `[${formatTimestamp(timestamp.timeMs, uniformPrecisionMs ?? timestamp.precisionMs)}]`)
    .join('')

  if (line.translation === undefined || line.translation === '') {
    return [prefix + body]
  }

  const separator = line.translationSeparator
  if (separator !== null && separator !== undefined && separator !== '') {
    return [prefix + body + separator + line.translation]
  }

  return [prefix + body, prefix + line.translation]
}

/**
 * 渲染单条元数据标签。
 *
 * 逐字复刻各标签的写出格式（含 `offset` 原值、`length` 的就地精度分支）。
 *
 * @param name 标签名
 * @param meta 元数据
 * @param custom 自定义标签表
 * @param preserveUnknownTags 是否写回未知标签
 * @returns 标签文本 `[name:value]`；当前无值或不应写回时为 `null`
 */
function renderOneTag(
  name: string,
  meta: LyricMetadata,
  custom: Record<string, string> | undefined,
  preserveUnknownTags: boolean,
): string | null {
  switch (name) {
    case 'ti':
      return meta.title !== undefined ? `[ti:${meta.title}]` : null
    case 'ar':
      return meta.artist !== undefined ? `[ar:${meta.artist}]` : null
    case 'al':
      return meta.album !== undefined ? `[al:${meta.album}]` : null
    case 'by':
      return meta.by !== undefined ? `[by:${meta.by}]` : null
    case 'lyricist':
      return meta.lyricist !== undefined ? `[lyricist:${meta.lyricist}]` : null
    case 'composer':
      return meta.composer !== undefined ? `[composer:${meta.composer}]` : null
    case 'arranger':
      return meta.arranger !== undefined ? `[arranger:${meta.arranger}]` : null
    case 'offset':
      return meta.offsetMs !== undefined ? `[offset:${meta.offsetMs}]` : null
    case 'length':
      return meta.lengthMs !== undefined
        ? `[length:${formatTimestamp(meta.lengthMs, meta.lengthMs % 1000 === 0 ? 1000 : 1)}]`
        : null
    default: {
      if (!preserveUnknownTags) return null
      const value = custom?.[name]
      return value !== undefined ? `[${name}:${value}]` : null
    }
  }
}

/**
 * 取一个标签名当前的「派生值」文本。
 *
 * 口径与 {@link renderOneTag} 的写出严格一致（`offset` 取整数文本、`length`
 * 沿用 `% 1000 === 0 ? 1000 : 1` 的精度分支），供 pristine 判据与 `metadataTags`
 * 记录的末值比较。
 *
 * @param name 标签名
 * @param meta 元数据
 * @returns 当前派生值文本；当前无值时为 `undefined`
 */
function deriveValue(name: string, meta: LyricMetadata): string | undefined {
  switch (name) {
    case 'ti':
      return meta.title
    case 'ar':
      return meta.artist
    case 'al':
      return meta.album
    case 'by':
      return meta.by
    case 'lyricist':
      return meta.lyricist
    case 'composer':
      return meta.composer
    case 'arranger':
      return meta.arranger
    case 'offset':
      return meta.offsetMs !== undefined ? String(meta.offsetMs) : undefined
    case 'length':
      return meta.lengthMs !== undefined
        ? formatTimestamp(meta.lengthMs, meta.lengthMs % 1000 === 0 ? 1000 : 1)
        : undefined
    default:
      return meta.custom?.[name]
  }
}

/**
 * 判断元数据是否保持原样（pristine）——未编辑时才能按原始标签序列逐字写回。
 *
 * 三条同时满足才算 pristine：
 * - (a) 每个被记录的名：当前派生值 === 记录中该名最后一次出现的值；
 * - (b) 不存在「当前有值、却未被记录覆盖」的名（标准字段与自定义键）；
 * - (c) 自定义名与标准名走同一比较（自定义值取自 `meta.custom`）。
 *
 * @param meta 元数据
 * @param tags 原始标签序列
 * @returns 保持原样时为 `true`
 */
function metadataIsPristine(
  meta: LyricMetadata,
  tags: Array<Array<{ name: string; value: string }>>,
): boolean {
  const lastValue = new Map<string, string>()
  const covered = new Set<string>()
  for (const group of tags) {
    for (const { name, value } of group) {
      covered.add(name)
      lastValue.set(name, value)
    }
  }

  for (const name of covered) {
    if (deriveValue(name, meta) !== lastValue.get(name)) return false
  }

  for (const name of STANDARD_META_ORDER) {
    if (!covered.has(name) && deriveValue(name, meta) !== undefined) return false
  }
  const custom = meta.custom
  if (custom !== undefined) {
    for (const name of Object.keys(custom)) {
      if (!covered.has(name)) return false
    }
  }

  return true
}

/**
 * 渲染元数据标签行。
 *
 * - 有记录（`format.metadataTags`）且元数据保持原样：按原始标签序列逐行逐条
 *   写回（含重复、含分行）；`preserveUnknownTags` 为 `false` 时跳过非标准标签名，
 *   某组被跳过至空则不产出该行。
 * - 其余情况（无记录 / 元数据已被编辑）：整体退回默认行为 —— 单行、标准顺序，
 *   未知标签按 `format.unknownTags` 顺序追加其后（可由 `preserveUnknownTags` 关闭）。
 *
 * @param document 歌词文档
 * @param preserveUnknownTags 是否写回未知标签
 * @returns 元数据行文本列表（不含换行，已剔除空行）
 */
function renderMetadata(document: LyricDocument, preserveUnknownTags: boolean): string[] {
  const { meta, format } = document
  const custom = meta.custom
  const tags = format.metadataTags

  // 原样写回：未编辑时逐字还原（含重复标签与原始分行）
  if (tags !== undefined && tags.length > 0 && metadataIsPristine(meta, tags)) {
    const outLines: string[] = []
    for (const group of tags) {
      const parts: string[] = []
      for (const { name, value } of group) {
        if (!preserveUnknownTags && !STANDARD_META_NAMES.has(name)) continue
        parts.push(`[${name}:${value}]`)
      }
      if (parts.length > 0) outLines.push(parts.join(''))
    }
    return outLines
  }

  // 退回现状：单行、标准顺序，未知标签追加其后
  const parts = STANDARD_META_ORDER.map((name) => renderOneTag(name, meta, custom, preserveUnknownTags)).filter(
    (part): part is string => part !== null,
  )
  if (preserveUnknownTags && custom !== undefined) {
    // 以 format.unknownTags 的顺序为准，避免依赖 Object 键序
    const names = format.unknownTags.length > 0 ? format.unknownTags : Object.keys(custom)
    for (const name of names) {
      const value = custom[name]
      if (value !== undefined) parts.push(`[${name}:${value}]`)
    }
  }
  return parts.length > 0 ? [parts.join('')] : []
}

/**
 * 把歌词文档序列化为 LRC 文本。
 *
 * 无损原则（与 `parseLrc` 对称）：
 * - 行级时间标签按 `precisionMs` 决定小数位数（给出 `uniformPrecisionMs` 时统一）；
 * - 无时间的正文行 / 未识别行优先写回 `raw`；
 * - 未知元数据标签按 `format.unknownTags` 顺序写回（可由选项关闭）；
 * - 换行符与 BOM 沿用文档记录，可用选项覆盖。
 *
 * @param document 歌词文档
 * @param options 序列化选项
 * @returns LRC 文本
 */
export function serializeLrc(document: LyricDocument, options: SerializeOptions = {}): string {
  const lineEnding = options.lineEnding ?? document.format.lineEnding
  const withBOM = options.withBOM ?? document.format.hasBOM
  const preserveUnknownTags = options.preserveUnknownTags ?? true

  const lines: string[] = []

  lines.push(...renderMetadata(document, preserveUnknownTags))

  for (const line of document.lines) {
    lines.push(...renderLine(line, options.uniformPrecisionMs))
  }

  return (withBOM ? '\uFEFF' : '') + lines.join(lineEnding) + lineEnding
}
