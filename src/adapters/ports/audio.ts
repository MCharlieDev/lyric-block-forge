import type { AudioAsset } from '@core/types'
import type { Unsubscribe } from './common'

/**
 * 音频端口：播放、暂停、定位、速率与音量控制。
 *
 * 设计要点：**音频时钟是播放的唯一基准**。编辑器的播放头位置、
 * 选区、打轴时间都从这个端口取，不从 UI 动画帧推算。
 *
 * 平台实现提示：
 * - Web：`<audio>` 元素或 Web Audio API 的 `AudioBufferSourceNode`。
 * - Tauri 2：Web 实现即可，或 Rust 侧解码后回传 PCM。
 * - Capacitor：`@capacitor-community/native-audio` 或 Web 实现。
 */

/** 音频播放状态机。 */
export type AudioPlaybackState =
  /** 未加载任何音频 */
  | 'idle'
  /** 正在加载 / 解码 */
  | 'loading'
  /** 已就绪但未播放 */
  | 'ready'
  /** 播放中 */
  | 'playing'
  /** 已暂停 */
  | 'paused'
  /** 播放到结尾 */
  | 'ended'
  /** 加载或播放失败 */
  | 'error'

/** 播放进度回调。 */
export type AudioTickListener = (timeMs: number) => void

/** 播放状态变化回调。 */
export type AudioStateListener = (state: AudioPlaybackState) => void

/**
 * 波形峰值金字塔的构建状态。
 * - `idle`：尚无音频或尚未开始构建；
 * - `building`：正在构建（`preparePeaks` 已调用）；
 * - `ready`：可用；
 * - `error`：构建失败。
 */
export type AudioPeakState = 'idle' | 'building' | 'ready' | 'error'

/** 峰值状态变化回调。 */
export type AudioPeakStateListener = (state: AudioPeakState) => void

/**
 * 峰值金字塔的一档层级。
 *
 * 第 0 档是最细的，之后每一档由相邻两个桶合并而来（mipmap）。
 * 渲染时按"每像素采样数"挑一档足够细的层级，再聚合成屏幕像素宽度，
 * 这样任何缩放级别下的工作量都只与**屏幕宽度**相关，与音频总长无关。
 */
export interface PeakLevel {
  /** 每个桶覆盖多少个原始采样点 */
  samplesPerBucket: number
  /** 桶数量 */
  bucketCount: number
  /** 每桶最小值，长度等于 `bucketCount` */
  min: Float32Array
  /** 每桶最大值，长度等于 `bucketCount` */
  max: Float32Array
}

/**
 * 一段时间的峰值查询结果：已按输出桶数聚合、可直接画柱。
 */
export interface PeakRange {
  /** 查询起点（毫秒） */
  startMs: number
  /** 每个输出桶覆盖的毫秒数 */
  msPerBucket: number
  /** 每桶最小值，取值 `[-1, 1]` */
  min: Float32Array
  /** 每桶最大值，取值 `[-1, 1]` */
  max: Float32Array
}

/**
 * 音频技术参数。解码完成后才可用，用于填充 `AudioAsset` 与波形缓存键。
 */
export interface AudioSpec {
  /** 采样率（Hz） */
  sampleRate: number
  /** 声道数 */
  channelCount: number
  /** 时长（毫秒） */
  durationMs: number
}

/**
 * 音频播放端口。
 */
export interface AudioPort {
  /**
   * 加载音频资源。加载完成前 `getDurationMs()` 返回 0。
   *
   * @param asset 音频资源
   */
  load(asset: AudioAsset): Promise<void>

  /** 卸载当前音频并释放资源。 */
  unload(): Promise<void>

  /** 从当前播放头位置开始播放。 */
  play(): Promise<void>

  /** 暂停播放，保留播放头位置。 */
  pause(): Promise<void>

  /**
   * 定位播放头。
   *
   * @param timeMs 目标时间（毫秒），会被裁剪到 `[0, durationMs]`
   */
  seek(timeMs: number): Promise<void>

  /**
   * 读取当前播放头位置。
   *
   * @returns 当前时间（毫秒）
   */
  getCurrentTimeMs(): number

  /**
   * 读取音频总时长。
   *
   * @returns 时长（毫秒）；未加载完成时为 0
   */
  getDurationMs(): number

  /**
   * 读取已解码音频的技术参数。
   *
   * @returns 采样率 / 声道数 / 时长；未加载完成时为 `null`
   */
  getSpec(): AudioSpec | null

  /**
   * 设置播放速率。
   *
   * @param rate 速率倍数，`1` 为原速
   */
  setPlaybackRate(rate: number): void

  /**
   * 设置音量。
   *
   * @param volume 音量，取值区间 `[0, 1]`
   */
  setVolume(volume: number): void

  /**
   * 订阅播放进度。回调频率由实现决定，UI 侧仍需自行节流渲染。
   *
   * @param listener 进度回调
   * @returns 取消订阅函数
   */
  onTick(listener: AudioTickListener): Unsubscribe

  /**
   * 订阅播放状态变化。
   *
   * @param listener 状态回调
   * @returns 取消订阅函数
   */
  onStateChange(listener: AudioStateListener): Unsubscribe

  /**
   * 读取峰值金字塔的构建状态。
   *
   * @returns 当前构建状态
   */
  getPeakState(): AudioPeakState

  /**
   * 构建峰值金字塔。已就绪时直接返回；正在构建时复用同一个任务。
   *
   * 波形层在音频加载完成后调用一次即可，构建过程不应阻塞播放。
   */
  preparePeaks(): Promise<void>

  /**
   * 查询时间窗内的峰值，已按 `bucketCount` 聚合到屏幕像素粒度。
   *
   * @param startMs 窗口起点（毫秒）
   * @param endMs 窗口终点（毫秒）
   * @param bucketCount 输出桶数，通常等于视口像素宽度
   * @returns 峰值区间；尚未就绪时为 `null`
   */
  getPeaks(startMs: number, endMs: number, bucketCount: number): PeakRange | null

  /**
   * 订阅峰值状态变化。
   *
   * @param listener 状态回调
   * @returns 取消订阅函数
   */
  onPeaksChange(listener: AudioPeakStateListener): Unsubscribe
}
