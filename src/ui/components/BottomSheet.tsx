import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

/** 可见高度不足该比例（相对屏高）即判定为「下滑关闭」。 */
const CLOSE_VISIBLE_RATIO = 0.1
/** 固定低档：面板顶落在 70% 屏高（即面板高度 30vh）。 */
const LOW_TOP_RATIO = 0.7
/** 读不到波形层时，中档回退为「面板顶落在 45% 屏高」。 */
const FALLBACK_MID_TOP_RATIO = 0.45

interface BottomSheetProps {
  /** 是否展开 */
  open: boolean
  /** 请求关闭（点「收起」/ 下滑超阈值） */
  onClose: () => void
  /** 抽屉内容 */
  children: ReactNode
}

/** 面板未位移时的基准顶与高度，档位偏移都以它为参照。 */
interface SheetGeometry {
  baseTop: number
  height: number
}

/**
 * 读取面板几何 + 计算三个吸附档位偏移（升序）。
 *
 * 档位固定为三个、**不做间距合并**：
 * 1. `0` —— 80vh 全展开；
 * 2. `cardBottom - baseTop` —— 时间轴卡片底边（露出波形 + 歌词拖动轨），读不到时回退 45% 屏高；
 * 3. `viewportH * 0.7 - baseTop` —— 面板高度固定 30vh。
 *
 * 排序后顺序可能随实际布局变化（卡片底边靠下时第 2 档会排到第 3 档之后），这是允许的。
 */
function buildStops(geometry: SheetGeometry, viewportH: number, cardBottom: number | null): number[] {
  const midOffset =
    cardBottom === null ? viewportH * FALLBACK_MID_TOP_RATIO - geometry.baseTop : cardBottom - geometry.baseTop
  return [
    0,
    Math.max(0, midOffset),
    Math.max(0, viewportH * LOW_TOP_RATIO - geometry.baseTop),
  ].sort((a, b) => a - b)
}

/** 纯函数：吸附到距离当前位移最近的档位。 */
function nearestStop(stops: number[], offsetY: number): number {
  return stops.reduce(
    (best, stop) => (Math.abs(stop - offsetY) < Math.abs(best - offsetY) ? stop : best),
    stops[0],
  )
}

/**
 * 实测面板几何 + 时间轴卡片底边，返回新的几何与档位。
 * 面板的 `transform: translateY(dragY)` 会影响 `rect.top`，故需减掉当前位移还原基准顶。
 */
function measureSheet(
  panel: HTMLDivElement | null,
  dragY: number,
): { geometry: SheetGeometry; stops: number[] } | null {
  if (panel === null) return null
  const rect = panel.getBoundingClientRect()
  const geometry: SheetGeometry = { baseTop: rect.top - dragY, height: rect.height }
  const card = document.querySelector('[data-timeline-strip]')
  const cardBottom = card === null ? null : card.getBoundingClientRect().bottom
  return { geometry, stops: buildStops(geometry, window.innerHeight, cardBottom) }
}

/**
 * 移动端底部抽屉。
 *
 * - **挂载**：`createPortal` 到 `document.body`，避免被布局容器的 `overflow` 裁剪；
 * - **无遮罩**：面板只覆盖自身矩形，上方未覆盖区域不拦截点击，
 *   用户可以直接操作背后的时间轴与波形（这正是本轮去遮罩的目的）；
 * - **手势**：只在顶部把手上响应指针拖拽，向下跟手（`transition: none`）；
 *   松手后吸附到三个档位之一，可见高度不足 10vh 则直接关闭；
 * - **收起按钮**：把手右侧的「收起 ▾」是把手**兄弟节点**，不会冒泡进拖拽逻辑。
 */
export function BottomSheet({ open, onClose, children }: BottomSheetProps) {
  /** 当前向下位移（像素）；吸附后停在档位上，未拖动时为 0 */
  const [dragY, setDragY] = useState(0)
  /** 拖动中：关掉 transition 让面板严格跟手 */
  const [dragging, setDragging] = useState(false)
  const startYRef = useRef(0)
  /** 按下瞬间面板已有的位移（可能是上次吸附的档位），拖拽在其基础上累加 */
  const startOffsetRef = useRef(0)
  /** `dragY` 的镜像：测量基准顶时需要读当前位移，但事件回调里 state 可能滞后 */
  const dragYRef = useRef(0)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const geometryRef = useRef<SheetGeometry>({ baseTop: 0, height: 0 })
  const stopsRef = useRef<number[]>([0])

  const applyDrag = (value: number): void => {
    dragYRef.current = value
    setDragY(value)
  }

  // 每次重新打开都从「完全展开」起步，并重新测量档位（视口 / 布局可能已变化）
  useEffect(() => {
    if (!open) return
    const measured = measureSheet(panelRef.current, dragYRef.current)
    if (measured !== null) {
      geometryRef.current = measured.geometry
      stopsRef.current = measured.stops
    }
    applyDrag(0)
  }, [open])

  if (!open) return null

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    startYRef.current = event.clientY
    startOffsetRef.current = dragYRef.current
    // 每次按下重测：时间轴卡片底边会随分析轨 / 歌词块高度变化
    const measured = measureSheet(panelRef.current, dragYRef.current)
    if (measured !== null) {
      geometryRef.current = measured.geometry
      stopsRef.current = measured.stops
    }
    setDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!dragging) return
    // 增量可为负（向上回拖），只有「总位移」才夹到 0，避免从非 0 档位向上拖时卡死
    applyDrag(Math.max(0, startOffsetRef.current + event.clientY - startYRef.current))
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!dragging) return
    setDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    // 位移要在「按下时的档位」上累加，否则从吸附位继续拖会突然跳回顶部
    const offsetY = Math.max(0, startOffsetRef.current + event.clientY - startYRef.current)
    const { height } = geometryRef.current
    // 可见高度 = 面板高度 - 位移；不足 10vh 视为「拖没了」，直接关闭
    const visibleHeight = height - offsetY
    if (visibleHeight < window.innerHeight * CLOSE_VISIBLE_RATIO) {
      applyDrag(0)
      onClose()
      return
    }
    applyDrag(nearestStop(stopsRef.current, offsetY))
  }

  return createPortal(
    <div
      ref={panelRef}
      data-sheet-panel
      role="dialog"
      aria-modal="true"
      className="fixed inset-x-0 bottom-0 z-50 flex h-[80vh] flex-col rounded-t-2xl bg-panel"
      style={{
        transform: `translateY(${dragY}px)`,
        transition: dragging ? 'none' : 'transform 200ms ease-out',
      }}
    >
      <div className="relative shrink-0">
        <div
          data-sheet-handle
          className="flex cursor-grab touch-none justify-center py-3 active:cursor-grabbing"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <div className="h-1.5 w-12 rounded-full bg-neutral-600" />
        </div>
        {/* 没有遮罩后，必须提供一个显式的收起入口；放在把手外层，避免拖拽冒泡 */}
        <button
          type="button"
          data-sheet-collapse
          onClick={onClose}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-neutral-500 hover:text-neutral-300"
        >
          收起 ▾
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">{children}</div>
    </div>,
    document.body,
  )
}
