/**
 * core 层（领域层）公共出口。
 *
 * 硬性约束：
 * - 不 import React；
 * - 不访问 `window` / `document` / DOM、不调用任何平台专有 API；
 * - 不依赖 `@adapters` / `@ui` / `@shells`。
 *
 * 平台能力（文件、音频、存储、震动等）一律以接口形式由上层注入，
 * 核心逻辑因此可被 Web 壳、桌面壳、移动壳共用。
 */

export * from './types'
export * from './operations'
export * from './lyrics'
export { createId } from './utils/id'
