import { create } from 'zustand'
import {
  appendOperation,
  buildBaselineFromDocument,
  createLyricLine,
  createOperationLog,
  deriveVisibleLines,
  filterEntries,
  getEntry,
  getReplayedLineTime,
  getReplayedLineTimes,
  getReplayedWordTime,
  isRevertable,
  replayOperations,
  restoreEntries,
  serializeLrc,
  undoByKind,
  undoEntries,
  undoLast,
  type AudioAsset,
  type LineTextOverride,
  type LyricDocument,
  type LyricLine,
  type OperationKind,
  type OperationLog,
  type OperationLogEntry,
  type OperationLogFilter,
  type ReplayState,
  type Timestamp,
  type ValidationIssue,
} from '@core'
import { createDemoSession } from './demoSession'
import { formatDuration, formatTimecode } from '../utils/format'

/**
 * 应用层状态（第一阶段为骨架）。
 *
 * 分层约定：
 * - 文档状态 `document`、操作日志 `log`、回放结果 `replay` 分开存放；
 * - 任何修改都先经过 core 的日志引擎，再由回放得到最新时间戳；
 * - UI 只读 `replay` 渲染时间轴与歌词块，不自行推算时间。
 */

/** 日志面板的页签。 */
export type LogTab =
  /** 总：全部修改记录按操作顺序排列 */
  | 'all'
  /** 修改：只看生效中的修改记录 */
  | 'edits'
  /** 报错：只看校验问题 */
  | 'issues'
  /** 已归档：装被撤销的原始修改记录本身，可恢复 */
  | 'archived'
  /** 忽略：装被忽略的报错 */
  | 'ignored'

/** 播放控制状态。音频尚未接入，第一阶段只维护界面状态。 */
export interface PlaybackState {
  /** 是否正在播放 */
  isPlaying: boolean
  /** 播放头位置（毫秒） */
  playheadMs: number
  /** 播放速率 */
  rate: number
  /** 音量，`[0, 1]` */
  volume: number
}

/** 选择状态。 */
export interface SelectionState {
  /** 选中的行 ID */
  lineIds: string[]
  /** 当前激活行 ID（光标所在行） */
  activeLineId: string | null
  /**
   * 范围选择的锚点行 ID。
   *
   * 取值 =「上一次非 Shift 点击的行」（Ctrl 点击也重设）；Shift+点击不改锚点。
   * 锚点为 `null` 或不在可见行时，Shift+点击退化为普通点击。
   * 无选中状态下同样为 `null`。
   */
  anchorLineId: string | null
  /** 选中的日志记录 ID，用于批量撤销 / 恢复所选 */
  entryIds: string[]
}

/** 已撤销记录在"总"页签中的显示模式。 */
export type ArchivedDisplay = 'thin' | 'hidden' | 'normal'

/** 日志面板视图状态。 */
export interface LogViewState {
  /** 当前页签 */
  tab: LogTab
  /** 筛选条件 */
  filter: OperationLogFilter
  /** 总页签中已撤销记录的显示模式 */
  archivedDisplay: ArchivedDisplay
  /** 处于展开状态的记录 ID；展开后才显示影响范围、变化量与状态历史 */
  expandedEntryIds: string[]
  /** 刚从"总"页签细行跳过来的记录 ID，用于滚动定位并高亮，处理完即清空 */
  focusEntryId: string | null
}

/**
 * 行文本的局部改动。
 *
 * 未提供的字段保持原值；显式给 `null` 表示清空该字段。
 */
export interface LineTextPatch {
  text?: string
  translation?: string | null
  romanization?: string | null
  comment?: string | null
}

/** 编辑器整体状态与动作。 */
export interface EditorState {
  /** 当前文档 */
  document: LyricDocument
  /** 操作日志 */
  log: OperationLog
  /** 日志回放结果 */
  replay: ReplayState
  /** 校验问题列表（校验层尚未实现，第一阶段为空） */
  issues: ValidationIssue[]
  /** 当前音频资源，未加载音频为 `null` */
  audioAsset: AudioAsset | null
  /** 播放状态 */
  playback: PlaybackState
  /** 选择状态 */
  selection: SelectionState
  /** 日志面板视图 */
  logView: LogViewState
  /**
   * 一次性提示文案（如「所选记录中无可撤销项」）。
   *
   * 存放于状态而非组件里，是因为触发它的动作（批量撤销）由日志面板发起，
   * 而提示浮层在根组件渲染；展示后由 UI 调用 {@link clearNotice} 清空。
   */
  notice: string | null
  /** 清空一次性提示 */
  clearNotice: () => void

  /**
   * 导入一份解析好的文档，替换当前会话。
   *
   * 文档、日志、回放是同一份会话的三面，必须整体重建：
   * 新文档配一份新日志，并追加一条 `import` 记录作为这段编辑史的起点。
   * 音频是独立维度，导入歌词**不影响**已加载的音频与播放状态，
   * 只把音频引用接到新文档上，并默认选中第一可见行。
   *
   * @param document 解析得到的文档
   * @param sourceName 源文件名，用于日志描述
   * @param issues 解析阶段发现的异常（正常为空）
   */
  importDocument: (document: LyricDocument, sourceName: string, issues?: ValidationIssue[]) => void
  /**
   * 记录已加载的音频资源，并把它挂到 `document.audioRef`。
   *
   * 加载时追加一条 `import` 记录留痕（不可撤销）；传 `null` 表示卸载，不写日志。
   *
   * @param asset 音频资源；传 `null` 表示卸载
   */
  attachAudio: (asset: AudioAsset | null) => void

  /**
   * 拖动**已打轴**的行：整行平移 `deltaMs`。
   *
   * 变化量用 `offset`，`scope` 里同时带上该行的全部字级下标 ——
   * 回放时行级与字级被施加同一个偏移，字级时间戳因此保持相对间距一起走。
   *
   * @param lineId 目标行 ID
   * @param deltaMs 位移（毫秒），正数延后、负数提前
   */
  nudgeLine: (lineId: string, deltaMs: number) => void
  /**
   * 拖动**未打轴**的行：把它打轴到绝对时间 `timeMs`。
   *
   * 变化量用 `absolute`，未打轴行在基线里没有时间戳，
   * 回放对空基线同样生效（`?? []` 兜底后写入首个行级时间戳）。
   *
   * @param lineId 目标行 ID
   * @param timeMs 落点时间（毫秒）
   */
  stampLine: (lineId: string, timeMs: number) => void
  /**
   * 行首拖动（推土机）：把行首移到 `newStartMs`，并推平被越过的字卡。
   *
   * 行级时间是本行的绝对锚点，行首右移后，凡是时间早于新行首的字卡都会
   * 落到块左缘之外；这里把它们一并推到新行首（时间等于行级）。
   * 行级项与被推平的每个字级项打包进**同一条** `absolute`，
   * 松手后一步撤销即可全部复原。
   *
   * 没有被越过的字卡时等价于 {@link stampLine}。
   *
   * @param lineId 目标行 ID
   * @param newStartMs 新行首时间（毫秒）
   */
  setLineStartWithPush: (lineId: string, newStartMs: number) => void

  /**
   * 把**一组已打轴的行**整体平移 `deltaMs`（多选拖动 / 多选方向键微调共用）。
   *
   * 三态分流，口径唯一：
   * - 参与集为空（成员全被删 / 全未打轴）：静默返回，不写日志；
   * - 只剩 1 行：转 {@link nudgeLine}（落 `manual-nudge`），与单块拖动逐字段一致；
   * - 2 行及以上：写**一条** `selection-offset`（`offset` 模式，`scope.lineIds` 覆盖整组、
   *   `wordRefs` 带全部字级），回放时整组同加同一偏移。
   *
   * 参与集 = `lineIds` ∩ 可见行 ∩ 已打轴，按可见行顺序输出 —— 拖动与方向键微调共用，
   * 不存在"一处含未打轴行、一处不含"的分叉。
   *
   * @param lineIds 目标行 ID 集合（可含不可见 / 未打轴行，会被过滤掉）
   * @param deltaMs 位移（毫秒），正数延后、负数提前
   */
  moveLinesByOffset: (lineIds: string[], deltaMs: number) => void

  /**
   * 上移 / 下移：交换两行的**文本**。
   *
   * 交换 `text` / `translation` / `romanization` / `comment`；
   * 行级时间戳留在原位（时间轴上两个块的位置不动，只有文字换），
   * 两行的字级时间戳一并清空 —— 文本换了，原字级已无意义。
   * 本条记录可撤销，撤销后重放会从基线复原字级。
   *
   * @param lineIdA 第一行 ID
   * @param lineIdB 第二行 ID
   */
  swapLineText: (lineIdA: string, lineIdB: string) => void
  /**
   * 行编辑改文本（含翻译、罗马音、注释），可撤销。
   *
   * **清空字级只在正文真的变化时发生**：`text` 变了，原有字级时间戳的
   * `range` 全部失效，必须连带清空；只改翻译 / 罗马音 / 注释时字级仍然有效，
   * 一并清空是错误行为，因此由本实现内部比较新旧正文决定，不由调用方指定。
   *
   * @param lineId 目标行 ID
   * @param patch 局部改动；未提供的字段保持原值
   */
  editLineText: (lineId: string, patch: LineTextPatch) => void
  /**
   * 批量改写一行的字级时间戳（行编辑弹窗的"字级微调"），可撤销。
   *
   * 一次保存只写**一条** `word-timestamp` 记录、`values` 带多项：
   * `absolute` 模式本就是批量设计，整批一起撤销才符合"我刚在弹窗里改的那批"的直觉。
   *
   * 只覆盖 `timeMs`；字级的文本与 `range` 来自行模型，不由日志改写。
   *
   * 输入框单向联动：若本次提交含首字（`wordIndex === 0`）且其时间早于当前行级时间，
   * 则在**同一条记录**里把行级时间强制拉齐到该首字时间（不弹确认框，直接生效）。
   * 拖拽触发的拉齐走 {@link nudgeWordsByOffset}，不经过这里。
   *
   * @param lineId 目标行 ID
   * @param values 逐项改动，`wordIndex` 是行模型 `wordTimestamps` 的数组下标
   * @returns 触发行级拉齐时返回新的行级时间（毫秒），否则 `null`
   */
  setWordTimestamps: (
    lineId: string,
    values: Array<{ wordIndex: number; timeMs: number; wordText?: string }>,
  ) => number | null
  /**
   * 按位移平移若干字级时间戳（字级拖拽），可撤销；**行级默认不动**。
   *
   * 单向联动规则（只允许字拉行，不允许行拉字）：
   * - **普通平移**：落 `offset`，只改 `wordRefs` 里的字级，`lineIds` 留空，
   *   因此行级与其余字级保持原位；
   * - **首字越界前移**：若首字在本次位移后早于行级时间，则落 `absolute`，
   *   把行级与首字一起拉到同一个目标时间（首字不会跑到行卡片之前）。
   *
   * 未打轴（回放无时间）的字不参与；`deltaMs` 为 0 或无有效字时 no-op。
   *
   * @param lineId 目标行 ID
   * @param wordIndices 目标字下标（行模型 `wordTimestamps` 的数组下标）
   * @param deltaMs 位移（毫秒），正数延后、负数提前
   */
  nudgeWordsByOffset: (lineId: string, wordIndices: number[], deltaMs: number) => void
  /**
   * 把一行的**行级时间戳**改到绝对时间 `timeMs`（行编辑弹窗的"行级时间戳"框），可撤销。
   *
   * 两种表达：
   * - **未打轴**（回放无行级时间）→ 落 `absolute`（与 {@link stampLine} 同口径）；
   * - **已打轴** → 落 `offset`，`offsetMs = 新值 − 当前回放值`，并把该行**全部字级**
   *   放进 `scope.wordRefs`，使字级随行级同加偏移、保持相对间距。
   *
   * 新值与当前回放值相等则 no-op，不写日志。
   *
   * 注：行级 `offset` 作用于该行**全部**行级时间戳，多时间戳行只改首个会连动其余。
   *
   * @param lineId 目标行 ID
   * @param timeMs 新的行级时间（毫秒）
   */
  setLineTime: (lineId: string, timeMs: number) => void
  /**
   * 清空一行的**行级时间戳与全部字级时间戳**，但**保留字级切分**，可撤销。
   *
   * 落一条 `manual-timestamp`（`delta.mode = 'clear-timestamps'`）：行本身留下，
   * 字级的 `text` / `range` 保留（仍可细分），只是时间不可用、展示为「未打轴」。
   *
   * 该行本就未打轴则 no-op。
   *
   * @param lineId 目标行 ID
   */
  clearLineTime: (lineId: string) => void
  /**
   * 删除一行歌词，可撤销。
   *
   * 删除作用于**文档基线里的行**；撤销后行回到列表，时间轴长度随之复原。
   *
   * @param lineId 目标行 ID
   */
  removeLine: (lineId: string) => void
  /**
   * 删除一批歌词行（多选删除），可撤销。
   *
   * 两态：
   * - **0（空集）**：去重 ∩ **可见行**后为空 → 静默返回（不写日志、不动选区）。
   *   这里的"可见"过滤是**刻意**的：一条 `remove-line` 的 `scope.lineIds` 若含
   *   无效行（已删 / 不存在），日志就带了无目标的引用。注意其判据与单行
   *   `removeLine` 的 `effectiveLineText` 守卫**不同**，是刻意不统一：
   *   `effectiveLineText` 认基线/覆盖层里的行，`可见` 还要剔除 `removedLineIds`。
   * - **≥1（单行或多行）**：写**一条** `remove-line`（`scope.lineIds` 为全部目标行），
   *   回放循环删除，故一次撤销整组复原。
   *
   * 落点固定为「直接无选中」：删除的是整个选区，删完选区必为空，故一次性落
   * `{ lineIds: [], activeLineId: null, anchorLineId: null }`（三字段全清），与点背景
   * 清空的"无选中"定义一致。多选删除**不模仿** `removeLine` 的"挑最近剩余"收口 ——
   * 那是单删（五按钮）才需要的语义。
   *
   * @param lineIds 目标行 ID 集合（类型无关）
   */
  removeLines: (lineIds: string[]) => void
  /**
   * 新建一行空白歌词。
   *
   * 按产品决定，新建行**仅记录在文档里、不进日志**：直接写进 `document.lines`
   * 并重建回放基线，因此它永远属于基线，与"删除只作用于基线行"自洽。
   * 该动作不可撤销。
   *
   * 给了 `afterLineId` 时，新行的初始时间戳按**锚点行推算**（见
   * {@link inferInitialTimeMs}）；时间戳与行一起写进基线，所以不能改用
   * `stampLine` 补 —— 那会留下一条可撤销的日志记录，与"新建行不可撤销"矛盾。
   *
   * @param text 初始文本，缺省为空串
   * @param afterLineId 插到该行**之后**；缺省时追加到末尾（此时不推算时间戳，
   *   新行保持未打轴）。该 ID 不在文档里时（例如它刚被删掉）退化为追加到末尾
   * @returns 新行的 ID，供调用方选中并滚动到可见
   */
  appendBlankLine: (text?: string, afterLineId?: string) => string

  /** 撤销最后一条可撤销记录 */
  undoLastAction: () => void
  /** 按类型撤销（分级回退） */
  undoByKindAction: (kind: OperationKind) => void
  /** 批量撤销选中的记录 */
  undoSelectedEntries: () => void
  /** 恢复所选（把已撤销的记录重新生效） */
  restoreSelectedEntries: () => void
  /** 切换一条日志记录的选中态 */
  toggleEntrySelection: (entryId: string) => void
  /** 清空日志选择 */
  clearEntrySelection: () => void
  /** 折叠 / 展开一条记录的详情 */
  toggleEntryExpanded: (entryId: string) => void
  /** 从"总"页签细行跳到"已归档"页签，并展开该条记录 */
  openArchivedEntry: (entryId: string) => void
  /** 切换日志页签 */
  setLogTab: (tab: LogTab) => void
  /** 设置"总"页签中已撤销记录的显示模式 */
  setArchivedDisplay: (mode: ArchivedDisplay) => void
  /** 合并式更新筛选条件 */
  patchLogFilter: (patch: Partial<OperationLogFilter>) => void
  /** 重置筛选条件 */
  resetLogFilter: () => void
  /** 选择行 */
  selectLine: (lineId: string | null) => void
  /**
   * Tab 导航专用：**清空选区、只留光标**。把 `activeLineId` 设为 `lineId`，
   * 同时把 `lineIds` 清空（`[]`）。
   *
   * 与 {@link selectLine} 的区别：`selectLine` 把选区替换为「新行单选」，
   * 本 action 则把选区清空 —— Tab 只负责挪光标，不留任何选中。
   *
   * `anchorLineId` 一并设为 `lineId`：选区已清空，锚点指向旧行无意义；
   * 且鼠标来源已被列表 `onFocus` 的 `:focus-visible` 守卫挡住，不会误改锚点、
   * 破坏 Shift 范围选。
   *
   * @param lineId 光标落点行 ID
   */
  setCursorOnly: (lineId: string) => void
  /**
   * 只挪光标、**保住选区**、重设锚点。
   *
   * 与 {@link setCursorOnly} 的唯一区别：本 action **不动 `lineIds`**
   * （`setCursorOnly` 会把选区清空）。`anchorLineId` 跟到新光标行，
   * 与鼠标 `Ctrl+点击`「一律重设锚点」的口径一致 —— 供 `Ctrl+↑/↓`
   * 「挪光标 + 保选区」使用。
   *
   * `entryIds`（日志条目多选）不在本次语义内，原样保留。
   *
   * @param lineId 光标落点行 ID
   */
  setActiveLine: (lineId: string) => void
  /**
   * 光标行开关（`Ctrl+Enter`）：把**当前光标行**加入 / 移出选区。
   *
   * - `activeLineId === null` → 无操作；
   * - 光标行已在 `lineIds` → 移出（**可为空**，`lineIds` 归 `[]`）；
   * - 否则 → 加入。
   *
   * 两种情况都**不动 `activeLineId`**（光标停在原行），`anchorLineId`
   * 跟到光标行。`entryIds` 原样保留。
   *
   * 与 {@link toggleLineSelection} 的区别：后者减选时会把 `activeLineId`
   * 跳到剩余成员末项 / 清空，本 action 恒停在光标行。
   */
  toggleActiveLineSelection: () => void
  /**
   * Ctrl(mac Cmd)+点击：切换一行的选中态。
   *
   * - 未选中 → 加入选中集，`activeLineId` 与锚点都跟随被点行；
   * - 已选中 → 移出选中集，锚点仍重设为被点行（与加选同口径）；
   *   被移出的恰是当前激活行时，`activeLineId` 落到剩余成员最后一项，
   *   剩余为空则整组清空（合法「无选中」）。
   *
   * @param lineId 被点击的行 ID
   */
  toggleLineSelection: (lineId: string) => void
  /**
   * Shift+点击：从锚点到目标行按可见行顺序范围选（含两端）。
   *
   * 锚点为 `null`、不在可见行，或目标行不可见时退化为普通点击
   * （因此「无选中状态下 Shift+点击 = 普通点击」）。锚点本身不改。
   *
   * @param lineId 被点击的行 ID
   */
  selectLineRange: (lineId: string) => void
  /** 清空行选择：`lineIds` / `activeLineId` / `anchorLineId` 一并归零（点时间轴背景时用） */
  clearLineSelection: () => void
  /** 设置播放头位置 */
  setPlayhead: (timeMs: number) => void
  /**
   * 设置播放状态。
   *
   * 由音频端口的 `onStateChange` 驱动，而不是按钮自己翻转 ——
   * 音频时钟是播放的唯一基准（架构文档 §6.4），界面只是它的镜像。
   *
   * @param isPlaying 是否正在播放
   */
  setPlaying: (isPlaying: boolean) => void
  /** 设置播放速率 */
  setRate: (rate: number) => void
  /** 设置音量 */
  setVolume: (volume: number) => void
}

/** 由日志与文档重新计算回放结果。 */
function computeReplay(document: LyricDocument, log: OperationLog): ReplayState {
  return replayOperations(log, buildBaselineFromDocument(document))
}

/**
 * 按"当前存在的行"对账选择里的行引用（纯函数）。
 *
 * **行已不存在才清，行还在就原样保留**：注意"未打轴"是合法状态而非无效状态，
 * 因此绝不因为一行没有时间戳就把它清掉。日志记录选择（`entryIds`）原样带过，
 * 是否清空由调用方决定（撤销 / 恢复后一律清空，见 {@link reconcileSelectionAfterUndo}）。
 *
 * 本函数只做"过滤"，不修复不变量：`lineIds` 非空而 `activeLineId` 为 `null`
 * 的修复由需要它的调用方（删除行）自行完成。
 *
 * @param selection 待对账的选择状态
 * @param existingIds 当前可见行的 ID 集合（判据 = 可见行，不是 `document.lines`）
 * @returns 过滤后的新选择状态
 */
export function reconcileLineFields(
  selection: SelectionState,
  existingIds: Set<string>,
): SelectionState {
  return {
    lineIds: selection.lineIds.filter((id) => existingIds.has(id)),
    activeLineId:
      selection.activeLineId !== null && existingIds.has(selection.activeLineId)
        ? selection.activeLineId
        : null,
    anchorLineId:
      selection.anchorLineId !== null && existingIds.has(selection.anchorLineId)
        ? selection.anchorLineId
        : null,
    entryIds: selection.entryIds,
  }
}

/**
 * 在被删行附近挑选「最近剩余成员」。
 *
 * 判据 = 剩余成员在删除后可见行里的下标，距被删行原下标最近；
 * 同距取靠后（下一行优先，即删除后被顶上来的那一行）。若剩余成员在删除后的
 * 可见行里**全部找不到**，兜底取 `remaining` 的最后一项。
 *
 * @param remaining 删除后被删行之外仍选中的行 ID（调用方保证非空）
 * @param after 删除后的可见行
 * @param removedIndex 被删行在删除前可见行里的下标
 * @returns 选中的成员 ID
 */
function nearestRemainingId(remaining: string[], after: LyricLine[], removedIndex: number): string {
  const indexOf = new Map(after.map((line, index) => [line.id, index]))
  let best: string | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  let bestIndex = -1
  for (const id of remaining) {
    const index = indexOf.get(id)
    if (index === undefined) continue
    const distance = Math.abs(index - removedIndex)
    if (distance < bestDistance || (distance === bestDistance && index > bestIndex)) {
      best = id
      bestDistance = distance
      bestIndex = index
    }
  }
  return best ?? remaining[remaining.length - 1]
}

/**
 * 撤销 / 恢复后对账选择中的行引用。
 *
 * 撤销只改日志、不改文档，行本身不会凭空消失；这里只是防御性地把
 * `lineIds` / `activeLineId` / `anchorLineId` 与当前**可见行**对账：
 * **行已不存在才清，行还在就原样保留**。判据取 {@link deriveVisibleLines} 而非
 * `document.lines` —— 被删行仍留在 `document.lines` 里、只被 `removedLineIds` 过滤掉，
 * 用文档行做判据会把幽灵引用当成有效行放过去。
 * 日志记录选择（`entryIds`）是页签内的临时状态，撤销后一律清空。
 *
 * @param document 操作后的文档
 * @param replay 操作后的回放结果
 * @param selection 操作前的选择状态
 * @returns 对账后的新选择状态
 */
function reconcileSelectionAfterUndo(
  document: LyricDocument,
  replay: ReplayState,
  selection: SelectionState,
): SelectionState {
  const existing = new Set(deriveVisibleLines(document, replay).map((line) => line.id))
  return { ...reconcileLineFields(selection, existing), entryIds: [] }
}

/**
 * 读取一行"当前有效"的文本。
 *
 * 优先取回放覆盖层，覆盖层未写的字段回退到文档基线；两处都没有该行时返回 `null`。
 * 缺失字段统一归一为 `null`，让调用方拿到的是一个可直接写进 delta 的自包含快照。
 *
 * @param document 当前文档
 * @param replay 回放结果
 * @param lineId 行 ID
 * @returns 该行的有效文本，行不存在为 `null`
 */
function effectiveLineText(
  document: LyricDocument,
  replay: ReplayState,
  lineId: string,
): LineTextOverride | null {
  const line = document.lines.find((item) => item.id === lineId)
  const override = replay.lineTexts[lineId]
  if (line === undefined && override === undefined) return null
  return {
    text: override?.text ?? line?.text ?? '',
    translation:
      override?.translation !== undefined ? override.translation : (line?.translation ?? null),
    romanization:
      override?.romanization !== undefined ? override.romanization : (line?.romanization ?? null),
    comment: override?.comment !== undefined ? override.comment : (line?.comment ?? null),
  }
}

/** 新建行与锚点行之间的默认时间间隔（毫秒）。 */
const INSERT_LINE_GAP_MS = 2000

/**
 * 推算新建行的初始时间戳。
 *
 * 锚点行的取值一律走 {@link getReplayedLineTimes}，不读 `document.lines` 的原始字段：
 * 基线里存的是导入时的原值，用户拖动 / 微调后的当前值在回放层。
 * "下一可见行"同样取自 {@link deriveVisibleLines}，与歌词列表面板的显示顺序同源
 * （列表渲染的就是可见行，用 `document.lines` 的下标会与看到的顺序错位）。
 *
 * 规则与边界：
 * - 锚点未打轴 → 新行也不打轴
 * - 锚点之后没有可见行、或那一行未打轴 → 锚点末个时间戳 + 2000
 * - 间隔 ≥ 2000 → 锚点末个时间戳 + 2000
 * - 间隔 ≤ 0 → 锚点末个时间戳（唯一允许与锚点相同的兜底）
 * - 间隔 = 1 → **不打轴**。时间戳是整数毫秒，`anchorLast + 1` 恒等于下一行的时间戳，
 *   取任一端点都必然与相邻行相同，从而在"导出 → 双语预设重导入"时被合并掉；
 *   这个间隔下不存在合法整数解，因此宁可让它保持未打轴。真实数据里几乎触发不到
 *   （手工打不出 1ms 间隔），这条分支的意义是保证规则在全输入域下自洽。
 * - 其余（2 ≤ 间隔 < 2000，且间隔为奇数 ≥ 3）→ 锚点末个时间戳 + floor(间隔 / 2)
 *
 * @param document 当前文档
 * @param replay 回放结果
 * @param anchorLineId 锚点行 ID
 * @returns 新行时间戳（毫秒）；`null` 表示不打轴
 */
function inferInitialTimeMs(
  document: LyricDocument,
  replay: ReplayState,
  anchorLineId: string,
): number | null {
  const visible = deriveVisibleLines(document, replay)
  const anchorIndex = visible.findIndex((line) => line.id === anchorLineId)
  if (anchorIndex < 0) return null

  const anchorTimes = getReplayedLineTimes(replay, anchorLineId)
  if (anchorTimes.length === 0) return null
  const anchorLast = anchorTimes[anchorTimes.length - 1]

  const nextLine = visible[anchorIndex + 1]
  const nextTimes = nextLine === undefined ? [] : getReplayedLineTimes(replay, nextLine.id)
  if (nextTimes.length === 0) return anchorLast + INSERT_LINE_GAP_MS

  const gap = nextTimes[0] - anchorLast
  if (gap >= INSERT_LINE_GAP_MS) return anchorLast + INSERT_LINE_GAP_MS
  if (gap <= 0) return anchorLast
  if (gap === 1) return null
  return anchorLast + Math.floor(gap / 2)
}

const demo = createDemoSession()

export const useEditorStore = create<EditorState>()((set, get) => ({
  document: demo.document,
  log: demo.log,
  replay: computeReplay(demo.document, demo.log),
  issues: [],
  audioAsset: null,
  playback: { isPlaying: false, playheadMs: 0, rate: 1, volume: 1 },
  selection: { lineIds: [], activeLineId: null, anchorLineId: null, entryIds: [] },
  logView: { tab: 'all', filter: {}, archivedDisplay: 'thin', expandedEntryIds: [], focusEntryId: null },
  notice: null,

  clearNotice: () => set({ notice: null }),

  importDocument: (document, sourceName, issues = []) => {
    const log = appendOperation(createOperationLog(document.id), {
      kind: 'import',
      // 空范围表示"整篇文档"，逐行罗列没有意义
      scope: { lineIds: [], wordRefs: [], timeRange: null },
      delta: { mode: 'none' },
      description: `导入 ${sourceName}（${document.lines.length} 行）`,
      baseVersion: document.version,
    })
    const replay = computeReplay(document, log)
    // 音频与歌词是两个独立维度：导入歌词不卸载已加载的音频，
    // 只把音频引用接到新文档上，维持 `document.audioRef === audioAsset?.id` 不变式
    const audioRef = get().audioAsset?.id ?? null
    // 导入后默认选中第一可见行：创作者导入后的第一件事就是打轴，
    // 没有选中就看不出从哪里开始（可见行语义见 selectVisibleLines）
    const firstVisibleId = selectVisibleLines(document, replay)[0]?.id ?? null
    set({
      document: { ...document, audioRef },
      log,
      replay,
      issues,
      selection: {
        lineIds: firstVisibleId === null ? [] : [firstVisibleId],
        activeLineId: firstVisibleId,
        // 导入默认选中第一可见行，锚点与激活行同值
        anchorLineId: firstVisibleId,
        entryIds: [],
      },
      logView: { tab: 'all', filter: {}, archivedDisplay: 'thin', expandedEntryIds: [], focusEntryId: null },
    })
  },

  attachAudio: (asset) => {
    const { document, log } = get()
    if (asset === null) {
      // 卸载音频不是"导入"，不写日志；只解除文档对资产的引用
      set({
        audioAsset: null,
        document: { ...document, audioRef: null, updatedAt: Date.now() },
      })
      return
    }
    // 音频引用不参与时间戳回放，属于文档级引用，直接改写。
    // 加载音频与导入 LRC 同规格留痕：kind 复用 'import'（仅记录、不可撤销）
    const nextLog = appendOperation(log, {
      kind: 'import',
      scope: { lineIds: [], wordRefs: [], timeRange: null },
      delta: { mode: 'none' },
      description: `导入音频 ${asset.source.name}（${formatDuration(asset.durationMs)}）`,
      baseVersion: document.version,
    })
    set({
      audioAsset: asset,
      log: nextLog,
      replay: computeReplay(document, nextLog),
      document: { ...document, audioRef: asset.id, updatedAt: Date.now() },
    })
  },

  nudgeLine: (lineId, deltaMs) => {
    if (!Number.isFinite(deltaMs) || deltaMs === 0) return
    const { document, log } = get()
    const line = document.lines.find((item) => item.id === lineId)
    if (line === undefined) return
    const next = appendOperation(log, {
      kind: 'manual-nudge',
      scope: {
        lineIds: [lineId],
        // 带上全部字级下标：回放时字级与行级同加 offsetMs，相对间距不变
        wordRefs: line.wordTimestamps.map((_, wordIndex) => ({ lineId, wordIndex })),
        timeRange: null,
      },
      delta: { mode: 'offset', offsetMs: deltaMs },
      description: `手动微调「${line.text}」（${deltaMs > 0 ? '+' : ''}${deltaMs}ms）`,
      baseVersion: document.version,
    })
    set({ log: next, replay: computeReplay(document, next) })
  },

  stampLine: (lineId, timeMs) => {
    if (!Number.isFinite(timeMs) || timeMs < 0) return
    const { document, log } = get()
    const line = document.lines.find((item) => item.id === lineId)
    if (line === undefined) return
    const landedMs = Math.round(timeMs)
    const next = appendOperation(log, {
      kind: 'manual-timestamp',
      // 未打轴行的字级时间戳本来就不存在，没有可联动的内容
      scope: { lineIds: [lineId], wordRefs: [], timeRange: null },
      delta: { mode: 'absolute', values: [{ lineId, wordIndex: null, timeMs: landedMs }] },
      description: `手动打轴「${line.text}」（${formatTimecode(landedMs)}）`,
      baseVersion: document.version,
    })
    set({ log: next, replay: computeReplay(document, next) })
  },

  setLineStartWithPush: (lineId, newStartMs) => {
    if (!Number.isFinite(newStartMs) || newStartMs < 0) return
    const { document, log, replay } = get()
    const line = document.lines.find((item) => item.id === lineId)
    if (line === undefined) return
    const landedMs = Math.round(newStartMs)
    // 被越过的字卡：时间早于新行首，绝对定位下会落到块左缘之外
    const pushedWordIndexes = line.wordTimestamps
      .map((_, wordIndex) => wordIndex)
      .filter((wordIndex) => {
        const wordTimeMs = getReplayedWordTime(replay, lineId, wordIndex)
        return wordTimeMs !== null && wordTimeMs < landedMs
      })
    if (pushedWordIndexes.length === 0) {
      get().stampLine(lineId, landedMs)
      return
    }
    // 行级项与被推平的字级项必须同属一条 absolute：撤销一步即全部复原
    const values = [
      { lineId, wordIndex: null, timeMs: landedMs },
      ...pushedWordIndexes.map((wordIndex) => ({ lineId, wordIndex, timeMs: landedMs })),
    ]
    const next = appendOperation(log, {
      kind: 'manual-timestamp',
      scope: {
        lineIds: [lineId],
        wordRefs: pushedWordIndexes.map((wordIndex) => ({ lineId, wordIndex })),
        timeRange: null,
      },
      delta: { mode: 'absolute', values },
      description: `行首拖动「${line.text}」（${formatTimecode(landedMs)}，推平 ${pushedWordIndexes.length} 个字卡）`,
      baseVersion: document.version,
    })
    set({ log: next, replay: computeReplay(document, next) })
  },

  moveLinesByOffset: (lineIds, deltaMs) => {
    if (!Number.isFinite(deltaMs) || deltaMs === 0) return
    const { document, replay, log } = get()
    const idSet = new Set(lineIds)
    // 参与集 = 选中 ∩ 可平移（可平移定义见 lineIsMovable：未删 且 已打轴），
    // 按可见行顺序（顺序稳定、日志可读）。
    // 这是数据安全的最后一道防线：入口层（拖动 / nudgeSelection）已拒绝混合集合，
    // 这里对绕过入口的调用再过滤一次，防止未打轴行落一条空转的 offset 脏日志。
    const participants = deriveVisibleLines(document, replay).filter(
      (line) => idSet.has(line.id) && lineIsMovable(replay, line.id),
    )
    if (participants.length === 0) return
    // 单成员：走单块口径，与既有单块拖动 / 方向键微调逐字段一致
    if (participants.length === 1) {
      get().nudgeLine(participants[0].id, deltaMs)
      return
    }
    const wordRefs = participants.flatMap((line) =>
      line.wordTimestamps.map((_, wordIndex) => ({ lineId: line.id, wordIndex })),
    )
    const next = appendOperation(log, {
      kind: 'selection-offset',
      scope: { lineIds: participants.map((line) => line.id), wordRefs, timeRange: null },
      delta: { mode: 'offset', offsetMs: deltaMs },
      description: `多选移动：${participants.length} 行（${deltaMs > 0 ? '+' : ''}${deltaMs}ms）`,
      baseVersion: document.version,
    })
    set({ log: next, replay: computeReplay(document, next) })
  },

  swapLineText: (lineIdA, lineIdB) => {
    if (lineIdA === lineIdB) return
    const { document, log, replay } = get()
    const textA = effectiveLineText(document, replay, lineIdA)
    const textB = effectiveLineText(document, replay, lineIdB)
    if (textA === null || textB === null) return
    // 行级时间戳刻意不动：两行的时间留在各自槽位，只有文字互换
    const next = appendOperation(log, {
      kind: 'swap-line-text',
      scope: { lineIds: [lineIdA, lineIdB], wordRefs: [], timeRange: null },
      delta: {
        mode: 'line-text',
        values: [
          { lineId: lineIdA, ...textB, clearWordTimestamps: true },
          { lineId: lineIdB, ...textA, clearWordTimestamps: true },
        ],
      },
      description: `交换「${textA.text}」与「${textB.text}」`,
      baseVersion: document.version,
    })
    set({ log: next, replay: computeReplay(document, next) })
  },

  editLineText: (lineId, patch) => {
    const { document, log, replay } = get()
    const current = effectiveLineText(document, replay, lineId)
    if (current === null) return
    // 逐字段合并成"全量替换"值：未提供的字段保持原值，显式 null 才清空
    const merged: LineTextOverride = {
      text: patch.text ?? current.text,
      translation: patch.translation !== undefined ? patch.translation : current.translation,
      romanization: patch.romanization !== undefined ? patch.romanization : current.romanization,
      comment: patch.comment !== undefined ? patch.comment : current.comment,
    }
    // 只有正文真的变了才清字级：改翻译 / 罗马音 / 注释时字级仍然有效
    const textChanged = merged.text !== current.text
    const next = appendOperation(log, {
      kind: 'text-edit',
      scope: { lineIds: [lineId], wordRefs: [], timeRange: null },
      delta: {
        mode: 'line-text',
        values: [{ lineId, ...merged, clearWordTimestamps: textChanged }],
      },
      description: `编辑「${current.text}」的文本`,
      baseVersion: document.version,
    })
    set({ log: next, replay: computeReplay(document, next) })
  },

  setWordTimestamps: (lineId, values) => {
    const { document, replay, log } = get()
    const line = document.lines.find((item) => item.id === lineId)
    if (line === undefined) return null
    // 内部一律整数毫秒：只收有限、非负的值，逐项四舍五入
    const changes = values
      .filter((value) => Number.isFinite(value.timeMs) && value.timeMs >= 0)
      .map((value) => ({
        lineId,
        wordIndex: value.wordIndex,
        timeMs: Math.round(value.timeMs),
        wordText: value.wordText,
      }))
    if (changes.length === 0) return null
    // 首字早于当前行级时间：同一条 absolute 记录里把行级一起拉到首字时间。
    // 行级未打轴（currentLineTime === null）时无可比对象，不联动。
    const firstWord = changes.find((value) => value.wordIndex === 0)
    const currentLineTime = getReplayedLineTime(replay, lineId)
    const clampedLineTimeMs =
      firstWord !== undefined && currentLineTime !== null && firstWord.timeMs < currentLineTime
        ? firstWord.timeMs
        : null
    const absoluteValues =
      clampedLineTimeMs === null
        ? changes
        : [...changes, { lineId, wordIndex: null, timeMs: clampedLineTimeMs }]
    const next = appendOperation(log, {
      kind: 'word-timestamp',
      scope: {
        lineIds: [lineId],
        wordRefs: changes.map((value) => ({ lineId, wordIndex: value.wordIndex })),
        timeRange: null,
      },
      delta: { mode: 'absolute', values: absoluteValues },
      description:
        clampedLineTimeMs === null
          ? `字级微调「${line.text}」（${changes.length} 处）`
          : `字级微调并拉齐行头「${line.text}」（${changes.length} 处）`,
      baseVersion: document.version,
    })
    set({ log: next, replay: computeReplay(document, next) })
    return clampedLineTimeMs
  },

  nudgeWordsByOffset: (lineId, wordIndices, deltaMs) => {
    if (!Number.isFinite(deltaMs)) return
    // 内部一律整数毫秒
    const offsetMs = Math.round(deltaMs)
    if (offsetMs === 0) return
    const { document, replay, log } = get()
    const line = document.lines.find((item) => item.id === lineId)
    if (line === undefined) return
    // 去重 + 剔除越界下标 + 剔除当前无回放时间的字（未打轴的字不参与平移）
    const validIndices = Array.from(new Set(wordIndices))
      .filter((index) => Number.isInteger(index) && index >= 0 && index < line.wordTimestamps.length)
      .filter((index) => getReplayedWordTime(replay, lineId, index) !== null)
    if (validIndices.length === 0) return
    const currentLineTime = getReplayedLineTime(replay, lineId)
    const currentFirstWordTime = getReplayedWordTime(replay, lineId, 0)
    const targetFirstTime = currentFirstWordTime === null ? null : currentFirstWordTime + offsetMs
    // 未打轴的行没有行级时间可比，无法判定越界，按普通平移处理
    const needsSyncLine =
      validIndices.includes(0) &&
      targetFirstTime !== null &&
      currentLineTime !== null &&
      targetFirstTime < currentLineTime
    // 越界联动时，同批被拖拽的其余字也必须按同一偏移平移，
    // 否则它们会留在原地、与首字撕裂
    const otherWordValues: Array<{ lineId: string; wordIndex: number; timeMs: number }> = []
    if (needsSyncLine) {
      for (const index of validIndices) {
        if (index === 0) continue
        const originalTime = getReplayedWordTime(replay, lineId, index)
        if (originalTime === null) continue
        otherWordValues.push({ lineId, wordIndex: index, timeMs: originalTime + offsetMs })
      }
    }
    const next =
      needsSyncLine && targetFirstTime !== null
        ? appendOperation(log, {
            kind: 'word-timestamp',
            scope: {
              lineIds: [lineId],
              wordRefs: validIndices.map((wordIndex) => ({ lineId, wordIndex })),
              timeRange: null,
            },
            delta: {
              mode: 'absolute',
              values: [
                // wordIndex === null 是 core 契约里的"行级时间戳"
                { lineId, wordIndex: null, timeMs: targetFirstTime },
                { lineId, wordIndex: 0, timeMs: targetFirstTime },
                ...otherWordValues,
              ],
            },
            description: `字级平移并拉齐行头「${line.text}」（${offsetMs > 0 ? '+' : ''}${offsetMs}ms）`,
            baseVersion: document.version,
          })
        : appendOperation(log, {
            kind: 'word-timestamp',
            // lineIds 留空：行级不参与本次 offset
            scope: {
              lineIds: [],
              wordRefs: validIndices.map((wordIndex) => ({ lineId, wordIndex })),
              timeRange: null,
            },
            delta: { mode: 'offset', offsetMs },
            description: `字级平移「${line.text}」（${validIndices.length}字，${offsetMs > 0 ? '+' : ''}${offsetMs}ms）`,
            baseVersion: document.version,
          })
    set({ log: next, replay: computeReplay(document, next) })
  },

  setLineTime: (lineId, timeMs) => {
    if (!Number.isFinite(timeMs) || timeMs < 0) return
    const { document, replay, log } = get()
    const line = document.lines.find((item) => item.id === lineId)
    if (line === undefined) return
    const landedMs = Math.round(timeMs)
    const current = getReplayedLineTime(replay, lineId)
    // 与当前回放值相同就不写日志，避免"点开保存又原样存回"产生噪声记录
    if (current === landedMs) return
    const wordRefs = line.wordTimestamps.map((_, wordIndex) => ({ lineId, wordIndex }))
    const next =
      current === null
        ? appendOperation(log, {
            kind: 'manual-timestamp',
            // 未打轴行的字级时间本来就不存在，没有可联动的内容（与 stampLine 同口径）
            scope: { lineIds: [lineId], wordRefs: [], timeRange: null },
            delta: { mode: 'absolute', values: [{ lineId, wordIndex: null, timeMs: landedMs }] },
            description: `手动打轴「${line.text}」（${formatTimecode(landedMs)}）`,
            baseVersion: document.version,
          })
        : appendOperation(log, {
            kind: 'manual-timestamp',
            // 已打轴：用 offset 表达，字级随行级同加同一偏移、保持相对间距
            scope: { lineIds: [lineId], wordRefs, timeRange: null },
            delta: { mode: 'offset', offsetMs: landedMs - current },
            description: `手动改行时间「${line.text}」（${formatTimecode(landedMs)}）`,
            baseVersion: document.version,
          })
    set({ log: next, replay: computeReplay(document, next) })
  },

  clearLineTime: (lineId) => {
    const { document, replay, log } = get()
    const current = getReplayedLineTime(replay, lineId)
    if (current === null) return
    const line = document.lines.find((item) => item.id === lineId)
    if (line === undefined) return
    // 带上全部字级：清空要连字级时间一起删，但 scope 里的 wordRefs 不参与删除判定，
    // 只用于日志展示"这一行的哪些字受影响"
    const wordRefs = line.wordTimestamps.map((_, wordIndex) => ({ lineId, wordIndex }))
    const next = appendOperation(log, {
      kind: 'manual-timestamp',
      scope: { lineIds: [lineId], wordRefs, timeRange: null },
      delta: { mode: 'clear-timestamps' },
      description: `清空时间戳「${line.text}」`,
      baseVersion: document.version,
    })
    set({ log: next, replay: computeReplay(document, next) })
  },

  removeLine: (lineId) => {
    const { document, log, replay, selection } = get()
    const current = effectiveLineText(document, replay, lineId)
    if (current === null) return
    const next = appendOperation(log, {
      kind: 'remove-line',
      scope: { lineIds: [lineId], wordRefs: [], timeRange: null },
      delta: { mode: 'remove-line' },
      description: `删除行「${current.text}」`,
      baseVersion: document.version,
    })
    const nextReplay = computeReplay(document, next)

    // 选中态漂移：被删的行仍留在 document.lines 里（只是被 removedLineIds 过滤掉），
    // 存量引用（lineIds / activeLineId / anchorLineId）会指向列表里根本不存在的行。
    // 三条路径统一收口：
    // - 删除的行在选中集里 → 先把它移出，必要时为 activeLineId 挑「最近剩余成员」；
    // - 所有引用一律过 reconcileLineFields 过滤（判据用可见行）；
    // - 修复「lineIds 非空但 activeLineId 为 null」的不变量；
    // - anchor 指向被删行时，重置为解决后的 activeLineId（见裁决 5）。
    const wasSelected = selection.lineIds.includes(lineId)
    const anchorTargeted = selection.anchorLineId === lineId

    let draft = selection
    if (wasSelected) {
      const remaining = selection.lineIds.filter((id) => id !== lineId)
      if (remaining.length > 0) {
        const before = deriveVisibleLines(document, replay)
        const removedIndex = before.findIndex((line) => line.id === lineId)
        const after = deriveVisibleLines(document, nextReplay)
        // 被删的恰是当前激活行 → 落到最近剩余成员；否则激活行原样保留
        const activeLineId =
          selection.activeLineId !== null && remaining.includes(selection.activeLineId)
            ? selection.activeLineId
            : nearestRemainingId(remaining, after, removedIndex)
        draft = { ...selection, lineIds: remaining, activeLineId }
      } else {
        // 选中集只剩这一行，删掉后整组清空（合法「无选中」）
        draft = { ...selection, lineIds: [], activeLineId: null }
      }
    }

    const visibleIds = new Set(deriveVisibleLines(document, nextReplay).map((line) => line.id))
    let nextSelection = reconcileLineFields(draft, visibleIds)
    // 不变量：lineIds 非空 ⇒ activeLineId 非空。不允许出现「lineIds 非空但 active 为 null」
    if (nextSelection.lineIds.length > 0 && nextSelection.activeLineId === null) {
      nextSelection = {
        ...nextSelection,
        activeLineId: nextSelection.lineIds[nextSelection.lineIds.length - 1],
      }
    }
    // 裁决 5：anchor 指向被删行 → 重置为解决后的 activeLineId（可能为 null）
    if (anchorTargeted) {
      nextSelection = { ...nextSelection, anchorLineId: nextSelection.activeLineId }
    }

    set({ log: next, replay: nextReplay, selection: nextSelection })
  },

  removeLines: (lineIds) => {
    const { document, log, replay, selection } = get()
    const visible = deriveVisibleLines(document, replay)
    // 0 态：去重 ∩ 可见行后为空 → 静默返回。
    // 判据刻意用"可见"而非单行 removeLine 的 effectiveLineText —— 见接口注释：
    // 一条 remove-line 的 scope.lineIds 不能含无效行（已删 / 不存在的行）。
    const visibleSet = new Set(visible.map((line) => line.id))
    const targetSet = new Set(lineIds.filter((id) => visibleSet.has(id)))
    if (targetSet.size === 0) return
    // 按可见行顺序排列：日志可读
    const targets = visible.filter((line) => targetSet.has(line.id)).map((line) => line.id)

    // ≥1 态：一条 remove-line 删（选中集的）行，回放循环 scope.lineIds，一次撤销整组复原。
    const next = appendOperation(log, {
      kind: 'remove-line',
      scope: { lineIds: targets, wordRefs: [], timeRange: null },
      delta: { mode: 'remove-line' },
      description: `删除 ${targets.length} 行`,
      baseVersion: document.version,
    })
    const nextReplay = computeReplay(document, next)

    // 落点固定为「直接无选中」：删的是整个选区，删完选区必为空，
    // 故三字段一次性全清，与点背景清空（clearLineSelection）的"无选中"定义逐字段一致。
    // 多选删除**不模仿** removeLine 的"挑最近剩余"收口 —— 那是单删（五按钮）才需要的语义。
    const nextSelection = { ...selection, lineIds: [], activeLineId: null, anchorLineId: null }

    set({ log: next, replay: nextReplay, selection: nextSelection })
  },

  appendBlankLine: (text = '', afterLineId) => {
    const { document, log, replay } = get()
    // 时间戳与行一起写进基线：新建行不进日志，所以不能事后用 stampLine 补
    const timeMs = afterLineId === undefined ? null : inferInitialTimeMs(document, replay, afterLineId)
    const newLine = createLyricLine(text, { timeMs })
    let lines: LyricLine[]
    if (afterLineId === undefined) {
      lines = [...document.lines, newLine]
    } else {
      const index = document.lines.findIndex((line) => line.id === afterLineId)
      lines =
        index < 0
          ? [...document.lines, newLine]
          : [...document.lines.slice(0, index + 1), newLine, ...document.lines.slice(index + 1)]
    }
    // 不进日志：新行直接落进文档，因此它永远属于回放基线
    const nextDocument: LyricDocument = { ...document, lines, updatedAt: Date.now() }
    set({ document: nextDocument, replay: computeReplay(nextDocument, log) })
    return newLine.id
  },

  undoLastAction: () => {
    const { log, document, selection } = get()
    const next = undoLast(log)
    const nextReplay = computeReplay(document, next)
    set({ log: next, replay: nextReplay, selection: reconcileSelectionAfterUndo(document, nextReplay, selection) })
  },

  undoByKindAction: (kind) => {
    const { log, document, selection } = get()
    const next = undoByKind(log, kind)
    const nextReplay = computeReplay(document, next)
    set({ log: next, replay: nextReplay, selection: reconcileSelectionAfterUndo(document, nextReplay, selection) })
  },

  undoSelectedEntries: () => {
    const { log, document, selection } = get()
    // 仅记录类（如导入）没有可回退的目标，先剔除；一个都不剩时明确提示，
    // 而不是静默无效（日志面板的勾选框本轮仍可见）
    const targets = selection.entryIds.filter((entryId) => {
      const entry = getEntry(log, entryId)
      return entry !== null && entry.status === 'active' && isRevertable(entry.kind)
    })
    if (targets.length === 0) {
      set({ notice: '所选记录中无可撤销项', selection: { ...get().selection, entryIds: [] } })
      return
    }
    const next = undoEntries(log, targets)
    const nextReplay = computeReplay(document, next)
    set({ log: next, replay: nextReplay, selection: reconcileSelectionAfterUndo(document, nextReplay, selection) })
  },

  restoreSelectedEntries: () => {
    const { log, document, selection } = get()
    const next = restoreEntries(log, selection.entryIds)
    const nextReplay = computeReplay(document, next)
    set({ log: next, replay: nextReplay, selection: reconcileSelectionAfterUndo(document, nextReplay, selection) })
  },

  toggleEntrySelection: (entryId) => {
    const { entryIds } = get().selection
    const next = entryIds.includes(entryId)
      ? entryIds.filter((id) => id !== entryId)
      : [...entryIds, entryId]
    set({ selection: { ...get().selection, entryIds: next } })
  },

  clearEntrySelection: () => set({ selection: { ...get().selection, entryIds: [] } }),

  toggleEntryExpanded: (entryId) => {
    const { expandedEntryIds } = get().logView
    const next = expandedEntryIds.includes(entryId)
      ? expandedEntryIds.filter((id) => id !== entryId)
      : [...expandedEntryIds, entryId]
    set({ logView: { ...get().logView, expandedEntryIds: next } })
  },

  openArchivedEntry: (entryId) => {
    const { logView } = get()
    set({
      logView: {
        ...logView,
        tab: 'archived',
        // 清掉筛选，保证跳过去的这条一定可见
        filter: {},
        expandedEntryIds: logView.expandedEntryIds.includes(entryId)
          ? logView.expandedEntryIds
          : [...logView.expandedEntryIds, entryId],
        focusEntryId: entryId,
      },
      selection: { ...get().selection, entryIds: [] },
    })
  },

  setLogTab: (tab) =>
    set({
      logView: { ...get().logView, tab, focusEntryId: null },
      // 选择是页签内的概念，切页签时清空，避免"撤销 / 恢复"用错上下文
      selection: { ...get().selection, entryIds: [] },
    }),

  setArchivedDisplay: (mode) => set({ logView: { ...get().logView, archivedDisplay: mode } }),

  patchLogFilter: (patch) => set({ logView: { ...get().logView, filter: { ...get().logView.filter, ...patch } } }),

  resetLogFilter: () => set({ logView: { ...get().logView, filter: {} } }),

  selectLine: (lineId) =>
    set({
      selection: {
        ...get().selection,
        activeLineId: lineId,
        lineIds: lineId ? [lineId] : [],
        // 普通点击即「非 Shift 点击」：anchor 跟随被点行（`null` 时一并清空）
        anchorLineId: lineId,
      },
    }),

  setCursorOnly: (lineId) =>
    set({
      selection: {
        ...get().selection,
        // Tab 只挪光标：清空行选区（entryIds 是日志条目多选，不在本次语义内，原样保留）
        lineIds: [],
        activeLineId: lineId,
        anchorLineId: lineId,
      },
    }),

  setActiveLine: (lineId) =>
    set({
      selection: {
        ...get().selection,
        // 只挪光标：lineIds / entryIds 原样保留；锚点跟到新行（对齐 Ctrl+点击口径）
        activeLineId: lineId,
        anchorLineId: lineId,
      },
    }),

  toggleActiveLineSelection: () => {
    const { selection } = get()
    const activeLineId = selection.activeLineId
    // 无光标：没有可切换的目标行，直接返回
    if (activeLineId === null) return
    const inSelection = selection.lineIds.includes(activeLineId)
    set({
      selection: {
        ...selection,
        // 加 / 减都停在光标行；减到空即 `lineIds` 归 []
        lineIds: inSelection
          ? selection.lineIds.filter((id) => id !== activeLineId)
          : [...selection.lineIds, activeLineId],
        activeLineId,
        anchorLineId: activeLineId,
      },
    })
  },

  toggleLineSelection: (lineId) => {
    const { document, replay, selection } = get()
    // 零.1：无类型判定 —— 异类行照常 toggle，不再忽略。
    // 只保留"存在性"过滤：目标不可见（不存在）时忽略。
    const target = deriveVisibleLines(document, replay).find((line) => line.id === lineId)
    if (target === undefined) return
    if (selection.lineIds.includes(lineId)) {
      const remaining = selection.lineIds.filter((id) => id !== lineId)
      if (remaining.length === 0) {
        // 减空最后一个成员：合法「无选中」，anchor 一并清空
        set({ selection: { ...selection, lineIds: [], activeLineId: null, anchorLineId: null } })
        return
      }
      set({
        selection: {
          ...selection,
          lineIds: remaining,
          // 被减的恰是当前激活行 → 落到剩余成员最后一项；否则激活行原样保留
          activeLineId:
            selection.activeLineId === lineId
              ? remaining[remaining.length - 1]
              : selection.activeLineId,
          // 二.2 字面：Ctrl 点击一律重设锚点为被点行，无论加选还是减选
          anchorLineId: lineId,
        },
      })
      return
    }
    // 加选：激活行与锚点都跟随被点行
    set({
      selection: {
        ...selection,
        lineIds: [...selection.lineIds, lineId],
        activeLineId: lineId,
        anchorLineId: lineId,
      },
    })
  },

  selectLineRange: (lineId) => {
    const { document, replay, selection } = get()
    const visible = deriveVisibleLines(document, replay)
    const targetIndex = visible.findIndex((line) => line.id === lineId)
    const anchorIndex =
      selection.anchorLineId === null
        ? -1
        : visible.findIndex((line) => line.id === selection.anchorLineId)
    // 锚点缺失 / 不可见、或目标行不可见 → 退化为普通点击
    if (anchorIndex < 0 || targetIndex < 0) {
      get().selectLine(lineId)
      return
    }
    const start = Math.min(anchorIndex, targetIndex)
    const end = Math.max(anchorIndex, targetIndex)
    // 零.2：范围全纳入，不再按类型过滤；锚点在范围内，故成员必非空
    const memberIds = visible.slice(start, end + 1).map((line) => line.id)
    set({
      selection: {
        ...selection,
        lineIds: memberIds,
        // 目标必在范围内 → 它就是激活行（零.3：锚点只作范围起点，不再决定集合类型）
        activeLineId: lineId,
        // Shift+点击不改锚点
      },
    })
  },

  clearLineSelection: () =>
    set({
      selection: { ...get().selection, lineIds: [], activeLineId: null, anchorLineId: null },
    }),

  setPlayhead: (timeMs) =>
    set({ playback: { ...get().playback, playheadMs: Math.max(0, Math.round(timeMs)) } }),

  setPlaying: (isPlaying) => set({ playback: { ...get().playback, isPlaying } }),

  setRate: (rate) => set({ playback: { ...get().playback, rate } }),

  setVolume: (volume) =>
    set({ playback: { ...get().playback, volume: Math.min(1, Math.max(0, volume)) } }),
}))

/**
 * 读取当前"可见行"。
 *
 * 可见行 = 文档行剔除被移除的、套上文本覆盖层、并抹掉被清空的字级。
 * 消费方必须"订阅 `document` / `replay` 两个稳定引用 + `useMemo`"调用本函数，
 * 不能写成 `useEditorStore((state) => selectVisibleLines(state.document, state.replay))` ——
 * 那会在每次 render 返回新数组，触发无限重渲染。
 *
 * @param document 当前文档
 * @param replay 回放结果
 * @returns 可见行数组（保持文档原有顺序）
 */
export function selectVisibleLines(document: LyricDocument, replay: ReplayState): LyricLine[] {
  return deriveVisibleLines(document, replay)
}

/**
 * 组装导出文本：把回放里的行级 / 字级时间戳合并进可见行，再按统一精度序列化。
 *
 * 编辑（打轴 / 微调 / 拖动 / 偏移 / 字级）只写 `log` + `replay`，导出却读 `document`，
 * 二者的桥就落在这里：
 * - 行级：用 {@link getReplayedLineTimes} 重建 `timestamps`（回放为准）；
 * - 字级：以文档行的 `wordTimestamps` 为骨架（保留 `range` / `text`），
 *   按下标用 {@link getReplayedWordTime} 覆盖 `timeMs`；
 * - 未打轴的行保持空 `timestamps`，由序列化层原样写回 `raw`。
 *
 * App.tsx 与验收 harness 必须共用本函数，不得各自拼装序列化参数。
 *
 * @param document 当前文档（基线）
 * @param replay 回放结果
 * @param uniformPrecisionMs 导出行级 / 字级统一精度（毫秒），必填：`10` 两位、`1` 三位
 * @returns 完整 LRC 文本
 */
export function buildExportText(
  document: LyricDocument,
  replay: ReplayState,
  uniformPrecisionMs: 10 | 1,
): string {
  const lines = deriveVisibleLines(document, replay).map((line): LyricLine => {
    // 行级时间戳被清空（clear-timestamps）：行本身留下、字级切分也保留，
    // 但导出必须按"纯文本"写回 —— 否则 `line.timestamps` 里的基线旧值
    // （以及 `wordTimestamps` 的旧标签）会绕过回放复活。清成空数组后，
    // serialize 回退到 `line.raw ?? line.text`，正是"清空"想要的纯文本。
    if (replay.clearedLineLines.has(line.id)) {
      return { ...line, timestamps: [], wordTimestamps: [], raw: undefined }
    }
    const lineTimes = getReplayedLineTimes(replay, line.id)
    const timestamps: Timestamp[] =
      lineTimes.length > 0
        ? lineTimes.map(
            (timeMs, index): Timestamp => ({
              kind: 'line',
              timeMs,
              precisionMs: line.timestamps[index]?.precisionMs ?? uniformPrecisionMs,
              source: line.timestamps[index]?.source ?? 'manual',
            }),
          )
        : line.timestamps

    const wordTimestamps =
      line.wordTimestamps.length > 0
        ? (() => {
            // D4 链式向前继承：被清空的字（回放返回 null）沿用「前一个有效字」的时间；
            // 链头（首字即被清）落该行行级时间戳（行级也没有时 → 跳过该字标签，
            // 其文本仍由 serialize 的 range 切片输出，「省略条目」即等价于「只留文本」）。
            const mapped: typeof line.wordTimestamps = []
            let lastValid: number | null = lineTimes.length > 0 ? lineTimes[0] : null
            for (let index = 0; index < line.wordTimestamps.length; index += 1) {
              const word = line.wordTimestamps[index]
              const replayed = getReplayedWordTime(replay, line.id, index)
              if (replayed !== null) {
                lastValid = replayed
                mapped.push({ ...word, timeMs: replayed })
              } else if (lastValid !== null) {
                // 连续被清空的字继承同一个 lastValid，不清零
                mapped.push({ ...word, timeMs: lastValid })
              }
            }
            return mapped
          })()
        : line.wordTimestamps

    if (timestamps === line.timestamps && wordTimestamps === line.wordTimestamps) return line
    return { ...line, timestamps, wordTimestamps }
  })

  // 导出顺延：beforeLine 的锚点行可能已被删除（不在可见行集合里）。
  // 此时把该批空行顺延到文档顺序中向下的第一个可见行；无则并入 trailing。
  // core 的 serializeLrc 仍保留「锚点不存在即丢弃」的降级契约，清洗只在导出层做。
  const blankLines = document.format.blankLines
  let format = document.format
  if (blankLines?.beforeLine !== undefined) {
    const visibleIds = new Set(lines.map((line) => line.id))
    const normalizedBeforeLine: Record<string, string[]> = {}
    const orphanTrailing: string[] = []
    for (const [id, blanks] of Object.entries(blankLines.beforeLine)) {
      let targetId: string | undefined = visibleIds.has(id) ? id : undefined
      if (targetId === undefined) {
        const anchorIndex = document.lines.findIndex((line) => line.id === id)
        for (let index = anchorIndex + 1; anchorIndex >= 0 && index < document.lines.length; index += 1) {
          const candidate = document.lines[index]
          if (visibleIds.has(candidate.id)) {
            targetId = candidate.id
            break
          }
        }
      }
      if (targetId === undefined) orphanTrailing.push(...blanks)
      else (normalizedBeforeLine[targetId] ??= []).push(...blanks)
    }
    // 顺延落空（锚点在末尾）的空行排在真实 trailing 之前，保持源顺序。
    const normalizedTrailing = [...orphanTrailing, ...(blankLines.trailing ?? [])]
    format = {
      ...document.format,
      blankLines: {
        ...(blankLines.leading !== undefined ? { leading: blankLines.leading } : {}),
        ...(Object.keys(normalizedBeforeLine).length > 0 ? { beforeLine: normalizedBeforeLine } : {}),
        ...(normalizedTrailing.length > 0 ? { trailing: normalizedTrailing } : {}),
      },
    }
  }

  return serializeLrc({ ...document, format, lines }, { uniformPrecisionMs })
}

/**
 * 判定一行当前是否「可平移」。
 *
 * 可平移 = **行未被删（可见）** 且 **行已打轴（有行级时间戳）**。
 * 两个条件都显式写，不依赖「被删 ⇒ 无时间戳」这一回放层的隐式不变量：
 * - 可见：`replay.removedLineIds` 不含该行（回放层判定可见行的同一判据）；
 * - 已打轴：{@link getReplayedLineTimes} 非空。
 *
 * 拖动入口、微调入口（`nudgeSelection`）与 {@link EditorState.moveLinesByOffset}
 * 内层过滤三处共用本函数：入口层据此拒绝整组，内层作为数据安全的最后一道防线。
 * 命名强调「可平移」而非「已打轴」—— 它不止判时间，还判可见。
 *
 * @param replay 当前回放结果
 * @param id 行 ID
 * @returns 可平移为 `true`
 */
export function lineIsMovable(replay: ReplayState, id: string): boolean {
  const visible = !replay.removedLineIds.has(id)
  const timed = getReplayedLineTimes(replay, id).length > 0
  return visible && timed
}

/**
 * 读取当前页签下应展示的日志记录。
 *
 * 日志里**只有修改记录**，撤销与恢复不产生新条目，只是把记录的状态翻转，
 * 因此三个页签的差别只是"看哪些状态的记录"：
 * - 总：全部修改记录；被撤销的按 `archivedDisplay` 决定显示、收成细行还是隐藏；
 * - 修改：只看生效中的修改，已撤销的进"已归档"，不在这里出现；
 * - 已归档：只看被撤销的原始修改记录本身，可恢复。
 *
 * "报错 / 忽略"依赖尚未实现的校验层，返回空数组。
 *
 * @param log 操作日志
 * @param logView 日志面板视图状态
 * @returns 命中的日志记录
 */
export function selectVisibleEntries(log: OperationLog, logView: LogViewState): OperationLogEntry[] {
  switch (logView.tab) {
    case 'all': {
      const entries = filterEntries(log, logView.filter)
      return logView.archivedDisplay === 'hidden'
        ? entries.filter((entry) => entry.status === 'active')
        : entries
    }
    case 'edits':
      // 只看生效中的修改；已撤销的记录不显示在"修改"页签
      return filterEntries(log, { ...logView.filter, statuses: ['active'] })
    case 'archived':
      // 已归档 = 被撤销的原始修改记录
      return filterEntries(log, { ...logView.filter, statuses: ['undone'] })
    case 'issues':
    case 'ignored':
    default:
      return []
  }
}
