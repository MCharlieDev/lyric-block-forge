/**
 * 移动外壳（占位）。
 *
 * 目标形态：Capacitor。移动端的差异化能力集中在三个 Port：
 * - `HapticsPort`：拖动歌词块吸附到节拍时给一次轻震，这是移动端手感的关键；
 * - `SharePort`：调用系统分享面板，把 LRC 直接发给微信 / 隔空投送；
 * - `StoragePort`：移动端存储配额更紧张，波形缓存要更激进地清理。
 *
 * 第一阶段不引入 Capacitor 依赖，只保留接线位置。
 */

/** 移动外壳是否已实装。真机上接入 Capacitor 后改为 `true`。 */
export const MOBILE_SHELL_READY = false

/**
 * 启动移动外壳。
 *
 * @param _rootElement React 挂载点（真实实装时使用）
 * @throws 当前阶段尚未实现
 */
export function bootstrapMobileShell(_rootElement: HTMLElement): never {
  throw new Error('移动外壳尚未实现：第一阶段仅搭建骨架，接入 Capacitor 时在此组装 AdapterContext')
}
