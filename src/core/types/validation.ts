import type { EditScope } from './scope'

/**
 * 校验问题严重程度。
 * - `error`：必定导致播放器显示异常，例如时间倒置
 * - `warning`：可能异常或影响观感，例如两行时间过近
 * - `info`：提示性信息，例如未知标签已原样保留
 */
export type ValidationSeverity = 'error' | 'warning' | 'info'

/**
 * 校验问题类型。校验层独立于文档与建议层：
 * 只读取文档、输出问题列表，绝不直接修改文档。
 */
export type ValidationKind =
  /** 时间倒置：字级时间戳早于行级时间戳 */
  | 'timestamp-inverted'
  /** 时间戳缺失：有文本但未打轴 */
  | 'timestamp-missing'
  /** 时间重复：多行起始时间完全相同 */
  | 'timestamp-duplicate'
  /** 字级越界：字级时间戳超出所在行的时间区间 */
  | 'word-out-of-line'
  /** 行重叠：与前一行时间区间重叠 */
  | 'line-overlap'
  /** 字重叠：同行内相邻字时间顺序错误 */
  | 'word-overlap'
  /** 编码问题：检测失败或与预设不一致 */
  | 'encoding'
  /** 未知标签：已原样保留，导出会写回 */
  | 'unknown-tag'
  /** 双语冲突：同一行的翻译/罗马音归属不明确 */
  | 'bilingual-conflict'

/**
 * 校验问题状态。
 * - `pending`：待处理
 * - `fixed`：已修复（归档到"已归档"页签）
 * - `ignored`：已忽略（归档到"忽略"页签）
 */
export type ValidationIssueStatus = 'pending' | 'fixed' | 'ignored'

/**
 * 建议的修复方式。校验层只给方案，实际写入由用户点击后走操作日志完成。
 */
export interface SuggestedFix {
  /** 修复方案 ID */
  id: string
  /** 展示文案，例如"将第 12 行时间戳提前到第 11 行之后" */
  label: string
  /**
   * 机器可执行的修复参数，结构由 `ValidationKind` 决定。
   * 缺省为 `null` 表示该修复需要用户手工处理。
   */
  payload: unknown
}

/**
 * 校验问题记录。同时也是日志面板"报错"页签的数据来源。
 */
export interface ValidationIssue {
  /** 问题唯一 ID */
  id: string
  /** 问题类型 */
  kind: ValidationKind
  /** 严重程度 */
  severity: ValidationSeverity
  /** 影响范围 */
  scope: EditScope
  /** 面向用户的问题描述 */
  message: string
  /** 可选的修复方案列表 */
  suggestedFixes: SuggestedFix[]
  /** 当前状态 */
  status: ValidationIssueStatus
  /** 发现时间（毫秒时间戳） */
  createdAt: number
  /** 发现该问题时的文档版本号，用于判断问题是否已过期 */
  detectedAtVersion: number
  /** 处理（修复或忽略）时间，未处理为 `null` */
  resolvedAt: number | null
}
