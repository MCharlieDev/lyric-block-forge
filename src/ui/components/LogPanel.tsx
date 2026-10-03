import { useEffect, useMemo, useRef } from 'react'
import { getLifecycleHistory, type OperationDelta, type OperationLogEntry, type OperationKind } from '@core'
import {
  ARCHIVED_DISPLAY_LABEL,
  LOG_TAB_EMPTY_HINT,
  LOG_TABS,
  OPERATION_KIND_LABEL,
  OPERATION_STATUS_LABEL,
} from '../labels'
import { selectVisibleEntries, useEditorStore, type ArchivedDisplay } from '../stores/editorStore'
import { formatLogTime, formatOffset, formatTimecode } from '../utils/format'
import { PanelFrame } from './PanelFrame'

/**
 * 日志面板：一份**工作日志**。
 *
 * 五个页签：总 / 修改 / 报错 / 已归档 / 忽略。
 *
 * 模型要点：日志里**只有修改记录**。撤销与恢复不产生新条目，
 * 只是把原记录的状态在"生效中 / 已撤销"之间翻转，并追加一条生命周期事件。
 * 因此：
 * - "修改"页签只看生效中的修改；
 * - "已归档"页签装被撤销的原始修改记录本身，展开可看完整详情并恢复；
 * - "总"页签里已撤销的记录按开关显示为细行 / 隐藏 / 正常，
 *   点细行不跳时间轴，而是跳到"已归档"并展开那条记录。
 *
 * "报错 / 忽略"页签等待校验层接入。
 */

export function LogPanel() {
  const log = useEditorStore((state) => state.log)
  const logView = useEditorStore((state) => state.logView)
  const selectedEntryIds = useEditorStore((state) => state.selection.entryIds)
  const setLogTab = useEditorStore((state) => state.setLogTab)
  const setArchivedDisplay = useEditorStore((state) => state.setArchivedDisplay)
  const patchLogFilter = useEditorStore((state) => state.patchLogFilter)
  const toggleEntrySelection = useEditorStore((state) => state.toggleEntrySelection)
  const clearEntrySelection = useEditorStore((state) => state.clearEntrySelection)
  const toggleEntryExpanded = useEditorStore((state) => state.toggleEntryExpanded)
  const openArchivedEntry = useEditorStore((state) => state.openArchivedEntry)
  const undoLastAction = useEditorStore((state) => state.undoLastAction)
  const undoSelectedEntries = useEditorStore((state) => state.undoSelectedEntries)
  const restoreSelectedEntries = useEditorStore((state) => state.restoreSelectedEntries)
  // 注意：不能写成 useEditorStore(selectVisibleEntries)。
  // selector 每次都会返回新数组引用，会触发 useSyncExternalStore 的快照缓存警告。
  const entries = useMemo(() => selectVisibleEntries(log, logView), [log, logView])

  const listRef = useRef<HTMLDivElement>(null)
  const activeKinds = Array.from(new Set(log.entries.map((entry) => entry.kind)))
  const statusFilter = logView.filter.statuses?.[0] ?? 'all'
  const isArchivedTab = logView.tab === 'archived'

  // 从"总"页签细行跳过来时滚动定位一次，避免记录在长列表里看不见。
  // 焦点高亮会一直保留到切页签，这样用户能看清到底跳到了哪一条。
  useEffect(() => {
    if (!logView.focusEntryId) return
    const node = listRef.current?.querySelector(`[data-entry-id="${logView.focusEntryId}"]`)
    if (node instanceof HTMLElement) node.scrollIntoView({ block: 'nearest' })
  }, [logView.focusEntryId])

  return (
    <PanelFrame
      title="工作日志"
      hint="随文档保存"
      className="flex-1"
      actions={
        <button
          type="button"
          onClick={undoLastAction}
          className="rounded border border-divider px-2 py-0.5 text-[11px] text-neutral-300 hover:border-accent/60 hover:text-accent"
        >
          撤销最后一条
        </button>
      }
    >
      <div className="flex h-full flex-col">
        {/* 页签 */}
        <nav className="flex shrink-0 gap-px border-b border-divider px-2 pt-2">
          {LOG_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setLogTab(tab.id)}
              className={`rounded-t px-2.5 py-1 text-[11px] ${
                logView.tab === tab.id
                  ? 'bg-canvas text-neutral-100'
                  : 'text-neutral-500 hover:text-neutral-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {/* 筛选区 */}
        <div className="shrink-0 space-y-1.5 border-b border-divider px-2 py-2">
          <div className="flex items-center gap-1">
            <span className="w-10 text-[11px] text-neutral-600">状态</span>
            {(['all', 'active', 'undone'] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() =>
                  patchLogFilter({ statuses: value === 'all' ? undefined : [value] })
                }
                className={`rounded px-1.5 py-0.5 text-[11px] ${
                  statusFilter === value
                    ? 'bg-accent/20 text-accent'
                    : 'text-neutral-500 hover:text-neutral-300'
                }`}
              >
                {value === 'all' ? '全部' : value === 'active' ? '只看生效' : '只看已撤销'}
              </button>
            ))}
          </div>

          {/* 只有"总"页签同时装着生效与已撤销两种记录，才需要这个显示模式开关 */}
          {logView.tab === 'all' ? (
            <div className="flex items-center gap-1">
              <span className="w-10 text-[11px] text-neutral-600">已撤销</span>
              {(['thin', 'hidden', 'normal'] as const).map((mode: ArchivedDisplay) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setArchivedDisplay(mode)}
                  className={`rounded px-1.5 py-0.5 text-[11px] ${
                    logView.archivedDisplay === mode
                      ? 'bg-accent/20 text-accent'
                      : 'text-neutral-500 hover:text-neutral-300'
                  }`}
                >
                  {ARCHIVED_DISPLAY_LABEL[mode]}
                </button>
              ))}
            </div>
          ) : null}

          <div className="flex items-start gap-1">
            <span className="w-10 shrink-0 pt-0.5 text-[11px] text-neutral-600">类型</span>
            <div className="flex flex-wrap gap-1">
              <button
                type="button"
                onClick={() => patchLogFilter({ kinds: undefined })}
                className={`rounded px-1.5 py-0.5 text-[11px] ${
                  logView.filter.kinds ? 'text-neutral-500 hover:text-neutral-300' : 'bg-accent/20 text-accent'
                }`}
              >
                全部
              </button>
              {activeKinds.map((kind: OperationKind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => patchLogFilter({ kinds: [kind] })}
                  className={`rounded px-1.5 py-0.5 text-[11px] ${
                    logView.filter.kinds?.includes(kind)
                      ? 'bg-accent/20 text-accent'
                      : 'text-neutral-500 hover:text-neutral-300'
                  }`}
                >
                  {OPERATION_KIND_LABEL[kind]}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 列表 */}
        <div ref={listRef} className="min-h-0 flex-1 overflow-auto">
          {entries.length === 0 ? (
            <p className="px-3 py-6 text-center text-[11px] text-neutral-600">
              {LOG_TAB_EMPTY_HINT[logView.tab]}
            </p>
          ) : (
            <ul className="divide-y divide-divider/50">
              {entries.map((entry) => (
                <LogEntryRow
                  key={entry.id}
                  entry={entry}
                  archivedTab={isArchivedTab}
                  thin={
                    logView.tab === 'all' &&
                    entry.status === 'undone' &&
                    logView.archivedDisplay === 'thin'
                  }
                  selected={selectedEntryIds.includes(entry.id)}
                  highlighted={logView.focusEntryId === entry.id}
                  expanded={logView.expandedEntryIds.includes(entry.id)}
                  onToggleSelect={() => toggleEntrySelection(entry.id)}
                  onToggleExpand={() => toggleEntryExpanded(entry.id)}
                  onOpenArchived={() => openArchivedEntry(entry.id)}
                />
              ))}
            </ul>
          )}
        </div>

        {/* 批量操作 */}
        <div className="flex shrink-0 items-center gap-2 border-t border-divider px-2 py-2">
          <span className="text-[11px] text-neutral-600">已选 {selectedEntryIds.length} 条</span>
          {isArchivedTab ? (
            <button
              type="button"
              disabled={selectedEntryIds.length === 0}
              onClick={restoreSelectedEntries}
              className="rounded border border-divider px-2 py-0.5 text-[11px] text-neutral-300 enabled:hover:border-accent/60 enabled:hover:text-accent disabled:opacity-40"
            >
              恢复所选
            </button>
          ) : (
            <button
              type="button"
              disabled={selectedEntryIds.length === 0}
              onClick={undoSelectedEntries}
              className="rounded border border-divider px-2 py-0.5 text-[11px] text-neutral-300 enabled:hover:border-accent/60 enabled:hover:text-accent disabled:opacity-40"
            >
              批量撤销
            </button>
          )}
          {selectedEntryIds.length > 0 ? (
            <button
              type="button"
              onClick={clearEntrySelection}
              className="text-[11px] text-neutral-600 hover:text-neutral-400"
            >
              清空选择
            </button>
          ) : null}
        </div>
      </div>
    </PanelFrame>
  )
}

/** 单条日志记录属性。 */
interface LogEntryRowProps {
  /** 日志记录 */
  entry: OperationLogEntry
  /** 是否处于"已归档"页签（那里的记录一定都是已撤销的） */
  archivedTab: boolean
  /** 是否渲染成"总"页签里的细行 */
  thin: boolean
  /** 是否被勾选 */
  selected: boolean
  /** 是否为刚跳转过来的焦点记录 */
  highlighted: boolean
  /** 是否展开详情 */
  expanded: boolean
  /** 切换勾选 */
  onToggleSelect: () => void
  /** 切换展开 */
  onToggleExpand: () => void
  /** 跳到"已归档"页签并展开 */
  onOpenArchived: () => void
}

/**
 * 单条日志记录。
 *
 * 三种形态：
 * - 细行（"总"页签里的已撤销记录）：只有时间、动作类型与"已撤销"，点击跳到"已归档"；
 * - 折叠行：标题行 + 描述 + 时间，点击展开；
 * - 展开行：额外显示影响范围、原变化量与状态历史。
 */
function LogEntryRow({
  entry,
  archivedTab,
  thin,
  selected,
  highlighted,
  expanded,
  onToggleSelect,
  onToggleExpand,
  onOpenArchived,
}: LogEntryRowProps) {
  const undone = entry.status === 'undone'

  if (thin) {
    return (
      <li data-entry-id={entry.id}>
        <button
          type="button"
          onClick={onOpenArchived}
          className="flex w-full items-center gap-2 py-0.5 pl-3 pr-2 text-left text-[10px] text-neutral-600 hover:text-neutral-400"
        >
          <span className="font-mono">{formatLogTime(entry.createdAt)}</span>
          <span>{OPERATION_KIND_LABEL[entry.kind]}</span>
          <span className="text-neutral-700">已撤销 · 点击到已归档查看</span>
        </button>
      </li>
    )
  }

  const offset = entry.delta.mode === 'offset' ? formatOffset(entry.delta.offsetMs) : null
  const history = getLifecycleHistory(entry)

  return (
    <li
      data-entry-id={entry.id}
      className={`px-2 py-1.5 ${undone && !archivedTab ? 'opacity-45' : ''} ${
        highlighted ? 'bg-accent/10' : ''
      }`}
    >
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          className="mt-1 h-3 w-3 shrink-0 accent-accent"
        />
        <button type="button" onClick={onToggleExpand} className="min-w-0 flex-1 text-left">
          <div className="flex items-center gap-1.5">
            <span className="rounded bg-white/5 px-1 py-px text-[10px] text-neutral-400">
              {OPERATION_KIND_LABEL[entry.kind]}
            </span>
            {entry.isMajor ? (
              <span className="rounded bg-amber-500/15 px-1 py-px text-[10px] text-amber-400">重大</span>
            ) : null}
            {offset ? <span className="font-mono text-[10px] text-neutral-500">{offset}</span> : null}
            {undone ? (
              <span className="rounded bg-white/5 px-1 py-px text-[10px] text-neutral-500">
                {OPERATION_STATUS_LABEL.undone}
              </span>
            ) : null}
            <span className="ml-auto text-[10px] text-neutral-700">{expanded ? '收起' : '详情'}</span>
          </div>
          <p className="mt-0.5 truncate text-[11px] text-neutral-300">{entry.description}</p>
          <p className="text-[10px] text-neutral-600">
            {formatLogTime(entry.createdAt)}
            {entry.scope.lineIds.length > 0 ? ` · 影响 ${entry.scope.lineIds.length} 行` : ''}
            {entry.scope.wordRefs.length > 0 ? ` · 影响 ${entry.scope.wordRefs.length} 字` : ''}
          </p>
        </button>
      </div>

      {expanded ? (
        <div className="mt-1.5 space-y-0.5 rounded bg-white/[0.03] px-2 py-1.5 pl-6 text-[10px] text-neutral-500">
          <p>
            原操作类型：<span className="text-neutral-400">{OPERATION_KIND_LABEL[entry.kind]}</span>
          </p>
          <p>
            影响范围：
            <span className="text-neutral-400">
              {describeScope(entry)}
            </span>
          </p>
          <p>
            原变化量：<span className="font-mono text-neutral-400">{describeDelta(entry.delta)}</span>
          </p>
          <p>
            当前状态：<span className="text-neutral-400">{OPERATION_STATUS_LABEL[entry.status]}</span>
          </p>
          {history.length > 0 ? (
            <p className="text-neutral-600">
              {history
                .map(
                  (event) =>
                    `于 ${formatLogTime(event.at)} ${event.type === 'undone' ? '撤销' : '恢复'}`,
                )
                .join(' / ')}
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

/** 把影响范围说成一句中文。 */
function describeScope(entry: OperationLogEntry): string {
  const parts: string[] = []
  if (entry.scope.lineIds.length > 0) parts.push(`${entry.scope.lineIds.length} 行`)
  if (entry.scope.wordRefs.length > 0) parts.push(`${entry.scope.wordRefs.length} 个字`)
  return parts.length > 0 ? parts.join('、') : '全篇 / 无具体行'
}

/** 把变化量渲染成可读文本。 */
function describeDelta(delta: OperationDelta): string {
  switch (delta.mode) {
    case 'offset':
      return formatOffset(delta.offsetMs)
    case 'absolute':
      return delta.values
        .map((value) => {
          if (value.wordIndex === null) return `行 → ${formatTimecode(value.timeMs)}`
          // 字级记录优先显示词组文本（wordText 只用于展示，不参与回放）；
          // 老记录 / 其它来源没有这个字段，回退成"第 N 字"
          const target =
            value.wordText !== undefined && value.wordText !== ''
              ? `「${value.wordText}」`
              : `第 ${value.wordIndex + 1} 字`
          return `${target} → ${formatTimecode(value.timeMs)}`
        })
        .join('、')
    case 'clear-timestamps':
      return '清空时间戳'
    case 'none':
    default:
      return '无时间变化'
  }
}
