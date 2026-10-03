import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createWebAdapters } from '@adapters'
import { AdapterProvider, App } from '@ui'

/**
 * Web 外壳入口。
 *
 * 外壳层的职责是"接线"：把平台实现组装成 {@link AdapterContext} 注入应用，
 * 并负责挂载 React 根节点。core 与 ui 都不感知自己跑在哪个平台上。
 *
 * 这里装配 {@link createWebAdapters} 产出的浏览器实现（File System Access API /
 * Web Audio / localStorage / navigator.share 等），并通过 `<AdapterProvider>` 注入。
 *
 * @param rootElement React 挂载点
 */
export function bootstrapWebShell(rootElement: HTMLElement): void {
  const adapters = createWebAdapters()
  createRoot(rootElement).render(
    <StrictMode>
      <AdapterProvider adapters={adapters}>
        <App />
      </AdapterProvider>
    </StrictMode>,
  )
}
