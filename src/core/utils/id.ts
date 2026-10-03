/**
 * ID 生成器。
 *
 * 采用"前缀 + 时间戳 36 进制 + 自增计数"结构，保证同一会话内单调且不重复。
 * 只依赖 ECMAScript 标准能力，不触碰任何平台 API。
 */

let counter = 0

/**
 * 生成一个带前缀的唯一 ID。
 *
 * @param prefix 语义前缀，例如 `line`、`op`、`doc`
 * @returns 形如 `line_l7x1k_3` 的唯一标识
 */
export function createId(prefix: string): string {
  counter += 1
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`
}
