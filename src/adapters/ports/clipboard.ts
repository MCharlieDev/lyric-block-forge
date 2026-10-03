/**
 * 剪贴板端口：支持手动输入、复制粘贴歌词与时间戳。
 *
 * 平台实现提示：
 * - Web：`navigator.clipboard`，非 HTTPS 环境需回退到 `document.execCommand`。
 * - Tauri 2：`@tauri-apps/plugin-clipboard-manager`。
 * - Capacitor：`@capacitor/clipboard`。
 */

/**
 * 剪贴板端口。
 */
export interface ClipboardPort {
  /**
   * 读取剪贴板文本。
   *
   * @returns 文本内容；剪贴板为空或无权限时为 `null`
   */
  readText(): Promise<string | null>

  /**
   * 写入文本到剪贴板。
   *
   * @param text 要写入的文本
   * @returns 是否写入成功
   */
  writeText(text: string): Promise<boolean>
}
