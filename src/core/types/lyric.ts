import type { Timestamp, WordTimestamp } from './timestamp'

/**
 * 歌词行的角色。用于区分主歌词、翻译、罗马音、元数据等，
 * 双语识别器与元数据前缀识别器的结果都会落到这里。
 */
export type LyricLineRole =
  /** 主歌词（主语言） */
  | 'main'
  /** 翻译行 */
  | 'translation'
  /** 罗马音行 */
  | 'romanization'
  /** 从歌曲开头介绍中识别出的元数据行（作词/作曲/演唱等） */
  | 'metadata'
  /** 注释行 */
  | 'comment'
  /** 未能识别的行，原样保留，导出时写回 */
  | 'unknown'

/**
 * 歌词行状态。
 * - `normal`：正常
 * - `conflict`：与其他行/字存在时间冲突（时间倒置、重叠等），由校验层标记
 * - `pending-review`：识别或分析结果置信度低，等待用户确认
 */
export type LyricLineStatus = 'normal' | 'conflict' | 'pending-review'

/**
 * 歌词行模型 —— 编辑器的最小编辑单位。
 */
export interface LyricLine {
  /** 行唯一 ID，与文本内容解耦，拖动 / 撤销重放都依赖它 */
  id: string
  /** 主文本 */
  text: string
  /** 翻译文本（可选） */
  translation?: string
  /**
   * 翻译的原始承载方式，决定导出时如何写回：
   * - `null` / 缺省：原文是独立的一行，导出写回为两行；
   * - 非空字符串：原文用该分隔符写在同一行内（如 `中文 / English`），导出时按同样分隔符拼回一行。
   */
  translationSeparator?: string | null
  /** 罗马音文本（可选） */
  romanization?: string
  /** 行注释（可选） */
  comment?: string
  /**
   * 行级时间戳集合，按时间升序约定。
   *
   * 用数组而非单值，是为了承载两种标准写法：
   * - `[00:15.50][00:18.00]同一句歌词`：同一句歌词在多个时间点出现，
   *   每个元素是一次出现的时间；文本共享，各次出现的时间可独立调整。
   * - 起止区间：由调用方按 `timestamps[0]`、`timestamps[1]` 解释（见设置里的时间戳解读方式）。
   *
   * 空数组表示尚未打轴。注意：拖动行级时，`wordTimestamps` 必须整体平移以保持相对间距。
   */
  timestamps: Timestamp[]
  /** 字级时间戳集合，按时间升序约定 */
  wordTimestamps: WordTimestamp[]
  /** 行角色 */
  role: LyricLineRole
  /** 行状态 */
  status: LyricLineStatus
  /**
   * 原始行文本（无损导入用）。未知标签、非标准写法原样保留于此，
   * 导出时优先写回，保证解析/序列化尽量无损。
   */
  raw?: string
  /** 该行携带的未知标签，键为标签名、值为原始内容，导出时写回 */
  unknownTags?: Record<string, string>
}
