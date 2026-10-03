import type { LyricLine, LyricLineRole } from './lyric'

/**
 * 歌词元数据。既承载 LRC 标准标签，也承载从前缀行识别出的介绍信息。
 */
export interface LyricMetadata {
  /** 歌曲标题（`ti`） */
  title?: string
  /** 演唱者（`ar`） */
  artist?: string
  /** 专辑（`al`） */
  album?: string
  /** 作词 */
  lyricist?: string
  /** 作曲 */
  composer?: string
  /** 编曲 */
  arranger?: string
  /** 歌曲时长（毫秒，`length`） */
  lengthMs?: number
  /**
   * 全局偏移量（毫秒，`offset`）。
   * 语义与 LRC 标准一致：正数表示歌词整体提前，负数表示整体延后。
   */
  offsetMs?: number
  /** 制作者（`by`） */
  by?: string
  /** 其他自定义标签，键为标签名、值为原始内容 */
  custom?: Record<string, string>
}

/** 解析时识别到的源文件格式。 */
export type LyricFileFormat = 'lrc' | 'enhanced-lrc' | 'plain' | 'unknown'

/**
 * 格式信息。解析/序列化要求尽量无损，因此需要把原始格式细节一并记录。
 */
export interface LyricFormatInfo {
  /** 检测（或用户指定）的编码，默认 `utf-8` */
  encoding: string
  /** 检测到的格式种类 */
  detectedFormat: LyricFileFormat
  /** 原始换行符，导出时写回 */
  lineEnding: '\n' | '\r\n'
  /** 原始文件是否带 BOM */
  hasBOM: boolean
  /** 无法识别但已原样保留的标签名列表 */
  unknownTags: string[]
  /** 双语识别使用的分隔符，未识别时为 `null` */
  bilingualSeparator: string | null
  /**
   * 源文件中纯元数据行的原始标签序列（additive，可选）。
   *
   * 外层每个元素对应源文件里一条纯元数据行，内层是该行标签按原始书写顺序的
   * 「名 + 值」列表。因此能原样承载重复标签（`[ti:a][ti:b]`、`[xx:1][xx:2]`）。
   *
   * 缺省（`undefined`）表示无记录：序列化退回默认的「单行 + 标准顺序」写出。
   * 该字段取代此前的 `metadataLayout`（同槽位、元素变富、不并存）。
   */
  metadataTags?: Array<Array<{ name: string; value: string }>>
}

/**
 * 恢复信息。离线程序没有服务端，崩溃恢复只能依赖本地自动保存。
 */
export interface RecoveryInfo {
  /** 上次手动保存时间（毫秒时间戳），从未保存为 `null` */
  lastSavedAt: number | null
  /** 上次自动保存时间（毫秒时间戳），从未自动保存为 `null` */
  autosaveAt: number | null
  /** 本地恢复副本的存储键，无副本为 `null` */
  backupRef: string | null
}

/**
 * 歌词文档模型 —— 整个编辑器的根聚合。
 *
 * 约定：文档状态、播放状态、编辑器状态三者分离；
 * 文档的任何修改都必须经由操作日志，不允许直接改写字段。
 */
export interface LyricDocument {
  /** 文档唯一 ID */
  id: string
  /** 元数据 */
  meta: LyricMetadata
  /** 歌词行集合，按时间顺序约定 */
  lines: LyricLine[]
  /** 引用的音频资源 ID，未加载音频为 `null` */
  audioRef: string | null
  /** 源文件格式信息 */
  format: LyricFormatInfo
  /** 脏标记：存在未保存修改时为 `true` */
  dirty: boolean
  /** 文档版本号，每次成功保存或结构变更后自增 */
  version: number
  /** 恢复信息 */
  recovery: RecoveryInfo
  /** 创建时间（毫秒时间戳） */
  createdAt: number
  /** 最后更新时间（毫秒时间戳） */
  updatedAt: number
}

/** 新建空文档时的可选初始参数。 */
export interface CreateLyricDocumentOptions {
  /** 指定文档 ID，缺省时自动生成 */
  id?: string
  /** 初始元数据 */
  meta?: LyricMetadata
  /** 初始歌词行 */
  lines?: LyricLine[]
  /** 初始格式信息 */
  format?: Partial<LyricFormatInfo>
  /** 当前时间提供函数，便于测试注入，缺省使用 `Date.now` */
  now?: () => number
}

/** 新建歌词行时的可选初始参数。 */
export interface CreateLyricLineOptions {
  /** 指定行 ID，缺省时自动生成 */
  id?: string
  /** 行角色，缺省为 `main` */
  role?: LyricLineRole
  /** 行级时间戳（毫秒），缺省为未打轴 */
  timeMs?: number | null
}
