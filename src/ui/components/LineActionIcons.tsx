/**
 * 行操作图标：全部内联 SVG，不依赖图标库，也不用 emoji。
 *
 * 用线条而非 emoji 的原因：🗑 这类字符由系统字体渲染成彩色位图，
 * 在深色界面里会跳色、且不同平台观感不一致；线条路径跟随 `currentColor`，
 * 与按钮的 hover / disabled 颜色状态天然一致。
 */
import type { ReactElement } from 'react'

/** 图标名。前四个与行操作一一对应，`more` 是 ⋮ 触发按钮。 */
export type LineActionIconName = 'move-up' | 'move-down' | 'insert' | 'delete' | 'more'

interface LineActionIconProps {
  name: LineActionIconName
  /** 尺寸与颜色类，如 `h-4 w-4`；颜色默认继承 `currentColor` */
  className?: string
}

/** 统一画布：20×20 线性图标，`strokeWidth` 1.5 在 16px 渲染尺寸下最清晰。 */
const PATHS: Record<LineActionIconName, ReactElement> = {
  'move-up': (
    <>
      <path d="M10 15.5V4.8" />
      <path d="M5.2 9.6 10 4.8l4.8 4.8" />
    </>
  ),
  'move-down': (
    <>
      <path d="M10 4.5v10.7" />
      <path d="M5.2 10.4 10 15.2l4.8-4.8" />
    </>
  ),
  insert: (
    <>
      <path d="M10 4.8v10.4" />
      <path d="M4.8 10h10.4" />
    </>
  ),
  delete: (
    <>
      <path d="M4.6 6.6h10.8" />
      <path d="M8.2 6.6V4.6h3.6v2" />
      <path d="M6.4 6.6l.6 8.6h6l.6-8.6" />
    </>
  ),
  more: (
    <>
      <circle cx="10" cy="4.6" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="10" cy="10" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="10" cy="15.4" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
}

/** 行操作图标。纯展示组件，无业务逻辑。 */
export function LineActionIcon({ name, className = 'h-4 w-4' }: LineActionIconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  )
}
