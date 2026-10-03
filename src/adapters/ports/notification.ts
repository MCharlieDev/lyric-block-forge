import type { PortCapabilities } from './common'

/**
 * 通知端口：后台任务完成提示（例如"人声边界分析已完成"）。
 *
 * 音频分析是用户手动触发的长任务，允许后台跑完再通知，
 * 因此该端口是"不阻塞创作者"这一体验的关键。
 *
 * 平台实现提示：
 * - Web：`Notification` API（需用户授权）+ 页内 toast 兜底。
 * - Tauri 2：`@tauri-apps/plugin-notification`。
 * - Capacitor：`@capacitor/local-notifications`。
 */

/** 通知级别，UI 侧可据此决定样式与是否打断。 */
export type NotificationLevel = 'info' | 'success' | 'warning' | 'error'

/** 通知请求。 */
export interface NotifyRequest {
  /** 标题 */
  title: string
  /** 正文 */
  body?: string
  /** 级别，缺省为 `info` */
  level?: NotificationLevel
  /**
   * 关联的文档 ID，用于点击通知后回到对应文档。
   */
  documentId?: string
}

/**
 * 通知端口。
 */
export interface NotificationPort {
  /**
   * 探测通知能力。
   *
   * @returns 能力探测结果
   */
  canNotify(): PortCapabilities

  /**
   * 申请通知权限。应在用户明确触发相关功能时调用。
   *
   * @returns 是否已获得权限
   */
  requestPermission(): Promise<boolean>

  /**
   * 发送通知。
   *
   * @param request 通知请求
   */
  notify(request: NotifyRequest): Promise<void>
}
