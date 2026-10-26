import { useEffect, useRef, useState, type CompositionEvent } from 'react'
import type { LyricLine, WordSegment } from '@core'
import { getReplayedLineTime, getReplayedWordTime } from '@core'
import { deriveInitialWordTimes } from '@core/lyrics/wordTimes'
import { useEditorStore } from '../stores/editorStore'
import { useSettingsStore } from '../stores/settingsStore'
import { showToast } from '../stores/toastStore'
import { formatDuration } from '../utils/format'
import { parseTimeInput } from '../utils/timeInput'
import { ConfirmDialog } from './ConfirmDialog'
import { LineActionIcon } from './LineActionIcons'
import type { LineActionItem } from './LineActionSheet'
import { WordCutDialog } from './WordCutDialog'

/** 行编辑弹窗内容区属性。 */
export interface LineEditFormProps {
  /** 目标行（可见行，文本与字级已是回放后的当前值）；父层用 `key={line.id}` 保证换行即重挂载 */
  line: LyricLine
  /** 底部四个行操作，恒为四项（上移 / 下移 / 新建 / 删除） */
  items: LineActionItem[]
  /** 关闭弹窗；取消与保存都走它 */
  onClose: () => void
  /** 脏状态变化时上抛，供父层判断 Esc / 点遮罩是否放行 */
  onDirtyChange: (dirty: boolean) => void
}

/** 可编辑的四个文本字段。 */
type TextFieldKey = 'text' | 'translation' | 'romanization' | 'comment'

/** 常驻字段：主文本不参与折叠。 */
const PRIMARY_FIELD: { key: TextFieldKey; label: string } = { key: 'text', label: '主文本' }

/** 可折叠字段：翻译 / 罗马音 / 注释，共用一个开关。 */
const COLLAPSIBLE_FIELDS: Array<{ key: TextFieldKey; label: string }> = [
  { key: 'translation', label: '翻译' },
  { key: 'romanization', label: '罗马音' },
  { key: 'comment', label: '注释' },
]

/** 全部可编辑字段，只用于脏检查，与折叠无关。 */
const TEXT_FIELDS = [PRIMARY_FIELD, ...COLLAPSIBLE_FIELDS]

/** 一个字的草稿：`raw` 是输入框里的原始文本，`initialMs` 是打开弹窗时的回放值。 */
interface WordDraft {
  /** 行模型 `wordTimestamps` 的数组下标，写日志时作为 `wordIndex` */
  index: number
  /** 词组文本，只读展示，同时作为日志的 `wordText` */
  text: string
  /** 打开弹窗时的回放值（毫秒） */
  initialMs: number | null
  /** 输入框里的原始文本 */
  raw: string
}

/** 空串视为清空（`null`），否则保留字符串。 */
function toNullable(value: string): string | null {
  return value === '' ? null : value
}

/**
 * 折叠开关的箭头。画的是朝下；收起时由 CSS 旋转指向右侧。
 *
 * 内联在这里而不是放进 `LineActionIcons.tsx`：那个文件的范围是"行操作图标"
 * （上移 / 下移 / 新建 / 删除 / ⋮），箭头属于本表单的 chrome，不是一类东西。
 * 也不复用 `move-down` —— 它带竖尾、语义是"下移操作"，拿来当展开指示会混淆。
 */
function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M5.5 7.5 10 12l4.5-4.5" />
    </svg>
  )
}

/**
 * 行编辑弹窗的内容区：四个文本字段 + 字级时间戳列表 + 底部一行。
 *
 * 弹窗外壳（遮罩 / 标题栏 / 关闭路径）在 `LineActionSheet`，本组件只管内容，
 * 但底部的四个行操作按钮**放在这里**，以便和右侧的取消 / 保存在同一行。
 *
 * 初值只在挂载时取一次，父层用 `key={line.id}` 重挂载实现"换行即重置"，
 * 因此这里不写任何 reset effect。
 */
export function LineEditForm({ line, items, onClose, onDirtyChange }: LineEditFormProps) {
  const replay = useEditorStore((state) => state.replay)
  const editLineText = useEditorStore((state) => state.editLineText)
  const setWordTimestamps = useEditorStore((state) => state.setWordTimestamps)
  const setLineTime = useEditorStore((state) => state.setLineTime)
  const clearLineTime = useEditorStore((state) => state.clearLineTime)
  const commitWordSegments = useEditorStore((state) => state.commitWordSegments)

  const [baseline] = useState(() => ({
    text: line.text,
    translation: line.translation ?? '',
    romanization: line.romanization ?? '',
    comment: line.comment ?? '',
  }))
  const [drafts, setDrafts] = useState(() => ({ ...baseline }))

  // 折叠状态默认展开。父层 `key={line.id}` 让换行即重挂载，因此天然回到默认，
  // 不需要写 reset effect。折叠不参与 dirty。
  const [expanded, setExpanded] = useState(true)

  // 切割草案：用户已在二级弹窗点「确定」，但尚未保存。只存 segments，不提前写 store；
  // 正文一改即作废（range 全部失效），作废时搬到 staleCutDraft 灰显留痕。
  const [cutDraft, setCutDraft] = useState<WordSegment[] | null>(null)
  const [cutDialogOpen, setCutDialogOpen] = useState(false)
  // 确认框：正文后果在输入瞬间弹，行级后果在保存时弹，共用同一个 ConfirmDialog
  const [confirmKind, setConfirmKind] = useState<'text' | 'line' | null>(null)
  // 用户在行级确认框点「继续保存」后置真，重入 save 时跳过守卫
  const skipConfirmRef = useRef(false)
  // 本会话内正文后果已确认过：此后改正文不再弹，直到关闭重开弹窗
  const textConfirmedRef = useRef(false)
  // 待确认的新正文；非 IME 路径在确认前不写入 drafts
  const pendingTextRef = useRef<string | null>(null)
  // 组合输入进行中：期间放行写入，避免打断输入法
  const composingTextRef = useRef(false)
  // 本次组合开始前的正文：IME 路径取消时回滚到这里
  const composingStartTextRef = useRef<string | null>(null)
  // 两项确认的形态设置：true = 弹窗，false = 仅 toast（不挡编辑）
  const confirmTextChange = useSettingsStore((state) => state.settings.confirmTextChange)
  const confirmClearLineTime = useSettingsStore((state) => state.settings.confirmClearLineTime)
  // 弹窗勾选「以后用 toast 提示」时写入对应设置项
  const updateSettings = useSettingsStore((state) => state.update)
  // 本次弹窗会话内正文降级提示已发过：避免逐字符刷屏
  const textToastedRef = useRef(false)
  // 草案时间的手改值：`null` = 用户没动过，保存时仍按保存那刻的锚点重算 200ms 序列
  const [cutTimesRaw, setCutTimesRaw] = useState<string[] | null>(null)
  // 已作废的草案快照：正文一改就搬过来，只做灰显展示。
  // 不参与保存、不进日志、不计入 dirty；重新切分或关闭弹窗即丢。
  const [staleCutDraft, setStaleCutDraft] = useState<{
    segments: WordSegment[]
    timesRaw: string[]
  } | null>(null)

  // 字级当前值必须走回放读取 —— `line.wordTimestamps[i].timeMs` 是基线值，
  // 之前的微调不在里面。展示按文本先后（`range.start`）排序，写日志用原始下标。
  const [words, setWords] = useState<WordDraft[]>(() =>
    line.wordTimestamps
      .map((word, index) => ({
        index,
        text: word.text,
        rangeStart: word.range.start,
        initialMs: getReplayedWordTime(replay, line.id, index),
      }))
      .sort((a, b) => a.rangeStart - b.rangeStart)
      .map((word) => ({
        index: word.index,
        text: word.text,
        initialMs: word.initialMs,
        raw: word.initialMs === null ? '' : formatDuration(word.initialMs),
      })),
  )

  // 行级当前回放值（毫秒），未打轴为 `null`。只在挂载时取一次，作为脏检查基准；
  // 不能判 `line.timestamps.length`（那同样是基线值）。
  const [initialLineTime] = useState(() => getReplayedLineTime(replay, line.id))
  // 输入框原文：编辑期间保持用户原样，**不**在失焦 / 回车时改写，保存时才归一化
  const [lineTimeRaw, setLineTimeRaw] = useState(() =>
    initialLineTime === null ? '' : formatDuration(initialLineTime),
  )

  const textDirty = drafts.text !== baseline.text
  const fieldsDirty = TEXT_FIELDS.some((field) => drafts[field.key] !== baseline[field.key])
  const parsed = words.map((word) => parseTimeInput(word.raw))

  // 行级框三态：空串 = 清空（合法）；非空且解析失败 = 非法；否则按值判脏。
  const lineTimeTrimmed = lineTimeRaw.trim()
  const lineParsed = parseTimeInput(lineTimeRaw)
  const lineEmpty = lineTimeTrimmed === ''
  const lineInvalid = !lineEmpty && lineParsed === null
  const lineDirty = lineEmpty
    ? initialLineTime !== null
    : lineParsed !== null && lineParsed !== initialLineTime

  // 保存后行级的落点：空串 = 清空；否则以输入框解析值为准（解析失败时退回挂载值）。
  // 切割锚点与 commitWordSegments 的三层回退同序：行级 → 首字（时间轴占位本轮不接）。
  const effectiveLineTime = lineEmpty ? null : (lineParsed ?? initialLineTime)
  const firstWordInitialMs = words.find((word) => word.index === 0)?.initialMs ?? null
  const cutAnchorMs = effectiveLineTime ?? firstWordInitialMs

  // 四种状态，按优先级取第一条命中的说明：
  // ① 有切割草案（旧槽位已不适用） → ② 没有字级划分 → ③ 还没打行级轴 → ④ 可编辑
  // 正文已改不在这里：统一由右侧黄字（showStaleHint）说明作废
  const wordHint =
    cutDraft !== null
      ? null
      : words.length === 0
        ? '这一行没有字级划分'
        : !textDirty && initialLineTime === null
          ? '先打行级时间戳，再细分字级'
          : null
  const wordListEnabled = words.length > 0 && !textDirty && initialLineTime !== null
  // 有草案时旧槽位不再展示，旧输入值也不该再挡住保存
  const wordValidationActive = wordListEnabled && cutDraft === null
  // 正文一改 markCutStale 就会清空草案，草案永远基于当前文本；
  // 因此 textDirty 不该拦切割入口，只差锚点。
  const cutDisabled = cutAnchorMs === null

  // 草案时间的默认预览序列（锚点 + 200ms）；锚点为空时没有默认值可展示
  const cutDefaultRaw =
    cutDraft === null || cutAnchorMs === null
      ? null
      : deriveInitialWordTimes(cutAnchorMs, cutDraft.length).map(formatDuration)
  // 落盘用的时间：用户没编辑过就是 null（不传 times，交由 action 按保存时的锚点重算）；
  // 编辑过则整条按用户值走，解析失败的项填 NaN，由 action 的 Number.isFinite 兜住
  const cutTimes =
    cutTimesRaw === null ? null : cutTimesRaw.map((raw) => parseTimeInput(raw) ?? Number.NaN)
  const cutTimesInvalid =
    cutTimes !== null && cutTimes.some((time) => !Number.isFinite(time) || time < 0)

  // 作废留痕提示：有失效草案，或正文已改且文档本来有字级。
  // 重新切分后新草案接管列表，提示自然退场（否则 textDirty 未保存前会一直成立）。
  const showStaleHint =
    cutDraft === null && (staleCutDraft !== null || (textDirty && words.length > 0))

  const wordsDirty = words.some((word, position) => {
    const value = parsed[position]
    return value !== null && value !== word.initialMs
  })
  // 列表不可编辑时字级的值注定作废（如正文已改），此时不该再因它挡住保存
  const hasInvalid =
    lineInvalid ||
    (wordValidationActive && parsed.some((value) => value === null)) ||
    cutTimesInvalid
  // 草案也是未落盘的改动：Esc / 点遮罩的脏保护必须把它算进去
  const dirty = fieldsDirty || wordsDirty || lineDirty || cutDraft !== null

  useEffect(() => {
    onDirtyChange(dirty)
  }, [dirty, onDirtyChange])

  /** 正文草案落值：只写文本，不碰草案 */
  const applyTextDrafts = (next: string) => {
    setDrafts((prev) => ({ ...prev, text: next }))
  }

  /** 正文已改，草案里的 range 全部失效：搬到 staleCutDraft 灰显留痕后作废 */
  const markCutStale = () => {
    if (cutDraft === null) return
    // 已有失效草案时不再覆盖，避免第二次改文本用空值冲掉它
    setStaleCutDraft({
      segments: [...cutDraft],
      timesRaw: [...(cutTimesRaw ?? cutDefaultRaw ?? cutDraft.map(() => ''))],
    })
    setCutDraft(null)
    setCutTimesRaw(null)
  }

  /**
   * 改正文会不会真丢数据：已确认过 / 有新草案（字级整体重建）/ 无字级时间时不问。
   * 回到原文不算改动，同样不问。
   */
  const textHasConsequence = (next: string) =>
    next !== baseline.text && cutDraft === null && words.some((word) => word.initialMs !== null)

  /** 正文输入入口（非 IME）：有后果才弹确认，确认前不写入 drafts */
  const requestTextChange = (next: string) => {
    if (textConfirmedRef.current || !textHasConsequence(next)) {
      applyTextDrafts(next)
      markCutStale()
      return
    }
    // 设置为「仅 toast」：不挡编辑，直接生效，本次会话只提示一次
    if (!confirmTextChange) {
      applyTextDrafts(next)
      markCutStale()
      if (!textToastedRef.current) {
        showToast('已修改正文，保存后将清空该行字级时间')
        textToastedRef.current = true
      }
      textConfirmedRef.current = true
      return
    }
    pendingTextRef.current = next
    setConfirmKind('text')
  }

  /** 组合输入结束：组合期间已放行写入，这里只判定后果与回滚 */
  const handleTextCompositionEnd = (event: CompositionEvent<HTMLInputElement>) => {
    composingTextRef.current = false
    const next = event.currentTarget.value
    // 组合没有改变文本（如输入法内部取消候选）→ 什么也不做
    if (next === composingStartTextRef.current) return
    if (textConfirmedRef.current || !textHasConsequence(next)) {
      applyTextDrafts(next)
      markCutStale()
      return
    }
    // 设置为「仅 toast」：组合结束后直接生效，本次会话只提示一次
    if (!confirmTextChange) {
      applyTextDrafts(next)
      markCutStale()
      if (!textToastedRef.current) {
        showToast('已修改正文，保存后将清空该行字级时间')
        textToastedRef.current = true
      }
      textConfirmedRef.current = true
      return
    }
    pendingTextRef.current = next
    setConfirmKind('text')
  }

  const updateField = (key: TextFieldKey, value: string) => {
    setDrafts((prev) => ({ ...prev, [key]: value }))
  }

  const updateWord = (position: number, raw: string) => {
    setWords((prev) => prev.map((word, i) => (i === position ? { ...word, raw } : word)))
  }

  /** 行级时间改动：空串落清空，非空落 setLineTime（解析失败不会走到这里） */
  const applyLineTimeChange = () => {
    if (!lineDirty) return
    if (lineEmpty) clearLineTime(line.id)
    else if (lineParsed !== null) setLineTime(line.id, lineParsed)
  }

  /**
   * 保存会真正丢数据的行级后果：`clearLineTime` 会连带清空该行字级时间。
   * 正文后果不在这里 —— 它在输入瞬间就已确认（见 requestTextChange）。
   */
  const needsConfirm = () => {
    const hasWordTime = words.some((word) => word.initialMs !== null)
    const lineConsequence = lineEmpty && lineDirty && initialLineTime !== null && hasWordTime
    return { lineConsequence }
  }

  const save = () => {
    // 非法输入由禁用的「保存」挡住；这里再兜一层，防键盘 / 程序触发
    if (hasInvalid) return

    // 保存前确认：正文后果已在输入瞬间确认，这里只判行级后果
    if (!skipConfirmRef.current) {
      const { lineConsequence } = needsConfirm()
      // 设置为「仅 toast」：不挡保存，后果照样发生，只提示一次
      if (lineConsequence && !confirmClearLineTime) {
        showToast('已清空行级时间，字级时间将一并清空')
      } else if (lineConsequence) {
        setConfirmKind('line')
        return
      }
    }
    skipConfirmRef.current = false

    if (drafts.text !== baseline.text) {
      // 正文变了，字级 `range` 全部失效：由 `editLineText` 内部清空字级，
      // 本次弹窗里的字级编辑随之作废，不另写记录。
      editLineText(line.id, {
        text: drafts.text,
        translation: toNullable(drafts.translation),
        romanization: toNullable(drafts.romanization),
        comment: toNullable(drafts.comment),
      })
      // 行级时间独立成条，不随文本变更丢弃（正文改的是文字，行时间仍在）
      applyLineTimeChange()
      if (cutDraft !== null) {
        // 顺序必须是「文本 → 行级 → 切分」：editLineText 已清空旧字级，
        // 切分随后重建结构；锚点要读到已落定的行级时间。
        commitWordSegments(
          line.id,
          cutDraft,
          cutTimes === null ? undefined : { times: cutTimes },
        )
      }
      onClose()
      return
    }

    // 正文没变：行级时间、字级、翻译类各写一条、互不冲突，撤销需要按对应次数。
    // 行级必须先落：它的 offset 会连带平移该行全部字级，之后再落字级绝对值，
    // 用户手改的那个字才会以绝对值收口（不叠加 offset）。见 setLineTime。
    applyLineTimeChange()
    if (cutDraft !== null) {
      // 切割必须在行级写入之后：action 以「保存后的行级时间」为锚点。
      // 新切分整笔接管字级时间（未手改时锚点 + 200ms 递增），旧槽位的手改值没有意义，
      // 因此本分支跳过 setWordTimestamps，避免旧下标污染新块。
      commitWordSegments(
        line.id,
        cutDraft,
        cutTimes === null ? undefined : { times: cutTimes },
      )
    } else {
      const wordChanges = words
        .map((word, position) => ({ word, value: parsed[position] }))
        .filter(
          (entry): entry is { word: WordDraft; value: number } =>
            entry.value !== null && entry.value !== entry.word.initialMs,
        )
        .map((entry) => ({
          wordIndex: entry.word.index,
          timeMs: entry.value,
          wordText: entry.word.text,
        }))
      if (wordChanges.length > 0) {
        // 首字早于行级时间时 store 会在同一条记录里拉齐行级，返回新行时间用于提示
        const clampedLineTimeMs = setWordTimestamps(line.id, wordChanges)
        if (clampedLineTimeMs !== null) {
          showToast(
            `首字时间早于行级时间，行级时间已自动拉齐至 ${formatDuration(clampedLineTimeMs)}`,
          )
        }
      }
    }

    // 只带真的变了的字段：正文没变，store 不会清字级
    const patch: {
      translation?: string | null
      romanization?: string | null
      comment?: string | null
    } = {}
    if (drafts.translation !== baseline.translation) patch.translation = toNullable(drafts.translation)
    if (drafts.romanization !== baseline.romanization)
      patch.romanization = toNullable(drafts.romanization)
    if (drafts.comment !== baseline.comment) patch.comment = toNullable(drafts.comment)
    if (Object.keys(patch).length > 0) editLineText(line.id, patch)

    onClose()
  }

  /** 行级确认框点「继续保存」：跳过守卫后重入 save */
  const handleConfirmSave = () => {
    skipConfirmRef.current = true
    setConfirmKind(null)
    save()
  }

  /** 行级确认框点「取消」/ Esc：退回编辑态，草稿与时间一律不动 */
  const handleCancelSave = () => {
    skipConfirmRef.current = false
    setConfirmKind(null)
  }

  /** 正文确认：写入待确认正文，本会话后续改正文不再弹 */
  const handleConfirmText = () => {
    const pending = pendingTextRef.current
    pendingTextRef.current = null
    textConfirmedRef.current = true
    setConfirmKind(null)
    if (pending !== null) applyTextDrafts(pending)
    markCutStale()
  }

  /**
   * 正文确认取消 = 不写入：
   * - 非 IME 路径：drafts 未动，DOM 值由框架回写成原文本
   * - IME 路径：组合期间已放行写入，显式回滚到组合前的值
   */
  const handleCancelText = () => {
    const pending = pendingTextRef.current
    pendingTextRef.current = null
    setConfirmKind(null)
    if (pending !== null && drafts.text === pending && composingStartTextRef.current !== null) {
      applyTextDrafts(composingStartTextRef.current)
      markCutStale()
    }
  }

  /** 单个文本字段：左标签固定宽，右单行输入框（超出横向滚动，不换行、不撑高）。 */
  const renderField = (field: { key: TextFieldKey; label: string }) => {
    const isPrimary = field.key === 'text'
    return (
      <label key={field.key} className="flex items-center gap-3">
        <span className="w-12 shrink-0 text-[11px] text-neutral-500">{field.label}</span>
        <input
          type="text"
          // 主文本框的稳定选择器：弹窗里新增了行级时间框后，不能再靠"第一个 text 输入"定位
          data-primary-text={isPrimary ? '' : undefined}
          value={drafts[field.key]}
          onChange={(event) => {
            const next = event.target.value
            if (!isPrimary) {
              updateField(field.key, next)
              return
            }
            // 组合期间放行写入：此时打断会让输入法候选错位
            if (composingTextRef.current || (event.nativeEvent as InputEvent).isComposing) {
              composingTextRef.current = true
              applyTextDrafts(next)
              return
            }
            requestTextChange(next)
          }}
          onCompositionStart={
            isPrimary
              ? () => {
                  composingStartTextRef.current = drafts.text
                  composingTextRef.current = true
                }
              : undefined
          }
          onCompositionEnd={isPrimary ? handleTextCompositionEnd : undefined}
          // 组合输入被中断（点别处）时复位标志，避免粘滞导致后续输入永不弹确认
          onBlur={isPrimary ? () => { composingTextRef.current = false } : undefined}
          className="min-w-0 flex-1 rounded border border-divider bg-canvas px-2 py-1 text-[11px] text-neutral-200 outline-none focus:border-accent/60"
        />
      </label>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 字段区：行级时间戳置顶；主文本常驻；翻译 / 罗马音 / 注释共用一个折叠开关，收起时不渲染 */}
      <div className="flex shrink-0 flex-col gap-2 px-4 pb-3">
        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-3">
            <span className="w-12 shrink-0 text-[11px] text-neutral-500">行级时间戳</span>
            <input
              type="text"
              data-line-time-input=""
              inputMode="numeric"
              aria-label="行级时间戳"
              aria-invalid={lineInvalid}
              value={lineTimeRaw}
              placeholder="未打轴"
              onChange={(event) => setLineTimeRaw(event.target.value)}
              className={`min-w-0 flex-1 rounded border bg-canvas px-2 py-1 font-mono text-[11px] text-neutral-200 outline-none focus:border-accent/60 ${
                lineInvalid ? 'border-red-500/60' : 'border-divider'
              }`}
            />
          </label>
          {/* 行内红字提示：与输入框左边缘对齐（标签 48px + 间距 12px） */}
          {lineInvalid ? (
            <span className="pl-[60px] text-[11px] text-red-400">
              格式无效：填 mm:ss（如 02:05）或秒数（如 125），留空表示清空
            </span>
          ) : null}
        </div>
        {renderField(PRIMARY_FIELD)}
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((prev) => !prev)}
          className="flex items-center gap-1.5 self-start rounded px-0.5 py-0.5 text-[11px] text-neutral-500 transition-colors hover:text-neutral-300"
        >
          <ChevronIcon
            className={`h-3.5 w-3.5 shrink-0 transition-transform ${expanded ? '' : '-rotate-90'}`}
          />
          翻译 / 罗马音 / 注释
        </button>
        {expanded ? COLLAPSIBLE_FIELDS.map(renderField) : null}
      </div>

      {/* 字级时间戳：占据剩余高度，列表内部滚动；槽位不可增删，只改数值 */}
      <div className="flex min-h-0 flex-1 flex-col px-4 pb-3">
        <div className="mb-2 flex shrink-0 items-baseline justify-between gap-3">
          <div className="flex items-baseline gap-2">
            <span className="text-[11px] text-neutral-500">字级时间戳</span>
            <button
              type="button"
              disabled={cutDisabled}
              onClick={() => setCutDialogOpen(true)}
              className="rounded border border-divider px-1.5 py-0.5 text-[11px] text-neutral-300 transition-colors enabled:hover:border-accent/60 enabled:hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              切分字块
            </button>
          </div>
          {showStaleHint ? (
            // 作废提示与右侧状态位合并为一条；常驻、不给关闭入口
            <span className="min-w-0 text-right text-[11px] leading-relaxed text-amber-400">
              文本已修改，字级划分已作废，保存后请重新切分
            </span>
          ) : wordHint !== null ? (
            <span className="text-[11px] text-neutral-600">{wordHint}</span>
          ) : null}
        </div>
        {cutDraft !== null ? (
          // 切割草案接管字级区域：块数与文本都来自草案，旧槽位不再展示。
          // 时间默认预览锚点 + 200ms，可直接改；改过之后保存就整条用用户值。
          <ul className="min-h-0 flex-1 divide-y divide-divider/60 overflow-x-hidden overflow-y-auto rounded border border-divider">
            {cutDraft.map((segment, position) => (
              <li key={`${segment.start}-${segment.end}`} className="flex items-center gap-3 px-2 py-1">
                <span className="min-w-0 flex-1 truncate text-[11px] text-neutral-300">
                  {segment.text}
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={cutTimesRaw?.[position] ?? cutDefaultRaw?.[position] ?? ''}
                  placeholder="未打轴"
                  aria-label={`切分块 ${position + 1} 时间`}
                  onChange={(event) => {
                    // 首次编辑时把整条默认预览序列铺满，避免稀疏数组
                    const next =
                      cutTimesRaw === null
                        ? (cutDefaultRaw ?? cutDraft.map(() => ''))
                        : [...cutTimesRaw]
                    next[position] = event.target.value
                    setCutTimesRaw(next)
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return
                    event.preventDefault()
                    event.currentTarget.blur()
                  }}
                  className="w-[96px] shrink-0 rounded border border-divider bg-canvas px-1.5 py-0.5 text-right font-mono text-[11px] text-neutral-200 outline-none focus:border-accent/60"
                />
              </li>
            ))}
          </ul>
        ) : staleCutDraft !== null ? (
          // 失效草案：正文已改，range 对不上，只留作废留痕。
          // 时间是作废那一刻的预览快照，不是落盘值；重新切分后按新锚点重算。
          <ul className="min-h-0 flex-1 divide-y divide-divider/60 overflow-x-hidden overflow-y-auto rounded border border-divider opacity-50">
            {staleCutDraft.segments.map((segment, position) => (
              <li key={`${segment.start}-${segment.end}`} className="flex items-center gap-3 px-2 py-1">
                <span className="min-w-0 flex-1 truncate text-[11px] text-neutral-300">
                  {segment.text}
                </span>
                <input
                  type="text"
                  disabled
                  value={staleCutDraft.timesRaw[position] ?? ''}
                  placeholder="未打轴"
                  aria-label={`已作废的切分块 ${position + 1} 时间`}
                  className="w-[96px] shrink-0 rounded border border-divider bg-canvas px-1.5 py-0.5 text-right font-mono text-[11px] text-neutral-200 outline-none disabled:cursor-not-allowed"
                />
              </li>
            ))}
          </ul>
        ) : words.length > 0 ? (
          <ul
            className={`min-h-0 flex-1 divide-y divide-divider/60 overflow-x-hidden overflow-y-auto rounded border border-divider ${
              wordListEnabled ? '' : 'opacity-50'
            }`}
          >
            {words.map((word, position) => {
              const invalid = wordListEnabled && parsed[position] === null
              return (
                <li key={word.index} className="flex items-center gap-3 px-2 py-1">
                  <span className="min-w-0 flex-1 truncate text-[11px] text-neutral-300">
                    {word.text}
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    data-word-input=""
                    value={word.raw}
                    disabled={!wordListEnabled}
                    placeholder="未打轴"
                    onChange={(event) => updateWord(position, event.target.value)}
                    // 回车只移出焦点，不再改写输入（归一化推迟到保存）
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter') return
                      event.preventDefault()
                      event.currentTarget.blur()
                    }}
                    className={`w-[96px] shrink-0 rounded border bg-canvas px-1.5 py-0.5 text-right font-mono text-[11px] text-neutral-200 outline-none focus:border-accent/60 disabled:cursor-not-allowed ${
                      invalid ? 'border-red-500/40' : 'border-divider'
                    }`}
                  />
                </li>
              )
            })}
          </ul>
        ) : null}
      </div>

      {/* 底部一行：左侧四个行操作，右侧取消 / 保存 */}
      <div className="flex shrink-0 items-center gap-2 px-4 pb-4">
        <ul
          role="menu"
          aria-label="行操作"
          aria-orientation="horizontal"
          className="flex flex-row items-center gap-2"
        >
          {items.map((item) => (
            <li key={item.key}>
              <button
                type="button"
                role="menuitem"
                disabled={item.disabled === true || dirty}
                title={dirty ? '请先保存或取消' : undefined}
                onClick={() => {
                  item.onSelect()
                  onClose()
                }}
                className="flex items-center gap-1.5 rounded border border-divider bg-canvas px-2.5 py-1.5 text-[11px] text-neutral-300 transition-colors enabled:hover:border-accent/60 enabled:hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
              >
                <LineActionIcon name={item.key} className="h-3.5 w-3.5 shrink-0" />
                {item.label}
              </button>
            </li>
          ))}
        </ul>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-divider px-2 py-0.5 text-[11px] text-neutral-300 hover:border-accent/60 hover:text-accent"
          >
            取消
          </button>
          <button
            type="button"
            disabled={hasInvalid}
            onClick={save}
            className="rounded border border-accent bg-accent/20 px-2 py-0.5 text-[11px] text-accent transition-colors enabled:hover:bg-accent/30 disabled:cursor-not-allowed disabled:opacity-40"
          >
            保存
          </button>
        </div>
      </div>

      {/* 二级弹窗：确定只写草案，不落 store；正文一改由 markCutStale 作废 */}
      {cutDialogOpen ? (
        <WordCutDialog
          text={drafts.text}
          initialSegments={cutDraft ?? undefined}
          onCancel={() => setCutDialogOpen(false)}
          onConfirm={(segments) => {
            setCutDraft(segments)
            setCutTimesRaw(null)
            setStaleCutDraft(null)
            setCutDialogOpen(false)
          }}
        />
      ) : null}

      {/* 正文确认 / 保存确认共用一框：kind 决定标题、文案与回调 */}
      {confirmKind !== null ? (
        <ConfirmDialog
          title={confirmKind === 'text' ? '修改正文确认' : '保存前确认'}
          description={
            confirmKind === 'text' ? (
              <p>修改正文会清空该行现有字级时间戳，保存后需重新打轴</p>
            ) : (
              <ul className="list-disc space-y-1 pl-4">
                <li>清空行级时间会同时清空该行字级时间戳，保存后需重新打轴</li>
                {/* 有草案时清行级会让锚点缺失，追加缺口说明（不阻止保存） */}
                {cutDraft !== null ? <li>当前切分草案缺少锚点，保存后将无法落盘</li> : null}
              </ul>
            )
          }
          confirmLabel={confirmKind === 'text' ? '继续修改' : '继续保存'}
          cancelLabel="取消"
          onConfirm={confirmKind === 'text' ? handleConfirmText : handleConfirmSave}
          onCancel={confirmKind === 'text' ? handleCancelText : handleCancelSave}
          dontAskLabel="以后用 toast 提示"
          onDontAsk={() => {
            if (confirmKind === 'text') updateSettings({ confirmTextChange: false })
            else updateSettings({ confirmClearLineTime: false })
          }}
        />
      ) : null}
    </div>
  )
}
