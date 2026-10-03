import type { TextRange } from './common'

/**
 * 时间戳种类。
 * - `line`：行级时间戳，决定整行歌词何时高亮。
 * - `word`：字级时间戳，决定行内某个字/词的起始时间。
 * - `range`：区间时间戳，用于人声段、间奏段等有起止的分析结果。
 */
export type TimestampKind = 'line' | 'word' | 'range'

/**
 * 时间戳来源，用于区分"人打的"和"机器猜的"。
 * 建议层产出的结果在被用户确认前不得伪装成 `manual`。
 */
export type TimestampSource =
  /** 用户手动输入或按键打轴 */
  | 'manual'
  /** 用户拖动歌词块产生 */
  | 'drag'
  /** 整体偏移 / 多选偏移批量平移产生 */
  | 'offset'
  /** 音频分析（频率微调 / 人声边界）产生，已确认 */
  | 'audio-analysis'
  /** 从文件中解析得到 */
  | 'import'

/**
 * 时间戳模型。
 *
 * 一个 `Timestamp` 描述"某个对象在音频中的时间位置"，对象是谁由
 * `kind` + 所在载体（`LyricLine` 或 `WordTimestamp`）共同决定。
 */
export interface Timestamp {
  /** 时间戳种类 */
  kind: TimestampKind
  /** 时间值，内部统一毫秒整数 */
  timeMs: number
  /**
   * 精度（毫秒）。表示该时间戳在业务上可信到哪个粒度，
   * 例如人声边界识别通常是 100ms 级，频率微调可到 1~10ms 级。
   */
  precisionMs: number
  /** 关联的文本区间；行级 / 区间级时间戳可为空 */
  range?: TextRange
  /** 时间戳来源 */
  source: TimestampSource
}

/**
 * 字级时间戳。字级时间戳必须落在行文本的某一段上，因此 `range` 必填。
 */
export interface WordTimestamp extends Timestamp {
  /** 字级时间戳只可能是 `word` */
  kind: 'word'
  /** 该字/词在行文本中的范围 */
  range: TextRange
  /** 该字/词对应的文本内容，便于脱离原文单独渲染与搜索 */
  text: string
}
