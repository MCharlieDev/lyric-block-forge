import type {
  AnalysisProgressListener,
  AudioAnalysisPort,
  AudioAnalysisTask,
  FrequencyNudgeRequest,
  FrequencyNudgeResult,
  Unsubscribe,
  VocalBoundaryRequest,
  VocalBoundaryResult,
} from '../ports'

/** 尚未接入时的统一错误信息。 */
const NOT_IMPLEMENTED = '音频分析端口尚未实现：当前阶段只完成导入 / 导出与播放链路'

/**
 * 创建 Web 端音频分析端口的占位实现。
 *
 * 频率微调与人声边界识别属于第三阶段之后的独立管道（分帧 → 特征提取 →
 * 判定 → 建议），此处只保证外壳能组装出完整的 {@link AdapterContext}，
 * 调用分析能力时明确失败，避免"静默返回空结果"误导用户。
 *
 * @returns 音频分析端口实例
 */
export function createWebAudioAnalysisPort(): AudioAnalysisPort {
  return {
    async nudgeFrequency(_request: FrequencyNudgeRequest): Promise<FrequencyNudgeResult | null> {
      throw new Error(NOT_IMPLEMENTED)
    },

    async detectVocalBoundaries(_request: VocalBoundaryRequest): Promise<VocalBoundaryResult> {
      throw new Error(NOT_IMPLEMENTED)
    },

    async hasCachedResult(_task: AudioAnalysisTask, _fingerprint: string): Promise<boolean> {
      return false
    },

    async cancel(_task?: AudioAnalysisTask): Promise<void> {
      // 无进行中的任务
    },

    onProgress(_listener: AnalysisProgressListener): Unsubscribe {
      return () => {}
    },
  }
}
