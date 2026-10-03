/**
 * 通用时间与范围类型。
 *
 * 架构约定：**内部时间一律使用毫秒整数**，显示时才做格式化；
 * 音频时钟是播放的唯一基准，所有时间戳都相对音频起点计算。
 */

/** 时间区间，单位毫秒，约定 `startMs <= endMs`。 */
export interface TimeRange {
  /** 区间起点（毫秒） */
  startMs: number
  /** 区间终点（毫秒） */
  endMs: number
}

/** 文本区间，用于把字级信息挂到行文本的某一段上。 */
export interface TextRange {
  /** 起始字符下标（含） */
  start: number
  /** 结束字符下标（不含） */
  end: number
}
