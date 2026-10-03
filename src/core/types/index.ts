/**
 * core 层类型总出口。
 *
 * core 层是纯 TypeScript 领域层：不允许 import React，
 * 不允许触碰 `window` / `document` / DOM 或任何平台 API。
 * 平台能力一律经 `@adapters` 的 Port 接口注入。
 */

export * from './common'
export * from './timestamp'
export * from './lyric'
export * from './audio'
export * from './document'
export * from './scope'
export * from './operation'
export * from './suggestion'
export * from './validation'
