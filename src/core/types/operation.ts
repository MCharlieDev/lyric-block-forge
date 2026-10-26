import type { EditScope } from './scope'

/**
 * 操作类型。
 *
 * 这是"分级回退"的实现基础：每条日志记录都带类型，
 * 用户既可以按顺序撤销最后一条，也可以**按类型整体撤销**
 * （例如把所有"频率微调"一次性退掉，保留手动打轴成果）。
 *
 * 类型同时用于判断是否属于"重大改变"——整体偏移、多选偏移、
 * 频率微调批量应用在 UI 上必须弹窗确认。
 *
 * 注意：**撤销与恢复不是操作类型**。它们不产生新记录，
 * 只是把已有记录的 `status` 改掉并追加一条生命周期事件，
 * 因此这里没有 `undo` / `restore` 这两项。
 */
export type OperationKind =
  /** 手动打轴 / 手动输入行级时间戳 */
  | 'manual-timestamp'
  /** 整体移动（全篇偏移），重大改变 */
  | 'global-offset'
  /** 多选移动（选中行一起平移），重大改变 */
  | 'selection-offset'
  /** 单行手动微调，不弹窗 */
  | 'manual-nudge'
  /** 字级时间戳微调（行编辑弹窗里批量改字级），单条不弹窗 */
  | 'word-timestamp'
  /** 按字符缝隙切分字块（写入新切分与初始字级时间，必要时补行级时间），单条不弹窗 */
  | 'word-segments'
  /** 频率微调（音频分析给出的精确时间），单条不弹窗、批量须弹窗 */
  | 'frequency-nudge'
  /** 人声边界修正（拖动 / 新增 / 删除 / 合并 / 拆分） */
  | 'vocal-boundary-edit'
  /** 歌词文本编辑（含翻译、罗马音、注释） */
  | 'text-edit'
  /** 上移 / 下移：交换两行的文本，行级时间戳留在原位 */
  | 'swap-line-text'
  /** 删除一行歌词 */
  | 'remove-line'
  /** 元数据编辑（含从介绍行识别出的作词、作曲等） */
  | 'metadata-edit'
  /** 文件导入（解析 + 规范化写入文档） */
  | 'import'

/**
 * 操作记录状态。
 *
 * 注意：撤销的记录**只标记不删除**，以保证撤销历史始终可见、可恢复。
 */
export type OperationStatus =
  /** 生效中，参与时间戳回放 */
  | 'active'
  /** 已撤销，不参与回放，但仍留在日志中可被恢复 */
  | 'undone'

/**
 * 记录生命周期事件的类型。
 *
 * 只描述这条**修改记录本身**的状态变化，不产生新的日志记录。
 */
export type OperationLifecycleEventType =
  /** 记录被创建 */
  | 'created'
  /** 记录被撤销 */
  | 'undone'
  /** 记录被恢复 */
  | 'restored'

/**
 * 记录生命周期中的一次事件。
 *
 * 撤销与恢复可能反复发生（撤销 → 恢复 → 再撤销），
 * 因此这是一个按时间**追加**的数组，首项固定是 `created`。
 */
export interface OperationLifecycleEvent {
  /** 事件类型 */
  type: OperationLifecycleEventType
  /** 事件发生时间（毫秒时间戳） */
  at: number
}

/**
 * 单条绝对值时间戳，用于 `absolute` 模式的变化量。
 */
export interface AbsoluteTimestampValue {
  /** 目标行 ID */
  lineId: string
  /** 目标字级时间戳下标；为 `null` 表示改的是行级时间戳 */
  wordIndex: number | null
  /**
   * 目标行级时间戳下标，仅在 `wordIndex === null` 时有意义，缺省为 `0`。
   * 一行可以有多个行级时间戳（`[00:15.50][00:18.00]同一句`），用它定位具体是哪一个。
   */
  timestampIndex?: number
  /**
   * 目标时间值（毫秒）；`null` 表示**清空该字时间**（仅字级合法）。
   *
   * 约束：`null` 只对字级（`wordIndex !== null`）合法，语义是「该字没有时间」——
   * 回放时删除该字的字级键，`getReplayedWordTime` 随之返回 `null`，而字级的
   * `text` / `range`（切分）不在回放层，因此切分保留。
   * **行级（`wordIndex === null`）不允许 `null`**：行级清空走 `clear-timestamps`
   * （它还要连带清该行全部字级时间并进 `clearedLineLines`，不是单键删除）。
   * 该约束仅靠约定维持，类型层不强制（`undefined` 仍表示"无此字段"）。
   */
  timeMs: number | null
  /**
   * 目标字级对应的文本，仅用于日志展示（`wordIndex !== null` 时有意义）。
   *
   * 不参与回放计算：字级的文本来自行模型 `WordTimestamp.text`，
   * 而回放只覆盖 `timeMs`，把这个冗余字段也带进来是为了让日志面板
   * 能脱离行模型、独立读懂"改了哪个字"。
   */
  wordText?: string
}

/**
 * 一次行文本改写，用于 `line-text` 模式的变化量。
 *
 * 采用**全量替换**语义：`text` 必填，其余字段缺省（`undefined`）表示"保持原值"、
 * 显式给 `null` 表示"清空"。这样一条记录自包含，回放时不必回读文档基线。
 */
export interface LineTextValue {
  /** 目标行 ID */
  lineId: string
  /** 新的正文（必填） */
  text: string
  /** 新的翻译；`undefined` 保持原值，`null` 清空 */
  translation?: string | null
  /** 新的罗马音；语义同上 */
  romanization?: string | null
  /** 新的行注释；语义同上 */
  comment?: string | null
  /**
   * 是否清空该行字级时间戳。
   *
   * 文本变了，原有字级时间戳的 `range` 全部失效，字级 chip 会与新文本对不上，
   * 因此**只有正文 `text` 真的变化时**才置 `true` —— 上移 / 下移必然置 `true`，
   * 行文本编辑则由 `editLineText` 内部比较新旧正文决定；只改翻译 / 罗马音 /
   * 注释时字级仍然有效，必须保留。
   */
  clearWordTimestamps?: boolean
}

/**
 * 一个切分后的字块。
 *
 * `start` / `end` 是相对行文本的 **UTF-16 码元偏移**（左闭右开），与
 * `WordTimestamp.range` 同坐标系；emoji 等代理对占 2 个码元，但块边界
 * 只落在码点之间（切分粒度按码点，见 `wordTimes.charsFromText`）。
 */
export interface WordSegment {
  /** 起始偏移（含） */
  start: number
  /** 结束偏移（不含） */
  end: number
  /** 该块对应的原文，等于 `text.slice(start, end)` */
  text: string
}

/**
 * 变化量描述 —— 统一用"绝对值"或"偏移量"两种表达。
 *
 * 选择偏移量表达（如整体移动 +120ms）的好处是：回放时不受基线变化影响，
 * 用户之后又改了别的行也不会让这条记录失真。
 */
export type OperationDelta =
  /** 相对偏移，单位毫秒，正数延后、负数提前 */
  | { mode: 'offset'; offsetMs: number }
  /** 逐项绝对值 */
  | { mode: 'absolute'; values: AbsoluteTimestampValue[] }
  /** 无时间变化（纯文本编辑等） */
  | { mode: 'none' }
  /** 改写行文本（上移 / 下移的文本交换、行文本编辑） */
  | { mode: 'line-text'; values: LineTextValue[] }
  /** 移除行；目标行由 `entry.scope.lineIds` 给出 */
  | { mode: 'remove-line' }
  /**
   * 清空时间戳：删除目标行的**行级时间戳**与**全部字级时间戳**，但**保留字级切分**。
   *
   * 与 `remove-line` 的区别是行本身留下；与 `line-text` 清字级的区别是
   * 字级的 `text` / `range`（切分）不被丢弃 —— 只是时间不可用，展示为「未打轴」。
   * 目标行由 `entry.scope.lineIds` 给出。
   */
  | { mode: 'clear-timestamps' }
  /**
   * 按块切分一行：写入新的字级切分（`segments`）与各块的初始字级时间（`times`），
   * 必要时一并补写字级锚点来源的行级时间（`lineTimeMs`）。
   *
   * 一条记录自包含：撤销后从基线重新回放，旧切分与旧字级时间一并复原；
   * 对同一行再次切分 = 新记录整体覆盖旧切分（回放顺序天然支持）。
   * 目标行由 `entry.scope.lineIds` 给出（单行）。
   */
  | {
      mode: 'word-segments'
      /** 新切分块，UTF-16 偏移，首尾相接、全覆盖、无 gap */
      segments: WordSegment[]
      /** 与 `segments` 等长的字级时间（毫秒），按下标对应块 */
      times: number[]
      /**
       * 需要补写的行级时间（毫秒）。
       *
       * 仅当锚点来自「首字」或「时间轴占位」（原本行级为空）时出现；
       * 锚点本来就是行级时间时省略，避免无意义地重写行级。
       */
      lineTimeMs?: number
    }

/**
 * 操作日志记录 —— 编辑器的唯一真相来源。
 *
 * 当前时间戳 = 从基线出发、按顺序回放所有 `active` 记录后的结果；
 * 撤销 / 恢复都只是改变记录的 `status`，然后重新回放，
 * 因此日志里**永远只有修改记录**，没有"撤销记录"这种条目。
 */
export interface OperationLogEntry {
  /** 记录唯一 ID */
  id: string
  /** 操作类型 */
  kind: OperationKind
  /** 记录创建时间（毫秒时间戳） */
  createdAt: number
  /** 影响范围 */
  scope: EditScope
  /** 变化量 */
  delta: OperationDelta
  /** 人类可读描述，直接显示在日志面板上 */
  description: string
  /** 当前状态。由日志引擎维护，与 `lifecycle` 末项保持一致 */
  status: OperationStatus
  /**
   * 生命周期详情：创建 / 被撤销 / 被恢复，按时间先后追加。
   * 首项固定为 `created`，之后每次撤销或恢复追加一项，可多次往复。
   */
  lifecycle: OperationLifecycleEvent[]
  /** 是否为重大改变（UI 需弹窗提示） */
  isMajor: boolean
  /** 该记录产生时的文档版本号，便于排查版本错配 */
  baseVersion: number
}

/**
 * 新建记录时由调用方提供的字段。
 * ID、时间、状态与生命周期由日志引擎补齐；
 * `isMajor` 缺省时由日志引擎按类型与范围自动判定。
 */
export type OperationLogDraft = Omit<
  OperationLogEntry,
  'id' | 'createdAt' | 'status' | 'lifecycle' | 'isMajor'
> &
  Partial<Pick<OperationLogEntry, 'id' | 'createdAt' | 'isMajor'>>

/**
 * 一份文档的工作日志。
 * 每个文档独立一份，随文档一起保存，不跨文档共享。
 */
export interface OperationLog {
  /** 所属文档 ID */
  documentId: string
  /** 记录集合，按发生顺序追加 */
  entries: OperationLogEntry[]
  /** 日志结构版本，用于后续迁移 */
  schemaVersion: number
}

/**
 * 日志筛选条件。全部字段可选，多字段之间为"与"关系。
 * 对应日志面板的筛选区：按状态（生效 / 已撤销）、按类型、按行、按时间、按关键词。
 */
export interface OperationLogFilter {
  /** 只保留这些状态的记录；为空表示不限 */
  statuses?: OperationStatus[]
  /** 只保留这些类型的记录；为空表示不限 */
  kinds?: OperationKind[]
  /** 只保留影响这些行的记录；为空表示不限 */
  lineIds?: string[]
  /** 时间下界（含），毫秒 */
  fromMs?: number
  /** 时间上界（含），毫秒 */
  toMs?: number
  /** 关键词，匹配 `description`，大小写不敏感 */
  keyword?: string
}
