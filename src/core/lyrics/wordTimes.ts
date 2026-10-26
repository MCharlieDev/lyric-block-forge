import type { WordSegment } from '../types/operation'

/**
 * 切分字块时，相邻块的默认时间间隔（毫秒）。
 *
 * 首块锚定行级时间，后续每块按此步长顺延；越界到下一行不做封顶。
 */
export const WORD_CUT_DEFAULT_GAP_MS = 200

/**
 * 把行文本拆成字符数组（按 UTF-16 码点）。
 *
 * 空格与标点都保留为独立元素，因此 `chars` 的下标是"码点序号"，
 * 而块边界的 `start` / `end` 是"码元偏移"，两者不能混用。
 *
 * @param text 行文本
 * @returns 码点数组；空串返回空数组
 */
export function charsFromText(text: string): string[] {
  return Array.from(text)
}

/**
 * 按缝隙把字符切成块。
 *
 * `cuts` 里的值是 **UTF-16 码元偏移**（与 `WordSegment.start` 同坐标系），
 * 落在合法码点边界上的才生效；越界或落在代理对中间的会被忽略。
 * 结果块首尾相接、全覆盖、无 gap。
 *
 * @param text 行文本
 * @param chars `charsFromText(text)` 的结果
 * @param cuts 切缝偏移集合
 * @returns 切分块；空文本返回空数组
 */
export function cutsToSegments(
  text: string,
  chars: readonly string[],
  cuts: ReadonlySet<number>
): WordSegment[] {
  if (chars.length === 0) return []
  const segments: WordSegment[] = []
  let start = 0
  let offset = 0
  for (const char of chars) {
    offset += char.length
    // 末尾不是缝：切了也没有下一块
    if (offset < text.length && cuts.has(offset)) {
      segments.push({ start, end: offset, text: text.slice(start, offset) })
      start = offset
    }
  }
  segments.push({ start, end: text.length, text: text.slice(start, text.length) })
  return segments
}

/**
 * 由切分块反推切缝集合（`cutsToSegments` 的逆运算）。
 *
 * 供弹窗复用：打开时把已落盘的切分还原成"缝隙勾选态"。
 *
 * @param segments 切分块
 * @returns 除首块起点外的全部块起点
 */
export function segmentsToCuts(segments: readonly WordSegment[]): Set<number> {
  const cuts = new Set<number>()
  for (let index = 1; index < segments.length; index += 1) cuts.add(segments[index].start)
  return cuts
}

/**
 * 生成切分后的初始字级时间序列。
 *
 * 首块 = 锚点，后续每块顺延 `stepMs`；不做越界封顶。
 *
 * @param anchorMs 锚点时间（毫秒）
 * @param count 块数
 * @param stepMs 块间步长（毫秒）
 * @returns 与块数等长的时间数组；`count <= 0` 返回空数组
 */
export function deriveInitialWordTimes(
  anchorMs: number,
  count: number,
  stepMs: number = WORD_CUT_DEFAULT_GAP_MS
): number[] {
  if (count <= 0) return []
  return Array.from({ length: count }, (_, index) => anchorMs + index * stepMs)
}

/**
 * 切分锚点解析结果。
 */
export interface CutAnchor {
  /** 锚点时间（毫秒） */
  anchorMs: number
  /** 锚点来源：行级时间 / 首字时间 / 时间轴占位 */
  source: 'line' | 'word' | 'placement'
}

/**
 * 三层回退求切分锚点：行级时间 → 首字时间 → 时间轴占位起点。
 *
 * @param lineTimeMs 回放后的行级时间；无则 `null`
 * @param firstWordTimeMs 回放后的首字时间；无则 `null`
 * @param placementStartMs 时间轴占位起点，由调用方算好传入；无则 `null`
 * @returns 锚点与来源；三层都为空返回 `null`
 */
export function resolveCutAnchor(
  lineTimeMs: number | null,
  firstWordTimeMs: number | null,
  placementStartMs: number | null
): CutAnchor | null {
  if (lineTimeMs !== null) return { anchorMs: lineTimeMs, source: 'line' }
  if (firstWordTimeMs !== null) return { anchorMs: firstWordTimeMs, source: 'word' }
  if (placementStartMs !== null) return { anchorMs: placementStartMs, source: 'placement' }
  return null
}
