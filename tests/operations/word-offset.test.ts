/**
 * 字级拖拽平移（R3c-1）store Action 测试。
 *
 * 规格：「单向联动」——
 * - 普通平移（非首字，或首字未越界）只改字级，行级不动；
 * - 首字往前拖到早于行级时间时，行级与首字一起拉齐到同一个目标时间。
 *
 * 本文件直接驱动 `useEditorStore`：先用 `importDocument` 注入 mock 文档，
 * 再调 `nudgeWordsByOffset`，最后从 `replay` 读回放结果。
 */

import { describe, expect, test } from 'vitest'
import {
  appendOperation,
  buildBaselineFromDocument,
  createLyricDocument,
  getReplayedLineTime,
  getReplayedWordTime,
  replayOperations,
  type LyricDocument,
  type LyricLine,
  type Timestamp,
  type WordTimestamp,
} from '@core'
import { useEditorStore } from '@ui/stores/editorStore'

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

/**
 * 行级 1000ms，三字 1100 / 2000 / 3000：
 * 首字比行级晚 100ms，正好留出「后移不越界」与「前移可越界」的空间。
 */
function threeWordLine(): LyricLine {
  return makeLine(
    LINE_ID,
    '好天气',
    [word('好', 0, 1, 1100), word('天', 1, 2, 2000), word('气', 2, 3, 3000)],
    [lineTime(1000)],
  )
}

/** 注入文档并返回当前回放。 */
function loadDoc(doc: LyricDocument) {
  useEditorStore.getState().importDocument(doc, 'test.lrc')
  return useEditorStore.getState().replay
}

describe('nudgeWordsByOffset · 普通平移', () => {
  test('a. 非首字平移：行级不变，目标字加偏移，其余字不动', () => {
    loadDoc(makeDoc([threeWordLine()]))

    useEditorStore.getState().nudgeWordsByOffset(LINE_ID, [1], 200)
    const { replay, log } = useEditorStore.getState()

    expect(getReplayedLineTime(replay, LINE_ID)).toBe(1000)
    expect(getReplayedWordTime(replay, LINE_ID, 0)).toBe(1100)
    expect(getReplayedWordTime(replay, LINE_ID, 1)).toBe(2200)
    expect(getReplayedWordTime(replay, LINE_ID, 2)).toBe(3000)
    // 普通平移走 offset，不出现「拉齐行头」的描述
    expect(log.entries.at(-1)?.description).toContain('字级平移「好天气」')
    expect(log.entries.at(-1)?.description).not.toContain('拉齐行头')
  })

  test('b. 首字后移未越界：行级不变，首字加偏移', () => {
    loadDoc(makeDoc([threeWordLine()]))

    useEditorStore.getState().nudgeWordsByOffset(LINE_ID, [0], 300)
    const { replay } = useEditorStore.getState()

    expect(getReplayedLineTime(replay, LINE_ID)).toBe(1000)
    expect(getReplayedWordTime(replay, LINE_ID, 0)).toBe(1400)
    expect(getReplayedWordTime(replay, LINE_ID, 1)).toBe(2000)
  })

  test('c. 首字前移但仍在行级之后：行级不变', () => {
    loadDoc(makeDoc([threeWordLine()]))

    useEditorStore.getState().nudgeWordsByOffset(LINE_ID, [0], -50)
    const { replay } = useEditorStore.getState()

    expect(getReplayedLineTime(replay, LINE_ID)).toBe(1000)
    expect(getReplayedWordTime(replay, LINE_ID, 0)).toBe(1050)
  })
})

describe('nudgeWordsByOffset · 首字越界联动行级', () => {
  test('d. 首字前移到早于行级：行级与首字拉齐到同一个目标时间', () => {
    loadDoc(makeDoc([threeWordLine()]))

    useEditorStore.getState().nudgeWordsByOffset(LINE_ID, [0], -300)
    const { replay, log } = useEditorStore.getState()

    // 1100 - 300 = 800 < 1000，行级被强制拉到 800
    expect(getReplayedLineTime(replay, LINE_ID)).toBe(800)
    expect(getReplayedWordTime(replay, LINE_ID, 0)).toBe(800)
    // 其余字不参与本次拖动，保持原位
    expect(getReplayedWordTime(replay, LINE_ID, 1)).toBe(2000)
    expect(getReplayedWordTime(replay, LINE_ID, 2)).toBe(3000)
    expect(log.entries.at(-1)?.description).toContain('拉齐行头')
  })

  test('e. 多字一起拖且含首字越界：行级拉齐首字，同批其余字按同一偏移平移', () => {
    loadDoc(makeDoc([threeWordLine()]))

    useEditorStore.getState().nudgeWordsByOffset(LINE_ID, [0, 1], -300)
    const { replay } = useEditorStore.getState()

    // 首字 1100 - 300 = 800 < 行级 1000 → 行级与首字拉齐到 800
    expect(getReplayedLineTime(replay, LINE_ID)).toBe(800)
    expect(getReplayedWordTime(replay, LINE_ID, 0)).toBe(800)
    // 同批被拖拽的第二个字也要减 300，不能留在 2000
    expect(getReplayedWordTime(replay, LINE_ID, 1)).toBe(1700)
    // 字 0 / 字 1 的相对差值保持 900ms 不变
    const first = getReplayedWordTime(replay, LINE_ID, 0) as number
    const second = getReplayedWordTime(replay, LINE_ID, 1) as number
    expect(second - first).toBe(900)
    // 未参与本次拖拽的字保持原位
    expect(getReplayedWordTime(replay, LINE_ID, 2)).toBe(3000)
  })
})

describe('nudgeWordsByOffset · 过滤与复位', () => {
  test('f. 无回放时间的字被过滤：只平移有时间的字', () => {
    const doc = makeDoc([threeWordLine()])
    useEditorStore.getState().importDocument(doc, 'test.lrc')

    // 模拟「第二个字已被清空时间」：向 store 注入一条 core 清空记录
    const { document, log } = useEditorStore.getState()
    const clearedLog = appendOperation(log, {
      kind: 'word-timestamp',
      scope: { lineIds: [LINE_ID], wordRefs: [{ lineId: LINE_ID, wordIndex: 1 }], timeRange: null },
      delta: {
        mode: 'absolute',
        values: [{ lineId: LINE_ID, wordIndex: 1, timeMs: null }],
      },
      description: '测试：清空第二个字',
      baseVersion: document.version,
    })
    useEditorStore.setState({
      log: clearedLog,
      replay: replayOperations(clearedLog, buildBaselineFromDocument(document)),
    })

    useEditorStore.getState().nudgeWordsByOffset(LINE_ID, [0, 1], 100)
    const { replay } = useEditorStore.getState()

    expect(getReplayedWordTime(replay, LINE_ID, 0)).toBe(1200)
    // 被清空的字不参与平移，仍为 null
    expect(getReplayedWordTime(replay, LINE_ID, 1)).toBeNull()
    expect(getReplayedWordTime(replay, LINE_ID, 2)).toBe(3000)
  })

  test('g. 全部字都无时间 / delta 为 0 / 非有限值：不写日志', () => {
    loadDoc(makeDoc([threeWordLine()]))
    const before = useEditorStore.getState().log.entries.length

    useEditorStore.getState().nudgeWordsByOffset(LINE_ID, [0, 1], 0)
    useEditorStore.getState().nudgeWordsByOffset(LINE_ID, [0, 1], Number.NaN)
    useEditorStore.getState().nudgeWordsByOffset(LINE_ID, [99, -1], 100)
    useEditorStore.getState().nudgeWordsByOffset('missing_line', [0], 100)

    expect(useEditorStore.getState().log.entries.length).toBe(before)
  })

  test('h. 撤销后字级与行级都复原', () => {
    loadDoc(makeDoc([threeWordLine()]))

    useEditorStore.getState().nudgeWordsByOffset(LINE_ID, [0], -300)
    expect(getReplayedLineTime(useEditorStore.getState().replay, LINE_ID)).toBe(800)

    useEditorStore.getState().undoLastAction()
    const { replay } = useEditorStore.getState()

    expect(getReplayedLineTime(replay, LINE_ID)).toBe(1000)
    expect(getReplayedWordTime(replay, LINE_ID, 0)).toBe(1100)
    expect(getReplayedWordTime(replay, LINE_ID, 1)).toBe(2000)
    expect(getReplayedWordTime(replay, LINE_ID, 2)).toBe(3000)
  })
})
