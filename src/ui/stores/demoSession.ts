import {
  appendOperation,
  createLyricDocument,
  createLyricLine,
  createOperationLog,
  restoreEntries,
  undoEntries,
  type EditScope,
  type LyricDocument,
  type LyricLine,
  type OperationLog,
  type WordTimestamp,
} from '@core'

/**
 * 骨架阶段的演示数据。
 *
 * 目的只有一个：让日志引擎与回放模型可以被肉眼验证 ——
 * 文档里的行**不带**行级时间戳，所有行级时间都来自操作日志回放，
 * 因此撤销 / 恢复的效果会直接反映到左侧歌词块上。
 *
 * 日志里**只有修改记录**：演示数据末尾对"手动微调"做了
 * 撤销 → 恢复 → 再撤销，用来验证生命周期历史与"已归档"页签，
 * 这一过程不会增加任何新记录。
 */

/** 演示歌词。四行都是"未打轴"状态，时间由操作日志产生。 */
const DEMO_LINES: Array<{ text: string; timeMs: number; words?: Array<{ text: string; timeMs: number }> }> = [
  {
    text: '夜色渐深 风穿过长街',
    timeMs: 12000,
    words: [
      { text: '夜色渐深', timeMs: 12000 },
      { text: '风穿过长街', timeMs: 13600 },
    ],
  },
  { text: '我把名字写在车窗上', timeMs: 16500 },
  { text: '路灯一盏一盏地数着', timeMs: 21200 },
  { text: '未说完的话都留在原地', timeMs: 25800 },
]

/** 被演示"撤销 → 恢复 → 再撤销"的那条记录 ID。 */
const DEMO_NUDGE_ENTRY_ID = 'op-demo-manual-nudge'

/**
 * 给一行挂上字级时间戳，文本区间按累加长度计算。
 *
 * @param line 目标行
 * @param words 字级内容与时间
 * @returns 挂好字级时间戳的新行
 */
function withWords(line: LyricLine, words: Array<{ text: string; timeMs: number }>): LyricLine {
  let cursor = 0
  const wordTimestamps: WordTimestamp[] = words.map((word) => {
    const start = cursor
    cursor += word.text.length
    return {
      kind: 'word',
      timeMs: word.timeMs,
      precisionMs: 10,
      range: { start, end: cursor },
      source: 'import',
      text: word.text,
    }
  })
  return { ...line, wordTimestamps }
}

/** 构造一个完整的编辑范围。 */
function scope(lineIds: string[] = [], wordRefs: EditScope['wordRefs'] = []): EditScope {
  return { lineIds, wordRefs, timeRange: null }
}

/**
 * 创建演示会话：一份文档 + 一段带类型的操作日志。
 *
 * @returns 文档与日志
 */
export function createDemoSession(): { document: LyricDocument; log: OperationLog } {
  const lines = DEMO_LINES.map((item) => {
    const line = createLyricLine(item.text)
    return item.words ? withWords(line, item.words) : line
  })

  const document = createLyricDocument({
    meta: { title: '演示曲目', artist: '演示演唱者', lyricist: '演示作词' },
    lines,
    format: { detectedFormat: 'lrc' },
  })

  const allLineIds = lines.map((line) => line.id)
  let tick = Date.now() - 30 * 60 * 1000
  const now = (): number => (tick += 60 * 1000)

  let log = createOperationLog(document.id)

  log = appendOperation(
    log,
    {
      kind: 'import',
      scope: scope(allLineIds),
      delta: { mode: 'none' },
      description: `导入 demo.lrc（${lines.length} 行）`,
      baseVersion: 0,
    },
    now,
  )

  lines.forEach((line, index) => {
    log = appendOperation(
      log,
      {
        kind: 'manual-timestamp',
        scope: scope([line.id]),
        delta: {
          mode: 'absolute',
          values: [{ lineId: line.id, wordIndex: null, timeMs: DEMO_LINES[index].timeMs }],
        },
        description: `手动打轴：第 ${index + 1} 行 → ${DEMO_LINES[index].timeMs}ms`,
        baseVersion: 0,
      },
      now,
    )
  })

  log = appendOperation(
    log,
    {
      kind: 'global-offset',
      scope: scope(allLineIds),
      delta: { mode: 'offset', offsetMs: 120 },
      description: '整体移动：全篇 +120ms',
      baseVersion: 0,
    },
    now,
  )

  log = appendOperation(
    log,
    {
      id: DEMO_NUDGE_ENTRY_ID,
      kind: 'manual-nudge',
      scope: scope([lines[1].id]),
      delta: { mode: 'offset', offsetMs: -30 },
      description: '手动微调：第 2 行 -30ms',
      baseVersion: 0,
    },
    now,
  )

  log = appendOperation(
    log,
    {
      kind: 'frequency-nudge',
      scope: scope([], [{ lineId: lines[0].id, wordIndex: 0 }]),
      delta: { mode: 'offset', offsetMs: 8 },
      description: '频率微调：第 1 行首字 +8ms',
      baseVersion: 0,
    },
    now,
  )

  log = appendOperation(
    log,
    {
      kind: 'selection-offset',
      scope: scope([lines[1].id, lines[2].id]),
      delta: { mode: 'offset', offsetMs: 50 },
      description: '多选移动：第 2、3 行 +50ms',
      baseVersion: 0,
    },
    now,
  )

  // 演示：撤销 → 恢复 → 再撤销。全程不产生新记录，只在这条记录上追加生命周期事件。
  log = undoEntries(log, [DEMO_NUDGE_ENTRY_ID], now)
  log = restoreEntries(log, [DEMO_NUDGE_ENTRY_ID], now)
  log = undoEntries(log, [DEMO_NUDGE_ENTRY_ID], now)

  return { document, log }
}
