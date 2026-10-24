/**
 * 行首拖动（推土机）落盘语义测试。
 *
 * 轨道在 `line-start` 会话松手时复用 `stampLine`：一条 `manual-timestamp` +
 * `absolute`，`values` 只含行级项（`wordIndex: null`），字级时间戳不动；
 * 撤销一步即可复原行首。本文件只从 store 层确认这两条契约，
 * 几何（框动字不动）由 harness BE 组在真实浏览器里验证。
 */

import { describe, expect, test } from 'vitest'
import {
  createLyricDocument,
  getReplayedLineTime,
  getReplayedWordTime,
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

/** 行级 1000ms、三字 1100 / 2000 / 3000：首字比行级晚 100ms，可验证行首独立变化。 */
function threeWordLine(): LyricLine {
  return makeLine(
    LINE_ID,
    '好天气',
    [word('好', 0, 1, 1100), word('天', 1, 2, 2000), word('气', 2, 3, 3000)],
    [lineTime(1000)],
  )
}

/** 注入文档并返回回放结果。 */
function loadDoc(doc: LyricDocument) {
  useEditorStore.getState().importDocument(doc, 'test.lrc')
  return useEditorStore.getState().replay
}

/** 读三个字级时间的数组，便于整体比较「全程未变」。 */
function readWords() {
  const { replay } = useEditorStore.getState()
  return [0, 1, 2].map((index) => getReplayedWordTime(replay, LINE_ID, index))
}

describe('stampLine · 行首拖动落盘', () => {
  test('a. 一条 manual-timestamp / absolute，values 只含行级项', () => {
    const replay0 = loadDoc(makeDoc([threeWordLine()]))
    const wordsBefore = [0, 1, 2].map((index) => getReplayedWordTime(replay0, LINE_ID, index))
    const before = useEditorStore.getState().log.entries.length

    useEditorStore.getState().stampLine(LINE_ID, 1500)
    const { log, replay } = useEditorStore.getState()
    const entry = log.entries.at(-1)

    expect(log.entries.length).toBe(before + 1)
    expect(entry?.kind).toBe('manual-timestamp')
    const delta = entry?.delta
    if (delta === undefined || delta.mode !== 'absolute') {
      throw new Error('行首拖动必须落 absolute（offset 会连带全部字级）')
    }
    // 只写行级项：wordIndex === null，且不夹带任何字级值
    expect(delta.values).toHaveLength(1)
    expect(delta.values[0]).toEqual({ lineId: LINE_ID, wordIndex: null, timeMs: 1500 })
    expect(getReplayedLineTime(replay, LINE_ID)).toBe(1500)
    expect(readWords()).toEqual(wordsBefore)
  })

  test('b. 撤销一步复原行首，字级时间戳全程未动', () => {
    loadDoc(makeDoc([threeWordLine()]))
    const wordsBefore = readWords()

    useEditorStore.getState().stampLine(LINE_ID, 2500)
    expect(getReplayedLineTime(useEditorStore.getState().replay, LINE_ID)).toBe(2500)
    expect(readWords()).toEqual(wordsBefore)

    useEditorStore.getState().undoLastAction()
    expect(getReplayedLineTime(useEditorStore.getState().replay, LINE_ID)).toBe(1000)
    expect(readWords()).toEqual(wordsBefore)
  })
})
