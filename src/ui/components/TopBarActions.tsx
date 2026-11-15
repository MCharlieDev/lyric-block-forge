import { useState } from 'react'
import { SettingsMenu } from './SettingsMenu'

/** 顶栏右侧操作区的四个外部入口。 */
export interface TopBarActionsProps {
  /** 导入音频文件（唤起音频文件选择器） */
  onImportAudio: () => void
  /** 导入歌词文件（.lrc / .txt / .docx） */
  onImportText: () => void
  /** 手动输入歌词（打开文本输入弹窗） */
  onManualInput: () => void
  /** 导出 LRC */
  onExport: () => void
}

/** 纯图标按钮统一样式：无文字，靠 `title` 提示。 */
const iconButtonClass =
  'rounded p-1 text-neutral-400 transition-colors hover:bg-white/5 hover:text-neutral-200'
/** 导入下拉条目统一样式。 */
const menuItemClass =
  'block w-full rounded px-3 py-1.5 text-left text-[11px] text-neutral-300 hover:bg-white/5 hover:text-accent'

/**
 * 顶栏操作区（桌面 / 窄屏共用一套）。
 *
 * 三个纯图标：导入（含二级下拉）/ 导出 / 设置。
 * 窄屏不再单独维护 `⋯` 菜单——两端同构，避免两套重复逻辑各自漂移。
 *
 * 各按钮都带 `data-*` 契约，harness 与后续轮次的自动化依赖它定位，
 * 不要再按可见文字匹配（这里没有可见文字）。
 */
export function TopBarActions({
  onImportAudio,
  onImportText,
  onManualInput,
  onExport,
}: TopBarActionsProps) {
  const [importOpen, setImportOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <div className="flex items-center gap-3">
      <div className="relative">
        <button
          type="button"
          data-topbar-import
          title="导入"
          aria-label="导入"
          onClick={() => setImportOpen((value) => !value)}
          className={iconButtonClass}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-5 w-5"
          >
            <path d="M4 14v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
            <path d="M12 3v10" />
            <path d="M8 9l4 4 4-4" />
          </svg>
        </button>

        {importOpen ? (
          <>
            {/* 点击面板外部关闭 */}
            <button
              type="button"
              aria-label="关闭导入菜单"
              className="fixed inset-0 z-10 cursor-default"
              onClick={() => setImportOpen(false)}
            />
            <div className="absolute right-0 top-full z-20 mt-1 w-40 rounded border border-divider bg-panel p-1 shadow-xl">
              <button
                type="button"
                data-import-audio
                className={menuItemClass}
                onClick={() => {
                  setImportOpen(false)
                  onImportAudio()
                }}
              >
                导入音频文件
              </button>
              <button
                type="button"
                data-import-text
                className={menuItemClass}
                onClick={() => {
                  setImportOpen(false)
                  onImportText()
                }}
              >
                导入歌词文件
              </button>
              <button
                type="button"
                data-import-manual
                className={menuItemClass}
                onClick={() => {
                  setImportOpen(false)
                  onManualInput()
                }}
              >
                输入歌词
              </button>
            </div>
          </>
        ) : null}
      </div>

      <button
        type="button"
        data-topbar-export
        title="导出 LRC"
        aria-label="导出 LRC"
        onClick={onExport}
        className={iconButtonClass}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-5 w-5"
        >
          <path d="M4 14v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
          <path d="M12 13V3" />
          <path d="M8 7l4-4 4 4" />
        </svg>
      </button>

      <div className="relative">
        <button
          type="button"
          data-topbar-settings
          title="设置"
          aria-label="设置"
          onClick={() => setSettingsOpen((value) => !value)}
          className={iconButtonClass}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-5 w-5"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>

        {/*
          设置面板由 SettingsMenu 自己渲染成 `top-full` 绝对定位；
          它内部那层 wrapper 是零尺寸，直接平铺会把面板顶到 header 中线。
          这里把 wrapper 锚在按钮正下方，保证面板贴着按钮下沿展开。
        */}
        <div className="absolute right-0 top-full mt-1">
          <SettingsMenu
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            hideTrigger
            panelAlign="right"
          />
        </div>
      </div>
    </div>
  )
}
