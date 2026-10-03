import type {
  AudioAnalysisPort,
  AudioPort,
  ClipboardPort,
  FilePort,
  HapticsPort,
  NotificationPort,
  SharePort,
  StoragePort,
  WaveformCachePort,
} from './ports'

/**
 * 平台适配层出口。
 *
 * 本层定义接口并附带一份 Web 端实现（`./web`）：Web 壳、Tauri 桌面壳、
 * Capacitor 移动壳可用各自的实现替换其中若干项再注入应用。
 * 这样 core 与 ui 都不会出现 `if (isTauri)` 之类的平台判断。
 */

export * from './ports'
export * from './web'

/**
 * 一组平台能力的集合。外壳层负责组装，应用层只消费。
 */
export interface AdapterContext {
  /** 文件读写 */
  file: FilePort
  /** 音频播放 */
  audio: AudioPort
  /** 本地存储 */
  storage: StoragePort
  /** 剪贴板 */
  clipboard: ClipboardPort
  /** 系统分享 */
  share: SharePort
  /** 系统通知 */
  notification: NotificationPort
  /** 震动反馈 */
  haptics: HapticsPort
  /** 波形缓存 */
  waveformCache: WaveformCachePort
  /** 音频分析 */
  audioAnalysis: AudioAnalysisPort
}
