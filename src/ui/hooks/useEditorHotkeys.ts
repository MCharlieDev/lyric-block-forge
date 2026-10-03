import { useEffect } from 'react'
import { useAdapters } from '../context/AdapterContext'
import {
  NUDGE_STEP_MS,
  moveSelection,
  nudgeSelection,
  removeSelectedLines,
  stampActiveLine,
  togglePlayback,
} from '../utils/editorCommands'

/**
 * 默认快捷键表。
 *
 * **本表是快捷键的唯一来源**：hook 内部一律从这张表读，
 * 任何地方都不直接写 `'Space'` / `'KeyE'`。
 * 将来"快捷键可自定义"那一轮，只需把这张常量表换成从设置读取，
 * 这里就是唯一改动点（本轮不做设置 UI、键位存储、冲突检测、恢复默认）。
 *
 * 一律用 `event.code` 匹配**物理键位**，不用 `event.key`：
 * `event.key` 受键盘布局与输入法影响（Dvorak 下 `' '` 未必在空格键上），
 * `event.code` 才对应"用户按了哪个键"。
 */
export const DEFAULT_HOTKEYS = {
  /** 打轴 */
  stamp: 'Space',
  /** 播放 / 暂停 */
  togglePlay: 'KeyE',
  /** 选中上一可见行 */
  prevLine: 'ArrowUp',
  /** 选中下一可见行 */
  nextLine: 'ArrowDown',
  /** 当前选中行时间戳 -10ms */
  nudgeBackward: 'ArrowLeft',
  /** 当前选中行时间戳 +10ms */
  nudgeForward: 'ArrowRight',
  /** 删除选中的歌词行（多选删除，作用于 selection.lineIds 全集） */
  deleteSelection: 'Delete',
  /** 删除选中行（退格键别名，与 Delete 同义） */
  deleteSelectionAlt: 'Backspace',
} as const

/**
 * 文本输入语义的 `<input type>`：焦点落在这些控件上时快捷键停用。
 *
 * 划分依据是"这个控件要不要自由录入文字 / 空格有没有原生语义"：
 * - 文本类：text / search / email / url / tel / password / number；
 * - checkbox / radio：空格是原生切换，若放行会"勾选 + 打轴"同时发生。
 *
 * 刻意**不含** `range` / `select`：它们没有文本输入语义
 * （range 用方向键，select 用方向键 + 原生 typeahead），
 * 用户调完音量 / 倍速后紧接着要打轴，这时按键失效会让人以为快捷键坏了。
 */
const TEXT_INPUT_TYPES = new Set([
  'text',
  'search',
  'email',
  'url',
  'tel',
  'password',
  'number',
  'checkbox',
  'radio',
])

/**
 * 焦点是否处于"文本输入语义"的控件上（产品决定 D1）。
 */
function blocksHotkeys(target: Element | null): boolean {
  if (target === null) return false
  if (target instanceof HTMLTextAreaElement) return true
  if (target instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(target.type)
  if (target instanceof HTMLElement && target.isContentEditable) return true
  return false
}

/**
 * 是否有模态弹窗打开（产品决定 D2）。
 *
 * **约定：本项目所有模态弹窗必须带 `role="dialog"` + `aria-modal="true"`**，
 * 快捷键层依赖此约定判定"弹窗打开 → 快捷键停用"。
 * 非模态的点击遮罩（如 SettingsMenu、侧栏遮罩）不带这两个属性，不受影响。
 */
function hasOpenDialog(): boolean {
  return document.querySelector('[role="dialog"], [aria-modal="true"]') !== null
}

/**
 * 焦点是否在"靠方向键操作"的原生控件上（range 滑块 / select 下拉）。
 *
 * {@link blocksHotkeys} 刻意放行这两类控件（理由见其注释），但方向键是它们
 * **唯一的键盘调整手段**：滑块靠 ←/→ 调值、下拉靠 ↑/↓ 换项。
 * 若方向键作为全局热键被接管，键盘用户将完全无法操作它们。
 * 打轴主流程靠 Space / E，不靠方向键，因此这条例外不影响创作动线。
 */
function defersDirectionsToNative(target: Element | null): boolean {
  if (target instanceof HTMLSelectElement) return true
  if (target instanceof HTMLInputElement && target.type === 'range') return true
  return false
}

/**
 * 编辑器全局快捷键（产品决定 B / C / D / G）。
 *
 * 在顶层挂载一次（`App.tsx`），监听 `window` 的 keydown；
 * 快捷键是全局的，挂在局部组件上会因为焦点不在该组件而收不到按键。
 *
 * ## 判断顺序（停用规则优先级从高到低，空格与 E 共用）
 * 1. `event.repeat` 为真 → 跳过（长按不连发）；
 * 2. `event.isComposing` 为真 → 跳过（输入法组合中，按键属于候选词操作）；
 * 3. 焦点在文本输入语义控件上 → 不生效，键就是键本身；
 * 4. 有模态弹窗打开 → 不生效；
 * 5. 命中键位 → `preventDefault()` 后执行；未命中 → 直接返回，不动默认行为。
 *
 * `preventDefault()` 必须做：否则空格会滚动页面，E 可能触发其他默认行为。
 * 第 5 条含"焦点在 button 上"：创作者点过播放按钮后焦点会留在它上面，
 * 若这时把键让给按钮，会让人以为快捷键坏了。实测确认在 keydown 上
 * `preventDefault()` 足以阻止 button 的 Space 激活（Space 激活发生在 keyup，
 * 但 keydown 的 preventDefault 会取消该默认动作）。
 *
 * ## 方向键的例外
 * 四个方向键命中后，若焦点在"靠方向键操作"的原生控件上
 * （{@link defersDirectionsToNative}：range 滑块 / select 下拉），
 * 直接返回 —— 不 `preventDefault()`、不执行命令，把方向键留给控件本身。
 * 这是第 3 条（`blocksHotkeys` 放行 range / select）的延伸：
 * Space / E 不受影响，仍按既有规则走。
 */
export function useEditorHotkeys(): void {
  const adapters = useAdapters()

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.repeat) return
      if (event.isComposing) return
      const active = document.activeElement
      if (blocksHotkeys(active)) return
      if (hasOpenDialog()) return

      switch (event.code) {
        case DEFAULT_HOTKEYS.stamp:
          event.preventDefault()
          stampActiveLine(adapters)
          return
        case DEFAULT_HOTKEYS.togglePlay:
          event.preventDefault()
          togglePlayback(adapters)
          return
        // 四个方向键命中后先让位给原生控件（滑块 / 下拉），
        // 见 defersDirectionsToNative 的理由；Space / E 不受此判断影响。
        case DEFAULT_HOTKEYS.prevLine:
          if (defersDirectionsToNative(active)) return
          event.preventDefault()
          moveSelection(-1)
          return
        case DEFAULT_HOTKEYS.nextLine:
          if (defersDirectionsToNative(active)) return
          event.preventDefault()
          moveSelection(1)
          return
        case DEFAULT_HOTKEYS.nudgeBackward:
          if (defersDirectionsToNative(active)) return
          event.preventDefault()
          nudgeSelection(-NUDGE_STEP_MS)
          return
        case DEFAULT_HOTKEYS.nudgeForward:
          if (defersDirectionsToNative(active)) return
          event.preventDefault()
          nudgeSelection(NUDGE_STEP_MS)
          return
        // 删除选中行（多选删除）。无选中时 removeSelectedLines 内部静默返回；
        // 焦点在文本输入 / 弹窗打开时已在 switch 之前放行，故不会误删。
        case DEFAULT_HOTKEYS.deleteSelection:
        case DEFAULT_HOTKEYS.deleteSelectionAlt:
          event.preventDefault()
          removeSelectedLines()
          return
        default:
          return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [adapters])
}
