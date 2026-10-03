/**
 * ui 层公共出口。
 *
 * 该层只依赖 `@core` 与 React，**不直接访问任何平台 API**：
 * 文件、音频、存储等能力由 shells 层注入的 `AdapterContext` 提供。
 */
export { App } from './App'
export { AdapterProvider, useAdapters } from './context/AdapterContext'
export { ThreeColumnLayout } from './layout/ThreeColumnLayout'
export { useEditorStore, selectVisibleEntries } from './stores/editorStore'
export type { EditorState, LogTab, LogViewState, PlaybackState, SelectionState } from './stores/editorStore'
