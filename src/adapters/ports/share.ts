import type { PortCapabilities } from './common'

/**
 * 分享端口：把导出的 LRC 文件交给系统分享面板。
 *
 * 移动端文件位于应用沙箱内，**必须有"导出到系统"或"分享"入口**，
 * 否则用户无法把成果取出，本端口就是那个出入口。
 *
 * 平台实现提示：
 * - Web：`navigator.share`（移动浏览器优先），不支持时降级为下载。
 * - Tauri 2：`@tauri-apps/plugin-opener` 打开系统文件管理器定位文件。
 * - Capacitor：`@capacitor/share`。
 */

/** 分享请求。 */
export interface ShareRequest {
  /** 分享标题 */
  title?: string
  /** 分享附带的说明文本 */
  text?: string
  /** 分享的文件名（含扩展名） */
  fileName?: string
  /** 分享的文件内容 */
  data?: Blob
}

/**
 * 分享端口。
 */
export interface SharePort {
  /**
   * 探测分享能力，用于决定是否展示分享入口。
   *
   * @returns 能力探测结果
   */
  canShare(): PortCapabilities

  /**
   * 调起系统分享。
   *
   * @param request 分享请求
   * @returns 是否完成分享；用户取消或无能力时为 `false`
   */
  share(request: ShareRequest): Promise<boolean>
}
