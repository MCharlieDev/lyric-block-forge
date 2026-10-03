import type {
  EditScope,
  OperationKind,
  OperationLifecycleEvent,
  OperationLifecycleEventType,
  OperationLog,
  OperationLogDraft,
  OperationLogEntry,
  OperationLogFilter,
  OperationStatus,
} from '../types'
import { createId } from '../utils/id'

/** 日志结构版本，用于将来迁移。 */
export const OPERATION_LOG_SCHEMA_VERSION = 1

/**
 * 仅记录、不提供撤销的操作类型白名单。
 *
 * 这类操作写进日志是为了留痕（"这份文档从哪来"），但没有可回退的目标：
 * 撤销一次导入并不会回到上一份文档。键为操作类型，值恒为 `true`；
 * 用字符串键是为了预留尚未纳入 `OperationKind` 的类型（如 `'new-line'`），
 * 不必为了预留而扩展核心类型。
 */
const NON_REVERTABLE_KINDS: Readonly<Record<string, true>> = {
  import: true,
  // 预留：新建空白行。当前实现直接改文档、不进日志，因此这条白名单暂时用不上，
  // 保留是为了将来若改为"进日志但不给撤销"时零成本接入。
  'new-line': true,
}

/**
 * 该类型的操作是否可撤销。
 *
 * @param kind 操作类型
 * @returns 可撤销为 `true`；仅记录类（导入等）为 `false`
 */
export function isRevertable(kind: OperationKind): boolean {
  return NON_REVERTABLE_KINDS[kind] !== true
}

/**
 * 判断一次操作是否属于"重大改变"。
 *
 * 重大改变在 UI 上必须弹窗提示（影响哪些行、变化量、撤销后能否恢复）；
 * 单行手动打轴、单行手动微调不弹窗，直接进日志。
 *
 * @param kind 操作类型
 * @param scope 影响范围
 * @returns 是否为重大改变
 */
export function isMajorChange(kind: OperationKind, scope: EditScope): boolean {
  switch (kind) {
    case 'global-offset':
    case 'selection-offset':
      return true
    case 'frequency-nudge':
      // 单条频率微调不弹窗，批量应用才弹窗
      return scope.lineIds.length > 1 || scope.wordRefs.length > 1
    default:
      return false
  }
}

/**
 * 读取一条记录的生命周期历史（不含创建事件）。
 *
 * 撤销与恢复都可反复发生，UI 用它渲染
 * 「于 12:30:22 撤销 / 于 12:35:10 恢复」这类小字。
 *
 * @param entry 日志记录
 * @returns 创建之后的全部状态变化事件，按时间先后排列
 */
export function getLifecycleHistory(entry: OperationLogEntry): OperationLifecycleEvent[] {
  return entry.lifecycle.filter((event) => event.type !== 'created')
}

/**
 * 在记录上追加一次状态变化事件，并同步 `status`。
 *
 * 这是撤销 / 恢复**唯一**的写入方式：不改记录数量，只改这条记录自身。
 *
 * @param entry 原记录
 * @param type 事件类型
 * @param at 事件时间
 * @returns 追加后的新记录
 */
function applyLifecycleEvent(
  entry: OperationLogEntry,
  type: Exclude<OperationLifecycleEventType, 'created'>,
  at: number,
): OperationLogEntry {
  return {
    ...entry,
    status: (type === 'undone' ? 'undone' : 'active') as OperationStatus,
    lifecycle: [...entry.lifecycle, { type, at }],
  }
}

/**
 * 创建一份空日志。每个文档独立一份，随文档保存。
 *
 * @param documentId 所属文档 ID
 * @param entries 初始记录（例如从持久化中恢复）
 * @returns 新的操作日志
 */
export function createOperationLog(
  documentId: string,
  entries: OperationLogEntry[] = [],
): OperationLog {
  return {
    documentId,
    entries: [...entries],
    schemaVersion: OPERATION_LOG_SCHEMA_VERSION,
  }
}

/**
 * 追加一条操作记录。
 *
 * 这是**唯一**允许写入修改的入口：所有编辑动作都要先经过这里，
 * 再由 {@link replayOperations} 回放得到最新时间戳。
 *
 * @param log 原日志
 * @param draft 记录内容，ID / 时间 / 状态由本函数补齐
 * @param now 当前时间提供函数，便于测试注入
 * @returns 追加后的新日志（不可变更新）
 */
export function appendOperation(
  log: OperationLog,
  draft: OperationLogDraft,
  now: () => number = Date.now,
): OperationLog {
  const at = draft.createdAt ?? now()
  const entry: OperationLogEntry = {
    ...draft,
    id: draft.id ?? createId('op'),
    createdAt: at,
    isMajor: draft.isMajor ?? isMajorChange(draft.kind, draft.scope),
    status: 'active',
    lifecycle: [{ type: 'created', at }],
  }
  return { ...log, entries: [...log.entries, entry] }
}

/**
 * 撤销最后一条生效中**且可撤销**的记录。
 *
 * 仅记录类（如导入）会被跳过，继续往前找 —— 它没有可回退的目标。
 *
 * @param log 原日志
 * @param now 当前时间提供函数
 * @returns 撤销后的新日志；无可撤销记录时原样返回
 */
export function undoLast(log: OperationLog, now: () => number = Date.now): OperationLog {
  const last = [...log.entries]
    .reverse()
    .find((entry) => entry.status === 'active' && isRevertable(entry.kind))
  if (!last) return log
  return undoEntries(log, [last.id], now)
}

/**
 * 按类型撤销：把指定类型下**所有生效中**的记录一次性退掉。
 *
 * 对应"分级回退"：例如只想退掉所有音频分析带来的频率微调，
 * 而保留作者手动打的轴。仅记录类（如导入）不在此列。
 *
 * @param log 原日志
 * @param kind 目标操作类型
 * @param now 当前时间提供函数
 * @returns 撤销后的新日志
 */
export function undoByKind(
  log: OperationLog,
  kind: OperationKind,
  now: () => number = Date.now,
): OperationLog {
  const ids = log.entries
    .filter((entry) => entry.kind === kind && entry.status === 'active')
    .map((entry) => entry.id)
  if (ids.length === 0) return log
  return undoEntries(log, ids, now)
}

/**
 * 撤销指定的一批记录（支持多选批量撤销）。
 *
 * 每条记录各自独立变为"已撤销"，并各自追加一条 `undone` 生命周期事件；
 * 不产生任何新记录，日志长度不变。已在撤销状态、不存在、或属于仅记录类
 * （{@link isRevertable} 为 `false`，如导入）的 ID 被忽略。
 *
 * @param log 原日志
 * @param entryIds 目标记录 ID 集合
 * @param now 当前时间提供函数
 * @returns 撤销后的新日志
 */
export function undoEntries(
  log: OperationLog,
  entryIds: string[],
  now: () => number = Date.now,
): OperationLog {
  const targetIds = new Set(entryIds)
  const at = now()
  let changed = false
  const entries = log.entries.map((entry) => {
    if (!targetIds.has(entry.id)) return entry
    if (entry.status !== 'active') return entry
    // 仅记录类没有可回退的目标，逐条兜底，防止绕过 undoLast 的入口
    if (!isRevertable(entry.kind)) return entry
    changed = true
    return applyLifecycleEvent(entry, 'undone', at)
  })
  if (!changed) return log
  return { ...log, entries }
}

/**
 * 恢复所选：把已撤销的记录重新生效。
 *
 * 同样只改这条记录自身的状态，并追加一条 `restored` 事件，
 * 不产生新记录；效果通过回放体现。
 *
 * @param log 原日志
 * @param entryIds 目标记录 ID 集合
 * @param now 当前时间提供函数
 * @returns 恢复后的新日志
 */
export function restoreEntries(
  log: OperationLog,
  entryIds: string[],
  now: () => number = Date.now,
): OperationLog {
  const targetIds = new Set(entryIds)
  const at = now()
  let changed = false
  const entries = log.entries.map((entry) => {
    if (!targetIds.has(entry.id)) return entry
    if (entry.status !== 'undone') return entry
    changed = true
    return applyLifecycleEvent(entry, 'restored', at)
  })
  if (!changed) return log
  return { ...log, entries }
}

/**
 * 按条件筛选日志记录。
 *
 * 对应日志面板的筛选区：只看生效 / 只看已撤销 / 按类型 / 按行 / 按时间段 / 关键词搜索。
 * 返回的是原记录引用，调用方不应就地修改。
 *
 * @param log 日志
 * @param filter 筛选条件，字段之间为"与"关系
 * @returns 命中的记录列表，保持原有时间顺序
 */
export function filterEntries(log: OperationLog, filter: OperationLogFilter = {}): OperationLogEntry[] {
  const keyword = filter.keyword?.trim().toLowerCase()
  return log.entries.filter((entry) => {
    if (filter.statuses && filter.statuses.length > 0 && !filter.statuses.includes(entry.status)) {
      return false
    }
    if (filter.kinds && filter.kinds.length > 0 && !filter.kinds.includes(entry.kind)) {
      return false
    }
    if (filter.lineIds && filter.lineIds.length > 0) {
      const hit = entry.scope.lineIds.some((lineId) => filter.lineIds?.includes(lineId))
      if (!hit) return false
    }
    if (typeof filter.fromMs === 'number' && entry.createdAt < filter.fromMs) return false
    if (typeof filter.toMs === 'number' && entry.createdAt > filter.toMs) return false
    if (keyword && !entry.description.toLowerCase().includes(keyword)) return false
    return true
  })
}

/**
 * 按类型统计生效中的记录数量，用于日志面板的类型筛选 chips。
 *
 * @param log 日志
 * @returns 类型到数量的映射，只包含出现过的类型
 */
export function countActiveByKind(log: OperationLog): Partial<Record<OperationKind, number>> {
  const result: Partial<Record<OperationKind, number>> = {}
  for (const entry of log.entries) {
    if (entry.status !== 'active') continue
    result[entry.kind] = (result[entry.kind] ?? 0) + 1
  }
  return result
}

/**
 * 列出日志中出现过、且**可撤销**的操作类型，供"按类型撤销"选择。
 *
 * 仅记录类（如导入）不在此列 —— 它不出现在"分级回退"的可选项里。
 *
 * @param log 日志
 * @returns 去重后的类型列表（保持首次出现顺序）
 */
export function listRevertableKinds(log: OperationLog): OperationKind[] {
  const kinds: OperationKind[] = []
  for (const entry of log.entries) {
    if (!isRevertable(entry.kind)) continue
    if (!kinds.includes(entry.kind)) kinds.push(entry.kind)
  }
  return kinds
}

/**
 * 列出已归档的记录（已撤销的那些）。
 * 日志面板的"已归档"页签展示这些内容，可被恢复。
 *
 * @param log 日志
 * @returns 已撤销记录列表
 */
export function listUndoneEntries(log: OperationLog): OperationLogEntry[] {
  return log.entries.filter((entry) => entry.status === 'undone')
}

/**
 * 按 ID 查找记录。
 *
 * @param log 日志
 * @param entryId 记录 ID
 * @returns 命中的记录，未找到为 `null`
 */
export function getEntry(log: OperationLog, entryId: string): OperationLogEntry | null {
  return log.entries.find((entry) => entry.id === entryId) ?? null
}
