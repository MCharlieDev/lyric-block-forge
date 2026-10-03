import type { WaveformBlock, WaveformCacheKey, WaveformCachePort } from '../ports'

/**
 * 创建 Web 端波形缓存端口（内存实现）。
 *
 * 本阶段只做内存占位，供任务 2 的波形渲染先把链路跑通；
 * 后续替换为 IndexedDB 持久化时，接口与调用方都无需改动。
 *
 * @returns 波形缓存端口实例
 */
export function createWebWaveformCachePort(): WaveformCachePort {
  const blocks = new Map<string, WaveformBlock>()

  const entryId = (key: WaveformCacheKey, blockIndex: number): string =>
    `${key.fingerprint}|${key.samplesPerMs}|${key.blockDurationMs}|${blockIndex}`

  const fingerprintPrefix = (fingerprint: string): string => `${fingerprint}|`

  return {
    async getBlock(key: WaveformCacheKey, blockIndex: number): Promise<WaveformBlock | null> {
      return blocks.get(entryId(key, blockIndex)) ?? null
    },

    async putBlock(key: WaveformCacheKey, blockIndex: number, block: WaveformBlock): Promise<void> {
      blocks.set(entryId(key, blockIndex), block)
    },

    async getRange(
      key: WaveformCacheKey,
      rangeMs: { startMs: number; endMs: number },
    ): Promise<WaveformBlock[]> {
      const prefix = fingerprintPrefix(key.fingerprint)
      const hits: WaveformBlock[] = []
      for (const [id, block] of blocks) {
        if (!id.startsWith(prefix)) continue
        if (block.startMs >= rangeMs.endMs) continue
        if (block.startMs + block.durationMs <= rangeMs.startMs) continue
        hits.push(block)
      }
      return hits.sort((a, b) => a.startMs - b.startMs)
    },

    async invalidate(fingerprint: string): Promise<void> {
      const prefix = fingerprintPrefix(fingerprint)
      for (const id of [...blocks.keys()]) {
        if (id.startsWith(prefix)) blocks.delete(id)
      }
    },

    async clear(): Promise<void> {
      blocks.clear()
    },
  }
}
