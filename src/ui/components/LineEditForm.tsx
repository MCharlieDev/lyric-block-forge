import { useEffect, useState } from 'react'
import type { LyricLine } from '@core'
import { getReplayedLineTime, getReplayedWordTime } from '@core'
import { useEditorStore } from '../stores/editorStore'
import { formatDuration } from '../utils/format'
import { parseTimeInput } from '../utils/timeInput'
import { LineActionIcon } from './LineActionIcons'
import type { LineActionItem } from './LineActionSheet'

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

  // 四种不可编辑状态，按优先级取第一条命中的说明：
  // ① 没有字级划分 → ② 主文本已改 → ③ 还没打行级轴 → ④ 可编辑
  const wordHint =
    words.length === 0
      ? '这一行没有字级划分'
      : textDirty
        ? '正文已修改，保存后将清空字级时间戳'
        : initialLineTime === null
          ? '先打行级时间戳，再细分字级'
          : null
  const wordListEnabled = words.length > 0 && !textDirty && initialLineTime !== null

  const wordsDirty = words.some((word, position) => {
    const value = parsed[position]
    return value !== null && value !== word.initialMs
  })
  // 列表不可编辑时字级的值注定作废（如正文已改），此时不该再因它挡住保存
  const hasInvalid = lineInvalid || (wordListEnabled && parsed.some((value) => value === null))
  const dirty = fieldsDirty || wordsDirty || lineDirty

  useEffect(() => {
    onDirtyChange(dirty)
  }, [dirty, onDirtyChange])

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

  const save = () => {
    // 非法输入由禁用的「保存」挡住；这里再兜一层，防键盘 / 程序触发
    if (hasInvalid) return

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
      onClose()
      return
    }

    // 正文没变：行级时间、字级、翻译类各写一条、互不冲突，撤销需要按对应次数。
    // 行级必须先落：它的 offset 会连带平移该行全部字级，之后再落字级绝对值，
    // 用户手改的那个字才会以绝对值收口（不叠加 offset）。见 setLineTime。
    applyLineTimeChange()
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
    if (wordChanges.length > 0) setWordTimestamps(line.id, wordChanges)

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

  /** 单个文本字段：左标签固定宽，右单行输入框（超出横向滚动，不换行、不撑高）。 */
  const renderField = (field: { key: TextFieldKey; label: string }) => (
    <label key={field.key} className="flex items-center gap-3">
      <span className="w-12 shrink-0 text-[11px] text-neutral-500">{field.label}</span>
      <input
        type="text"
        // 主文本框的稳定选择器：弹窗里新增了行级时间框后，不能再靠"第一个 text 输入"定位
        data-primary-text={field.key === 'text' ? '' : undefined}
        value={drafts[field.key]}
        onChange={(event) => updateField(field.key, event.target.value)}
        className="min-w-0 flex-1 rounded border border-divider bg-canvas px-2 py-1 text-[11px] text-neutral-200 outline-none focus:border-accent/60"
      />
    </label>
  )

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
          <span className="text-[11px] text-neutral-500">字级时间戳</span>
          {wordHint !== null ? (
            <span className="text-[11px] text-neutral-600">{wordHint}</span>
          ) : null}
        </div>
        {words.length > 0 ? (
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
    </div>
  )
}
