import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { LyricLine } from '@core'
import { useSettingsStore } from '../stores/settingsStore'
import type { LineActionIconName } from './LineActionIcons'
import { LineEditForm } from './LineEditForm'

/** 弹窗里的一个行操作。 */
export interface LineActionItem {
  /** 同时也是图标名 */
  key: Extract<LineActionIconName, 'move-up' | 'move-down' | 'insert' | 'delete'>
  /** 按钮文字 */
  label: string
  /** 当前不可用（如首行不能再上移）；禁用项仍然显示，只是不可点 */
  disabled?: boolean
  onSelect: () => void
}

/** 行操作弹窗属性。 */
export interface LineActionSheetProps {
  /** 目标行；`null` 时不渲染（代替单独的 open 开关，避免出现"打开但无目标行"的非法组合） */
  line: LyricLine | null
  /** 目标行在**可见行**里的下标（0 起），标题显示 `lineIndex + 1` */
  lineIndex: number
  /** 操作项，恒为四项（上移 / 下移 / 新建 / 删除） */
  items: LineActionItem[]
  onClose: () => void
}

/**
 * 关闭按钮的 ×。
 *
 * 内联在这里而不是放进 `LineActionIcons.tsx`：那个文件的范围是"行操作图标"
 * （上移 / 下移 / 新建 / 删除 / ⋮），× 属于弹窗 chrome，不是一类东西。
 * 也不用文本 `×`（U+00D7）—— 它是乘号，各字体字面大小与基线不一致，
 * 中文环境常走 CJK 字体、偏宽偏重，还得靠 CSS 反复调光学居中。
 */
function CloseIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M5.5 5.5 14.5 14.5" />
      <path d="M14.5 5.5 5.5 14.5" />
    </svg>
  )
}

/**
 * 行操作弹窗（居中模态）。
 *
 * 用 `createPortal` 挂到 `document.body`，避免被列表滚动容器（`overflow: auto`）裁剪。
 * 遮罩 `z-40` 属于项目里 dialog 的层级约定。
 *
 * 关闭路径三条：Esc、右上角 ×、点遮罩。
 * **点遮罩默认不生效** —— 误触会丢掉正在编辑的内容，代价太高；
 * 由设置里的 `closeDialogOnBackdropClick` 主动开启。
 *
 * 有未保存改动时：取消是显式丢弃、照常关闭；Esc 与点遮罩这两条非显式路径
 * 一律不关闭（点遮罩即使开关开启也不关），与底部四个操作按钮的禁用保持一致。
 *
 * 内容区（四个文本字段 + 字级时间戳列表 + 底部四操作与取消 / 保存）在 `LineEditForm`。
 */
export function LineActionSheet({ line, lineIndex, items, onClose }: LineActionSheetProps) {
  const closeOnBackdropClick = useSettingsStore((state) => state.settings.closeDialogOnBackdropClick)

  // 本组件是常驻挂载（`line === null` 时自己 return null），`dirty` 不会随弹窗关闭复位。
  // 用"渲染期调整状态"在换行时同步复位：无额外渲染、无闪烁；
  // 换成 useEffect 会先渲染一帧"脏"的样子（按钮灰着），看着像 bug。
  const lineId = line?.id ?? null
  const [dirtyLineId, setDirtyLineId] = useState<string | null>(lineId)
  const [dirty, setDirty] = useState(false)
  if (lineId !== dirtyLineId) {
    setDirtyLineId(lineId)
    setDirty(false)
  }

  // Esc 关闭。用 window 监听而非焦点绑定：弹窗内容可能没有可聚焦元素。
  // `dirty` 必须在依赖里，否则回调读到的永远是打开那一刻的值（false），改过也照关。
  useEffect(() => {
    if (line === null) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      if (dirty) return
      onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [line, onClose, dirty])

  if (line === null) return null

  // 空行（新建出来的行）不留一个悬空的 " · "
  const title = line.text === '' ? `第 ${lineIndex + 1} 行` : `第 ${lineIndex + 1} 行 · ${line.text}`

  return createPortal(
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4"
      // 只认遮罩自身被点到：弹窗内部的点击冒泡上来时 target 是子元素，不会误关
      onClick={
        closeOnBackdropClick
          ? (event) => {
              if (event.target !== event.currentTarget) return
              // 有未保存改动时不关，开关开启也一样
              if (dirty) return
              onClose()
            }
          : undefined
      }
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="行操作"
        className="flex h-[520px] max-h-full w-[520px] max-w-full flex-col overflow-hidden rounded-lg border border-divider bg-panel shadow-xl"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 px-4 pt-3 pb-2">
          <h2 className="max-w-[280px] min-w-0 truncate text-xs text-neutral-400">{title}</h2>
          <button
            type="button"
            aria-label="关闭"
            title="关闭"
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-neutral-400 transition-colors hover:bg-white/10 hover:text-neutral-100"
          >
            <CloseIcon />
          </button>
        </div>

        <LineEditForm
          key={line.id}
          line={line}
          items={items}
          onClose={onClose}
          onDirtyChange={setDirty}
        />
      </div>
    </div>,
    document.body,
  )
}
