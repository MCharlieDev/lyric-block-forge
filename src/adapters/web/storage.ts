import type { StoragePort, StorageUsage } from '../ports'

/** 所有键统一加前缀，保证 `clear()` 只清理本应用的数据。 */
const NAMESPACE = 'lrc-editor:'

/**
 * 创建 Web 端存储端口（`localStorage`）。
 *
 * 本阶段只承载偏好设置这类小数据；波形缓存与恢复副本等大对象
 * 由 IndexedDB 承载（见 `createWebWaveformCachePort`），不塞进这里。
 *
 * @returns 存储端口实例
 */
export function createWebStoragePort(): StoragePort {
  const listKeys = (prefix?: string): string[] => {
    const names: string[] = []
    for (let index = 0; index < localStorage.length; index += 1) {
      const storageKey = localStorage.key(index)
      if (storageKey === null || !storageKey.startsWith(NAMESPACE)) continue
      const name = storageKey.slice(NAMESPACE.length)
      if (prefix === undefined || name.startsWith(prefix)) names.push(name)
    }
    return names
  }

  return {
    async get<T>(key: string): Promise<T | null> {
      const raw = localStorage.getItem(NAMESPACE + key)
      if (raw === null) return null
      try {
        return JSON.parse(raw) as T
      } catch {
        return null
      }
    },

    async set<T>(key: string, value: T): Promise<void> {
      localStorage.setItem(NAMESPACE + key, JSON.stringify(value))
    },

    async remove(key: string): Promise<void> {
      localStorage.removeItem(NAMESPACE + key)
    },

    async keys(prefix?: string): Promise<string[]> {
      return listKeys(prefix)
    },

    async clear(): Promise<void> {
      for (const name of listKeys()) localStorage.removeItem(NAMESPACE + name)
    },

    async estimateUsage(): Promise<StorageUsage | null> {
      if (navigator.storage?.estimate === undefined) return null
      const { usage, quota } = await navigator.storage.estimate()
      return { usageBytes: usage ?? 0, quotaBytes: quota ?? null }
    },
  }
}
