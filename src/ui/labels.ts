import type { OperationKind } from '@core'
import type { LogTab } from './stores/editorStore'

/** 操作类型的中文标签，直接显示在日志面板上。 */
export const OPERATION_KIND_LABEL: Record<OperationKind, string> = {
  'manual-timestamp': '手动打轴',
  'global-offset': '整体移动',
  'selection-offset': '多选移动',
  'manual-nudge': '手动微调',
  'word-timestamp': '字级微调',
  'word-segments': '字级切分',
  'frequency-nudge': '频率微调',
  'vocal-boundary-edit': '人声边界修正',
  'text-edit': '文本编辑',
  'swap-line-text': '上下移行',
  'remove-line': '删除行',
  'metadata-edit': '元数据编辑',
  import: '导入',
}

/** 日志记录状态的中文标签。 */
export const OPERATION_STATUS_LABEL: Record<'active' | 'undone', string> = {
  active: '生效中',
  undone: '已撤销',
}

/** "总"页签里已撤销记录（已归档记录）的显示模式。 */
export const ARCHIVED_DISPLAY_LABEL: Record<'thin' | 'hidden' | 'normal', string> = {
  thin: '细行',
  hidden: '隐藏',
  normal: '正常',
}

/** 日志面板页签定义，顺序即展示顺序。 */
export const LOG_TABS: Array<{ id: LogTab; label: string }> = [
  { id: 'all', label: '总' },
  { id: 'edits', label: '修改' },
  { id: 'issues', label: '报错' },
  { id: 'archived', label: '已归档' },
  { id: 'ignored', label: '忽略' },
]

/** 各页签为空时的提示文案。 */
export const LOG_TAB_EMPTY_HINT: Record<LogTab, string> = {
  all: '暂无操作记录',
  edits: '暂无修改记录',
  issues: '暂无报错记录（校验层尚未接入）',
  archived: '暂无已归档记录；被撤销的修改记录会归档到这里，可随时恢复',
  ignored: '暂无被忽略的报错',
}
