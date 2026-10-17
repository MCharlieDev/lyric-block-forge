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
   *
   * `rules` 缺省时使用 {@link DEFAULT_METADATA_PREFIX_RULES}；一旦传入即**完全替换**
   * 默认表（空数组表示全部不识别），调用方需自行合并默认表。
   */
  metadataPrefix?: {
    enabled?: boolean
    keepLyricLine?: boolean
    rules?: MetadataPrefixRule[]
  }
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
 * 一条元数据前缀规则。
 *
 * - `prefix`：行首精确匹配的前缀（如「作词」）；
 * - `tag`：写入 `applyMetaTag` 的标签名（标准标签名如 `lyricist`，或自定义键）；
 * - `action`：命中后的处理方式，缺省 `'meta'`：
 *   - `'off'` 忽略该规则，保留为普通歌词行；
 *   - `'meta'` 仅转元数据，是否保留歌词行取决于全局 `keepLyricLine`；
 *   - `'meta+line'` 既转元数据，又强制保留歌词行（优先于全局 `keepLyricLine`）。
 */
export interface MetadataPrefixRule {
  prefix: string
  tag: string
  action?: 'off' | 'meta' | 'meta+line'
}

/**
 * 默认元数据前缀表：行首中文前缀 → 标签名。
 *
 * `tag` 用的是「标签名」而非字段名，与 `applyMetaTag` 的 `case` 同名
 * （故「演唱」对应 `ar` 而不是 `artist`）；不在标准 `case` 内的走 default →
 * `meta.custom` 并登记 `unknownTags`。
 *
 * 调用方传入 `rules` 时整表替换，不与此默认表合并。
 */
export const DEFAULT_METADATA_PREFIX_RULES: MetadataPrefixRule[] = [
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
 * 判断一条前缀规则是否可用于匹配。
 *
 * 非法规则（空 `prefix` / 空 `tag` / `prefix` 含分隔符）在匹配时静默跳过，
 * 不抛异常，避免脏配置让整次导入失败。
 *
 * @param rule 前缀规则
 * @returns 可用于匹配时为 `true`
 */
function isValidMetadataPrefixRule(rule: MetadataPrefixRule): boolean {
  if (rule.prefix.trim() === '' || rule.tag.trim() === '') return false
  return !Array.from(rule.prefix).some((char) => METADATA_PREFIX_SEPARATORS.includes(char))
}

/**
 * 识别一行是否为「元数据前缀介绍行」（如 `作词：张三`）。
 *
 * 前缀须锚定行首且后紧邻一个合法分隔符（避免「作词人：X」误命中「作词」）；
 * 值两端 trim 后非空才算命中。多条规则命中同一行时先到先得；非法规则跳过。
 *
 * @param line 原始行（未 trim）
 * @param rules 前缀规则表（调用方已决定是否使用默认表）
 * @returns 命中的标签名、值与处理方式；未命中为 `null`
 */
function matchMetadataPrefix(
  line: string,
  rules: readonly MetadataPrefixRule[],
): { tag: string; value: string; action: 'off' | 'meta' | 'meta+line' } | null {
  for (const rule of rules) {
    if (!isValidMetadataPrefixRule(rule)) continue
    if (!line.startsWith(rule.prefix)) continue
    const separator = line.charAt(rule.prefix.length)
    if (separator === '' || !METADATA_PREFIX_SEPARATORS.includes(separator)) continue
    const value = line.slice(rule.prefix.length + 1).trim()
    if (value === '') continue
    const action = rule.action === 'off' || rule.action === 'meta+line' ? rule.action : 'meta'
    return { tag: rule.tag, value, action }
  }
  return null
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
   * 首行前的空行归 `leading`；元数据块内部的空行不再丢弃，留在
   * `pendingBlanks` 中，随下一条可见内容行归位到其 `beforeLine`。
   */
  const flushBlanksForMetaRow = (): void => {
    if (!sawAnyLine) {
      leadingBlanks.push(...pendingBlanks)
      pendingBlanks = []
      sawAnyLine = true
    }
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
  /** 前缀规则表：传入即整表替换默认表（空数组 = 全部不识别）。 */
  const metadataPrefixRules = options.metadataPrefix?.rules ?? DEFAULT_METADATA_PREFIX_RULES
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
        // 元数据块内部的空行不在此落盘：留在 pendingBlanks，随下一条内容行归位。
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

      // 元数据前缀识别：窗口内、首条带时间戳的行之前。action 为 off 时忽略该规则，
      // 直接落到下方 placeLine 当作普通歌词行；其余动作先转元数据（该行不进 lines），
      // 再按 meta+line（强制）或全局 keepLyricLine 决定是否额外保留一条歌词行。
      // 命中时同步 push 进 metadataTags（占源顺序位置），否则 pristine 判据 (b) 失败 →
      // 导出退回单行标准序，多行元数据布局会塌陷。
      if (recognizeMetadataPrefix && withinPrefixWindow && !sawTimestamp) {
        const matched = matchMetadataPrefix(rawLine, metadataPrefixRules)
        if (matched !== null && matched.action !== 'off') {
          flushBlanksForMetaRow()
          metadataTags.push([{ name: matched.tag, value: matched.value }])
          applyMetaTag(matched.tag, matched.value)
          if (matched.action === 'meta+line' || keepLyricLine) {
            // 保留歌词行：文本=原行，时间戳 00:00.000，兜底给不认元数据标签的播放器显示。
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

  // 清理孤儿锚点：双语合并会吞噬被动行，其 id 不再出现在 merged.lines 中。
  // 挂在孤儿上的空行不顺延丢弃，而是顺延到合并后的存活行；实在无法定位则归 trailing。
  // 按 beforeLineBlanks 的插入顺序（即源文件顺序）遍历，保证空行数组顺序不变。
  const presentIds = new Set(merged.lines.map((line) => line.id))
  const originalIndex = new Map(lines.map((line, index) => [line.id, index]))
  const toleranceMs = bilingual.toleranceMs ?? 0
  const sameTimestampSet = (left: LyricLine, right: LyricLine): boolean =>
    left.timestamps.length === right.timestamps.length &&
    left.timestamps.every(
      (stamp, index) => Math.abs(stamp.timeMs - right.timestamps[index].timeMs) <= toleranceMs,
    )

  const beforeLine: Record<string, string[]> = {}
  const orphanTrailing: string[] = []
  for (const [id, blanks] of Object.entries(beforeLineBlanks)) {
    if (presentIds.has(id)) {
      ;(beforeLine[id] ??= []).push(...blanks)
      continue
    }

    const index = originalIndex.get(id)
    const line = index === undefined ? undefined : lines[index]
    const previous = index !== undefined && index > 0 ? lines[index - 1] : undefined
    const next = index !== undefined ? lines[index + 1] : undefined
    const previousAlive = previous !== undefined && presentIds.has(previous.id) ? previous : undefined
    const nextAlive = next !== undefined && presentIds.has(next.id) ? next : undefined

    // 优先挂到时间戳一致的相邻存活行（即双语合并的合并目标），
    // 否则退化为任一相邻存活行；都没有则归 trailing。
    const target =
      previousAlive !== undefined && line !== undefined && sameTimestampSet(previousAlive, line)
        ? previousAlive
        : nextAlive !== undefined && line !== undefined && sameTimestampSet(nextAlive, line)
          ? nextAlive
          : (previousAlive ?? nextAlive)

    if (target !== undefined) {
      ;(beforeLine[target.id] ??= []).push(...blanks)
    } else {
      orphanTrailing.push(...blanks)
    }
  }

  // 孤儿空行位于源文件末尾时排在真实 trailing 之前，保持源顺序。
  if (orphanTrailing.length > 0) trailingBlanks.unshift(...orphanTrailing)

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
