/**
 * 桌面外壳（占位）。
 *
 * 目标形态：Tauri 2。Tauri 提供的是"能导出文件到任意路径"的能力，
 * 对应架构文档里 `FilePort.supportsNativeSave === true` 的分支 ——
 * 桌面端不需要"导出到下载目录再自己找"的降级流程。
 *
 * 第一阶段不引入 Tauri 依赖，只保留接线位置，避免把平台判断
 * 泄漏到 core / ui。
 */

/** 桌面外壳是否已实装。真机上接入 Tauri 后改为 `true`。 */
export const DESKTOP_SHELL_READY = false

/**
 * 启动桌面外壳。
 *
 * @param _rootElement React 挂载点（真实实装时使用）
 * @throws 当前阶段尚未实现
 */
export function bootstrapDesktopShell(_rootElement: HTMLElement): never {
  throw new Error('桌面外壳尚未实现：第一阶段仅搭建骨架，接入 Tauri 2 时在此组装 AdapterContext')
}
