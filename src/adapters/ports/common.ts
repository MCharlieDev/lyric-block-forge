/**
 * 平台适配层的公共小类型。
 *
 * 适配层是 core 与平台之间的唯一边界：core 只认识这里的接口，
 * 各外壳（Web / Tauri 桌面 / Capacitor 移动）负责提供具体实现。
 */

/** 取消订阅函数，调用后不再接收事件。 */
export type Unsubscribe = () => void

/** 可释放资源。 */
export interface Disposable {
  /** 释放内部持有的资源（监听器、句柄、缓存句柄等） */
  dispose(): void
}

/**
 * 能力探测结果。
 * 移动端与桌面端能力差异较大（例如震动、系统分享），
 * UI 通过该结果决定是否展示对应入口。
 */
export interface PortCapabilities {
  /** 是否具备该能力 */
  supported: boolean
  /** 不具备或降级时的原因说明，供 UI 做提示 */
  reason?: string
}
