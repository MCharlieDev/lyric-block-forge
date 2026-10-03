/**
 * 存储端口：偏好设置、最近文件、自动保存恢复副本。
 *
 * 约定：离线程序，无账号、无服务端、无同步，所有数据只落本地。
 * 音频与波形这类大块数据由 {@link import('./waveform-cache').WaveformCachePort}
 * 单独管理，不塞进本端口。
 *
 * 平台实现提示：
 * - Web：`localStorage`（小配置）+ IndexedDB（大对象）。
 * - Tauri 2：应用数据目录下的 JSON / SQLite 文件。
 * - Capacitor：`@capacitor/preferences` + 沙箱内文件。
 */

/** 存储用量估算。 */
export interface StorageUsage {
  /** 已用字节数 */
  usageBytes: number
  /** 配额字节数，无法获取为 `null` */
  quotaBytes: number | null
}

/**
 * 键值存储端口。值需可被结构化克隆或 JSON 序列化。
 */
export interface StoragePort {
  /**
   * 读取一个值。
   *
   * @param key 存储键
   * @returns 反序列化后的值；不存在为 `null`
   */
  get<T>(key: string): Promise<T | null>

  /**
   * 写入一个值。
   *
   * @param key 存储键
   * @param value 值
   */
  set<T>(key: string, value: T): Promise<void>

  /**
   * 删除一个键。
   *
   * @param key 存储键
   */
  remove(key: string): Promise<void>

  /**
   * 列出键名。
   *
   * @param prefix 前缀过滤；缺省返回全部键
   * @returns 键名列表
   */
  keys(prefix?: string): Promise<string[]>

  /** 清空本端口管理的全部数据。 */
  clear(): Promise<void>

  /**
   * 估算存储用量。
   *
   * @returns 用量信息；平台不支持时为 `null`
   */
  estimateUsage(): Promise<StorageUsage | null>
}
