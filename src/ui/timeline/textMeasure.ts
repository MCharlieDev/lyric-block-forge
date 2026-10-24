/**
 * 歌词块文本测量内核。
 *
 * 分两层：
 * - `computeLineWidths`：纯函数，注入 `MeasureTextFn` 即可运行，node 环境可直接测试。
 * - `measureLineWidths`：浏览器单例，内部用 Canvas `measureText` + 字体探针校准，
 *   并带文本级缓存。顶层不访问 `document` / `canvas` / `window`，只有真正调用时才初始化。
 */

import { WORD_CHIP_MIN_WIDTH_PX } from './constants'

/** 块内参与测量的文本样式。 */
export type TextStyleKey = 'body' | 'timecode' | 'badge' | 'chip' | 'translation'

/** 测量函数：给定文本与样式，返回自然宽（CSS px）。 */
export type MeasureTextFn = (text: string, style: TextStyleKey) => number

/** `computeLineWidths` 的输入。 */
export interface LineMeasureInput {
  /** 正文文本。 */
  text: string
  /** 译文，可为空。 */
  translation?: string
  /** 信息行的时间码文本。 */
  timecode: string
  /** 超出当前卡片的译文条数，> 0 时渲染 `+N` 徽标。 */
  extraCount: number
  /** 是否带字级时间戳，渲染「字级」徽标。 */
  hasWords: boolean
  /** 是否带译文，渲染「双语」徽标。 */
  hasTranslation: boolean
  /**
   * word 模式下的 chip 文本（已按显示顺序排好）。
   * 不传或空数组时 `wordRowWidthPx` 为 null；line 模式不传。
   */
  wordTexts?: readonly string[]
  /**
   * word 模式下的 chip 时间戳文本（`ss.xx`），与 `wordTexts` 按下标一一对应。
   * 缺项或短于 `wordTexts` 时该 chip 不计时间戳宽。
   */
  wordTimeTexts?: readonly string[]
}

/** 单行的自然宽结果，全部不含块的 padding / border。 */
export interface LineWidths {
  /** 正文自然宽。 */
  bodyWidthPx: number
  /** 信息行自然宽：时间码 + 各徽标。 */
  infoRowWidthPx: number
  /** 译文自然宽，无译文时为 null。 */
  translationWidthPx: number | null
  /** word 模式 chip 行自然宽；未传 `wordTexts` 或为空时为 null。 */
  wordRowWidthPx: number | null
  /** word 模式下每个 chip 的独立宽度（含自身 padding，不含间隔）；未传或为空时为 null。 */
  wordChipWidthsPx: number[] | null
  /**
   * word 模式下每个 chip 的纯内容宽：只测文本本身，不含 chip padding、不含时间戳徽标宽、
   * 不受 `WORD_CHIP_MIN_WIDTH_PX` 约束。与 `wordChipWidthsPx` 同长度、同下标。
   *
   * 三者关系：`wordChipContentWidthsPx[i] ≤ wordChipWidthsPx[i] - CHIP_PADDING_X_PX`。
   * 阶梯化渲染必须用本字段算内部偏移，不能用 `wordChipWidthsPx[i] - 8` 反推（拉丁字符会偏 7px/字）。
   */
  wordChipContentWidthsPx: number[] | null
}

/** 徽标之间的间距（对应 DOM 的 `gap-1`），每个徽标前计一次。 */
const BADGE_GAP_PX = 4

/** 徽标自身左右内边距合计（对应 DOM 的 `px-1`）。 */
const BADGE_PADDING_X_PX = 8

/** word 模式 chip 自身左右内边距合计（对应 DOM 的 `px-1`）。 */
export const CHIP_PADDING_X_PX = 8

/** word 模式 chip 之间的间距（对应 DOM 的 `gap-0.5`）。 */
export const CHIP_GAP_PX = 2

/**
 * 纯函数：由注入的测量函数算出单行各项宽度。
 *
 * 徽标拼装顺序与 DOM 一致：`+N` → 「字级」→「双语」；每个徽标计
 * `gap + 文字宽 + padding`，因此与 `gap-1 px-1` 的盒模型对齐。
 */
export function computeLineWidths(input: LineMeasureInput, measure: MeasureTextFn): LineWidths {
  const bodyWidthPx = measure(input.text, 'body')

  const badges: string[] = []
  if (input.extraCount > 0) badges.push(`+${input.extraCount}`)
  if (input.hasWords) badges.push('字级')
  if (input.hasTranslation) badges.push('双语')

  const timecodeWidthPx = measure(input.timecode, 'timecode')
  const badgesWidthPx = badges.reduce(
    (sum, badgeText) => sum + BADGE_GAP_PX + measure(badgeText, 'badge') + BADGE_PADDING_X_PX,
    0,
  )

  const infoRowWidthPx = timecodeWidthPx + badgesWidthPx

  const translationWidthPx = input.translation ? measure(input.translation, 'translation') : null

  // word 模式 chip 行：每个 chip 取「歌词宽 / 时间戳宽分别加 padding」与最小宽的较大者，
  // chip 之间再加间隔。不含把手与块 chrome，由 blockLayout 负责相加。
  const wordTexts = input.wordTexts
  const wordTimeTexts = input.wordTimeTexts
  let wordRowWidthPx: number | null = null
  let wordChipWidthsPx: number[] | null = null
  let wordChipContentWidthsPx: number[] | null = null
  if (wordTexts !== undefined && wordTexts.length > 0) {
    // 纯内容宽：只测文本本身，不加 padding、不算时间戳、不受最小宽夹取。
    wordChipContentWidthsPx = wordTexts.map((chipText) => measure(chipText, 'chip'))
    wordChipWidthsPx = wordTexts.map((chipText, index) => {
      const timeText = wordTimeTexts?.[index]
      return Math.max(
        measure(chipText, 'chip') + CHIP_PADDING_X_PX,
        timeText ? measure(timeText, 'badge') + CHIP_PADDING_X_PX : 0,
        WORD_CHIP_MIN_WIDTH_PX,
      )
    })
    wordRowWidthPx =
      wordChipWidthsPx.reduce((sum, widthPx) => sum + widthPx, 0) +
      CHIP_GAP_PX * (wordTexts.length - 1)
  }

  return {
    bodyWidthPx,
    infoRowWidthPx,
    translationWidthPx,
    wordRowWidthPx,
    wordChipWidthsPx,
    wordChipContentWidthsPx,
  }
}

/** 各样式对应的探针 class，必须与 `LyricBlock` 内真实元素的排版类保持一致。 */
const STYLE_PROBE_CLASS: Record<TextStyleKey, string> = {
  body: 'text-xs',
  timecode: 'font-mono text-[10px]',
  badge: 'font-mono text-[9px]',
  // 该探针现在只服务 word 模式 chip（12px）；line 态旧 chip 行不做测量，不受影响。
  chip: 'text-xs',
  translation: 'text-[10px]',
}

const STYLE_KEYS: TextStyleKey[] = ['body', 'timecode', 'badge', 'chip', 'translation']

/** 校准样本：中英文 + 数字，尽量覆盖不同字宽。 */
const CALIBRATION_SAMPLE = '时间码 00:00.000 Lyric'

/** 文本缓存上限，超限整体清空。 */
const CACHE_LIMIT = 4096

const RATIO_MIN = 0.9
const RATIO_MAX = 1.1

/** 校准偏差超过该阈值时打警告，但仍然应用校准系数。 */
const RATIO_WARN_DELTA = 0.02

/** 探针 DOM 与 canvas 上下文，首次调用时才创建。 */
interface ProbeDom {
  ctx: CanvasRenderingContext2D
  probes: Record<TextStyleKey, HTMLSpanElement>
}

/** 校准后的测量引擎。 */
interface MeasureEngine {
  ctx: CanvasRenderingContext2D
  fonts: Record<TextStyleKey, string>
  ratios: Record<TextStyleKey, number>
}

let probeDom: ProbeDom | null = null
let engine: MeasureEngine | null = null

const widthCache = new Map<string, number>()

function createProbe(container: HTMLDivElement, style: TextStyleKey): HTMLSpanElement {
  const span = document.createElement('span')
  span.className = STYLE_PROBE_CLASS[style]
  span.textContent = CALIBRATION_SAMPLE
  container.appendChild(span)
  return span
}

function bindFontEvents(): void {
  const fonts = document.fonts
  if (!fonts) return

  const onFontsChanged = () => resetTextMeasureCache()
  fonts.addEventListener('loadingdone', onFontsChanged)
  void fonts.ready.then(onFontsChanged, () => {})
}

function createProbeDom(): ProbeDom {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('[textMeasure] 当前浏览器不支持 Canvas 2D，无法测量歌词文本宽度。')
  }

  const container = document.createElement('div')
  container.setAttribute('aria-hidden', 'true')
  container.style.position = 'absolute'
  container.style.left = '-10000px'
  container.style.top = '0'
  container.style.visibility = 'hidden'
  container.style.whiteSpace = 'nowrap'
  container.style.pointerEvents = 'none'
  container.appendChild(canvas)

  const probes: Record<TextStyleKey, HTMLSpanElement> = {
    body: createProbe(container, 'body'),
    timecode: createProbe(container, 'timecode'),
    badge: createProbe(container, 'badge'),
    chip: createProbe(container, 'chip'),
    translation: createProbe(container, 'translation'),
  }

  document.body.appendChild(container)
  bindFontEvents()

  return { ctx, probes }
}

/**
 * 用探针 span 的真实渲染宽度校准 canvas 测量值。
 *
 * 某些平台的字体回退会让 `measureText` 与 DOM 排版产生偏差，这里按样式
 * 取 `domWidth / canvasWidth` 作为系数并 clamp 到 `[0.9, 1.1]`。
 */
function calibrate({ ctx, probes }: ProbeDom): MeasureEngine {
  const fonts: Record<TextStyleKey, string> = {
    body: '',
    timecode: '',
    badge: '',
    chip: '',
    translation: '',
  }
  const ratios: Record<TextStyleKey, number> = {
    body: 1,
    timecode: 1,
    badge: 1,
    chip: 1,
    translation: 1,
  }

  for (const style of STYLE_KEYS) {
    const probe = probes[style]
    const computed = getComputedStyle(probe)
    const font = `${computed.fontStyle} ${computed.fontWeight} ${computed.fontSize} ${computed.fontFamily}`
    fonts[style] = font

    probe.textContent = CALIBRATION_SAMPLE
    const domWidth = probe.getBoundingClientRect().width
    ctx.font = font
    const canvasWidth = ctx.measureText(CALIBRATION_SAMPLE).width
    const rawRatio = canvasWidth > 0 ? domWidth / canvasWidth : 1
    const ratio = Math.min(RATIO_MAX, Math.max(RATIO_MIN, rawRatio))

    if (Math.abs(ratio - 1) > RATIO_WARN_DELTA) {
      console.warn(
        `[textMeasure] ${style} 字体探针与 Canvas 测量偏差 ${((ratio - 1) * 100).toFixed(1)}%，` +
          `已应用校准系数 ${ratio.toFixed(3)}`,
      )
    }

    ratios[style] = ratio
  }

  return { ctx, fonts, ratios }
}

function ensureReady(): MeasureEngine {
  if (typeof document === 'undefined') {
    throw new Error(
      '[textMeasure] measureLineWidths 依赖浏览器 DOM / Canvas；node 环境请改用 computeLineWidths 并注入 measure。',
    )
  }

  if (!probeDom) probeDom = createProbeDom()
  if (!engine) engine = calibrate(probeDom)
  return engine
}

function measureWithCanvas(text: string, style: TextStyleKey): number {
  const { ctx, fonts, ratios } = ensureReady()

  const key = `${style}\u0000${text}`
  const cached = widthCache.get(key)
  if (cached !== undefined) return cached

  ctx.font = fonts[style]
  const width = ctx.measureText(text).width * ratios[style]

  if (widthCache.size >= CACHE_LIMIT) widthCache.clear()
  widthCache.set(key, width)

  return width
}

/**
 * 浏览器单例：测量单行的各项自然宽。
 *
 * 首次调用时惰性创建 canvas 与离屏探针容器，并按样式读取真实字体做一次校准。
 * `document.fonts` 加载完成会清空缓存与字体/校准结果，下次调用时重新校准。
 */
export function measureLineWidths(input: LineMeasureInput): LineWidths {
  return computeLineWidths(input, measureWithCanvas)
}

/** 清空文本缓存与字体/校准结果；字体热替换或测试需要重置时调用。 */
export function resetTextMeasureCache(): void {
  widthCache.clear()
  engine = null
}
