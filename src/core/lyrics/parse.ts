import type {
  LyricDocument,
  LyricLine,
  LyricLineRole,
  LyricMetadata,
  Suggestion,
  ValidationIssue,
  WordTimestamp,
} from '../types'
import { mergeBilingualLines, type BilingualMergeOptions } from './bilingual'
import { createLyricDocument, createLyricLine, createTimestamp } from './factory'

/** 解析选项。 */
export interface ParseOptions {
  /**
   * 源文本编码。缺省时先按 `utf-8` 尝试，失败再走用户预设的备选编码。
   * 编码检测失败属于"必须事后确认"的少数异常之一。
   */
  encoding?: string
  /** 识别器总闸门：为 `false` 时跳过全部识别（双语合并与元数据前缀识别），默认 `true` */
  applyRecognizers?: boolean
  /** 双语识别与合并预设（分隔符、主语言、容差、开关） */
  bilingual?: BilingualMergeOptions
  /**
   * 元数据前缀识别预设：把歌词前的介绍行（如「作词：张三」）转为文档元数据。
   * 默认关闭——既有调用方都不传该字段，默认开启会让既有导入突然开始摘行。
   *
   * `keepLyricLine` 仅在 `enabled === true` 时被读取（否则无意义），默认 `false`
   * 即保持现状：识别行只转元数据、不进歌词行。置 `true` 则额外保留一条普通歌词行
   * （文本为原行，行级时间戳 `00:00.000`），兜底给不认元数据标签的播放器显示。
   */
  metadataPrefix?: { enabled?: boolean; keepLyricLine?: boolean }
}

/**
 * 解析结果。
 *
 * 导入主流程为"输入源 → 格式检测 → 解析 → 规范化 → 按预设识别 → 直接写入文档"，
 * 因此正常路径下 `issues` 为空，只有异常才需要用户确认。
 */
export interface ParseResult {
  /** 解析得到的文档，彻底失败时为 `null` */
  document: LyricDocument | null
  /** 解析阶段发现的校验问题（编码失败、格式无法识别等异常） */
  issues: ValidationIssue[]
  /** 识别器产出的建议，用户确认后才写入文档 */
  suggestions: Suggestion[]
  /** 无法识别但已原样保留的标签 */
  unknownTags: string[]
}

/** 行级时间标签的匹配片段：`[mm:ss]` / `[mm:ss.x]` / `[mm:ss:xx]`。 */
const LINE_TAG_PATTERN = '\\[(\\d{1,3}):(\\d{1,2})(?:[.:](\\d{1,3}))?\\]'

/** 增强型字级标签的匹配片段：`<mm:ss.xx>`。 */
const WORD_TAG_PATTERN = '<(\\d{1,3}):(\\d{1,2})(?:[.:](\\d{1,3}))?>'

/** 元数据标签：`[ti:标题]`。只认字母标签名，因此不会误吞时间标签。 */
const META_TAG_PATTERN = /\[([a-zA-Z]+):([^\]]*)\]/g

/** 元数据前缀识别的作用窗口：只看歌词前 N 条内容行（空行与元数据行不计入）。 */
const METADATA_PREFIX_MAX_LINES = 10

/**
 * 默认元数据前缀表：行首中文前缀 → 标签名。
 *
 * `tag` 用的是「标签名」而非字段名，与 `applyMetaTag` 的 `case` 同名
 * （故「演唱」对应 `ar` 而不是 `artist`）；不在标准 `case` 内的走 default →
 * `meta.custom` 并登记 `unknownTags`。
 */
const METADATA_PREFIX_TABLE: ReadonlyArray<{ prefix: string; tag: string }> = [
  { prefix: '作词', tag: 'lyricist' },
  { prefix: '作曲', tag: 'composer' },
  { prefix: '演唱', tag: 'ar' },
  { prefix: '编曲', tag: 'arranger' },
  { prefix: '制作人', tag: 'producer' },
  { prefix: '混音', tag: 'mixer' },
  { prefix: '母带', tag: 'mastering' },
  { prefix: '出品', tag: 'presented' },
  { prefix: '发行', tag: 'publisher' },
]

/** 前缀与值之间的合法分隔符：中文冒号 / 英文冒号 / 半角空格 / Tab。 */
const METADATA_PREFIX_SEPARATORS = '：: \t'

/**
 * 解析一个时间标签的数字部分。
 *
 * 小数位数决定 `precisionMs`：无小数 = 秒级（1000），一位 = 100，两位 = 10，三位 = 1。
 * 序列化时按同一规则写回，因此整数毫秒与源文件写法可以精确往返。
 *
 * @param match 正则命中结果（含分、秒、小数三组）
 * @returns 时间值（毫秒）与精度（毫秒）
 */
function parseTimeParts(match: RegExpMatchArray): { timeMs: number; precisionMs: number } {
  const minutes = Number(match[1])
  const seconds = Number(match[2])
  const fraction = match[3] ?? ''
  const millis = fraction === '' ? 0 : Number(fraction.padEnd(3, '0').slice(0, 3))
  const precisionMs = fraction.length === 0 ? 1000 : fraction.length === 1 ? 100 : fraction.length === 2 ? 10 : 1
  return { timeMs: minutes * 60_000 + seconds * 1000 + millis, precisionMs }
}

/**
 * 判断一行是否"整行都由元数据标签构成"。
 *
 * 只由标签构成时返回标签列表（`[ti:a][ar:b]` 这种连写也能拆开），
 * 混有正文时返回 `null`，交由歌词行逻辑处理，避免误吞内容。
 *
 * @param line 原始行
 * @returns 标签名值对列表；不是纯元数据行为 `null`
 */
function extractMetadataTags(line: string): Array<{ name: string; value: string }> | null {
  const tags = Array.from(line.matchAll(META_TAG_PATTERN), (match) => ({ name: match[1], value: match[2] }))
  if (tags.length === 0) return null
  const rest = line.replace(META_TAG_PATTERN, '').trim()
  return rest === '' ? tags : null
}

/**
 * 识别一行是否为「元数据前缀介绍行」（如 `作词：张三`）。
 *
 * 前缀须锚定行首且后紧邻一个合法分隔符（避免「作词人：X」误命中「作词」）；
 * 值两端 trim 后非空才算命中。
 *
 * @param line 原始行（未 trim）
 * @returns 命中的标签名与值；未命中为 `null`
 */
function matchMetadataPrefix(line: string): { tag: string; value: string } | null {
  const entry = METADATA_PREFIX_TABLE.find((item) => line.startsWith(item.prefix))
  if (entry === undefined) return null
  const separator = line.charAt(entry.prefix.length)
  if (separator === '' || !METADATA_PREFIX_SEPARATORS.includes(separator)) return null
  const value = line.slice(entry.prefix.length + 1).trim()
  return value === '' ? null : { tag: entry.tag, value }
}

/**
 * 解析 `[length:]` 的值：优先按 `mm:ss[.xx]`，否则按秒数。
 *
 * @param value 标签原始值
 * @returns 时长（毫秒）；无法解析为 `null`
 */
function parseLength(value: string): number | null {
  const match = /^(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?$/.exec(value.trim())
  if (match) return parseTimeParts(match).timeMs
  const seconds = Number(value.trim())
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : null
}

/**
 * 拆分增强型行内文本，得到可见文本与字级时间戳。
 *
 * 文本被 `<mm:ss.xx>` 切成若干段：每个标签管辖"它到下一个标签之间的文本"。
 * 首个标签之前的文本没有时间归属，原样并入可见文本。
 *
 * @param content 已剥离行级时间标签的正文
 * @returns 可见文本与字级时间戳（按文本顺序）
 */
function splitEnhancedText(content: string): { text: string; words: WordTimestamp[] } {
  const words: WordTimestamp[] = []
  let text = ''
  let lastIndex = 0
  let pending: { timeMs: number; precisionMs: number; start: number } | null = null

  for (const match of content.matchAll(new RegExp(WORD_TAG_PATTERN, 'g'))) {
    const segment = content.slice(lastIndex, match.index)
    if (pending !== null) {
      if (segment.length > 0) {
        words.push({
          kind: 'word',
          timeMs: pending.timeMs,
          precisionMs: pending.precisionMs,
          range: { start: pending.start, end: pending.start + segment.length },
          source: 'import',
          text: segment,
        })
        text += segment
      }
    } else {
      text += segment
    }
    lastIndex = match.index + match[0].length
    const parts = parseTimeParts(match)
    pending = { timeMs: parts.timeMs, precisionMs: parts.precisionMs, start: text.length }
  }

  const tail = content.slice(lastIndex)
  if (pending !== null) {
    if (tail.length > 0) {
      words.push({
        kind: 'word',
        timeMs: pending.timeMs,
        precisionMs: pending.precisionMs,
        range: { start: pending.start, end: pending.start + tail.length },
        source: 'import',
        text: tail,
      })
      text += tail
    }
  } else {
    text += tail
  }

  return { text, words }
}

/**
 * 构造一条歌词行。
 *
 * @param text 行文本
 * @param role 行角色
 * @param raw 原始行文本，导出非时间戳行时原样写回
 * @param times 行级时间戳（毫秒与精度），一行可有多个
 * @param words 字级时间戳
 * @returns 新的歌词行
 */
function buildLine(
  text: string,
  role: LyricLineRole,
  raw: string,
  times: Array<{ timeMs: number; precisionMs: number }>,
  words: WordTimestamp[],
): LyricLine {
  const line = createLyricLine(text, { role })
  return {
    ...line,
    timestamps: times.map((time) => createTimestamp('line', time.timeMs, 'import', time.precisionMs)),
    wordTimestamps: words,
    raw,
  }
}

/**
 * 解析 LRC 文本为歌词文档。
 *
 * 无损原则：
 * - 行级时间标签的小数位数记入 `precisionMs`，导出时按同样位数写回；
 * - 一行多个时间标签（`[00:15.50][00:18.00]同一句`）保留为**同一条歌词行的多个时间戳**，
 *   不拆成互不关联的两行，`raw` 原样保留；
 * - 无法识别的元数据标签进入 `meta.custom` 与 `format.unknownTags`，导出时写回；
 * - 非时间戳行保留 `raw`，导出时原样输出。
 *
 * 解析后按预设执行双语识别：时间戳相同（在容差内）且脚本不同的相邻两行
 * 会合并成一条（主文本 + 翻译），详见 `mergeBilingualLines`。
 * 该步骤以"时间戳相同自动合并"为兜底逻辑，可由 `options.bilingual` 调整或关闭。
 *
 * @param source 源文本（已解码为字符串）
 * @param options 解析选项
 * @returns 解析结果
 */
export function parseLrc(source: string, options: ParseOptions = {}): ParseResult {
  const unknownTags: string[] = []
  const custom: Record<string, string> = {}
  const meta: LyricMetadata = {}
  /** 纯元数据行的原始标签序列：逐行记录「名 + 值」原序，供序列化保真写回。 */
  const metadataTags: Array<Array<{ name: string; value: string }>> = []
  /** 空行记录（additive）：首条内容行之前。 */
  const leadingBlanks: string[] = []
  /** 空行记录（additive）：某条歌词行 id 之前。 */
  const beforeLineBlanks: Record<string, string[]> = {}
  /** 空行记录（additive）：最后一条歌词行之后、终止换行之前。 */
  const trailingBlanks: string[] = []
  /** 连续空行的暂存区，遇到下一条内容行时归位到对应锚点。 */
  let pendingBlanks: string[] = []
  /** 是否已消费首条非空行：用于区分「leading」与「beforeLine」。 */
  let sawAnyLine = false

  /**
   * 把一条「标签名 → 值」写入元数据。
   *
   * 元数据标签路径（`[tag:value]`）与元数据前缀识别路径**共用此函数**：
   * 同一套映射只有这一处定义；非标准标签名走 `meta.custom` 并登记 `unknownTags`。
   */
  const applyMetaTag = (name: string, value: string): void => {
    switch (name) {
      case 'ti':
        meta.title = value
        break
      case 'ar':
        meta.artist = value
        break
      case 'al':
        meta.album = value
        break
      case 'by':
        meta.by = value
        break
      case 'lyricist':
        meta.lyricist = value
        break
      case 'composer':
        meta.composer = value
        break
      case 'arranger':
        meta.arranger = value
        break
      case 'offset': {
        const offset = Number.parseInt(value, 10)
        if (!Number.isNaN(offset)) meta.offsetMs = offset
        break
      }
      case 'length': {
        const lengthMs = parseLength(value)
        if (lengthMs !== null) meta.lengthMs = lengthMs
        break
      }
      default:
        custom[name] = value
        if (!unknownTags.includes(name)) unknownTags.push(name)
    }
  }

  /**
   * 元数据行（含识别出的前缀行）落盘前的空行游标处理：
   * 首行前的空行归 `leading`，块内空行丢弃（既有已知有损缺口）。
   */
  const flushBlanksForMetaRow = (): void => {
    if (!sawAnyLine) {
      leadingBlanks.push(...pendingBlanks)
      sawAnyLine = true
    }
    pendingBlanks = []
  }

  let text = source
  let hasBOM = false
  if (text.charCodeAt(0) === 0xfeff) {
    hasBOM = true
    text = text.slice(1)
  }

  const lineEnding: '\n' | '\r\n' = text.includes('\r\n') ? '\r\n' : '\n'
  const sourceHasTimestamp = new RegExp(LINE_TAG_PATTERN).test(text)

  const lines: LyricLine[] = []
  let sawTimestamp = false
  let sawWordTimestamp = false
  /** 已遇到的内容行计数（只计走到 plain / timestamped 两分支的行）。 */
  let contentLineCount = 0

  /** 把暂存的空行归位到指定歌词行之前并落盘该行。 */
  const placeLine = (line: LyricLine): void => {
    if (!sawAnyLine) {
      leadingBlanks.push(...pendingBlanks)
    } else if (pendingBlanks.length > 0) {
      ;(beforeLineBlanks[line.id] ??= []).push(...pendingBlanks)
    }
    pendingBlanks = []
    sawAnyLine = true
    lines.push(line)
  }

  const parts = text.split(/\r\n|\n|\r/)
  // 文本以换行结尾时 split 末尾必有一个 '' 元素，是终止符产物而非真实空行。
  // 终止换行由 serializeLrc 末尾固定补出，故此处剔除，避免多记一个假空行。
  if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop()

  const applyRecognizers = options.applyRecognizers ?? true
  /** 元数据前缀识别：总闸门开 且 该识别被显式开启（默认关）。 */
  const recognizeMetadataPrefix = applyRecognizers && options.metadataPrefix?.enabled === true
  /** 第三态：识别前缀时是否额外保留一条普通歌词行（仅在识别开启时被读取）。 */
  const keepLyricLine = options.metadataPrefix?.keepLyricLine === true

  for (const rawLine of parts) {
    if (rawLine.trim() === '') {
      // 空行 / 仅含空白字符的行：存原文以保字节无损，等待归位到下一个锚点。
      pendingBlanks.push(rawLine)
      continue
    }

    const timeMatches = Array.from(rawLine.matchAll(new RegExp(LINE_TAG_PATTERN, 'g')))

    // 元数据行：整行由 [tag:value] 构成
    if (timeMatches.length === 0) {
      const tags = extractMetadataTags(rawLine)
      if (tags !== null) {
        // TODO(空行·未来扩展)：元数据块内部的空行（两条元数据行之间）本轮丢弃，
        // 属已知有损缺口；未来可在此承载（如在 metadataTags 同槽位记录）。
        flushBlanksForMetaRow()
        metadataTags.push(tags)
        for (const { name, value } of tags) applyMetaTag(name, value)
        continue
      }
    }

    // 走到这里说明是「内容行」（非空、非纯元数据行）：计入「前 N 条内容行」窗口。
    const withinPrefixWindow = contentLineCount < METADATA_PREFIX_MAX_LINES
    contentLineCount += 1

    // 纯文本行：有时间的文件里视为未识别行，整篇无时间的文件里视为正文
    if (timeMatches.length === 0) {
      // 普通行的行角色：供下方普通行与前缀保留行共用（同一概念单一来源）。
      const role: LyricLineRole = sourceHasTimestamp ? 'unknown' : 'main'

      // 元数据前缀识别：窗口内、首条带时间戳的行之前；命中即转元数据，该行不进 lines。
      // 命中时同步 push 进 metadataTags（占源顺序位置），否则 pristine 判据 (b) 失败 →
      // 导出退回单行标准序，多行元数据布局会塌陷。
      if (recognizeMetadataPrefix && withinPrefixWindow && !sawTimestamp) {
        const matched = matchMetadataPrefix(rawLine)
        if (matched !== null) {
          flushBlanksForMetaRow()
          metadataTags.push([{ name: matched.tag, value: matched.value }])
          applyMetaTag(matched.tag, matched.value)
          if (keepLyricLine) {
            // 第三态：除元数据标签外，额外保留一条普通歌词行（文本=原行，时间戳 00:00.000），
            // 兜底给不认元数据标签的播放器显示。
            placeLine(buildLine(rawLine.trim(), role, rawLine, [{ timeMs: 0, precisionMs: 1 }], []))
          }
          continue
        }
      }
      placeLine(buildLine(rawLine.trim(), role, rawLine, [], []))
      continue
    }

    // 歌词行：剥离行级标签后可能还带增强型字级标签
    sawTimestamp = true
    const content = rawLine.replace(new RegExp(LINE_TAG_PATTERN, 'g'), '')
    const hasWordTags = new RegExp(WORD_TAG_PATTERN).test(content)
    if (hasWordTags) sawWordTimestamp = true
    const enhanced = hasWordTags ? splitEnhancedText(content) : { text: content, words: [] as WordTimestamp[] }

    // 一行多个时间标签属于同一条歌词：保留为一个行的多个时间戳，不拆分
    placeLine(
      buildLine(
        enhanced.text,
        'main',
        rawLine,
        timeMatches.map((match) => parseTimeParts(match)),
        enhanced.words,
      ),
    )
  }

  // 循环结束后仍暂存的空行：位于最后一条歌词行之后、终止换行之前 → trailing。
  if (pendingBlanks.length > 0) {
    trailingBlanks.push(...pendingBlanks)
    pendingBlanks = []
  }

  // 双语识别：按预设合并相邻同时间戳的双语行、拆分行内分隔符
  const bilingual = options.bilingual ?? {}
  const merged = applyRecognizers
    ? mergeBilingualLines(lines, bilingual)
    : { lines, mergedPairCount: 0, splitSeparatorCount: 0 }

  const detectedFormat = sawWordTimestamp ? 'enhanced-lrc' : sawTimestamp ? 'lrc' : lines.length > 0 ? 'plain' : 'unknown'

  // 过滤孤儿锚点：双语合并会吞噬被动行，其 id 不再出现在 merged.lines 中，
  // 挂在它上面的空行随之丢弃（降级规则：锚点消失即丢弃，不顺延）。
  const presentIds = new Set(merged.lines.map((line) => line.id))
  const beforeLine: Record<string, string[]> = {}
  for (const [id, blanks] of Object.entries(beforeLineBlanks)) {
    if (presentIds.has(id)) beforeLine[id] = blanks
  }

  const hasBlankLines =
    leadingBlanks.length > 0 || trailingBlanks.length > 0 || Object.keys(beforeLine).length > 0

  const document = createLyricDocument({
    meta: Object.keys(custom).length > 0 ? { ...meta, custom } : meta,
    lines: merged.lines,
    format: {
      encoding: options.encoding ?? 'utf-8',
      detectedFormat,
      lineEnding,
      hasBOM,
      unknownTags,
      bilingualSeparator: bilingual.separator ?? null,
      metadataTags: metadataTags.length > 0 ? metadataTags : undefined,
      blankLines: hasBlankLines
        ? {
            ...(leadingBlanks.length > 0 ? { leading: leadingBlanks } : {}),
            ...(Object.keys(beforeLine).length > 0 ? { beforeLine } : {}),
            ...(trailingBlanks.length > 0 ? { trailing: trailingBlanks } : {}),
          }
        : undefined,
    },
  })

  return { document, issues: [], suggestions: [], unknownTags }
}
