import { useEffect } from 'react'
import type { OperationKind } from '@core'
import { ARCHIVED_DISPLAY_LABEL, OPERATION_KIND_LABEL } from '../labels'
import { useEditorStore, type ArchivedDisplay } from '../stores/editorStore'

/**
 * 日志筛选弹层。
 *
 * 作为普通下拉挂在触发按钮下方（父容器需 `relative`）：宽度由 `w-72` 与
 * `max-w-[calc(100vw-2rem)]` 兜底，高度由 `max-h-[60vh]` + 内部滚动兜底，
 * 不再需要 Portal 与视口定位，也就不会被卡片边界「割裂」。
 *
 * 注意：**不能加 `role="dialog"` / `aria-modal`** —— 那会让 `hasOpenDialog()`
 * 判定为模态打开，进而停掉全部编辑器快捷键。
 */
interface LogFilterPopoverProps {
  /** 关闭弹层（Esc 用；遮罩点击由父级处理） */
  onClose: () => void
}

const CHIP = 'rounded px-2 py-1 text-[11px] max-md:px-3 max-md:py-2 max-md:text-sm'
const CHIP_ON = 'bg-accent/20 text-accent'
const CHIP_OFF = 'text-neutral-500 hover:text-neutral-300'
const SECTION_LABEL = 'text-[11px] text-neutral-600 max-md:text-xs'

export function LogFilterPopover({ onClose }: LogFilterPopoverProps) {
  const log = useEditorStore((state) => state.log)
  const logView = useEditorStore((state) => state.logView)
  const patchLogFilter = useEditorStore((state) => state.patchLogFilter)
  const setArchivedDisplay = useEditorStore((state) => state.setArchivedDisplay)

  const activeKinds = Array.from(new Set(log.entries.map((entry) => entry.kind)))
  const statusFilter = logView.filter.statuses?.[0] ?? 'all'
  // 状态与已撤销显示只在「总」页签有意义，其它页签不暴露，避免无效选项
  const showsStatusSections = logView.tab === 'all'

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div
      data-log-filter-popover
      className="absolute right-0 top-full z-20 mt-1 w-72 max-w-[calc(100vw-2rem)] max-h-[60vh] overflow-y-auto rounded-lg border border-divider bg-panel p-3 shadow-xl"
    >
      {showsStatusSections ? (
        <>
          <div data-filter-section="status" className="space-y-1 max-md:space-y-2">
            <span className={SECTION_LABEL}>状态</span>
            <div className="flex flex-wrap gap-1 max-md:gap-2">
              {(['all', 'active', 'undone'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  data-filter-status={value}
                  onClick={() =>
                    patchLogFilter({ statuses: value === 'all' ? undefined : [value] })
                  }
                  className={`${CHIP} ${statusFilter === value ? CHIP_ON : CHIP_OFF}`}
                >
                  {value === 'all' ? '全部' : value === 'active' ? '只看生效' : '只看已撤销'}
                </button>
              ))}
            </div>
          </div>

          <div data-filter-section="archived" className="space-y-1 max-md:space-y-2">
            <span className={SECTION_LABEL}>已撤销</span>
            <div className="flex flex-wrap gap-1 max-md:gap-2">
              {(['thin', 'hidden', 'normal'] as const).map((mode: ArchivedDisplay) => (
                <button
                  key={mode}
                  type="button"
                  data-filter-archived={mode}
                  onClick={() => setArchivedDisplay(mode)}
                  className={`${CHIP} ${logView.archivedDisplay === mode ? CHIP_ON : CHIP_OFF}`}
                >
                  {ARCHIVED_DISPLAY_LABEL[mode]}
                </button>
              ))}
            </div>
          </div>
        </>
      ) : null}

      <div data-filter-section="kind" className="space-y-1 max-md:space-y-2">
        <span className={SECTION_LABEL}>类型</span>
        <div className="flex flex-wrap gap-1 max-md:gap-2">
          <button
            type="button"
            data-filter-kind-all
            onClick={() => patchLogFilter({ kinds: undefined })}
            className={`${CHIP} ${logView.filter.kinds ? CHIP_OFF : CHIP_ON}`}
          >
            全部
          </button>
          {activeKinds.map((kind: OperationKind) => (
            <button
              key={kind}
              type="button"
              data-filter-kind={kind}
              onClick={() => patchLogFilter({ kinds: [kind] })}
              className={`${CHIP} ${
                logView.filter.kinds?.includes(kind) ? CHIP_ON : CHIP_OFF
              }`}
            >
              {OPERATION_KIND_LABEL[kind]}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
