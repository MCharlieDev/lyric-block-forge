/**
 * 字块切分（R4a 内核契约）落盘与回放测试。
 *
 * 规格：
 * - `commitWordSegments` 只写一条 `word-segments`，直接写绝对值；
 * - 锚点三层回退：行级 → 首字 → 调用方传入的时间轴占位；
 * - 首块 = 锚点，后续 +200ms，越界不封顶；
 * - 撤销一次全退（旧切分、旧字级、补写的行级一并复原）；
 * - 连续两次提交，后者整体覆盖前者。
 */

import { describe, expect, test } from 'vitest'
import {
  deriveVisibleLines,
  getReplayedLineTime,
  getReplayedLineTimes,
  getReplayedWordTime,
  createLyricDocument,
  type LyricDocument,
  type LyricLine,
  type Timestamp,
  type WordSegment,
  type WordTimestamp,
} from '@core'
import { buildExportText, useEditorStore } from '@ui/stores/editorStore'

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

/** 注入文档并返回回放结果。 */
function loadDoc(doc: LyricDocument) {
  useEditorStore.getState().importDocument(doc, 'test.lrc')
  return useEditorStore.getState().replay
}

/** 「你好世界」切成 3 块：你 / 好 / 世界。 */
const THREE_SEGMENTS: WordSegment[] = [
  { start: 0, end: 1, text: '你' },
  { start: 1, end: 2, text: '好' },
  { start: 2, end: 4, text: '世界' },
]

/** 「你好世界」切成 2 块：你好 / 世界。 */
const TWO_SEGMENTS: WordSegment[] = [
  { start: 0, end: 2, text: '你好' },
  { start: 2, end: 4, text: '世界' },
]

/** 读某行在可见行里的字级结构；行不存在返回 null。 */
function visibleWords(lineId: string) {
  const { document, replay } = useEditorStore.getState()
  const line = deriveVisibleLines(document, replay).find((item) => item.id === lineId)
  return line === undefined ? null : line.wordTimestamps
}

/** 读某行第 index 个字的回放时间。 */
function wordTime(lineId: string, index: number) {
  return getReplayedWordTime(useEditorStore.getState().replay, lineId, index)
}

describe('commitWordSegments · 行级锚点', () => {
  test('a. 一条 word-segments，times 从行级时间起算 +200ms，不重写行级', () => {
    loadDoc(makeDoc([makeLine(LINE_ID, '你好世界', [], [lineTime(1000)])]))
    const before = useEditorStore.getState().log.entries.length

    const result = useEditorStore.getState().commitWordSegments(LINE_ID, THREE_SEGMENTS)

    const { log, document, replay } = useEditorStore.getState()
    expect(result).toEqual({ ok: true })
    expect(log.entries.length).toBe(before + 1)
    const entry = log.entries.at(-1)
    expect(entry?.kind).toBe('word-segments')
    const delta = entry?.delta
    if (delta === undefined || delta.mode !== 'word-segments') {
      throw new Error('切分必须落 word-segments')
    }
    expect(delta.times).toEqual([1000, 1200, 1400])
    // 锚点本来就是行级时间：不携带 lineTimeMs
    expect(delta.lineTimeMs).toBeUndefined()
    expect(entry?.scope.lineIds).toEqual([LINE_ID])
    expect(entry?.scope.wordRefs).toEqual([
      { lineId: LINE_ID, wordIndex: 0 },
      { lineId: LINE_ID, wordIndex: 1 },
      { lineId: LINE_ID, wordIndex: 2 },
    ])

    expect([0, 1, 2].map((index) => getReplayedWordTime(replay, LINE_ID, index))).toEqual([
      1000, 1200, 1400,
    ])
    expect(getReplayedLineTimes(replay, LINE_ID)).toEqual([1000])

    expect(deriveVisibleLines(document, replay)[0].wordTimestamps).toEqual([
      {
        kind: 'word',
        timeMs: 1000,
        precisionMs: 1,
        source: 'manual',
        range: { start: 0, end: 1 },
        text: '你',
      },
      {
        kind: 'word',
        timeMs: 1200,
        precisionMs: 1,
        source: 'manual',
        range: { start: 1, end: 2 },
        text: '好',
      },
      {
        kind: 'word',
        timeMs: 1400,
        precisionMs: 1,
        source: 'manual',
        range: { start: 2, end: 4 },
        text: '世界',
      },
    ])
  })

  test('b. 撤销后结构与字级时间完全复原', () => {
    loadDoc(makeDoc([makeLine(LINE_ID, '你好世界', [], [lineTime(1000)])]))
    useEditorStore.getState().commitWordSegments(LINE_ID, THREE_SEGMENTS)
    useEditorStore.getState().undoLastAction()

    expect(visibleWords(LINE_ID)).toEqual([])
    expect([0, 1, 2].map((index) => wordTime(LINE_ID, index))).toEqual([null, null, null])
    expect(getReplayedLineTime(useEditorStore.getState().replay, LINE_ID)).toBe(1000)
  })
})

describe('commitWordSegments · 首字 / 占位锚点', () => {
  test('c. 行级为空、锚点来自首字：补写行级，撤销后行级回到空', () => {
    loadDoc(makeDoc([makeLine(LINE_ID, '你好世界', [word('你', 0, 1, 500)])]))

    const result = useEditorStore.getState().commitWordSegments(LINE_ID, THREE_SEGMENTS)
    const { replay, log } = useEditorStore.getState()
    const delta = log.entries.at(-1)?.delta

    expect(result).toEqual({ ok: true })
    if (delta === undefined || delta.mode !== 'word-segments') {
      throw new Error('切分必须落 word-segments')
    }
    expect(delta.times).toEqual([500, 700, 900])
    expect(delta.lineTimeMs).toBe(500)
    expect(getReplayedLineTime(replay, LINE_ID)).toBe(500)

    useEditorStore.getState().undoLastAction()
    expect(getReplayedLineTime(useEditorStore.getState().replay, LINE_ID)).toBeNull()
    expect(visibleWords(LINE_ID)).toEqual([word('你', 0, 1, 500)])
    expect(wordTime(LINE_ID, 0)).toBe(500)
    expect(wordTime(LINE_ID, 1)).toBeNull()
  })

  test('d. 行级与首字都为空、锚点来自时间轴占位：补写行级，撤销后回到空', () => {
    loadDoc(makeDoc([makeLine(LINE_ID, '你好世界', [])]))

    const result = useEditorStore.getState()
      .commitWordSegments(LINE_ID, THREE_SEGMENTS, { placementStartMs: 2500 })
    const { replay, log } = useEditorStore.getState()
    const delta = log.entries.at(-1)?.delta

    expect(result).toEqual({ ok: true })
    if (delta === undefined || delta.mode !== 'word-segments') {
      throw new Error('切分必须落 word-segments')
    }
    expect(delta.times).toEqual([2500, 2700, 2900])
    expect(delta.lineTimeMs).toBe(2500)
    expect(getReplayedLineTime(replay, LINE_ID)).toBe(2500)

    useEditorStore.getState().undoLastAction()
    expect(getReplayedLineTime(useEditorStore.getState().replay, LINE_ID)).toBeNull()
    expect(wordTime(LINE_ID, 0)).toBeNull()
  })

  test('e. 三层锚点全空：返回 no-anchor，不写日志', () => {
    loadDoc(makeDoc([makeLine(LINE_ID, '你好世界', [])]))
    const before = useEditorStore.getState().log.entries.length

    const result = useEditorStore.getState().commitWordSegments(LINE_ID, THREE_SEGMENTS)

    expect(result).toEqual({ ok: false, reason: 'no-anchor' })
    expect(useEditorStore.getState().log.entries.length).toBe(before)
    expect(useEditorStore.getState().replay.wordSegments).toEqual({})
    expect(visibleWords(LINE_ID)).toEqual([])
  })

  test('f. 行不存在：返回 line-not-found，不写日志', () => {
    loadDoc(makeDoc([makeLine(LINE_ID, '你好世界', [], [lineTime(1000)])]))
    const before = useEditorStore.getState().log.entries.length

    const result = useEditorStore.getState().commitWordSegments('line_missing', THREE_SEGMENTS)

    expect(result).toEqual({ ok: false, reason: 'line-not-found' })
    expect(useEditorStore.getState().log.entries.length).toBe(before)
  })
})

describe('commitWordSegments · 覆盖与撤销', () => {
  test('g. 连续两次提交：后者覆盖前者，逐次撤销回到上一步', () => {
    loadDoc(makeDoc([makeLine(LINE_ID, '你好世界', [], [lineTime(1000)])]))

    useEditorStore.getState().commitWordSegments(LINE_ID, THREE_SEGMENTS)
    useEditorStore.getState().commitWordSegments(LINE_ID, TWO_SEGMENTS)

    expect(visibleWords(LINE_ID)?.map((item) => item.text)).toEqual(['你好', '世界'])
    expect([0, 1, 2].map((index) => wordTime(LINE_ID, index))).toEqual([1000, 1200, null])

    useEditorStore.getState().undoLastAction()
    expect(visibleWords(LINE_ID)?.map((item) => item.text)).toEqual(['你', '好', '世界'])
    expect([0, 1, 2].map((index) => wordTime(LINE_ID, index))).toEqual([1000, 1200, 1400])

    useEditorStore.getState().undoLastAction()
    expect(visibleWords(LINE_ID)).toEqual([])
    expect([0, 1, 2].map((index) => wordTime(LINE_ID, index))).toEqual([null, null, null])
    expect(getReplayedLineTime(useEditorStore.getState().replay, LINE_ID)).toBe(1000)
  })

  test('h. 已有切分与时间的行再提交：旧结构整体替换，撤销回到旧结构', () => {
    loadDoc(
      makeDoc([
        makeLine(LINE_ID, '你好世界', [word('你', 0, 1, 1100), word('好', 1, 2, 1200)], [lineTime(1000)]),
      ]),
    )

    useEditorStore.getState().commitWordSegments(LINE_ID, THREE_SEGMENTS)
    expect(visibleWords(LINE_ID)?.map((item) => item.text)).toEqual(['你', '好', '世界'])
    expect([0, 1, 2].map((index) => wordTime(LINE_ID, index))).toEqual([1000, 1200, 1400])

    useEditorStore.getState().undoLastAction()
    expect(visibleWords(LINE_ID)).toEqual([word('你', 0, 1, 1100), word('好', 1, 2, 1200)])
    expect([0, 1, 2].map((index) => wordTime(LINE_ID, index))).toEqual([1100, 1200, null])
  })
})

describe('commitWordSegments · 调用方指定 times', () => {
  test('k. times 合法：直接落用户值，不再按锚点 +200ms 生成', () => {
    loadDoc(makeDoc([makeLine(LINE_ID, '你好世界', [], [lineTime(1000)])]))
    const before = useEditorStore.getState().log.entries.length

    const result = useEditorStore
      .getState()
      .commitWordSegments(LINE_ID, THREE_SEGMENTS, { times: [1500, 3200, 9800] })

    const { log, document, replay } = useEditorStore.getState()
    const delta = log.entries.at(-1)?.delta
    expect(result).toEqual({ ok: true })
    if (delta === undefined || delta.mode !== 'word-segments') {
      throw new Error('切分必须落 word-segments')
    }
    expect(log.entries.length).toBe(before + 1)
    expect(delta.times).toEqual([1500, 3200, 9800])
    // 锚点本来就是行级时间：仍不携带 lineTimeMs
    expect(delta.lineTimeMs).toBeUndefined()
    expect([0, 1, 2].map((index) => getReplayedWordTime(replay, LINE_ID, index))).toEqual([
      1500, 3200, 9800,
    ])
    expect(deriveVisibleLines(document, replay)[0].wordTimestamps.map((item) => item.timeMs)).toEqual(
      [1500, 3200, 9800],
    )
  })

  test('l. times 长度与块数不符：invalid-times，不写日志', () => {
    loadDoc(makeDoc([makeLine(LINE_ID, '你好世界', [], [lineTime(1000)])]))
    const before = useEditorStore.getState().log.entries.length

    const result = useEditorStore
      .getState()
      .commitWordSegments(LINE_ID, THREE_SEGMENTS, { times: [1500, 3200] })

    expect(result).toEqual({ ok: false, reason: 'invalid-times' })
    expect(useEditorStore.getState().log.entries.length).toBe(before)
    expect(useEditorStore.getState().replay.wordSegments).toEqual({})
    expect(visibleWords(LINE_ID)).toEqual([])
  })

  test('m. times 含 NaN 或负数：invalid-times，不写日志', () => {
    loadDoc(makeDoc([makeLine(LINE_ID, '你好世界', [], [lineTime(1000)])]))

    const nanResult = useEditorStore
      .getState()
      .commitWordSegments(LINE_ID, THREE_SEGMENTS, { times: [1500, Number.NaN, 9800] })
    expect(nanResult).toEqual({ ok: false, reason: 'invalid-times' })

    const before = useEditorStore.getState().log.entries.length
    const negativeResult = useEditorStore
      .getState()
      .commitWordSegments(LINE_ID, THREE_SEGMENTS, { times: [1500, 3200, -1] })
    expect(negativeResult).toEqual({ ok: false, reason: 'invalid-times' })
    expect(useEditorStore.getState().log.entries.length).toBe(before)
    expect(useEditorStore.getState().replay.wordSegments).toEqual({})
  })

  test('n. 传 times 且锚点来自首字：撤销一次后切分、时间与补写行级全部回退', () => {
    loadDoc(makeDoc([makeLine(LINE_ID, '你好世界', [word('你', 0, 1, 500)])]))

    const result = useEditorStore
      .getState()
      .commitWordSegments(LINE_ID, THREE_SEGMENTS, { times: [500, 3000, 4500] })
    const { replay, log } = useEditorStore.getState()
    const delta = log.entries.at(-1)?.delta

    expect(result).toEqual({ ok: true })
    if (delta === undefined || delta.mode !== 'word-segments') {
      throw new Error('切分必须落 word-segments')
    }
    expect(delta.times).toEqual([500, 3000, 4500])
    expect(delta.lineTimeMs).toBe(500)
    expect(getReplayedLineTime(replay, LINE_ID)).toBe(500)
    expect([0, 1, 2].map((index) => getReplayedWordTime(replay, LINE_ID, index))).toEqual([
      500, 3000, 4500,
    ])

    useEditorStore.getState().undoLastAction()
    expect(getReplayedLineTime(useEditorStore.getState().replay, LINE_ID)).toBeNull()
    expect(visibleWords(LINE_ID)).toEqual([word('你', 0, 1, 500)])
    expect(wordTime(LINE_ID, 0)).toBe(500)
    expect(wordTime(LINE_ID, 1)).toBeNull()
  })
})

describe('commitWordSegments · 导出', () => {
  test('i. 切割后导出逐块字级标签', () => {
    loadDoc(makeDoc([makeLine(LINE_ID, '你好世界', [], [lineTime(1000)])]))
    useEditorStore.getState().commitWordSegments(LINE_ID, THREE_SEGMENTS)
    const { document, replay } = useEditorStore.getState()

    expect(buildExportText(document, replay, 10)).toBe(
      '[00:01.00]<00:01.00>你<00:01.20>好<00:01.40>世界\n',
    )
  })

  test('j. 占位锚点补行级后，导出含行级标签', () => {
    loadDoc(makeDoc([makeLine(LINE_ID, '你好世界', [])]))
    useEditorStore.getState().commitWordSegments(LINE_ID, THREE_SEGMENTS, { placementStartMs: 2500 })
    const { document, replay } = useEditorStore.getState()

    expect(buildExportText(document, replay, 10)).toBe(
      '[00:02.50]<00:02.50>你<00:02.70>好<00:02.90>世界\n',
    )
  })
})
