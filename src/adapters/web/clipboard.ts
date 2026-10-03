import type { ClipboardPort } from '../ports'

/**
 * 创建 Web 端剪贴板端口。
 *
 * `navigator.clipboard` 在非安全上下文或未获授权时会抛错，
 * 这里统一降级为"读不到 / 写失败"，不打断用户操作。
 *
 * @returns 剪贴板端口实例
 */
export function createWebClipboardPort(): ClipboardPort {
  return {
    async readText(): Promise<string | null> {
      try {
        if (navigator.clipboard?.readText === undefined) return null
        return await navigator.clipboard.readText()
      } catch {
        return null
      }
    },

    async writeText(text: string): Promise<boolean> {
      try {
        if (navigator.clipboard?.writeText === undefined) return false
        await navigator.clipboard.writeText(text)
        return true
      } catch {
        return false
      }
    },
  }
}
