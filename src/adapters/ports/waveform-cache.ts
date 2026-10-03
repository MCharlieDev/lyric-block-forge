/**
 * 波形缓存端口：波形峰值数据的分块读写。
 *
 * 设计约束（对应"大文件"策略）：
 * - 波形数据量大，必须**分块**存储与读取，时间轴只渲染可视区域；
 * - 缓存键由"文件指纹 + 峰值参数"构成，文件被替换时不会误用旧缓存；
 * - 预处理与特征提取结果同样按块缓存，与音频文件指纹绑定。
 *
 * 平台实现提示：
 * - Web：IndexedDB（Blob / 数组缓冲）。
 * - Tauri 2：应用数据目录下的二进制文件。
 * - Capacitor：沙箱内文件或原生存储。
 */

/**
 * 单个时间块的波形峰值。
 *
 * 峰值采用 min/max 双值而非单值，避免渲染时波形"消失"或失真。
 */
export interface WaveformBlock {
  /** 该块起始时间（毫秒） */
  startMs: number
  /** 该块覆盖的时长（毫秒） */
  durationMs: number
  /** 每个采样点的最小值，取值区间 `[-1, 1]` */
  min: Float32Array
  /** 每个采样点的最大值，取值区间 `[-1, 1]` */
  max: Float32Array
}

/**
 * 波形缓存键。任何一个字段变化都会生成不同的缓存条目。
 */
export interface WaveformCacheKey {
  /** 音频文件指纹（内容哈希） */
  fingerprint: string
  /** 每毫秒的采样点数（缩放级别） */
  samplesPerMs: number
  /** 块覆盖的时长（毫秒） */
  blockDurationMs: number
}

/**
 * 波形缓存端口。
 */
export interface WaveformCachePort {
  /**
   * 读取一个波形块。
   *
   * @param key 缓存键
   * @param blockIndex 块序号，从 0 开始
   * @returns 波形块；未命中为 `null`
   */
  getBlock(key: WaveformCacheKey, blockIndex: number): Promise<WaveformBlock | null>

  /**
   * 写入一个波形块。
   *
   * @param key 缓存键
   * @param blockIndex 块序号
   * @param block 波形块数据
   */
  putBlock(key: WaveformCacheKey, blockIndex: number, block: WaveformBlock): Promise<void>

  /**
   * 读取一段连续时间范围所需的全部已缓存块。
   *
   * @param key 缓存键
   * @param rangeMs 时间范围（毫秒）
   * @returns 命中的块列表，按块序号升序；缺失的块不返回
   */
  getRange(key: WaveformCacheKey, rangeMs: { startMs: number; endMs: number }): Promise<WaveformBlock[]>

  /**
   * 删除某个指纹下的全部缓存（音频文件被替换时调用）。
   *
   * @param fingerprint 音频文件指纹
   */
  invalidate(fingerprint: string): Promise<void>

  /** 清空全部波形缓存。 */
  clear(): Promise<void>
}
