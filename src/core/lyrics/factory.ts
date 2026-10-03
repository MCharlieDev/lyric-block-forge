import type {
  CreateLyricDocumentOptions,
  CreateLyricLineOptions,
  LyricDocument,
  LyricFormatInfo,
  LyricLine,
  LyricLineRole,
  Timestamp,
} from '../types'
import { createId } from '../utils/id'

/** 默认格式信息：内部一律按 UTF-8 / LF 处理，导出时再按源文件写回。 */
const DEFAULT_FORMAT: LyricFormatInfo = {
  encoding: 'utf-8',
  detectedFormat: 'unknown',
  lineEnding: '\n',
  hasBOM: false,
  unknownTags: [],
  bilingualSeparator: null,
}

/**
 * 创建一条歌词行。
 *
 * @param text 行文本
 * @param options 可选初始参数
 * @returns 新的歌词行
 */
export function createLyricLine(text: string, options: CreateLyricLineOptions = {}): LyricLine {
  const role: LyricLineRole = options.role ?? 'main'
  const timeMs = options.timeMs ?? null
  return {
    id: options.id ?? createId('line'),
    text,
    timestamps: timeMs === null ? [] : [createTimestamp('line', timeMs, 'manual')],
    wordTimestamps: [],
    role,
    status: 'normal',
  }
}

/**
 * 创建一个时间戳。
 *
 * @param kind 时间戳种类
 * @param timeMs 时间值（毫秒整数）
 * @param source 来源
 * @param precisionMs 精度（毫秒），缺省为 1
 * @returns 新的时间戳
 */
export function createTimestamp(
  kind: Timestamp['kind'],
  timeMs: number,
  source: Timestamp['source'],
  precisionMs = 1,
): Timestamp {
  return { kind, timeMs: Math.round(timeMs), precisionMs, source }
}

/**
 * 创建一个空歌词文档。
 *
 * @param options 可选初始参数
 * @returns 新的歌词文档
 */
export function createLyricDocument(options: CreateLyricDocumentOptions = {}): LyricDocument {
  const now = options.now ?? Date.now
  const timestamp = now()
  return {
    id: options.id ?? createId('doc'),
    meta: options.meta ?? {},
    lines: options.lines ?? [],
    audioRef: null,
    format: { ...DEFAULT_FORMAT, ...options.format },
    dirty: false,
    version: 0,
    recovery: { lastSavedAt: null, autosaveAt: null, backupRef: null },
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}
