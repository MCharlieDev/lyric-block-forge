import type { TimeRange } from './common'

/**
 * 音频来源种类。
 * 离线程序约定：`file` / `object-url` 指向本地资源，不允许上传到任何服务端。
 */
export type AudioSourceKind =
  /** 本地文件（桌面 / 移动端经 FilePort 选定） */
  | 'file'
  /** 由本地文件派生的 blob URL */
  | 'object-url'
  /** 用户拖入或粘贴得到的跨域不明资源，需经用户确认后本地缓存 */
  | 'remote'

/**
 * 音频来源描述。真正的字节流由 `AudioPort` 按平台方式加载，core 层只持有引用。
 */
export interface AudioSource {
  /** 来源种类 */
  kind: AudioSourceKind
  /** 资源定位符（本地路径、blob URL 或远程 URL） */
  uri: string
  /** 展示用文件名 */
  name: string
  /** MIME 类型，未知时为 `null` */
  mimeType: string | null
  /** 字节大小，未知时为 `null` */
  sizeBytes: number | null
}

/**
 * 音频分析结果摘要。
 * 完整的分块缓存由 `WaveformCachePort` 负责，这里只保存可随时重建的小结论。
 */
export interface AudioAnalysisSummary {
  /** 分析完成时间（毫秒时间戳） */
  analyzedAt: number
  /** 节拍点集合（毫秒），用于拖动吸附 */
  beatMs: number[]
  /** 静音区间，用于间奏标记 */
  silenceRanges: TimeRange[]
  /** 人声区间，用于人声边界标记 */
  vocalRanges: TimeRange[]
}

/**
 * 音频资源模型。一个文档最多引用一个音频资源。
 */
export interface AudioAsset {
  /** 资源唯一 ID */
  id: string
  /** 音频来源 */
  source: AudioSource
  /** 时长（毫秒）。未加载完成时为 0 */
  durationMs: number
  /** 采样率（Hz），未解码时为 0 */
  sampleRate: number
  /** 声道数，未解码时为 0 */
  channelCount: number
  /**
   * 波形缓存键。由 `WaveformCachePort` 按"文件指纹 + 峰值参数"生成，
   * 为空表示尚无可用缓存。
   */
  waveformCacheKey: string | null
  /**
   * 音频指纹（内容哈希）。用于把缓存、分析结果与具体文件绑定，
   * 文件被替换时不至于复用错误缓存。
   */
  fingerprint: string | null
  /** 分析结果摘要，未分析时为 `null` */
  analysis: AudioAnalysisSummary | null
}
