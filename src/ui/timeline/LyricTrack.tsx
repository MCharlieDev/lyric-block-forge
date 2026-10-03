import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { getReplayedLineTimes, getReplayedWordTime, type LyricLine } from '@core'
import {
  DEFAULT_BLOCK_MS,
  DRAG_MIN_DELTA_MS,
  DRAG_THRESHOLD_PX,
  GRID_SNAP_BUFFER_PX,
  LABEL_MIN_GAP_PX,
  LYRIC_ROW_COUNT,
  LYRIC_ROW_HEIGHT_PX,
  LYRIC_TRACK_HEIGHT_PX,
  ROW_ASSIGN_GAP_PX,
  SNAP_PX,
} from './constants'
import { LyricBlock, lyricBlockWidthPx, type SelectModifiers } from './LyricBlock'
import { adaptiveGridMs } from './timeMap'
import { lineIsMovable, selectVisibleLines, useEditorStore } from '../stores/editorStore'
import { useSettingsStore } from '../stores/settingsStore'
import { showToast } from '../stores/toastStore'
import { MajorChangeDialog, type MajorChangeLine } from '../components/MajorChangeDialog'
import { useAdapters } from '../context/AdapterContext'
import { useTimelineFrame, useTimelineSnapshot, type TimelineFrame } from './useTimelineViewport'
import { useTimelineViewportContext } from './viewportContext'

/** 一行的渲染数据。 */
interface RowModel {
  line: LyricLine
  /** 行级时间戳（回放后） */
  times: number[]
  /** 字级时间戳（回放后），缺项为 `null` */
  wordTimes: Array<number | null>
  /** 块起点（毫秒） */
  startMs: number
  /** 块时长（毫秒） */
  spanMs: number
  /** 是否未打轴 */
  isUntimed: boolean
}

/** 布局结果：在 {@link RowModel} 之上补出行号与像素区间。 */
interface LaidOutRow {
  row: RowModel
  /** 落在第几行（0 / 1） */
  rowIndex: number
  /** 块左边缘（像素，轨道坐标） */
  startPx: number
  /** 块右边缘（像素，轨道坐标） */
  endPx: number
}

/** 在升序数组里找第一个严格大于 `value` 的元素，找不到返回 `null`。 */
function nextGreater(sorted: number[], value: number): number | null {
  let low = 0
  let high = sorted.length
  while (low < high) {
    const mid = (low + high) >> 1
    if (sorted[mid] <= value) low = mid + 1
    else high = mid
  }
  return low < sorted.length ? sorted[low] : null
}

/** 一次吸附的结果。 */
interface SnapResult {
  /** 贴齐后的像素位移（未命中时即原始位移）。 */
  offsetPx: number
  /** 命中的目标时间（毫秒）；未命中为 `null`。 */
  snappedMs: number | null
}

/**
 * 把原始位移吸附到最近的候选时间上（与既有单块拖动同口径）。
 *
 * 判定在"块的起点时间"上做：候选起点 = 起点 + 位移换算的时间，
 * 取距离最近且不超过 {@link SNAP_PX} 换算出的毫秒数的候选；
 * 命中则返回贴到该候选所需的像素偏移与命中的目标时间，未命中原样返回原始位移。
 */
function snapOffsetPx(
  rawPx: number,
  startMs: number,
  targetsMs: readonly number[],
  pixelsPerMs: number,
): SnapResult {
  if (targetsMs.length === 0 || pixelsPerMs <= 0) return { offsetPx: rawPx, snappedMs: null }
  const candidateStartMs = startMs + rawPx / pixelsPerMs
  const thresholdMs = SNAP_PX / pixelsPerMs
  let bestMs: number | null = null
  let bestDistanceMs = Number.POSITIVE_INFINITY
  for (const target of targetsMs) {
    const distanceMs = Math.abs(target - candidateStartMs)
    if (distanceMs < bestDistanceMs) {
      bestDistanceMs = distanceMs
      bestMs = target
    }
  }
  if (bestMs === null || bestDistanceMs > thresholdMs) return { offsetPx: rawPx, snappedMs: null }
  return { offsetPx: (bestMs - startMs) * pixelsPerMs, snappedMs: bestMs }
}

/** 一次按下会落入的四种分派模式。 */
type DragMode =
  /** 带修饰键的点击：不拖动，松手时按点选语义派发（Ctrl / Shift 由上层分派） */
  | 'click'
  /** 多选但被按块未打轴：不允许拖动，只记「已拖动」以便松手时区分点击 */
  | 'blocked'
  /** 单块拖动：已打轴走平移，未打轴走打轴 */
  | 'single'
  /** 多选拖动：参与集（≥2 行）一起平移 */
  | 'multi'

/** 一次按下的过程状态。整个过程不触发渲染，故放在 ref 里。 */
interface DragSession {
  pointerId: number
  /** 被按下的行 ID */
  pressedLineId: string
  /** 按下时的指针横坐标 */
  startClientX: number
  /** 分派模式 */
  mode: DragMode
  /** 是否已越过 {@link DRAG_THRESHOLD_PX} */
  dragging: boolean
  /** 按下时捕获的修饰键（`click` 模式派发用） */
  modifiers: SelectModifiers
  /** 吸附基准起点（被按块的起点毫秒） */
  pressedStartMs: number
  /** 被按块是否未打轴（`single` 模式决定落 stampLine 还是 offset） */
  pressedIsUntimed: boolean
  /** 本次要一起位移的行（`multi` 为参与集，`single` 为单块） */
  moveLineIds: string[]
  /** 吸附时排除的时间值（参与集自身的全部时间戳，避免"拖到自己上"恒命中） */
  excludeTimesMs: number[]
  /** 参与集在渲染窗口内的块节点（窗口外的成员不渲染，提交后由回放结果补齐） */
  nodes: Map<string, HTMLElement>
  /** not-allowed 提示元素（`blocked` 模式） */
  blockedEl: HTMLElement | null
  /** 本会话是否已挂起跟随（按块即挂起，松手 / 取消时按设置恢复） */
  followSuspended: boolean
}

/** 待确认的一次「重大改变」（多选拖动）：块保留临时位移停在吸附落点，等用户裁决。 */
interface PendingMajorChange {
  /** 本次拖动会话（确认 / 取消都还要用它的 nodes 与 moveLineIds） */
  session: DragSession
  /** 本次位移量（毫秒） */
  deltaMs: number
  /** 受影响行（行号 + 文本），供确认框展示 */
  lines: MajorChangeLine[]
}

/**
 * 歌词块轨道（架构文档 §6.1 第三层）。
 *
 * ## 剪映式单行时间轴
 * 所有歌词块沿**时间横向排列**，纵向只用 2 行做视觉避让：
 * 时间上挤在一起的两个块分居两行，互不遮挡；行数固定为
 * {@link LYRIC_ROW_COUNT}，因此轨道高度写死为 {@link LYRIC_TRACK_HEIGHT_PX}，
 * 再多歌词也不会把轨道撑高、更不需要纵向滚动。
 *
 * ## 定位：平面 + 平移
 * 块自己用 `left = startMs × pixelsPerMs` 钉在时间平面上，**滚动时不重算**；
 * 整条平面用一个 `translate3d` 整体平移。这样横向平移不触发 React 重渲染，
 * 只有"缩放 / 换窗口"才会。
 *
 * ## 横向虚拟滚动
 * 只渲染渲染窗口（含 overscan）内的块，与波形共用同一个窗口，行数上万也不影响帧率。
 */
export function LyricTrack() {
  const { kernel } = useTimelineViewportContext()
  const snapshot = useTimelineSnapshot(kernel)
  const document = useEditorStore((state) => state.document)
  const replay = useEditorStore((state) => state.replay)
  // 可见行 = 文档行剔除被删行 + 文本覆盖；订阅两个稳定引用再派生，避免无限重渲染
  const lines = useMemo(() => selectVisibleLines(document, replay), [document, replay])
  const activeLineId = useEditorStore((state) => state.selection.activeLineId)
  // 订阅 lineIds 原始引用，Set 派生放 useMemo（selector 里新建 Set 会无限重渲染）
  const selectedLineIds = useEditorStore((state) => state.selection.lineIds)
  const selectedLineIdSet = useMemo(() => new Set(selectedLineIds), [selectedLineIds])
  const selectLine = useEditorStore((state) => state.selectLine)
  const toggleLineSelection = useEditorStore((state) => state.toggleLineSelection)
  const selectLineRange = useEditorStore((state) => state.selectLineRange)
  const clearLineSelection = useEditorStore((state) => state.clearLineSelection)
  const stampLine = useEditorStore((state) => state.stampLine)
  const moveLinesByOffset = useEditorStore((state) => state.moveLinesByOffset)
  const adapters = useAdapters()

  const planeRef = useRef<HTMLDivElement | null>(null)

  /**
   * 吸附对齐辅助线（单例，平面层内）。拖动命中时命令式显示，
   * 全程只写 inline style，绝不走 React state（拖动中零重渲染是硬约束）。
   */
  const guideRef = useRef<HTMLDivElement | null>(null)
  /**
   * 本次按下是否落在块上。
   *
   * `setPointerCapture` 会把随后的兼容 `click` 的 target 重定向到捕获元素（平面容器），
   * 于是 `click` 里 `event.target` 永远是平面、`closest('[data-lyric-block]')` 恒为 null。
   * 因此"点没点块"必须在按下瞬间（捕获之前）记下来，供 {@link handleTrackClick} 判定。
   */
  const pressedOnBlockRef = useRef(false)

  /**
   * 读取播放头当前时间。
   *
   * 与 `PlayheadLayer` 同源（直接读音频时钟），不用 store 里的 `playback.playheadMs` ——
   * 那个值是 10Hz 的读数镜像，最多落后真实播放头 100ms，吸附会落在肉眼可见偏掉的位置。
   * 用函数而不是传值：播放头每帧都在动，而拖动不会触发重渲染，传值只会拿到僵死的快照。
   */
  const getPlayheadMs = useCallback(() => adapters.audio.getCurrentTimeMs(), [adapters])

  const rows = useMemo<RowModel[]>(() => {
    const base = lines.map((line) => ({
      line,
      times: getReplayedLineTimes(replay, line.id),
      wordTimes: line.wordTimestamps.map((_, index) => getReplayedWordTime(replay, line.id, index)),
    }))

    const sortedStarts = base
      .map((item) => (item.times.length > 0 ? item.times[0] : null))
      .filter((value): value is number => value !== null)
      .sort((a, b) => a - b)

    // 未打轴的块没有时间可依，从 0 起按 DEFAULT_BLOCK_MS 依次右移占位
    let untimedIndex = 0

    return base.map((item) => {
      if (item.times.length === 0) {
        const startMs = untimedIndex * DEFAULT_BLOCK_MS
        untimedIndex += 1
        return { ...item, startMs, spanMs: DEFAULT_BLOCK_MS, isUntimed: true }
      }
      const startMs = item.times[0]
      // 多时间戳时，块的宽度天然就是两个时间戳之间的间隔
      const endMs =
        item.times.length >= 2 ? item.times[1] : (nextGreater(sortedStarts, startMs) ?? startMs + DEFAULT_BLOCK_MS)
      return { ...item, startMs, spanMs: Math.max(1, endMs - startMs), isUntimed: false }
    })
  }, [lines, replay])

  // 拖动状态机在 ref 里读最新行模型，避免为它重绑事件（render 期同步最新值即可）
  const rowsRef = useRef<RowModel[]>(rows)
  rowsRef.current = rows

  /**
   * 两行贪心分配：按起点遍历，找第一个"上一块已经让开"的行；
   * 两行都占着就退而求其次放到当前结束更早的那行（保证视觉上错开）。
   * 判定用像素间距（{@link ROW_ASSIGN_GAP_PX}），因此任何缩放下视觉间隙都一致。
   */
  const laidOut = useMemo<LaidOutRow[]>(() => {
    const pixelsPerMs = snapshot.pixelsPerMs
    const lastEndPx: number[] = new Array<number>(LYRIC_ROW_COUNT).fill(Number.NEGATIVE_INFINITY)
    const rowIndexOf = new Array<number>(rows.length).fill(0)

    const ordered = rows
      .map((row, index) => ({ row, index }))
      .sort((a, b) => a.row.startMs - b.row.startMs || a.index - b.index)

    for (const { row, index } of ordered) {
      const startPx = row.startMs * pixelsPerMs
      const endPx = startPx + lyricBlockWidthPx(row.spanMs, pixelsPerMs)
      let target = -1
      for (let candidate = 0; candidate < LYRIC_ROW_COUNT; candidate += 1) {
        if (lastEndPx[candidate] + ROW_ASSIGN_GAP_PX <= startPx) {
          target = candidate
          break
        }
      }
      if (target === -1) {
        target = 0
        for (let candidate = 1; candidate < LYRIC_ROW_COUNT; candidate += 1) {
          if (lastEndPx[candidate] < lastEndPx[target]) target = candidate
        }
      }
      rowIndexOf[index] = target
      lastEndPx[target] = Math.max(lastEndPx[target], endPx)
    }

    return rows.map((row, index) => {
      const startPx = row.startMs * pixelsPerMs
      return {
        row,
        rowIndex: rowIndexOf[index],
        startPx,
        endPx: startPx + lyricBlockWidthPx(row.spanMs, pixelsPerMs),
      }
    })
  }, [rows, snapshot.pixelsPerMs])

  // 横向虚拟滚动：只保留与渲染窗口相交的块
  const windowStartPx = snapshot.windowStartMs * snapshot.pixelsPerMs
  const windowEndPx = snapshot.windowEndMs * snapshot.pixelsPerMs
  const visibleRows = laidOut.filter((item) => item.endPx > windowStartPx && item.startPx < windowEndPx)

  /** 块点选：Shift 范围选 > Ctrl/Cmd 切换 > 普通单选。 */
  const handleSelectBlock = useCallback(
    (lineId: string, modifiers: SelectModifiers) => {
      if (modifiers.shift) selectLineRange(lineId)
      else if (modifiers.ctrl || modifiers.meta) toggleLineSelection(lineId)
      else selectLine(lineId)
    },
    [selectLine, toggleLineSelection, selectLineRange],
  )

  /**
   * 背景点击：只有点到**非块区域**（时间轴空白）才清空选中。
   * 点块的选择语义在平面层的 pointer 委托里，由 `closest` 排除，不在这里重复处理。
   */
  const handleTrackClick = useCallback(() => {
    // 用按下时的命中记录判定：指针捕获会让 click 的 target 变成平面容器，event.target 不可信
    if (!pressedOnBlockRef.current) clearLineSelection()
  }, [clearLineSelection])

  /* ------------------------------------------------------------------ *
   * 拖动状态机（平面层事件委托）
   *
   * 事件统一挂在平面容器上，按 `closest('[data-lyric-block]')` 判定是否点在块上、
   * 用 `data-line-id` 取行 ID，块本身完全不接 pointer 回调。整个过程只有
   * `dragRef` 一个 ref 在动：拖动中**零 store 写入**，位移以命令式 `transform`
   * 写到参与集的块节点上（块不声明 `transform`，React 重渲染不会抹掉）。
   * 松手才提交**一条**日志（多选 `selection-offset` / 单块 `manual-nudge` / 未打轴 `manual-timestamp`）。
   * ------------------------------------------------------------------ */
  const dragRef = useRef<DragSession | null>(null)

  /**
   * 待确认的重大改变。
   *
   * 会话（含 nodes 映射）暂存在 ref 里、另用 state 驱动弹窗开合：
   * 弹窗打开期间不撤临时位移，块就停在吸附落点上，所见即所确认。
   */
  const pendingMajorRef = useRef<PendingMajorChange | null>(null)
  const [majorDialogOpen, setMajorDialogOpen] = useState(false)

  /** 收集参与集在渲染窗口内的块节点（窗口外的成员不渲染，提交后由回放结果补齐位置）。 */
  const collectNodes = (ids: string[]): Map<string, HTMLElement> => {
    const plane = planeRef.current
    const nodes = new Map<string, HTMLElement>()
    if (plane === null) return nodes
    const wanted = new Set(ids)
    for (const el of plane.querySelectorAll<HTMLElement>('[data-lyric-block]')) {
      const id = el.dataset.lineId
      if (id !== undefined && wanted.has(id)) nodes.set(id, el)
    }
    return nodes
  }

  /** 拖动中即时位移：命令式写 `transform`，不走 React。 */
  const moveNodes = (session: DragSession, offsetPx: number): void => {
    for (const el of session.nodes.values()) {
      el.style.transform = `translate3d(${offsetPx}px, 0, 0)`
    }
  }

  /** 显示对齐辅助线：命令式写轨道坐标位移 + inline display，命中时间写入 dataset 供观测。 */
  const showGuide = (snappedMs: number): void => {
    const guide = guideRef.current
    if (guide === null) return
    guide.style.transform = `translate3d(${snappedMs * snapshot.pixelsPerMs}px, 0, 0)`
    guide.dataset.snapMs = String(snappedMs)
    guide.style.display = 'block'
  }

  /** 隐藏对齐辅助线。 */
  const hideGuide = (): void => {
    const guide = guideRef.current
    if (guide === null) return
    guide.style.display = 'none'
    delete guide.dataset.snapMs
  }

  /** 撤销本会话留下的全部命令式样式（transform / 层级 / 光标）与对齐辅助线。 */
  const clearSessionStyles = (session: DragSession): void => {
    for (const el of session.nodes.values()) {
      el.style.transform = ''
      el.style.zIndex = ''
      el.style.cursor = ''
    }
    if (session.blockedEl !== null) session.blockedEl.style.cursor = ''
    hideGuide()
  }

  /**
   * 网格吸附候选：当前视窗内（含边缘外 `GRID_SNAP_BUFFER_PX` 像素）的刻度值。
   *
   * 档位与刻度尺共用 `LABEL_MIN_GAP_PX`，且用同一 `Math.ceil(from / stepMs) * stepMs`
   * 的起始对齐，保证吸附点与看得见的刻度逐点重合。视窗范围现取自
   * `kernel.getFrame().view`（`snapshot` 不含 `viewStartMs`）。
   */
  const collectGridTimesMs = (): number[] => {
    const view = kernel.getFrame().view
    if (view.pixelsPerMs <= 0) return []
    const stepMs = adaptiveGridMs(view.pixelsPerMs, LABEL_MIN_GAP_PX)
    const bufferMs = GRID_SNAP_BUFFER_PX / view.pixelsPerMs
    const fromMs = view.startMs - bufferMs
    const firstMs = Math.ceil(fromMs / stepMs) * stepMs
    const toMs = view.startMs + kernel.getViewportSize().widthPx / view.pixelsPerMs + bufferMs
    const result: number[] = []
    for (let ms = firstMs; ms <= toMs; ms += stepMs) result.push(ms)
    return result
  }

  /**
   * 吸附候选：按设置拼装成**单一候选数组**（候选等权，取全局最近）。
   *
   * - `snapEnabled` 关闭 → 空数组（一律不吸）；
   * - `snapToPlayhead` → 播放头（每帧现取）；
   * - `snapToLineTimes` → 其他行的时间戳（排除参与集自身的时间值）；
   * - `snapToGrid` → 视窗内刻度值。
   */
  const collectTargetsMs = (excludeTimesMs: number[]): number[] => {
    const settings = useSettingsStore.getState().settings
    if (!settings.snapEnabled) return []
    const targets: number[] = []
    if (settings.snapToPlayhead) targets.push(getPlayheadMs())
    if (settings.snapToLineTimes) {
      const others = rowsRef.current.flatMap((row) => row.times)
      for (const target of others) {
        if (!excludeTimesMs.some((own) => Math.abs(own - target) < 1e-6)) targets.push(target)
      }
    }
    if (settings.snapToGrid) targets.push(...collectGridTimesMs())
    return targets
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    // 防御性重置：上一轮若异常退出，辅助线可能还残留
    hideGuide()
    // 只接主键：右键 / 中键不参与拖动
    if (event.button !== 0) return
    const blockEl = (event.target as HTMLElement).closest<HTMLElement>('[data-lyric-block]')
    // 先在"捕获之前"记下命中：供 click 时的背景清空判定（见 pressedOnBlockRef）
    pressedOnBlockRef.current = blockEl !== null
    // 点在空白：不建会话，交给 onClick 清空选中
    if (blockEl === null) return
    const pressedLineId = blockEl.dataset.lineId
    if (pressedLineId === undefined) return
    // 拦住默认行为，避免拖动时选中文字
    event.preventDefault()

    const modifiers: SelectModifiers = {
      ctrl: event.ctrlKey,
      meta: event.metaKey,
      shift: event.shiftKey,
    }

    // 有修饰键：只记「点击待发」，不建拖动会话（松手时按点选语义派发）
    if (modifiers.ctrl || modifiers.meta || modifiers.shift) {
      dragRef.current = {
        pointerId: event.pointerId,
        pressedLineId,
        startClientX: event.clientX,
        mode: 'click',
        dragging: false,
        modifiers,
        pressedStartMs: 0,
        pressedIsUntimed: false,
        moveLineIds: [pressedLineId],
        excludeTimesMs: [],
        nodes: new Map(),
        blockedEl: null,
        followSuspended: false,
      }
      event.currentTarget.setPointerCapture(event.pointerId)
      return
    }

    const state = useEditorStore.getState()
    // 无修饰键且被按块不在选中集：立即归位为单选（让它成为唯一选中，后续才谈得上整组拖动）
    if (!state.selection.lineIds.includes(pressedLineId)) state.selectLine(pressedLineId)
    const selected = useEditorStore.getState().selection.lineIds

    const pressedRow = rowsRef.current.find((row) => row.line.id === pressedLineId)

    let mode: DragMode
    if (selected.length >= 2) {
      // 集合级判定（二.9）：≥2 行即"整组拖动"，须全组可平移。
      // 可平移定义统一见 lineIsMovable（未删 且 已打轴，双条件显式）；
      // 与 nudgeSelection 入口、moveLinesByOffset 内层过滤共用同一口径。
      // 含不可平移行（未打轴 / 已删）→ 整组 not-allowed（零位移、零日志、不写选区）。
      const allMovable = selected.every((id) => lineIsMovable(state.replay, id))
      mode = allMovable ? 'multi' : 'blocked'
    } else {
      mode = 'single'
    }

    const moveLineIds = mode === 'multi' ? selected : [pressedLineId]
    const memberRows = rowsRef.current.filter((row) => moveLineIds.includes(row.line.id))
    const excludeTimesMs = memberRows.flatMap((row) => row.times)

    // 按块即挂起跟随（无条件）：拖动期间视口不动，否则拖不准
    kernel.cancelFollowAnimation()
    kernel.suspendFollow()

    const session: DragSession = {
      pointerId: event.pointerId,
      pressedLineId,
      startClientX: event.clientX,
      mode,
      dragging: false,
      modifiers,
      pressedStartMs: pressedRow?.startMs ?? 0,
      pressedIsUntimed: pressedRow?.isUntimed ?? false,
      moveLineIds,
      excludeTimesMs,
      nodes: mode === 'blocked' ? new Map() : collectNodes(moveLineIds),
      blockedEl: mode === 'blocked' ? blockEl : null,
      followSuspended: true,
    }
    if (mode === 'blocked') blockEl.style.cursor = 'not-allowed'
    dragRef.current = session
    // 捕获指针：拖动中指针移出块也照样收到 move / up
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const session = dragRef.current
    if (session === null || session.pointerId !== event.pointerId) return
    // 修饰键点击不参与拖动
    if (session.mode === 'click') return
    const rawPx = event.clientX - session.startClientX
    if (!session.dragging) {
      // 只看水平位移：纵向抖动不算拖动；阈值内不进入拖动、不写任何样式
      if (Math.abs(rawPx) < DRAG_THRESHOLD_PX) return
      session.dragging = true
      if (session.mode === 'blocked') return // 被阻止：只记「已拖动」，不产生视觉位移
      // 进入拖动态：抬升层级 + grabbing 光标
      for (const el of session.nodes.values()) {
        el.style.zIndex = '10'
        el.style.cursor = 'grabbing'
      }
    }
    if (session.mode === 'blocked') return
    const { offsetPx, snappedMs } = snapOffsetPx(
      rawPx,
      session.pressedStartMs,
      collectTargetsMs(session.excludeTimesMs),
      snapshot.pixelsPerMs,
    )
    moveNodes(session, offsetPx)
    if (snappedMs === null) hideGuide()
    else showGuide(snappedMs)
  }

  /**
   * 松手 / 取消时按设置恢复跟随。
   *
   * - 真正拖动过（已越阈值）：按设置 A「立刻拉回」（带动画）/ B「进入跟随暂停」；
   * - 只是点击（未越阈值）：仅解除挂起、不动跟随状态，
   *   否则 B 模式下"点选一个块"也会把跟随停掉。
   */
  const restoreFollowAfterDrag = (session: DragSession): void => {
    if (!session.followSuspended) return
    session.followSuspended = false
    if (!session.dragging) {
      kernel.clearFollowSuspension()
      return
    }
    kernel.resumeFollow(useSettingsStore.getState().settings.followResumeMode, adapters.audio.getCurrentTimeMs())
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const session = dragRef.current
    if (session === null || session.pointerId !== event.pointerId) return
    dragRef.current = null
    // 显式收口：multi + confirm 分支不走 clearSessionStyles，须在此先隐藏辅助线
    hideGuide()
    restoreFollowAfterDrag(session)

    // 未越阈值 = 一次点击：按点选语义派发（无修饰键时即普通单选，保零.3）
    if (!session.dragging) {
      clearSessionStyles(session)
      handleSelectBlock(session.pressedLineId, session.modifiers)
      return
    }

    // 越阈值但拖动被阻止：不动选区、不写日志（用户意图是拖动，被拦下不该顺手改选中）；
    // 顺带说明原因，别让用户以为"拖不动是坏了"
    if (session.mode === 'blocked') {
      clearSessionStyles(session)
      showToast('无法整组拖动：所选行含未打轴（或已删除）行，请先全部打轴')
      return
    }

    const rawPx = event.clientX - session.startClientX
    const { offsetPx } = snapOffsetPx(
      rawPx,
      session.pressedStartMs,
      collectTargetsMs(session.excludeTimesMs),
      snapshot.pixelsPerMs,
    )

    if (session.mode === 'single' && session.pressedIsUntimed) {
      // 单块未打轴：落点 = 原占位起点 + 位移，与原占位的差就是本次实际移动（保留既有语义，二.8）
      clearSessionStyles(session)
      const landedMs = Math.round(session.pressedStartMs + offsetPx / snapshot.pixelsPerMs)
      if (Math.abs(landedMs - session.pressedStartMs) < DRAG_MIN_DELTA_MS) return
      stampLine(session.pressedLineId, landedMs)
      return
    }

    const deltaMs = Math.round(offsetPx / snapshot.pixelsPerMs)
    if (Math.abs(deltaMs) < DRAG_MIN_DELTA_MS) {
      clearSessionStyles(session)
      return
    }

    // 多选拖动是"重大改变"：开关打开时先弹确认框，**不撤样式、不落日志**——
    // 块停在吸附落点等裁决。确认才撤样式 + 落一条 selection-offset，取消只撤样式（块弹回原位）。
    if (session.mode === 'multi' && useSettingsStore.getState().settings.confirmMajorChange) {
      moveNodes(session, offsetPx)
      pendingMajorRef.current = { session, deltaMs, lines: collectMajorChangeLines(session.moveLineIds) }
      setMajorDialogOpen(true)
      return
    }

    // 先撤临时位移，与下面的提交合批：新位置直接由回放结果给出
    clearSessionStyles(session)
    // 单块 → 内部转 nudgeLine；多选 → 一条 selection-offset。共用同一口径
    moveLinesByOffset(session.moveLineIds, deltaMs)
  }

  /** 取参与本次位移的行（行号 + 文本），供确认框展示。 */
  const collectMajorChangeLines = (ids: string[]): MajorChangeLine[] => {
    const wanted = new Set(ids)
    const result: MajorChangeLine[] = []
    lines.forEach((line, index) => {
      if (wanted.has(line.id)) result.push({ index: index + 1, text: line.text })
    })
    return result
  }

  /** 确认：撤临时位移（与提交合批）+ 落一条日志，与既有提交口径一致。 */
  const handleMajorConfirm = (): void => {
    const pending = pendingMajorRef.current
    pendingMajorRef.current = null
    setMajorDialogOpen(false)
    if (pending === null) return
    clearSessionStyles(pending.session)
    moveLinesByOffset(pending.session.moveLineIds, pending.deltaMs)
  }

  /** 取消：只撤临时位移，块弹回原位；不写日志、不写选区。 */
  const handleMajorCancel = (): void => {
    const pending = pendingMajorRef.current
    pendingMajorRef.current = null
    setMajorDialogOpen(false)
    if (pending !== null) clearSessionStyles(pending.session)
  }

  /** 指针被系统收回（触屏取消、窗口失焦等）：放弃本次拖动，不写日志。 */
  const handlePointerCancel = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const session = dragRef.current
    if (session === null || session.pointerId !== event.pointerId) return
    dragRef.current = null
    restoreFollowAfterDrag(session)
    clearSessionStyles(session)
  }

  const handleFrame = useCallback((frame: TimelineFrame) => {
    const plane = planeRef.current
    if (plane !== null) {
      plane.style.transform = `translate3d(${-frame.view.startMs * frame.view.pixelsPerMs}px, 0, 0)`
    }
  }, [])

  useTimelineFrame(kernel, handleFrame)

  return (
    <div
      className="relative shrink-0 overflow-hidden border-t border-divider bg-canvas"
      style={{ height: `${LYRIC_TRACK_HEIGHT_PX}px` }}
      onClick={handleTrackClick}
    >
      {/* 两行静态底纹：不随横向平移移动，用来标识两条泳道 */}
      {Array.from({ length: LYRIC_ROW_COUNT }, (_, rowIndex) => (
        <div
          key={`stripe-${rowIndex}`}
          className={rowIndex % 2 === 1 ? 'absolute left-0 w-full bg-white/[0.015]' : 'absolute left-0 w-full'}
          style={{ top: `${rowIndex * LYRIC_ROW_HEIGHT_PX}px`, height: `${LYRIC_ROW_HEIGHT_PX}px` }}
        />
      ))}

      {/* 时间平面层：整层随视口横向平移，歌词块以轨道坐标写 left / top */}
      <div
        ref={planeRef}
        className="absolute left-0 top-0 h-full w-full will-change-transform"
        // 点选 / 拖动统一在此委托：块本身不接任何 pointer 回调
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      >
        <div
          ref={guideRef}
          data-snap-guide
          className="pointer-events-none absolute left-0 top-0 z-20 h-full w-px bg-accent"
          style={{ display: 'none' }}
        />
        {visibleRows.map((item) => (
          <LyricBlock
            key={item.row.line.id}
            line={item.row.line}
            times={item.row.times}
            wordTimes={item.row.wordTimes}
            startMs={item.row.startMs}
            spanMs={item.row.spanMs}
            isUntimed={item.row.isUntimed}
            isActive={item.row.line.id === activeLineId}
            inSelection={selectedLineIdSet.has(item.row.line.id)}
            pixelsPerMs={snapshot.pixelsPerMs}
            topPx={item.rowIndex * LYRIC_ROW_HEIGHT_PX}
          />
        ))}
      </div>

      {rows.length === 0 ? (
        <span className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[11px] text-neutral-600">
          没有歌词行
        </span>
      ) : null}

      {/* 重大改变确认框：挂到 body，z-40 盖在保留临时位移的块（zIndex=10）之上 */}
      <MajorChangeDialog
        open={majorDialogOpen}
        lines={pendingMajorRef.current?.lines ?? []}
        deltaMs={pendingMajorRef.current?.deltaMs ?? 0}
        onConfirm={handleMajorConfirm}
        onCancel={handleMajorCancel}
      />
    </div>
  )
}
