import type { PeakLevel, PeakRange } from '../ports'

/**
 * 主线程侧的峰值搬运与查询。
 *
 * 分工：
 * - `buildPeakPyramid` 只做"切片 + 拷贝 + transfer"和一次节流让步，
 *   真正的聚合在 `waveform.worker.ts` 里；
 * - `queryPeaks` 在金字塔上做 O(输出桶数) 的查询，与音频总长无关，
 *   因此缩放 / 滚动时每帧重新查询也是常数开销。
 *
 * 关于拷贝：`AudioBuffer.getChannelData()` 返回的是 AudioBuffer 内部内存的
 * **视图**，直接 transfer 会 detach 掉解码数据，所以必须 `set()` 拷贝。
 * 为此按块拷贝（默认 1M 采样 ≈ 4MB），块之间让出主线程。
 */

/** 第 0 档的采样粒度；64 个采样约等于 1.5ms（44.1kHz），已细于最大缩放下的单像素。 */
const BASE_SAMPLES_PER_BUCKET = 64

/** 第 0 档桶数上限，避免超长音频把内存撑爆（超出则自动加粗粒度）。 */
const MAX_BASE_BUCKETS = 1 << 19

/** 单次搬运给 Worker 的采样数上限。 */
const CHUNK_SAMPLES = 1 << 20

export interface PeakStartMessage {
  type: 'start'
  sampleRate: number
  channelCount: number
  totalSamples: number
  samplesPerBucket: number
}

export interface PeakSamplesMessage {
  type: 'samples'
  channel: number
  startSample: number
  data: Float32Array
}

export interface PeakFinishMessage {
  type: 'finish'
}

export type PeakRequest = PeakStartMessage | PeakSamplesMessage | PeakFinishMessage

export interface PeakReadyMessage {
  type: 'ready'
  levels: PeakLevel[]
}

export interface PeakErrorMessage {
  type: 'error'
  message: string
}

export type PeakResponse = PeakReadyMessage | PeakErrorMessage

/** 构建完成的峰值金字塔，`levels[0]` 最细，之后逐档加粗。 */
export interface PeakPyramid {
  sampleRate: number
  durationMs: number
  levels: PeakLevel[]
}

/** 构建被调用方取消（通常是又加载了新音频）。 */
export class PeakBuildCancelledError extends Error {
  constructor() {
    super('峰值构建已取消')
    this.name = 'PeakBuildCancelledError'
  }
}

export interface PeakBuildHandle {
  promise: Promise<PeakPyramid>
  cancel(): void
}

const chooseSamplesPerBucket = (totalSamples: number): number => {
  let samplesPerBucket = BASE_SAMPLES_PER_BUCKET
  while (Math.ceil(totalSamples / samplesPerBucket) > MAX_BASE_BUCKETS) samplesPerBucket *= 2
  return samplesPerBucket
}

const feedChunks = async (
  worker: Worker,
  buffer: AudioBuffer,
  samplesPerBucket: number,
  isCancelled: () => boolean,
): Promise<void> => {
  const totalSamples = buffer.length
  const channelCount = buffer.numberOfChannels
  // 块长必须是桶粒度的整数倍，Worker 才能把每个块落到整段桶上
  const chunkSamples = Math.max(CHUNK_SAMPLES, samplesPerBucket * 4)

  worker.postMessage({
    type: 'start',
    sampleRate: buffer.sampleRate,
    channelCount,
    totalSamples,
    samplesPerBucket,
  } satisfies PeakStartMessage)

  for (let channel = 0; channel < channelCount; channel++) {
    const data = buffer.getChannelData(channel)
    for (let start = 0; start < totalSamples; start += chunkSamples) {
      if (isCancelled()) return
      const length = Math.min(chunkSamples, totalSamples - start)
      const copy = new Float32Array(length)
      copy.set(data.subarray(start, start + length))
      worker.postMessage(
        { type: 'samples', channel, startSample: start, data: copy } satisfies PeakSamplesMessage,
        [copy.buffer],
      )
      // 让出主线程，长音频的拷贝才不会把界面顶住
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 0)
      })
    }
  }
}

/**
 * 启动一次峰值金字塔构建。
 *
 * @param buffer 已解码的音频
 * @returns 构建句柄；不再需要时调用 `cancel()` 终止 Worker
 */
export function buildPeakPyramid(buffer: AudioBuffer): PeakBuildHandle {
  const samplesPerBucket = chooseSamplesPerBucket(buffer.length)
  let cancelBuild: (() => void) | null = null

  const promise = new Promise<PeakPyramid>((resolve, reject) => {
    const worker = new Worker(new URL('./waveform.worker.ts', import.meta.url), { type: 'module' })
    let cancelled = false

    cancelBuild = (): void => {
      if (cancelled) return
      cancelled = true
      worker.terminate()
      reject(new PeakBuildCancelledError())
    }

    worker.onmessage = (event: MessageEvent<PeakResponse>): void => {
      const message = event.data
      worker.terminate()
      if (message.type === 'error') {
        reject(new Error(message.message))
        return
      }
      resolve({ sampleRate: buffer.sampleRate, durationMs: buffer.duration * 1000, levels: message.levels })
    }

    worker.onerror = (): void => {
      worker.terminate()
      reject(new Error('峰值构建 Worker 异常'))
    }

    void feedChunks(worker, buffer, samplesPerBucket, () => cancelled).then(
      () => {
        if (!cancelled) worker.postMessage({ type: 'finish' } satisfies PeakFinishMessage)
      },
      (error: unknown) => {
        if (cancelled) return
        cancelled = true
        worker.terminate()
        reject(error instanceof Error ? error : new Error('峰值构建失败'))
      },
    )
  })

  return {
    promise,
    cancel: (): void => cancelBuild?.(),
  }
}

/** 挑选"每桶毫秒数不超过一个输出桶"的最粗一档，使查询工作量贴近输出桶数。 */
const pickLevel = (levels: PeakLevel[], msPerBucket: number, sampleRate: number): PeakLevel | null => {
  for (let index = levels.length - 1; index >= 0; index--) {
    const level = levels[index]
    if ((level.samplesPerBucket / sampleRate) * 1000 <= msPerBucket) return level
  }
  return levels[0] ?? null
}

/**
 * 查询时间窗内的峰值。
 *
 * @param pyramid 已构建的金字塔
 * @param startMs 窗口起点（毫秒）
 * @param endMs 窗口终点（毫秒）
 * @param bucketCount 输出桶数，通常等于视口像素宽度
 * @returns 聚合后的峰值区间；金字塔不可用时为 `null`
 */
export function queryPeaks(
  pyramid: PeakPyramid,
  startMs: number,
  endMs: number,
  bucketCount: number,
): PeakRange | null {
  if (bucketCount <= 0) return null
  const level = pickLevel(pyramid.levels, (endMs - startMs) / bucketCount, pyramid.sampleRate)
  if (level === null) return null

  const msPerBucket = Math.max(1e-6, (endMs - startMs) / bucketCount)
  const levelBucketMs = (level.samplesPerBucket / pyramid.sampleRate) * 1000
  const min = new Float32Array(bucketCount)
  const max = new Float32Array(bucketCount)

  for (let bucket = 0; bucket < bucketCount; bucket++) {
    const from = startMs + bucket * msPerBucket
    let first = Math.floor(from / levelBucketMs)
    let last = Math.ceil((from + msPerBucket) / levelBucketMs)
    if (last <= first) last = first + 1
    if (last <= 0 || first >= level.bucketCount) continue
    if (first < 0) first = 0
    if (last > level.bucketCount) last = level.bucketCount

    let low = level.min[first]
    let high = level.max[first]
    for (let index = first + 1; index < last; index++) {
      if (level.min[index] < low) low = level.min[index]
      if (level.max[index] > high) high = level.max[index]
    }
    min[bucket] = low
    max[bucket] = high
  }

  return { startMs, msPerBucket, min, max }
}
