import type { LyricLine } from '../types'

/**
 * 文字脚本分类。
 *
 * 双语识别不依赖"具体是哪种语言"，而是先看两行各用什么文字书写：
 * 中文（汉字）、日文（假名）、韩文（谚文）、俄文（西里尔）、拉丁字母等。
 * 这样即使遇到未见过的语种，也能按脚本差异判断是否构成双语对。
 */
export type LyricScript = 'han' | 'kana' | 'hangul' | 'cyrillic' | 'latin' | 'other'

/**
 * 主语言预设。`auto` 表示沿用文件顺序（第一行作主文本）。
 *
 * 覆盖主流歌曲语种；同以拉丁字母书写的语种（英/西/法/德/葡/意）
 * 彼此脚本相同，因此它们之间不会互相合并，只会与不同脚本的行合并。
 */
export type BilingualLanguage = 'auto' | 'zh' | 'ja' | 'ko' | 'ru' | 'en' | 'es' | 'fr' | 'de' | 'pt' | 'it'

/** 脚本检测用的字符范围。 */
const SCRIPT_PATTERNS: Array<{ script: LyricScript; pattern: RegExp }> = [
  { script: 'kana', pattern: /[\u3040-\u30ff\u31f0-\u31ff\uff66-\uff9d]/ },
  { script: 'hangul', pattern: /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/ },
  { script: 'han', pattern: /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/ },
  { script: 'cyrillic', pattern: /[\u0400-\u04ff\u0500-\u052f]/ },
  { script: 'latin', pattern: /[a-zA-Z\u00c0-\u024f\u1e00-\u1eff]/ },
]

/** 语言到脚本的映射。 */
const LANGUAGE_SCRIPT: Record<Exclude<BilingualLanguage, 'auto'>, LyricScript> = {
  zh: 'han',
  ja: 'kana',
  ko: 'hangul',
  ru: 'cyrillic',
  en: 'latin',
  es: 'latin',
  fr: 'latin',
  de: 'latin',
  pt: 'latin',
  it: 'latin',
}

/**
 * 判断一段文本的主要书写脚本。
 *
 * 取"命中的最高优先级脚本"：假名 > 谚文 > 汉字 > 西里尔 > 拉丁。
 * 优先级保证了混排文本的归属稳定——例如"君の名は"含汉字与假名，
 * 归为假名（日文），不会与纯中文行误判为同脚本。
 *
 * @param text 待判定文本
 * @returns 主要脚本；不含任何已知脚本字符时为 `other`
 */
export function primaryScript(text: string): LyricScript {
  for (const { script, pattern } of SCRIPT_PATTERNS) {
    if (pattern.test(text)) return script
  }
  return 'other'
}

/**
 * 语言预设对应的脚本。
 *
 * @param language 语言预设
 * @returns 对应脚本；`auto` 时为 `null`
 */
export function scriptOfLanguage(language: BilingualLanguage): LyricScript | null {
  if (language === 'auto') return null
  return LANGUAGE_SCRIPT[language] ?? null
}

/** 双语合并选项。 */
export interface BilingualMergeOptions {
  /**
   * 是否启用合并，默认 `true`。
   * 关闭时仅做分隔符拆分（若配置了分隔符），不按时间戳合并相邻行。
   */
  enabled?: boolean
  /**
   * 时间戳容差（毫秒），默认 `0`（严格相等）。
   * 两行时间戳差值不超过容差才视为"同一时刻"。
   */
  toleranceMs?: number
  /** 主语言预设，决定合并后哪一行作文本、哪一行作翻译。默认 `auto`（沿用文件顺序）。 */
  primaryLanguage?: BilingualLanguage
  /**
   * 双语识别分隔符。非空时，单行文本里出现该分隔符会被拆成主文本 + 翻译。
   * 缺省为 `null`（不做行内拆分）。
   */
  separator?: string | null
}

/** 双语合并结果。 */
export interface BilingualMergeResult {
  /** 合并后的歌词行 */
  lines: LyricLine[]
  /** 按时间戳合并的双语对数量 */
  mergedPairCount: number
  /** 按分隔符拆分的行数 */
  splitSeparatorCount: number
}

/**
 * 在候选行中挑选主文本行。
 *
 * - `auto`：沿用文件顺序，取第一行为主文本；
 * - 指定语言：取脚本匹配目标语言的那一行为主文本，
 *   若两行都不匹配或都匹配，则回退为文件顺序。
 *
 * @param firstScript 第一行脚本
 * @param secondScript 第二行脚本
 * @param targetScript 目标脚本，`null` 表示 `auto`
 * @returns 主文本行的下标
 */
function pickPrimaryIndex(
  firstScript: LyricScript,
  secondScript: LyricScript,
  targetScript: LyricScript | null,
): 0 | 1 {
  if (targetScript === null) return 0
  const firstMatches = firstScript === targetScript
  const secondMatches = secondScript === targetScript
  if (firstMatches && !secondMatches) return 0
  if (secondMatches && !firstMatches) return 1
  return 0
}

/**
 * 判断两行是否构成可合并的双语对。
 *
 * 合并条件（全部满足）：
 * 1. 均为主歌词行，且尚未带翻译；
 * 2. 各恰好有一个行级时间戳，且时间差不超过容差；
 * 3. 均无字级时间戳（字级打轴的行不做双语合并，避免破坏字级对齐）；
 * 4. 文本非空，且两行主要脚本不同、均非 `other`。
 *
 * @param first 前一行
 * @param second 后一行
 * @param toleranceMs 时间戳容差（毫秒）
 * @returns 是否可合并
 */
function isMergeablePair(first: LyricLine, second: LyricLine, toleranceMs: number): boolean {
  if (first.role !== 'main' || second.role !== 'main') return false
  if (first.translation !== undefined || second.translation !== undefined) return false
  if (first.timestamps.length !== 1 || second.timestamps.length !== 1) return false
  if (first.wordTimestamps.length > 0 || second.wordTimestamps.length > 0) return false
  if (first.text.trim() === '' || second.text.trim() === '') return false

  const delta = Math.abs(first.timestamps[0].timeMs - second.timestamps[0].timeMs)
  if (delta > toleranceMs) return false

  const firstScript = primaryScript(first.text)
  const secondScript = primaryScript(second.text)
  if (firstScript === 'other' || secondScript === 'other') return false
  return firstScript !== secondScript
}

/**
 * 合并一组双语对。
 *
 * 合并后：主行的文本与时间戳保留，另一行作为 `translation`；
 * `translationSeparator` 置为 `null`，表示导出时写回为两行（同时间戳）。
 *
 * @param main 主文本行
 * @param other 翻译行
 * @returns 合并后的歌词行
 */
function mergePair(main: LyricLine, other: LyricLine): LyricLine {
  return {
    ...main,
    translation: other.text,
    translationSeparator: null,
    raw: undefined,
  }
}

/**
 * 按分隔符把单行文本拆成主文本 + 翻译。
 *
 * 仅在配置了非空分隔符且文本中确实出现时才拆分；
 * 主文本的归属由主语言决定，并记录 `translationSeparator`，
 * 保证导出时能用同一分隔符拼回一行。
 *
 * @param line 待拆分的歌词行
 * @param separator 分隔符
 * @param targetScript 目标脚本，`null` 表示 `auto`
 * @returns 拆分后的行；不满足拆分条件时为原行
 */
function splitBySeparator(
  line: LyricLine,
  separator: string,
  targetScript: LyricScript | null,
): LyricLine | null {
  if (line.role !== 'main' || line.translation !== undefined) return null
  const index = line.text.indexOf(separator)
  if (index < 0) return null

  const left = line.text.slice(0, index).trim()
  const right = line.text.slice(index + separator.length).trim()
  if (left === '' || right === '') return null

  const leftScript = primaryScript(left)
  const rightScript = primaryScript(right)
  const mainFirst = pickPrimaryIndex(leftScript, rightScript, targetScript) === 0
  const main = mainFirst ? left : right
  const translation = mainFirst ? right : left

  return { ...line, text: main, translation, translationSeparator: separator }
}

/**
 * 对解析得到的歌词行执行双语识别与合并。
 *
 * 分两步：
 * 1. **分隔符拆分**：单行文本含配置的分隔符时拆成主文本 + 翻译；
 * 2. **相邻行合并**：时间戳相同（在容差内）且脚本不同的相邻两行合并成一条，
 *    主语言决定主文本归属，另一行转为 `translation`。
 *
 * 合并保留主行的 `id`，因此拖动这一行时，主文本与翻译天然一起移动，
 * 不会出现"翻译掉队"的问题。
 *
 * @param lines 解析得到的歌词行（按文件顺序）
 * @param options 合并选项
 * @returns 合并结果
 */
export function mergeBilingualLines(
  lines: LyricLine[],
  options: BilingualMergeOptions = {},
): BilingualMergeResult {
  const enabled = options.enabled ?? true
  const toleranceMs = options.toleranceMs ?? 0
  const separator = options.separator ?? null
  const targetScript = scriptOfLanguage(options.primaryLanguage ?? 'auto')

  let splitSeparatorCount = 0
  let mergedPairCount = 0

  // 第一步：行内分隔符拆分
  let working: LyricLine[] = lines
  if (separator !== null && separator !== '') {
    working = lines.map((line) => {
      const split = splitBySeparator(line, separator, targetScript)
      if (split !== null) splitSeparatorCount += 1
      return split ?? line
    })
  }

  if (!enabled) {
    return { lines: working, mergedPairCount, splitSeparatorCount }
  }

  // 第二步：相邻同时间戳的双语行合并
  const merged: LyricLine[] = []
  for (let i = 0; i < working.length; i += 1) {
    const current = working[i]
    const next = working[i + 1]
    if (next !== undefined && isMergeablePair(current, next, toleranceMs)) {
      const currentScript = primaryScript(current.text)
      const nextScript = primaryScript(next.text)
      const mainIsFirst = pickPrimaryIndex(currentScript, nextScript, targetScript) === 0
      merged.push(mainIsFirst ? mergePair(current, next) : mergePair(next, current))
      mergedPairCount += 1
      i += 1
      continue
    }
    merged.push(current)
  }

  return { lines: merged, mergedPairCount, splitSeparatorCount }
}
