import type { AdapterContext } from '@adapters'
import { lineIsMovable, selectVisibleLines, useEditorStore } from '../stores/editorStore'
import { showToast } from '../stores/toastStore'

/**
 * 编辑器命令层。
 *
 * 这里放"按钮"与"快捷键"必须**完全等价**的动作：两条入口都调同一个函数，
 * 只有一份实现，行为不会分叉。
 *
 * 刻意不放快捷键判定逻辑（那是 `useEditorHotkeys` 的职责），
 * 也不做成 React hook —— 事件处理器与组件都要调用，用 `adapters` 入参最直接。
 */

/**
 * 播放 / 暂停。
 *
 * 架构约定（架构文档 §6.4）：**音频时钟是播放的唯一基准**。
 * 因此这里不翻转任何本地状态，而是调用音频端口的 `play` / `pause`，
 * `isPlaying` 由端口 `onStateChange` 回灌（见 `useAudioPlayback`）。
 * 绕过端口直接改 store 会让按钮显示状态与真实播放脱节。
 *
 * @param adapters 平台能力集合
 */
export function togglePlayback(adapters: AdapterContext): void {
  const { playback, audioAsset } = useEditorStore.getState()
  const hasAudio = audioAsset !== null && audioAsset.durationMs > 0
  if (!hasAudio) return
  if (playback.isPlaying) void adapters.audio.pause()
  else void adapters.audio.play()
}

/**
 * 手势开始时按设置暂停音频（**真暂停**，松手不自动续播）。
 *
 * 用于"平移视窗"（滚动条拖拽 / 滚轮）与"移动播放头"（尺子擦洗 / 屏外箭头拖动）
 * 两类手势：开关关闭时保持旧行为（拖到哪从那继续播）；
 * 开启且正在播放时立即 `pause()`，由端口 `onStateChange` 回灌 `isPlaying`。
 *
 * @param adapters 平台能力集合
 * @param enabled 对应设置项是否开启
 */
export function pauseAudioOnGesture(adapters: AdapterContext, enabled: boolean): void {
  if (!enabled) return
  const { playback, audioAsset } = useEditorStore.getState()
  if (audioAsset === null || audioAsset.durationMs <= 0) return
  if (!playback.isPlaying) return
  void adapters.audio.pause()
}

/**
 * 播放头拖动会话（模块级单例）。
 *
 * ## 为什么放模块级，而不是 store / React state
 * - 拖动期间每帧都要读这个值（{@link resolvePlayheadMs} 被各图层每帧调用），
 *   放 React state 会造成 60Hz 重渲染，放 store 同样会高频通知订阅者；
 * - 拖动是**瞬时交互状态**：没有跨会话持久化需求，也不该进撤销栈；
 * - 本模块不 import 时间轴目录，作为会话宿主可避免循环依赖。
 *
 * 单进程单实例假设：同一时刻只允许一个拖动会话（指针 capture 已保证）。
 */
let scrubMs: number | null = null

/** 是否正在拖动播放头。 */
export function isScrubbing(): boolean {
  return scrubMs !== null
}

/** 拖动会话中的当前时间（毫秒）；不在拖动中返回 `null`。 */
export function getScrubMs(): number | null {
  return scrubMs
}

/**
 * 开始拖动会话。
 *
 * `pointerdown` 即调用（**按住即接管**，不等移动）。
 *
 * @param timeMs 接管瞬间的播放头时间（毫秒）
 */
export function beginScrub(timeMs: number): void {
  scrubMs = timeMs
}

/** 更新拖动会话时间（毫秒）。 */
export function moveScrub(timeMs: number): void {
  scrubMs = timeMs
}

/** 结束拖动会话。 */
export function endScrub(): void {
  scrubMs = null
}

/**
 * 解析"当前时间"（播放头所在毫秒）。
 *
 * ## 为什么收口成一个函数
 * "当前时间"有三个可能来源，全项目只在这一次分流（优先级从高到低）：
 * - 拖动中：拖动会话值 {@link getScrubMs}（**最高优先级**，"按住即接管、跟手"）；
 * - 播放中且有音频：音频时钟 {@link AudioPort.getCurrentTimeMs}（每帧可读，唯一时钟基准）；
 * - 其余（暂停 / 无音频）：store 的 `playback.playheadMs`
 *   （无音频时端口恒为 0；暂停时端口 seek 会把位置夹回音频时长，
 *   退不回尾巴区，故改用 store 承载用户点出来的位置）。
 *
 * 播放中**不能**退回 `playback.playheadMs`：它是 10Hz 节流后的镜像
 * （见 `useAudioPlayback`），读数会偏。
 *
 * @param adapters 平台能力集合
 */
export function resolvePlayheadMs(adapters: AdapterContext): number {
  if (scrubMs !== null) return scrubMs
  if (
    adapters.audio.getDurationMs() > 0 &&
    useEditorStore.getState().playback.isPlaying
  ) {
    return adapters.audio.getCurrentTimeMs()
  }
  return useEditorStore.getState().playback.playheadMs
}

/**
 * 定位播放头（**唯一的写入口**）。
 *
 * store 的读数镜像与音频端口的真实时钟必须成对写入，故收成一处。
 * 无音频时**不调端口**：端口没有 buffer，`seek` 会把位置夹回 0，
 * 反而抹掉刚写进 store 的可见位置（这正是"无音频点时间轴看不见播放头动"的根因）。
 *
 * ## 上界
 * 本函数只沿用 `setPlayhead` 现有的口径（`Math.max(0, Math.round)`）；
 * 上界由调用方按各自的 `durationMs` 预夹后传入
 * （音频时长与时间轴内容时长并不相等，只有调用方知道该用哪个）。
 *
 * @param adapters 平台能力集合
 * @param timeMs 目标时间（毫秒）
 */
export function seekPlayhead(adapters: AdapterContext, timeMs: number): void {
  useEditorStore.getState().setPlayhead(timeMs)
  if (adapters.audio.getDurationMs() > 0) void adapters.audio.seek(timeMs)
}

/**
 * 对当前选中行打轴，并把选中推进到下一可见行。
 *
 * ## 时间来源
 * 取 {@link resolvePlayheadMs}：有音频时是音频时钟
 * （{@link AudioPort.getCurrentTimeMs}，打轴精度依赖它，**不能用 10Hz 节流的
 * `playback.playheadMs`**）；无音频时是 store 里承载的播放头位置
 * （端口恒为 0，用 0 打轴会与用户看见的播放头位置不符）。
 *
 * ## 行集合
 * 一律按"可见行"判定（`selectVisibleLines`）：被删除的行仍留在 `document.lines` 里，
 * 只是被 `removedLineIds` 过滤掉，所以"行是否存在"与"下一行是谁"都必须看可见行。
 *
 * ## 边界（产品决定 F / E / 零.2）
 * - 没有可见行：静默返回（无行可打）；
 * - 没有任何选中行：静默返回（无选中是合法状态，打轴必须有明确目标）；
 * - `activeLineId` 指向不存在的行（已被删除）：静默返回，不打轴；
 * - 没有音频：用 store 里承载的播放头位置打轴（与用户看见的播放头一致）；
 * - 同一行重复打轴：允许覆盖，每次追加一条新日志（可撤销）；
 * - 打完已是最后一行：保持选中不动（不清空选中）。
 *
 * @param adapters 平台能力集合
 */
export function stampActiveLine(adapters: AdapterContext): void {
  const store = useEditorStore.getState()
  const visible = selectVisibleLines(store.document, store.replay)
  if (visible.length === 0) return

  const activeId = store.selection.activeLineId
  // 无选中：静默返回，不猜"第一可见行"（零.2）
  if (activeId === null) return
  // 选中行已被删除（不在可见行里）：静默返回，不误打到别的行
  if (!visible.some((line) => line.id === activeId)) return

  store.stampLine(activeId, resolvePlayheadMs(adapters))

  const next = visible[visible.findIndex((line) => line.id === activeId) + 1]
  if (next !== undefined) store.selectLine(next.id)
}

/**
 * 方向键微调的步长（毫秒）。
 *
 * 刻意**不进 `DEFAULT_HOTKEYS`**：那张表管"按哪个键"，
 * 步长是业务参数，将来做键位设置 UI 时两者要分开。
 */
export const NUDGE_STEP_MS = 10

/**
 * 把选中行移到上一 / 下一**可见行**。
 *
 * ## 行集合
 * 一律按可见行（{@link selectVisibleLines}）：被删除的行仍留在 `document.lines` 里，
 * 按 `lines` 算会选到用户看不见的行。
 *
 * ## 边界口径
 * - 没有可见行：静默返回；
 * - 没有选中行，**或**选中行已被删除（不在可见行里）：都视同"无选中"，
 *   选中第一可见行。选中行被删后静默不动会让用户卡住、没有恢复路径；
 * - 已在首 / 末可见行：不动（不清空选中）。
 *
 * @param direction `-1` 上一行，`1` 下一行
 * @param options.keepSelection `true`（`Ctrl+↑/↓`）→ 只挪光标、**保选区**并重设
 *   锚点（走 {@link EditorState.setActiveLine}）；省略 / `false` → 现状
 *   （走 `selectLine`，选区重置为「新行单选」）。
 */
export function moveSelection(
  direction: -1 | 1,
  options: { keepSelection?: boolean } = {},
): void {
  const store = useEditorStore.getState()
  const visible = selectVisibleLines(store.document, store.replay)
  const first = visible[0]
  if (first === undefined) return

  // 落点提交方式分流：keep 模式保选区，默认模式单选重置
  const commit =
    options.keepSelection === true
      ? (id: string): void => store.setActiveLine(id)
      : (id: string): void => store.selectLine(id)

  const activeId = store.selection.activeLineId
  const currentIndex = activeId === null ? -1 : visible.findIndex((line) => line.id === activeId)
  if (currentIndex === -1) {
    commit(first.id)
    return
  }

  const target = visible[currentIndex + direction]
  if (target === undefined) return
  commit(target.id)
}

/**
 * `Shift+↑/↓`：从锚点范围选到相邻可见行（含两端）。
 *
 * 范围计算**不在这里重写**，直接复用 {@link EditorState.selectLineRange} 的
 * 「锚点→目标全纳、`activeLineId` = 目标行、锚点不动」口径；本函数只负责
 * 按光标位置求出目标行。
 *
 * 无光标（`currentIndex === -1`）→ 退化为 `selectLine(visible[0])`，与
 * 鼠标「无锚点时 Shift+点击 = 普通点击」的退化口径一致。
 *
 * @param direction `-1` 上一行，`1` 下一行
 */
export function moveSelectionRange(direction: -1 | 1): void {
  const store = useEditorStore.getState()
  const visible = selectVisibleLines(store.document, store.replay)
  const first = visible[0]
  if (first === undefined) return

  const activeId = store.selection.activeLineId
  const currentIndex = activeId === null ? -1 : visible.findIndex((line) => line.id === activeId)
  if (currentIndex === -1) {
    store.selectLine(first.id)
    return
  }

  const target = visible[currentIndex + direction]
  if (target === undefined) return
  store.selectLineRange(target.id)
}

/**
 * `Esc`：清空行选区，**光标不动**。
 *
 * 只调用 {@link EditorState.setCursorOnly}（`lineIds` 清空、`activeLineId` /
 * 锚点设为该行），不改其实现 —— 该 action 原为 Tab 导航专用，此处借它的
 * 「清选区 + 保光标」语义。无光标（`activeLineId === null`）→ 无操作
 * （由单向不变量，此时 `lineIds` 必为空，无需清）。
 */
export function clearSelectionKeepCursor(): void {
  const store = useEditorStore.getState()
  const activeId = store.selection.activeLineId
  if (activeId === null) return
  store.setCursorOnly(activeId)
}

/**
 * `Ctrl+Enter`：光标行加入 / 移出选区（开关）。
 *
 * 薄封装，直接转交 {@link EditorState.toggleActiveLineSelection}，
 * 让 hotkeys 统一从命令层取入口。
 */
export function toggleCursorSelection(): void {
  useEditorStore.getState().toggleActiveLineSelection()
}

/**
 * 对当前选中行做相对偏移（微调）。
 *
 * ## 单块 / 多选同一口径
 * - 选中集 ≥ 1 行：整组一起偏移；参与集 = 选中 ∩ 可平移，空则静默返回；
 * - 其余（0 行）：走单块口径（读光标行 `activeLineId`）。
 *
 * 阈值定为 1（而非旧的 2）是为了覆盖新状态 `{lineIds:[A], active:B}`：只要有
 * 选中行就以**选中集**为基准。旧状态下 `lineIds` 单行时 `activeLineId` 必等于
 * 该行，故旧行为逐字段等价；仅上述新状态下由「动 B」改为「动 A」。
 *
 * 两条分支最终都调 {@link EditorState.moveLinesByOffset}，因此"哪些行参与、空集怎么办"
 * 只有一处实现（单成员在内部再分流到 `nudgeLine`，落 `manual-nudge`，与既有行为逐字段一致）。
 *
 * ## 单块何时不生效（产品决定：静默返回）
 * - 没有选中行：没有可偏移的基准；
 * - 选中行不可平移（已删 / 未打轴）：没有可偏移的基线。
 *
 * "可平移"的统一定义见 {@link lineIsMovable}（**未删 且 已打轴**，两个条件都显式写）。
 * 最后一条**必须显式守卫**（多选分支由 `moveLinesByOffset` 内部过滤完成）：
 * `nudgeLine` 只校验行是否存在，对未打轴行仍会追加一条 `manual-nudge` 日志，
 * 而回放时这条 offset 因"该行没有行级时间戳"被静默跳过 ——
 * 不守卫等于"时间戳没变、日志却脏了"。
 *
 * @param deltaMs 偏移量（毫秒），正数向后（变晚）、负数向前（变早）
 */
export function nudgeSelection(deltaMs: number): void {
  const store = useEditorStore.getState()

  // 集合级判定（选中集 ≥ 1 行）—— 只要有一行不可平移（未打轴 / 已删）→ 整组拒绝（静默返回）。
  // "可平移"统一走 lineIsMovable（三处共用一个定义，入口层不各写一遍）。
  // 拒绝必须在此入口表达，不得依赖 moveLinesByOffset 的内层过滤兜底
  // （否则会"静默只动已打轴子集"，与裁决冲突）。
  if (store.selection.lineIds.length >= 1) {
    const allMovable = store.selection.lineIds.every((id) => lineIsMovable(store.replay, id))
    if (!allMovable) {
      showToast('无法微调：所选行含未打轴行')
      return
    }
    store.moveLinesByOffset(store.selection.lineIds, deltaMs)
    return
  }

  // 单选 / 无选中：保留可平移守卫后走单块口径（可见性与已打轴都由 lineIsMovable 覆盖）。
  // 单行被拒保持静默（拖不动 / 微调不了是单块常态，弹提示反而吵）。
  const activeId = store.selection.activeLineId
  if (activeId === null) return
  if (!lineIsMovable(store.replay, activeId)) return
  store.moveLinesByOffset([activeId], deltaMs)
}

/**
 * 删除当前选中的全部行（多选删除，键盘 Delete / Backspace 的等价命令）。
 *
 * 类型无关：作用于 `selection.lineIds` 全集。无选中 → 静默返回。
 * 单行 / 多行的日志形态与"直接无选中"落点交给 store 的 `removeLines` 两态处理。
 */
export function removeSelectedLines(): void {
  const store = useEditorStore.getState()
  if (store.selection.lineIds.length === 0) return
  store.removeLines(store.selection.lineIds)
}
