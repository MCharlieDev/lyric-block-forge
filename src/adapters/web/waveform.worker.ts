import type { PeakLevel } from '../ports'
import type { PeakRequest, PeakResponse, PeakSamplesMessage, PeakStartMessage } from './waveform-peaks'

/**
 * 峰值金字塔构建 Worker。
 *
 * 职责：把逐块喂进来的 PCM 采样聚合成 `(min, max)` 金字塔（mipmap）。
 * 全量扫描 O(N) 只发生在这里，主线程只负责拷贝与搬运，绝不遍历原始采样。
 *
 * 协议见 `waveform-peaks.ts`：`start`（开张）→ 若干 `samples`（逐通道逐块）
 * → `finish`（合并通道并生成上层）。块起点保证按桶对齐，因此每个块只写
 * 自己那段桶，不需要跨块合并状态。
 *
 * 多通道用 `min(各通道 min) / max(各通道 max)` 合成，等价于波形显示里常见的
 * "叠加"视图：既不会丢掉瞬态，也不用把整轨混音成一条新的大数组。
 */

/** 只用得到的那几个全局对象，避免引入 webworker lib 与 DOM lib 冲突。 */
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<PeakRequest>) => void) | null
  postMessage(message: PeakResponse, transfer?: Transferable[]): void
}

let samplesPerBucket = 0
let bucketCount = 0
/** 每个通道各自的最低 / 最高值，`finish` 时再跨通道合并 */
let channelMin: Float32Array[] = []
let channelMax: Float32Array[] = []

const handleStart = (message: PeakStartMessage): void => {
  samplesPerBucket = message.samplesPerBucket
  bucketCount = Math.ceil(message.totalSamples / samplesPerBucket)
  channelMin = []
  channelMax = []
  for (let channel = 0; channel < message.channelCount; channel++) {
    channelMin.push(new Float32Array(bucketCount).fill(Number.POSITIVE_INFINITY))
    channelMax.push(new Float32Array(bucketCount).fill(Number.NEGATIVE_INFINITY))
  }
}

const handleSamples = (message: PeakSamplesMessage): void => {
  const min = channelMin[message.channel]
  const max = channelMax[message.channel]
  if (min === undefined || max === undefined) return

  const data = message.data
  let bucket = Math.floor(message.startSample / samplesPerBucket)
  for (let offset = 0; offset < data.length && bucket < bucketCount; offset += samplesPerBucket, bucket++) {
    const end = Math.min(offset + samplesPerBucket, data.length)
    let low = Number.POSITIVE_INFINITY
    let high = Number.NEGATIVE_INFINITY
    for (let i = offset; i < end; i++) {
      const value = data[i]
      if (value < low) low = value
      if (value > high) high = value
    }
    if (low < min[bucket]) min[bucket] = low
    if (high > max[bucket]) max[bucket] = high
  }
}

const handleFinish = (): void => {
  if (bucketCount === 0) {
    scope.postMessage({ type: 'ready', levels: [] })
    return
  }

  // 跨通道合并出第 0 档
  let currentMin = new Float32Array(bucketCount)
  let currentMax = new Float32Array(bucketCount)
  for (let bucket = 0; bucket < bucketCount; bucket++) {
    let low = Number.POSITIVE_INFINITY
    let high = Number.NEGATIVE_INFINITY
    for (let channel = 0; channel < channelMin.length; channel++) {
      const min = channelMin[channel][bucket]
      const max = channelMax[channel][bucket]
      if (min < low) low = min
      if (max > high) high = max
    }
    currentMin[bucket] = Number.isFinite(low) ? low : 0
    currentMax[bucket] = Number.isFinite(high) ? high : 0
  }

  // 相邻两桶合并出上一档，直到只剩一个桶
  const levels: PeakLevel[] = []
  let count = bucketCount
  let perBucket = samplesPerBucket
  for (;;) {
    levels.push({ samplesPerBucket: perBucket, bucketCount: count, min: currentMin, max: currentMax })
    if (count <= 1) break

    const nextCount = Math.ceil(count / 2)
    const nextMin = new Float32Array(nextCount)
    const nextMax = new Float32Array(nextCount)
    for (let bucket = 0; bucket < nextCount; bucket++) {
      const left = bucket * 2
      const right = Math.min(left + 1, count - 1)
      const low = Math.min(currentMin[left], currentMin[right])
      const high = Math.max(currentMax[left], currentMax[right])
      nextMin[bucket] = low
      nextMax[bucket] = high
    }
    currentMin = nextMin
    currentMax = nextMax
    count = nextCount
    perBucket *= 2
  }

  const transfer: Transferable[] = []
  for (const level of levels) {
    transfer.push(level.min.buffer as ArrayBuffer, level.max.buffer as ArrayBuffer)
  }
  scope.postMessage({ type: 'ready', levels }, transfer)
}

scope.onmessage = (event: MessageEvent<PeakRequest>): void => {
  const message = event.data
  try {
    if (message.type === 'start') handleStart(message)
    else if (message.type === 'samples') handleSamples(message)
    else handleFinish()
  } catch (error) {
    scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : '峰值构建失败' })
  }
}
