import type { LyricDocument, LyricLine, OperationKind, OperationLog, OperationLogEntry } from '../types'

/**
 * 字级时间戳在回放状态中的键。
 *
 * @param lineId 行 ID
 * @param wordIndex 字级下标
 * @returns 形如 `line_x#3` 的键
 */
export function wordKey(lineId: string, wordIndex: number): string {
  return `${lineId}#${wordIndex}`
}

/**
 * 时间戳基线 —— "所有操作都被撤销"时的状态。
 *
 * 回放模型：当前时间戳 = 基线 + 按顺序叠加所有生效中的操作。
 * 撤销与恢复都只改变记录状态，然后重新回放，因此永远只有一套逻辑。
 */
export interface TimestampBaseline {
  /**
   * 行 ID 到行级时间戳数组（毫秒）的映射。
   *
   * 用数组是因为一行可以有多个行级时间戳（`[00:15.50][00:18.00]同一句`），
   * 每个元素对应一次出现或区间端点，下标即 `timestampIndex`。
   */
  lineTimestamps: Record<string, number[]>
  /** `wordKey` 到字级时间戳（毫秒）的映射 */
  wordTimestamps: Record<string, number>
}

/**
 * 回放选项。用于"分级回退"：只回放某一层级的操作，
 * 即可得到"仅保留手动打轴""保留手动打轴 + 整体移动"等中间结果。
 */
export interface ReplayOptions {
  /** 只回放这些类型的操作；为空表示全部回放 */
  kinds?: OperationKind[]
  /** 只回放该记录（含）之前的操作，用于回退到历史某一点 */
  untilEntryId?: string
  /** 是否把已撤销的记录也纳入回放，默认 `false` */
  includeUndone?: boolean
}

/**
 * 一行的文本覆盖层内容。
 *
 * 只在 `line-text` 模式下写入；未写的字段为 `undefined`，表示沿用文档基线原值。
 */
export interface LineTextOverride {
  /** 正文 */
  text: string
  /** 翻译；`null` 表示明确清空 */
  translation?: string | null
  /** 罗马音；`null` 表示明确清空 */
  romanization?: string | null
  /** 行注释；`null` 表示明确清空 */
  comment?: string | null
}

/**
 * 回放结果。
 */
export interface ReplayState {
  /** 所使用的基线 */
  baseline: TimestampBaseline
  /** 回放后的行级时间戳，每行一个数组 */
  lineTimestamps: Record<string, number[]>
  /** 回放后的字级时间戳 */
  wordTimestamps: Record<string, number>
  /** 实际参与回放的记录 ID，按顺序 */
  appliedEntryIds: string[]
  /** 行文本覆盖层（`line-text` 模式产生），键为行 ID */
  lineTexts: Record<string, LineTextOverride>
  /** 被移除的行 ID */
  removedLineIds: Set<string>
  /** 字级时间戳被清空的行 ID */
  clearedWordLines: Set<string>
  /**
   * 行级时间戳被清空（`clear-timestamps`）的行 ID。
   *
   * 与 {@link ReplayState.clearedWordLines} 的差别：这里**只标记时间被清**，
   * 字级的 `text` / `range`（切分）仍然保留，因此 `deriveVisibleLines`
   * 不据此抹掉 `wordTimestamps`；导出时用它避免旧标签「复活」。
   */
  clearedLineLines: Set<string>
}

/**
 * 从文档构建时间戳基线。
 *
 * @param document 歌词文档
 * @returns 与文档结构对应的基线
 */
export function buildBaselineFromDocument(document: LyricDocument): TimestampBaseline {
  const baseline: TimestampBaseline = { lineTimestamps: {}, wordTimestamps: {} }
  for (const line of document.lines) {
    if (line.timestamps.length > 0) baseline.lineTimestamps[line.id] = line.timestamps.map((item) => item.timeMs)
    line.wordTimestamps.forEach((word, index) => {
      baseline.wordTimestamps[wordKey(line.id, index)] = word.timeMs
    })
  }
  return baseline
}

/**
 * 回放操作日志，得到当前时间戳。
 *
 * 只回放"生效中"的记录；撤销与恢复不产生新记录，只是改变记录状态，
 * 所以这里无需为它们做任何特殊处理。
 *
 * @param log 操作日志
 * @param baseline 时间戳基线，缺省为空基线（全部由操作日志推导）
 * @param options 回放选项
 * @returns 回放结果
 */
export function replayOperations(
  log: OperationLog,
  baseline: TimestampBaseline = { lineTimestamps: {}, wordTimestamps: {} },
  options: ReplayOptions = {},
): ReplayState {
  // 行级是数组，浅拷贝会共享内层数组，必须逐行复制
  const lineTimestamps: Record<string, number[]> = Object.fromEntries(
    Object.entries(baseline.lineTimestamps).map(([lineId, times]) => [lineId, [...times]]),
  )
  const wordTimestamps = { ...baseline.wordTimestamps }
  const appliedEntryIds: string[] = []
  // 文本覆盖层与两个标记集合都不来自基线：撤销后从基线重新回放，
  // 它们自然重建为空，因此"字级被清空"的复原无需保存任何旧值。
  const lineTexts: Record<string, LineTextOverride> = {}
  const removedLineIds = new Set<string>()
  const clearedWordLines = new Set<string>()
  const clearedLineLines = new Set<string>()
  const kindFilter = options.kinds && options.kinds.length > 0 ? new Set(options.kinds) : null

  for (const entry of log.entries) {
    if (!options.includeUndone && entry.status !== 'active') continue
    if (kindFilter && !kindFilter.has(entry.kind)) continue
    applyEntry(entry, lineTimestamps, wordTimestamps, lineTexts, removedLineIds, clearedWordLines, clearedLineLines)
    appliedEntryIds.push(entry.id)
    if (options.untilEntryId && entry.id === options.untilEntryId) break
  }

  return {
    baseline,
    lineTimestamps,
    wordTimestamps,
    appliedEntryIds,
    lineTexts,
    removedLineIds,
    clearedWordLines,
    clearedLineLines,
  }
}

/**
 * 删除某一行在字级时间戳表里的全部条目。
 *
 * 键形如 `lineId#wordIndex`，加 `#` 前缀可避免 `line_1#` 误匹配 `line_10#0`。
 *
 * @param lineId 行 ID
 * @param wordTimestamps 字级时间戳表（就地修改）
 */
function clearLineWords(lineId: string, wordTimestamps: Record<string, number>): void {
  const prefix = `${lineId}#`
  for (const key of Object.keys(wordTimestamps)) {
    if (key.startsWith(prefix)) delete wordTimestamps[key]
  }
}

/**
 * 把一条记录的变化量叠加到时间戳表上。
 *
 * @param entry 日志记录
 * @param lineTimestamps 行级时间戳表（就地修改）
 * @param wordTimestamps 字级时间戳表（就地修改）
 * @param lineTexts 行文本覆盖层（就地修改）
 * @param removedLineIds 被移除的行集合（就地修改）
 * @param clearedWordLines 字级被清空的行集合（就地修改）
 * @param clearedLineLines 行级时间被清空的行集合（就地修改）
 */
function applyEntry(
  entry: OperationLogEntry,
  lineTimestamps: Record<string, number[]>,
  wordTimestamps: Record<string, number>,
  lineTexts: Record<string, LineTextOverride>,
  removedLineIds: Set<string>,
  clearedWordLines: Set<string>,
  clearedLineLines: Set<string>,
): void {
  const { delta, scope } = entry
  switch (delta.mode) {
    case 'offset': {
      // 整体平移作用于该行的全部行级时间戳，保持多次出现/区间的相对间距
      for (const lineId of scope.lineIds) {
        const times = lineTimestamps[lineId]
        if (!times) continue
        lineTimestamps[lineId] = times.map((timeMs) => timeMs + delta.offsetMs)
      }
      for (const ref of scope.wordRefs) {
        const key = wordKey(ref.lineId, ref.wordIndex)
        if (typeof wordTimestamps[key] === 'number') {
          wordTimestamps[key] += delta.offsetMs
        }
      }
      break
    }
    case 'absolute': {
      for (const value of delta.values) {
        if (value.wordIndex === null) {
          const index = value.timestampIndex ?? 0
          const times = lineTimestamps[value.lineId] ?? []
          const next = [...times]
          // 支持"先无时间戳、后补打轴"：下标越界时补空位
          while (next.length < index) next.push(0)
          next[index] = value.timeMs
          lineTimestamps[value.lineId] = next
        } else {
          wordTimestamps[wordKey(value.lineId, value.wordIndex)] = value.timeMs
        }
      }
      break
    }
    case 'none':
      break
    case 'line-text': {
      for (const value of delta.values) {
        lineTexts[value.lineId] = {
          text: value.text,
          translation: value.translation,
          romanization: value.romanization,
          comment: value.comment,
        }
        if (value.clearWordTimestamps) {
          clearedWordLines.add(value.lineId)
          // 必须就地删除，否则不可改的消费方（如时间轴时长计算）
          // 会通过 getReplayedWordTime 读到基线里的旧字级值
          clearLineWords(value.lineId, wordTimestamps)
        }
      }
      break
    }
    case 'remove-line': {
      for (const lineId of scope.lineIds) {
        removedLineIds.add(lineId)
        // 被移除的行不该再在时间轴上占位：行级与字级表项一并删除
        delete lineTimestamps[lineId]
        clearLineWords(lineId, wordTimestamps)
      }
      break
    }
    case 'clear-timestamps': {
      for (const lineId of scope.lineIds) {
        // 只删时间不删切分：字级的 text / range 留在行模型里，弹窗槽位仍在，
        // 只是 getReplayedWordTime 读不到值 → 展示为「未打轴」。
        delete lineTimestamps[lineId]
        clearLineWords(lineId, wordTimestamps)
        // 关键：绝不 add 到 clearedWordLines，否则 deriveVisibleLines 会抹掉
        // wordTimestamps 数组，切分（range/text）随之丢失。
        clearedLineLines.add(lineId)
      }
      break
    }
  }
}

/**
 * 从文档与回放结果派生出"可见行"。
 *
 * 可见行 = `document.lines` 剔除被移除的行，再套上文本覆盖层；
 * 被清空字级的行把 `wordTimestamps` 置空，避免消费方渲染出无意义的字级 chip。
 *
 * @param document 歌词文档
 * @param state 回放结果
 * @returns 可见行数组，保持文档原有顺序
 */
export function deriveVisibleLines(document: LyricDocument, state: ReplayState): LyricLine[] {
  const lines: LyricLine[] = []
  for (const line of document.lines) {
    if (state.removedLineIds.has(line.id)) continue
    const override = state.lineTexts[line.id]
    let next = line
    if (override !== undefined) {
      next = { ...next, text: override.text }
      if (override.translation !== undefined) next.translation = override.translation ?? undefined
      if (override.romanization !== undefined) next.romanization = override.romanization ?? undefined
      if (override.comment !== undefined) next.comment = override.comment ?? undefined
    }
    if (state.clearedWordLines.has(line.id) && next.wordTimestamps.length > 0) {
      next = { ...next, wordTimestamps: [] }
    }
    lines.push(next)
  }
  return lines
}

/**
 * 读取回放结果中某一行的全部行级时间戳。
 *
 * @param state 回放结果
 * @param lineId 行 ID
 * @returns 行级时间戳数组（毫秒），该行未打轴为空数组
 */
export function getReplayedLineTimes(state: ReplayState, lineId: string): number[] {
  return state.lineTimestamps[lineId] ?? []
}

/**
 * 读取回放结果中某一行某一个行级时间戳。
 *
 * @param state 回放结果
 * @param lineId 行 ID
 * @param index 行级时间戳下标，缺省取第一个（主时间戳）
 * @returns 行级时间戳（毫秒），该位置未打轴为 `null`
 */
export function getReplayedLineTime(state: ReplayState, lineId: string, index = 0): number | null {
  const value = state.lineTimestamps[lineId]?.[index]
  return typeof value === 'number' ? value : null
}

/**
 * 读取回放结果中某个字的时间戳。
 *
 * @param state 回放结果
 * @param lineId 行 ID
 * @param wordIndex 字级下标
 * @returns 字级时间戳（毫秒），该字未打轴为 `null`
 */
export function getReplayedWordTime(
  state: ReplayState,
  lineId: string,
  wordIndex: number,
): number | null {
  const value = state.wordTimestamps[wordKey(lineId, wordIndex)]
  return typeof value === 'number' ? value : null
}
