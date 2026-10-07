/**
 * 字级时间戳清空（P2-Y · B 段第 1 轮）core 回放测试。
 *
 * 规格：`absolute` 模式的 `timeMs` 放宽为 `number | null` 后，
 * 字级（`wordIndex !== null`）的 `null` 表示「清空该字时间」——
 * 回放层用「删除该字的字级键」表达，`getReplayedWordTime` 随之返回 `null`。
 * 切分（`WordTimestamp.text` / `range`）不在回放层，删键不影响它；
 * 撤销只改记录状态、重新回放即可复原，无需保存旧值。
 *
 * 本文件只测 core 层纯函数，不触及 UI / 导出。导出侧对空字仍会输出
 * `NaN` 垃圾（serialize.renderWords 未改），属第 2 轮范围，不在本测试内。
 */

import { describe, expect, test } from 'vitest'
import {
  appendOperation,
  buildBaselineFromDocument,
  createLyricDocument,
  createOperationLog,
  deriveVisibleLines,
  getReplayedLineTimes,
  getReplayedWordTime,
  replayOperations,
  undoLast,
  type EditScope,
  type LyricDocument,
  type LyricLine,
  type OperationDelta,
  type Timestamp,
  type WordTimestamp,
} from '@core'

const LINE_ID = 'line_1'

/** 造一个行级时间戳。 */
function lineTime(timeMs: number): Timestamp {
  return { kind: 'line', timeMs, precisionMs: 1, source: 'manual' }
}

/** 造一个字级时间戳（带切分 range 与 text）。 */
function word(text: string, start: number, end: number, timeMs: number): WordTimestamp {
  return { kind: 'word', timeMs, precisionMs: 1, source: 'manual', range: { start, end }, text }
}

/** 造一条歌词行。 */
function makeLine(
  id: string,
  text: string,
  wordTimestamps: WordTimestamp[],
  timestamps: Timestamp[] = [],
): LyricLine {
  return { id, text, timestamps, wordTimestamps, role: 'main', status: 'normal' }
}

/** 造一份只含给定行的文档。 */
function makeDoc(lines: LyricLine[]): LyricDocument {
  return createLyricDocument({ id: 'doc_1', lines })
}

/** 造一条字级「绝对值」记录并追加到空日志。 */
function logWithAbsolute(
  values: { wordIndex: number | null; timeMs: number | null; wordText?: string }[],
  deltaOverride?: OperationDelta,
): ReturnType<typeof appendOperation> {
  const scope: EditScope = {
    lineIds: [LINE_ID],
    wordRefs: values
      .filter((value) => value.wordIndex !== null)
      .map((value) => ({ lineId: LINE_ID, wordIndex: value.wordIndex as number })),
    timeRange: null,
  }
  const delta: OperationDelta =
    deltaOverride ?? {
      mode: 'absolute',
      values: values.map((value) => ({
        lineId: LINE_ID,
        wordIndex: value.wordIndex,
        timeMs: value.timeMs,
        wordText: value.wordText,
      })),
    }
  return appendOperation(createOperationLog('doc_1'), {
    kind: 'word-timestamp',
    scope,
    delta,
    description: '测试记录',
    baseVersion: 0,
  })
}

/** 三个字「好天气」，时间 1000 / 2000 / 3000。 */
function threeWordLine(): LyricLine {
  return makeLine(LINE_ID, '好天气', [word('好', 0, 1, 1000), word('天', 1, 2, 2000), word('气', 2, 3, 3000)])
}

describe('字级时间戳清空 · 回放', () => {
  test('a. 清空字级时间：回放后该字为 null，其它字不受影响', () => {
    const doc = makeDoc([threeWordLine()])
    const baseline = buildBaselineFromDocument(doc)

    // 清空前该字可读
    const before = replayOperations(createOperationLog('doc_1'), baseline)
    expect(getReplayedWordTime(before, LINE_ID, 1)).toBe(2000)

    const log = logWithAbsolute([{ wordIndex: 1, timeMs: null, wordText: '天' }])
    const state = replayOperations(log, baseline)
    expect(getReplayedWordTime(state, LINE_ID, 1)).toBeNull()
    expect(getReplayedWordTime(state, LINE_ID, 0)).toBe(1000)
    expect(getReplayedWordTime(state, LINE_ID, 2)).toBe(3000)
  })

  test('b. 切分守恒：清空只删时间键，不动数组长度 / range / text', () => {
    const doc = makeDoc([threeWordLine()])
    const baseline = buildBaselineFromDocument(doc)
    const log = logWithAbsolute([{ wordIndex: 1, timeMs: null, wordText: '天' }])
    const state = replayOperations(log, baseline)

    // 可见行仍带着完整切分：清字级不写 clearedWordLines，deriveVisibleLines 不抹数组
    const visible = deriveVisibleLines(doc, state).find((line) => line.id === LINE_ID)
    expect(visible).toBeDefined()
    expect(visible?.wordTimestamps).toHaveLength(3)
    expect(visible?.wordTimestamps.map((item) => item.text)).toEqual(['好', '天', '气'])
    expect(visible?.wordTimestamps.map((item) => item.range)).toEqual([
      { start: 0, end: 1 },
      { start: 1, end: 2 },
      { start: 2, end: 3 },
    ])

    // 回放不就地改文档：原行对象依旧完整
    expect(doc.lines[0].wordTimestamps).toHaveLength(3)
  })

  test('c. 撤销后该字时间复原（重新回放）', () => {
    const doc = makeDoc([threeWordLine()])
    const baseline = buildBaselineFromDocument(doc)
    const log = logWithAbsolute([{ wordIndex: 1, timeMs: null, wordText: '天' }])

    const cleared = replayOperations(log, baseline)
    expect(getReplayedWordTime(cleared, LINE_ID, 1)).toBeNull()

    const undone = undoLast(log)
    const restored = replayOperations(undone, baseline)
    expect(getReplayedWordTime(restored, LINE_ID, 1)).toBe(2000)
  })

  test('d. 单条记录内混合「设值 + 清空」多个字', () => {
    const doc = makeDoc([threeWordLine()])
    const baseline = buildBaselineFromDocument(doc)
    const log = logWithAbsolute([
      { wordIndex: 0, timeMs: 1500, wordText: '好' },
      { wordIndex: 2, timeMs: null, wordText: '气' },
    ])
    const state = replayOperations(log, baseline)

    expect(getReplayedWordTime(state, LINE_ID, 0)).toBe(1500) // 设值生效
    expect(getReplayedWordTime(state, LINE_ID, 1)).toBe(2000) // 未提及，保持基线
    expect(getReplayedWordTime(state, LINE_ID, 2)).toBeNull() // 清空生效
  })

  test('e. 行级（wordIndex===null）配 timeMs===null 被忽略，不抛错、不产生 NaN', () => {
    const doc = makeDoc([makeLine(LINE_ID, '好天气', [], [lineTime(5000)])])
    const baseline = buildBaselineFromDocument(doc)
    const log = logWithAbsolute([{ wordIndex: null, timeMs: null }])

    let state: ReturnType<typeof replayOperations> | undefined
    expect(() => {
      state = replayOperations(log, baseline)
    }).not.toThrow()

    // 行级时间保持基线原值，未被 null 污染
    expect(state && getReplayedLineTimes(state, LINE_ID)).toEqual([5000])
  })
})
