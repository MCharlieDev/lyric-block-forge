/**
 * 时间格式化工具。
 *
 * 架构约定：内部一律毫秒整数，只在展示时格式化。
 */

/** 把毫秒补零成固定宽度整数。 */
function pad(value: number, width = 2): string {
  return Math.floor(value).toString().padStart(width, '0')
}

/**
 * 格式化为 LRC 风格时间码 `mm:ss.xx`（百分秒）。
 *
 * @param ms 毫秒
 * @returns 时间码字符串
 */
export function formatTimecode(ms: number): string {
  const safe = Math.max(0, ms)
  const minutes = Math.floor(safe / 60000)
  const seconds = Math.floor((safe % 60000) / 1000)
  const centis = Math.floor((safe % 1000) / 10)
  return `${pad(minutes)}:${pad(seconds)}.${pad(centis)}`
}

/**
 * 格式化为播放器风格时长 `mm:ss.mmm`（毫秒）。
 *
 * @param ms 毫秒
 * @returns 时长字符串
 */
export function formatDuration(ms: number): string {
  const safe = Math.max(0, ms)
  const minutes = Math.floor(safe / 60000)
  const seconds = Math.floor((safe % 60000) / 1000)
  const millis = Math.floor(safe % 1000)
  return `${pad(minutes)}:${pad(seconds)}.${pad(millis, 3)}`
}

/**
 * 把毫秒时间偏移格式化为带符号的秒数，用于展示变化量。
 *
 * @param offsetMs 偏移量（毫秒）
 * @returns 形如 `+0.120s` 的字符串
 */
export function formatOffset(offsetMs: number): string {
  const sign = offsetMs >= 0 ? '+' : '-'
  return `${sign}${(Math.abs(offsetMs) / 1000).toFixed(3)}s`
}

/**
 * 格式化日志时间戳为 `HH:MM:SS`。
 *
 * @param timestamp 毫秒时间戳
 * @returns 时间字符串
 */
export function formatLogTime(timestamp: number): string {
  const date = new Date(timestamp)
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}
