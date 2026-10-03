import type { NotificationPort, NotifyRequest, PortCapabilities } from '../ports'

/**
 * 创建 Web 端通知端口（Notification API）。
 *
 * 权限未授予时静默跳过：分析任务属于"不阻塞创作者"的后台任务，
 * 结果仍会写回文档，通知只是锦上添花。
 *
 * @returns 通知端口实例
 */
export function createWebNotificationPort(): NotificationPort {
  const supported = (): boolean => typeof Notification !== 'undefined'

  return {
    canNotify(): PortCapabilities {
      return supported()
        ? { supported: true }
        : { supported: false, reason: '当前浏览器不支持系统通知' }
    },

    async requestPermission(): Promise<boolean> {
      if (!supported()) return false
      if (Notification.permission === 'granted') return true
      if (Notification.permission === 'denied') return false
      return (await Notification.requestPermission()) === 'granted'
    },

    async notify(request: NotifyRequest): Promise<void> {
      if (!supported() || Notification.permission !== 'granted') return
      new Notification(request.title, request.body === undefined ? {} : { body: request.body })
    },
  }
}
