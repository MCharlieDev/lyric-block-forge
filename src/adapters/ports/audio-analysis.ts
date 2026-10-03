import type { TimeRange } from '@core/types'
import type { Unsubscribe } from './common'

/**
 * 音频分析端口：只服务两件事 —— **频率微调**与**人声边界识别**。
 *
 * 架构约束：
 * - 一套分析管道，两种输出；
 * - **用户手动触发，不自动跑**（这不是傻瓜编辑器）；
 * - 分析结果先进入建议层，用户确认后才写入文档；
 * - 算法可替换、参数可配、结果可解释。
 *
 * 管道四层：预处理（解码 PCM / 分帧 / 加窗）→ 特征提取（短时能量、
 * 过零率、频谱质心、基频、MFCC）→ 判定（双门限比较法等）→ 应用输出。
 *
 * 平台实现提示：
 * - Web：Web Worker + Web Audio API 或 WASM，纯客户端计算，不上传服务器。
 * - Tauri 2：Rust 侧做分析，性能更好。
 * - Capacitor：原生插件或 WASM。
 */

/** 分析任务类型。 */
export type AudioAnalysisTask = 'frequency-nudge' | 'vocal-boundary'

/** 分析进度回调。 */
export interface AnalysisProgress {
  /** 所属任务 */
  task: AudioAnalysisTask
  /** 进度，取值区间 `[0, 1]` */
  progress: number
  /** 阶段说明，例如"提取特征" */
  stage: string
}

/** 分析进度监听器。 */
export type AnalysisProgressListener = (progress: AnalysisProgress) => void

/**
 * 频率微调请求。
 *
 * 只分析选中行附近的一小段（前后各约 500ms），保证毫秒级精度：
 * 帧长要短、重叠要大，必要时用抛物线插值提高时间分辨率。
 */
export interface FrequencyNudgeRequest {
  /** 音频指纹，用于绑定缓存 */
  fingerprint: string
  /** 目标时间（毫秒） */
  timeMs: number
  /** 目标附近的搜索半径（毫秒），缺省 500 */
  searchRadiusMs?: number
  /** 关联的行 ID，仅用于把结果回填到建议的 scope */
  lineId?: string
}

/** 频率微调结果。 */
export interface FrequencyNudgeResult {
  /** 原始粗略时间（毫秒） */
  originalMs: number
  /** 建议的精确时间（毫秒） */
  suggestedMs: number
  /** 建议相对于原始时间的偏移量（毫秒） */
  offsetMs: number
  /** 置信度，取值区间 `[0, 1]` */
  confidence: number
  /** 精度（毫秒），表示结果可信到哪个粒度 */
  precisionMs: number
  /** 可解释的判定依据，例如"短时能量峰值" */
  rationale: string
}

/**
 * 人声边界识别请求（分析整首歌，百毫秒级精度，可后台跑）。
 */
export interface VocalBoundaryRequest {
  /** 音频指纹，用于绑定缓存 */
  fingerprint: string
  /** 双门限能量法的上/下门限倍数，可配 */
  thresholds?: { high: number; low: number }
}

/** 人声边界识别结果。 */
export interface VocalBoundaryResult {
  /** 人声区间列表，按时间升序 */
  vocalRanges: TimeRange[]
  /** 静音区间列表，用于间奏标记 */
  silenceRanges: TimeRange[]
  /** 置信度，取值区间 `[0, 1]` */
  confidence: number
  /** 精度（毫秒） */
  precisionMs: number
}

/**
 * 音频分析端口。
 */
export interface AudioAnalysisPort {
  /**
   * 频率微调：给定粗略时间戳，返回建议的精确时间戳。
   *
   * @param request 微调请求
   * @returns 微调结果；该位置无可识别起音时为 `null`
   */
  nudgeFrequency(request: FrequencyNudgeRequest): Promise<FrequencyNudgeResult | null>

  /**
   * 人声边界识别：返回整首歌的人声区间。
   *
   * @param request 识别请求
   * @returns 识别结果
   */
  detectVocalBoundaries(request: VocalBoundaryRequest): Promise<VocalBoundaryResult>

  /**
   * 查询某任务是否已有可用缓存，UI 可据此提示"复用上次结果"。
   *
   * @param task 任务类型
   * @param fingerprint 音频指纹
   * @returns 是否有缓存
   */
  hasCachedResult(task: AudioAnalysisTask, fingerprint: string): Promise<boolean>

  /**
   * 取消正在进行的分析（用户切歌或关闭文档时调用）。
   *
   * @param task 任务类型；缺省取消全部任务
   */
  cancel(task?: AudioAnalysisTask): Promise<void>

  /**
   * 订阅分析进度。
   *
   * @param listener 进度回调
   * @returns 取消订阅函数
   */
  onProgress(listener: AnalysisProgressListener): Unsubscribe
}
