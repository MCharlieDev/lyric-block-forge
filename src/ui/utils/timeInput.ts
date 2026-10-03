/** `mm:ss` / `mm:ss.mmm`，分钟 1~3 位、秒 1~2 位、毫秒 1~3 位 */
export const TIME_INPUT_PATTERN = /^(\d{1,3}):(\d{1,2})(?:\.(\d{1,3}))?$/

/**
 * 把时间戳输入框文本解析成毫秒。
 *
 * 规则（行级框与字级框共用）：
 * - 空串 → `null`（调用方按「清空」语义处理，不算非法）
 * - 纯数字 → **秒**（`20` → 20000；`125` → 125 秒）
 * - `mm:ss` / `mm:ss.mmm` → 常规解析，毫秒不足三位右补零；秒 ≥ 60 判非法
 * - 其他 → `null`（非法）
 *
 * @param raw 输入框原文
 * @returns 毫秒值；空串或非法为 `null`
 */
export function parseTimeInput(raw: string): number | null {
  const text = raw.trim()
  if (text === '') return null
  if (/^\d+$/.test(text)) return Number(text) * 1000
  const match = TIME_INPUT_PATTERN.exec(text)
  if (match === null) return null
  const seconds = Number(match[2])
  if (seconds >= 60) return null
  const millis = Number((match[3] ?? '').padEnd(3, '0').slice(0, 3))
  return Number(match[1]) * 60000 + seconds * 1000 + millis
}
