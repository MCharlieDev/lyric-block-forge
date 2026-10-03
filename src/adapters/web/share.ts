import type { PortCapabilities, SharePort, ShareRequest } from '../ports'

/**
 * 创建 Web 端分享端口。
 *
 * 移动浏览器优先走 `navigator.share`；不支持时 `canShare()` 返回不可用，
 * UI 应回退到"导出 LRC"（下载）入口。
 *
 * @returns 分享端口实例
 */
export function createWebSharePort(): SharePort {
  const hasShareApi = (): boolean =>
    typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  return {
    canShare(): PortCapabilities {
      return hasShareApi()
        ? { supported: true }
        : { supported: false, reason: '当前浏览器不支持系统分享，请改用导出下载' }
    },

    async share(request: ShareRequest): Promise<boolean> {
      if (!hasShareApi()) return false

      const payload: ShareData = {}
      if (request.title !== undefined) payload.title = request.title
      if (request.text !== undefined) payload.text = request.text

      if (request.data !== undefined) {
        const file = new File([request.data], request.fileName ?? 'lyrics.lrc', {
          type: request.data.type === '' ? 'text/plain' : request.data.type,
        })
        if (navigator.canShare?.({ files: [file] }) === true) payload.files = [file]
      }

      try {
        await navigator.share(payload)
        return true
      } catch {
        // 用户取消也会走到这里，按"未完成分享"处理
        return false
      }
    },
  }
}
