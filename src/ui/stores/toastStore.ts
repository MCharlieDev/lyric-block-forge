import { create } from 'zustand'

/**
 * 同一条消息的去重窗口（毫秒）。
 *
 * 窗口内再次到达的同文案提示直接丢弃、且**不刷新**自动消失计时：
 * 连按方向键微调 N 次只会看到一条提示，而不是被反复"续命"。
 */
const DEDUP_WINDOW_MS = 3000

/** 提示状态与动作。 */
export interface ToastState {
  /** 当前提示文案；`null` 表示无提示 */
  message: string | null
  /** 每次"真正展示"自增，供宿主重置自动消失计时（被去重丢弃时不增） */
  seq: number
  /** 展示一条提示（命中去重窗口则丢弃） */
  showToast: (message: string) => void
  /** 手动关闭当前提示 */
  dismissToast: () => void
}

/** 最近一次真正展示的文案与时间戳，去重判定用（模块级，不进状态）。 */
let lastMessage: string | null = null
let lastShownAt = 0

/**
 * 提示存储。
 *
 * 用 zustand 而非组件本地状态：触发方之一是 `editorCommands`（React 之外的模块），
 * 它只能通过 store 的 `getState()` 触达 UI。
 *
 * 单槽语义：后到的提示直接替换前一条，不做堆叠。
 */
export const useToastStore = create<ToastState>()((set, get) => ({
  message: null,
  seq: 0,

  showToast: (message) => {
    const now = Date.now()
    // 同文案在去重窗口内再次到达：丢弃，且不刷新计时（不改 seq）
    if (message === lastMessage && now - lastShownAt < DEDUP_WINDOW_MS) return
    lastMessage = message
    lastShownAt = now
    set({ message, seq: get().seq + 1 })
  },

  dismissToast: () => set({ message: null }),
}))

/**
 * React 之外的模块触发提示的入口。
 *
 * 与按钮 / 快捷键一致：两条入口都走同一个 store 动作，只有一份实现。
 *
 * @param message 提示文案
 */
export function showToast(message: string): void {
  useToastStore.getState().showToast(message)
}
