import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { getReplayedLineTimes, getReplayedWordTime, type LyricLine } from '@core'
import { selectVisibleLines, useEditorStore } from '../stores/editorStore'
import { formatTimecode } from '../utils/format'
import { LineActionIcon } from './LineActionIcons'
import { LineActionSheet, type LineActionItem } from './LineActionSheet'
import { PanelFrame } from './PanelFrame'

/**
 * 收窄断点 —— 量的是**歌词列表面板自身**的宽度，不是视口宽度。
 *
 * 行内固定开销（px 计）：左内边距 12 + 序号 24 + 时间列 80 + 热区内 3 个 gap 共 36
 * + 标签列 33~95 + 按钮组 148（5 × 28 + 4 × 2）+ 右侧留白 ~16，
 * 合计约 350~410；低于 440 时文本列会被挤到没法读，因此收窄。
 * 这是临时值，等真机测试后再调，不写死在行内。
 */
export const PANEL_NARROW_WIDTH_PX = 440

/**
 * 从节点向上找到最近的纵向滚动容器。
 *
 * 滚动容器是 PanelFrame 内部的 `overflow-auto` 节点，且没有 `position: relative`，
 * 因此不能用 `offsetTop`（它相对的是不确定的 offsetParent）。这里按计算样式识别，
 * 不依赖具体的 Tailwind 类名。
 */
function findScrollParent(element: HTMLElement): HTMLElement | null {
  let node = element.parentElement
  while (node !== null) {
    const overflowY = getComputedStyle(node).overflowY
    if (overflowY === 'auto' || overflowY === 'scroll') return node
    node = node.parentElement
  }
  return null
}

/**
 * 歌词块面板。
 *
 * 交互设计（架构文档 §6.3）：拖动歌词块比输入时间戳直观得多。
 * - 拖动行级 → 字级时间戳整体平移，保持相对间距；
 * - 拖动字级 → 只改该字起始时间，非法位置直接阻止；
 * - 拖动过程中不写日志，**松手时才生成一条**操作记录。
 *
 * 行内操作（本轮）：每行右侧五个按钮 —— 上移 / 下移 / 新建 / 删除 / ⋮。
 * 前四个在空间足够时外显；面板收窄到 {@link PANEL_NARROW_WIDTH_PX} 以下时只留 ⋮，
 * 前四个收进 ⋮ 打开的弹窗底部（弹窗底部**永远**有这四个，与外显与否无关）。
 * 「行编辑」⌄ 弹窗的内容是下一轮（B-UI-2）的事。
 */
export function LyricBlockPanel() {
  const document = useEditorStore((state) => state.document)
  const replay = useEditorStore((state) => state.replay)
  // 订阅的是 document / replay 两个稳定引用，派生放在 useMemo 里：
  // 直接订阅派生结果会每次返回新数组，导致无限重渲染
  const lines = useMemo(() => selectVisibleLines(document, replay), [document, replay])
  const activeLineId = useEditorStore((state) => state.selection.activeLineId)
  // 订阅 lineIds 原始引用（store 变更时才换新数组），Set 派生放 useMemo：
  // 在 selector 里新建 Set 会每次返回新引用，导致无限重渲染
  const selectedLineIds = useEditorStore((state) => state.selection.lineIds)
  const selectedLineIdSet = useMemo(() => new Set(selectedLineIds), [selectedLineIds])
  const selectLine = useEditorStore((state) => state.selectLine)
  const toggleLineSelection = useEditorStore((state) => state.toggleLineSelection)
  const selectLineRange = useEditorStore((state) => state.selectLineRange)
  const swapLineText = useEditorStore((state) => state.swapLineText)
  const removeLine = useEditorStore((state) => state.removeLine)
  const appendBlankLine = useEditorStore((state) => state.appendBlankLine)

  // 行节点表：activeLineId 变化时据此定位目标行
  const itemRefs = useRef(new Map<string, HTMLLIElement>())
  // 观测列表自身宽度（见 PANEL_NARROW_WIDTH_PX 注释：面板宽度 ≠ 视口宽度）
  const listRef = useRef<HTMLUListElement | null>(null)
  const [narrow, setNarrow] = useState(false)

  // ⋮ 弹窗：只记"哪一行"，行本身由 sheetLineId 推导出目标行与行号
  const [sheetLineId, setSheetLineId] = useState<string | null>(null)
  // 触发当前弹窗的 ⋮ 按钮：关闭后把焦点还回去（同层有多个 ⋮，只能靠事件源定位）
  const sheetTriggerRef = useRef<HTMLButtonElement | null>(null)
  // 关闭的唯一出口：四条关闭路径（Esc / × / 遮罩 / 操作与取消保存）都经过它。
  // 行被删后按钮已卸载 → isConnected 为假，自动跳过（不是额外分支，是不变量）。
  const closeSheet = useCallback(() => {
    setSheetLineId(null)
    const trigger = sheetTriggerRef.current
    if (trigger !== null && trigger.isConnected) trigger.focus()
  }, [])

  // 断点判定：用 ResizeObserver 测面板自身宽度。
  // 不用 CSS 媒体查询 —— 媒体查询量的是视口，而右侧日志面板可收起 / 展开
  // （w-80 ↔ w-9），视口宽度不变时歌词面板宽度会变。
  useLayoutEffect(() => {
    const list = listRef.current
    if (list === null) return
    const observer = new ResizeObserver((entries) => {
      setNarrow((entries[0]?.contentRect.width ?? 0) < PANEL_NARROW_WIDTH_PX)
    })
    observer.observe(list)
    return () => observer.disconnect()
  }, [])

  // 选中的歌词块在时间轴被点击后，把列表滚到对应行并垂直居中。
  // 只依赖 activeLineId：不监听 scroll 事件，因此不会打断用户的手动滚动。
  // 新建行后也是靠这条路径把新行滚到可见。
  useEffect(() => {
    if (activeLineId === null) return
    const row = itemRefs.current.get(activeLineId)
    if (row === undefined) return
    const container = findScrollParent(row)
    if (container === null) return

    const containerRect = container.getBoundingClientRect()
    const rowRect = row.getBoundingClientRect()
    const rowHeight = rowRect.height
    // 相对量代替 offsetTop：offsetParent 不可靠。
    // 夹到 [0, maxTop] 后，靠近两端时自然贴边，不会滚出空白。
    const desired = container.scrollTop + (rowRect.top - containerRect.top) - (container.clientHeight - rowHeight) / 2
    const maxTop = container.scrollHeight - container.clientHeight
    const target = Math.min(Math.max(desired, 0), maxTop)

    // 已在居中位置附近（偏差不足一行高）→ 不动，避免点击面板自身行时抖动
    if (Math.abs(target - container.scrollTop) < rowHeight) return

    container.scrollTo({ top: target, behavior: 'smooth' })
  }, [activeLineId])

  /** 组装一行的四个操作。上移 / 下移的禁用态按**可见行下标**判断。 */
  const buildActions = (line: LyricLine, index: number): LineActionItem[] => [
    {
      key: 'move-up',
      label: '上移',
      // 用可见行下标：删除会让可见行变少，用 document 下标判断会错位
      disabled: index === 0,
      onSelect: () => {
        const previous = lines[index - 1]
        if (previous !== undefined) swapLineText(line.id, previous.id)
      },
    },
    {
      key: 'move-down',
      label: '下移',
      disabled: index === lines.length - 1,
      onSelect: () => {
        const next = lines[index + 1]
        if (next !== undefined) swapLineText(line.id, next.id)
      },
    },
    {
      key: 'insert',
      label: '新建',
      onSelect: () => {
        // 插到被点击的这一行下方，并把新行选中（滚动到可见由上方的 effect 负责）
        const newLineId = appendBlankLine('', line.id)
        selectLine(newLineId)
      },
    },
    {
      key: 'delete',
      label: '删除',
      // 不做二次确认：删除可撤销（选中态漂移由 store 的 removeLine 处理）
      onSelect: () => removeLine(line.id),
    },
  ]

  const sheetLine = sheetLineId === null ? null : lines.find((line) => line.id === sheetLineId) ?? null
  const sheetIndex = sheetLine === null ? -1 : lines.findIndex((line) => line.id === sheetLine.id)

  // 弹窗指向的行被删掉 / 被撤销掉时立刻关闭，避免弹窗挂在一个不存在的行上
  useEffect(() => {
    if (sheetLineId !== null && sheetLine === null) closeSheet()
  }, [sheetLineId, sheetLine, closeSheet])

  return (
    <>
      <PanelFrame
        title="歌词块"
        hint="一行多时间戳 / 双语合并后的翻译随主文本一起移动；占位 · 拖动未接入"
        className="flex-1"
        actions={<span className="text-[11px] text-neutral-500">共 {lines.length} 行</span>}
      >
        <ul ref={listRef} className="divide-y divide-divider/60">
          {lines.map((line, index) => {
            const times = getReplayedLineTimes(replay, line.id)
            const isActive = line.id === activeLineId
            const inSelection = selectedLineIdSet.has(line.id)
            const actions = buildActions(line, index)
            const tags: string[] = []
            if (times.length > 1) tags.push(`行级×${times.length}`)
            else if (times.length === 1) tags.push('行级')
            if (line.wordTimestamps.length > 0) tags.push('字级')
            if (line.translation !== undefined) tags.push('双语')
            return (
              <li
                key={line.id}
                ref={(element) => {
                  if (element === null) itemRefs.current.delete(line.id)
                  else itemRefs.current.set(line.id, element)
                }}
                className={`transition-colors ${
                  isActive ? 'bg-accent/10' : inSelection ? 'bg-accent/5' : 'hover:bg-white/5'
                }`}
              >
                {/*
                  行根必须是 div 而不是 button：右侧要嵌独立 button，
                  而 button 不能嵌套 button（HTML 规范，浏览器行为未定义）。
                  文本热区保留 role=button + tabIndex + Enter/Space，补回键盘可达性。
                */}
                <div className="flex items-start">
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={(event) => {
                      // 修饰键分派：Shift 范围选 > Ctrl/Cmd 切换 > 普通单选
                      if (event.shiftKey) selectLineRange(line.id)
                      else if (event.ctrlKey || event.metaKey) toggleLineSelection(line.id)
                      else selectLine(line.id)
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return
                      event.preventDefault()
                      selectLine(line.id)
                    }}
                    className="flex min-w-0 flex-1 cursor-pointer items-start gap-3 px-3 py-2"
                  >
                    <span className="w-6 shrink-0 pt-0.5 text-right text-[11px] text-neutral-600">
                      {index + 1}
                    </span>
                    <span className="w-20 shrink-0 pt-0.5 font-mono text-[11px] text-neutral-400">
                      {times.length === 0 ? (
                        <span className="block">--:--.--</span>
                      ) : (
                        times.map((timeMs, timeIndex) => (
                          <span key={`${line.id}-t${timeIndex}`} className="block">
                            {formatTimecode(timeMs)}
                          </span>
                        ))
                      )}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-neutral-100">{line.text}</span>

                      {line.translation !== undefined ? (
                        <span className="mt-0.5 block truncate text-xs text-neutral-400">
                          {line.translation}
                        </span>
                      ) : null}

                      {line.romanization !== undefined ? (
                        <span className="mt-0.5 block truncate text-xs text-neutral-500">
                          {line.romanization}
                        </span>
                      ) : null}

                      {line.wordTimestamps.length > 0 ? (
                        <span className="mt-1 flex flex-wrap gap-1">
                          {line.wordTimestamps.map((word, wordIndex) => {
                            const wordMs = getReplayedWordTime(replay, line.id, wordIndex)
                            return (
                              <span
                                key={`${line.id}-${wordIndex}`}
                                className="rounded border border-divider px-1.5 py-0.5 text-[11px] text-neutral-400"
                              >
                                {word.text}
                                <span className="ml-1 font-mono text-neutral-600">
                                  {wordMs === null ? '--' : wordMs}
                                </span>
                              </span>
                            )
                          })}
                        </span>
                      ) : null}
                    </span>

                    {/* 收窄态隐藏标签列：条件不渲染（而非 visibility / opacity），不占布局宽度 */}
                    {narrow ? null : (
                      <span className="shrink-0 pt-0.5 text-[11px] text-neutral-600">
                        {tags.length > 0 ? tags.join(' + ') : '未打轴'}
                      </span>
                    )}
                  </div>

                  {/* 前四个按钮：空间足够才外显；收窄时它们只存在于 ⋮ 弹窗底部 */}
                  {narrow ? null : (
                    <div className="flex shrink-0 items-center gap-0.5 py-2 pr-2">
                      {actions.map((action) => (
                        <button
                          key={action.key}
                          type="button"
                          disabled={action.disabled === true}
                          aria-label={action.label}
                          title={action.label}
                          onClick={action.onSelect}
                          className="flex h-7 w-7 items-center justify-center rounded text-neutral-400 transition-colors hover:bg-white/10 hover:text-neutral-100 disabled:cursor-not-allowed disabled:text-neutral-700 disabled:hover:bg-transparent"
                        >
                          <LineActionIcon name={action.key} />
                        </button>
                      ))}
                    </div>
                  )}

                  {/* ⋮ 永远外显 */}
                  <div className="shrink-0 py-2 pr-2">
                    <button
                      type="button"
                      aria-label="行操作"
                      title="行操作"
                      aria-haspopup="menu"
                      aria-expanded={sheetLineId === line.id}
                      onClick={(event) => {
                        sheetTriggerRef.current = event.currentTarget
                        setSheetLineId(line.id)
                      }}
                      className="flex h-7 w-7 items-center justify-center rounded text-neutral-400 transition-colors hover:bg-white/10 hover:text-neutral-100"
                    >
                      <LineActionIcon name="more" />
                    </button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>

        {/* 空状态：与时间轴空状态同字号、同色阶；文案是引导式而非陈述式 */}
        {lines.length === 0 ? (
          <div className="flex flex-col items-center gap-1 px-6 py-10 text-center">
            <span className="text-[11px] text-neutral-600">还没有歌词</span>
            <span className="text-[11px] text-neutral-600">
              试试导入 LRC、从剪贴板粘贴，或手动输入
            </span>
          </div>
        ) : null}
      </PanelFrame>

      <LineActionSheet
        line={sheetLine}
        lineIndex={sheetIndex}
        items={sheetLine === null ? [] : buildActions(sheetLine, sheetIndex)}
        onClose={closeSheet}
      />
    </>
  )
}
