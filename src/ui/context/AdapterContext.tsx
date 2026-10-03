import { createContext, useContext, type ReactNode } from 'react'
import type { AdapterContext } from '@adapters'

/**
 * 平台能力注入点。
 *
 * ui 层需要文件、音频等能力，但**不允许直接访问平台 API**：
 * 外壳层把实现好的 {@link AdapterContext} 从外部注入，
 * 组件通过 {@link useAdapters} 取用，从而同一套 UI 可以跑在 Web / 桌面 / 移动上。
 */
const PlatformAdaptersContext = createContext<AdapterContext | null>(null)

/** 平台能力提供者，由外壳层在 React 根节点处包裹应用。 */
export function AdapterProvider({
  adapters,
  children,
}: {
  adapters: AdapterContext
  children: ReactNode
}) {
  return <PlatformAdaptersContext.Provider value={adapters}>{children}</PlatformAdaptersContext.Provider>
}

/**
 * 读取当前平台能力集合。
 *
 * @returns 平台适配器集合
 * @throws 未包裹在 `AdapterProvider` 内时抛错，避免静默拿到 `undefined`
 */
export function useAdapters(): AdapterContext {
  const adapters = useContext(PlatformAdaptersContext)
  if (adapters === null) {
    throw new Error('useAdapters 必须在 <AdapterProvider> 内使用，请由外壳层注入 AdapterContext')
  }
  return adapters
}
