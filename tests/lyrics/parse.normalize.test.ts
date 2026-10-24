/**
 * 导入时时间戳逻辑纠错（A 错位）测试。
 *
 * 口径：
 *   A 错位（字级时间 < 行级时间）：修。以行级时间为绝对锚点，单向拉齐到行起点。
 *   B 错位（行内字级乱序）：放行。不排序、不改 range/text。
 *   C 错位（跨行重叠）：不处理。
 */

import { describe, expect, test } from 'vitest'
import { parseLrc, serializeLrc, type ParseOptions } from '@core'

/** 关闭识别器，隔离时间戳纠错本身。 */
const RAW: ParseOptions = { applyRecognizers: false }

/** 解析并取首行的字级时间戳。 */
function words(input: string) {
  const result = parseLrc(input, RAW)
  if (result.document === null) throw new Error('parseLrc 意外返回 null')
  return result.document.lines[0].wordTimestamps
}

/** 解析后序列化。 */
function rt(input: string): string {
  const result = parseLrc(input, RAW)
  if (result.document === null) throw new Error('parseLrc 意外返回 null')
  return serializeLrc(result.document)
}

describe('A 错位：字级时间早于行级时间', () => {
  test('越界者拉齐到行起点，未越界者不动', () => {
    const ws = words('[00:15.00]<00:14.00>早<00:16.00>晚\n')
    expect(ws.map((w) => w.timeMs)).toEqual([15000, 16000])
  })

  test('恰等于行起点不误伤', () => {
    const ws = words('[00:15.00]<00:15.00>齐\n')
    expect(ws.map((w) => w.timeMs)).toEqual([15000])
  })

  test('多行级标签锚定首项', () => {
    const ws = words('[00:15.00][00:18.00]<00:14.00>x\n')
    expect(ws.map((w) => w.timeMs)).toEqual([15000])
  })

  test('精度取两者更细者，导出不丢位', () => {
    const ws = words('[00:15.50]<00:15>x\n')
    expect(ws[0].timeMs).toBe(15500)
    expect(ws[0].precisionMs).toBe(10)
    expect(rt('[00:15.50]<00:15>x\n')).toBe('[00:15.50]<00:15.50>x\n')
  })

  test('导出方向：修正结果写回文件', () => {
    expect(rt('[00:15.00]<00:14.00>早\n')).toBe('[00:15.00]<00:15.00>早\n')
  })
})

describe('B 错位：行内字级乱序', () => {
  test('时间、顺序、文本与 range 均原样保留', () => {
    const ws = words('[00:15.00]<00:16.00>后<00:15.50>前\n')
    expect(ws.map((w) => w.timeMs)).toEqual([16000, 15500])
    expect(ws.map((w) => w.text)).toEqual(['后', '前'])
    expect(ws.map((w) => [w.range.start, w.range.end])).toEqual([
      [0, 1],
      [1, 2],
    ])
  })
})

describe('无字级标签：no-op', () => {
  test('纯文本行的字级数组为空', () => {
    expect(words('纯文本\n')).toEqual([])
  })
})
