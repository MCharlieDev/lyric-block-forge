import type { EditScope } from './scope'

/**
 * 建议类型。自动化产出（识别器、音频分析）一律先进入建议层，
 * 用户确认后才转成操作日志写入文档 —— 建议层不直接改文档。
 */
export type SuggestionKind =
  /** 元数据前缀识别（演唱者 / 作词 / 作曲等介绍行） */
  | 'metadata-prefix'
  /** 双语识别与合并 */
  | 'bilingual-merge'
  /** 非标准时间戳格式识别 */
  | 'timestamp-format'
  /** 结构识别（段落、空行、注释） */
  | 'structure'
  /** 人声边界识别结果 */
  | 'vocal-boundary'
  /** 频率微调结果 */
  | 'frequency-nudge'
  /** 编码检测结果 */
  | 'encoding'

/**
 * 建议状态。
 * - `pending`：等待用户处理
 * - `accepted`：已接受并写入文档
 * - `rejected`：已拒绝
 * - `ignored`：已忽略（批量忽略全部）
 */
export type SuggestionStatus = 'pending' | 'accepted' | 'rejected' | 'ignored'

/**
 * 单条建议。
 *
 * 置信度决定交互方式：高置信度允许"一键全部接受"，
 * 低置信度必须逐条确认。
 */
export interface Suggestion {
  /** 建议唯一 ID */
  id: string
  /** 建议类型 */
  kind: SuggestionKind
  /** 影响范围 */
  scope: EditScope
  /** 建议值，结构由 `kind` 决定，由消费方按类型收窄 */
  suggestedValue: unknown
  /** 置信度，取值区间 `[0, 1]` */
  confidence: number
  /** 当前状态 */
  status: SuggestionStatus
  /** 面向用户的说明，解释为什么给出这条建议 */
  reason: string
  /** 建议产生时间（毫秒时间戳） */
  createdAt: number
  /** 用户处理该建议的时间，未处理为 `null` */
  resolvedAt: number | null
}
