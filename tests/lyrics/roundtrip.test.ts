/**
 * LRC「解析 → 序列化」往返（round-trip）保真测试。
 *
 * 尺子：对同一份输入，`serializeLrc(parseLrc(input))` 应当逐字节还原 input。
 * 该性质是「无损导入 / 导出」的实用规格：既不依赖内部数据结构，也不依赖实现细节。
 *
 * ⚠️ test.fails 翻转语义（后续修复必须遵守）：
 * 本文件用 `test.fails(...)` 标记「当前已知的保真漏洞」。这些断言刻画的是
 * 「修复后应当成立」的目标行为，仅因漏洞存在而暂时失败。
 * 一旦对应漏洞被修复，必须摘掉该用例的 `.fails` 标记、改回普通 `test(...)`；
 * 否则该用例会从「预期失败」翻转为「意外通过（expected to fail but passed）」而失败。
 * 每处 test.fails 均在用例名与注释里写明对应漏洞，修复时请一并更新本清单。
 *
 * 待修复漏洞清单（由 test.fails 量化）：
 *   V4 混合换行符：整篇只记一种 lineEnding（含 `\r\n` 即判为 CRLF），逐行差异丢失。
 *
 * 已修复（对应断言须为普通 test）：
 *   V1 重复标准标签：由 `format.metadataTags` 记录名值序列并逐字写回。
 *   V2 重复自定义标签：同上（自定义值取自 `meta.custom`）。
 *   V3 空行：由 `format.blankLines` 以行 ID 锚定、原文存储并写回（空行不进 lines）。
 *      元数据块内部（两条元数据行之间）的空行仍不承载，属已知有损缺口。
 *   V5 多标签行顺序：由 `format.metadataTags` 记录并写回原始顺序。
 *   V6 元数据跨行合并：由 `format.metadataTags` 记录原始分行并逐行写回。
 *
 * 边界：本测试只覆盖 core 层的字符串往返，不覆盖字节编码落盘
 * （编码在 adapters 层固定为 UTF-8，见 src/adapters/web/file.ts）。
 *
 * 记录在案（不在本轮范围）：
 *   - 验收方式：项目的 CDP 验收 harness 位于仓外临时目录（非本仓），历来验收走它。
 *     本轮结论（core 层 vitest）不受此影响；后续若涉验收方式再议。
 */

import { describe, expect, test } from 'vitest'
import { createLyricDocument, parseLrc, serializeLrc, type ParseOptions } from '@core'

/** 关闭识别器，隔离「序列化保真」本身，避免双语识别介入影响断言。 */
const RAW: ParseOptions = { applyRecognizers: false }

/** 解析并断言成功，返回文档。 */
function parseOk(input: string, options?: ParseOptions) {
  const result = parseLrc(input, options)
  if (result.document === null) throw new Error('parseLrc 意外返回 null')
  return result.document
}

/** 往返：解析后再序列化。 */
function rt(input: string, options?: ParseOptions): string {
  return serializeLrc(parseOk(input, options))
}

describe('往返保真（应通过）', () => {
  test('LF：基本歌词行', () => {
    const src = '[00:01.00]第一句\n[00:02.50]第二句\n'
    expect(rt(src, RAW)).toBe(src)
  })

  test('CRLF：换行符写回', () => {
    const src = '[00:01.00]a\r\n[00:02.00]b\r\n'
    expect(rt(src, RAW)).toBe(src)
  })

  test('BOM：写回文件头', () => {
    const src = '\uFEFF[00:01.00]a\n'
    expect(rt(src, RAW)).toBe(src)
  })

  test('编码：记录到 format.encoding（默认 utf-8）', () => {
    expect(parseOk('[00:01.00]a\n', RAW).format.encoding).toBe('utf-8')
    expect(parseOk('[00:01.00]a\n', { ...RAW, encoding: 'gbk' }).format.encoding).toBe('gbk')
  })

  test('编码选项不影响字符串往返（死选项，落盘在 adapters 层）', () => {
    const doc = parseOk('[00:01.00]a\n', RAW)
    // serializeLrc 的 encoding 选项当前从未被使用，仅验证字符串结果一致。
    expect(serializeLrc(doc, { encoding: 'gbk' })).toBe(serializeLrc(doc))
  })

  test('未知标签：单标签原样写回', () => {
    const src = '[ti:标题][xx:foo]\n[00:01.00]a\n'
    expect(rt(src, RAW)).toBe(src)
    expect(parseOk(src, RAW).format.unknownTags).toEqual(['xx'])
  })

  test('行尾空格：正文行与元数据值均保留', () => {
    expect(rt('[00:01.00]hello   \n', RAW)).toBe('[00:01.00]hello   \n')
    expect(rt('[ti:a ]\n[00:01.00]x\n', RAW)).toBe('[ti:a ]\n[00:01.00]x\n')
  })

  test('默认双语识别：同脚本相邻行不合并（no-op）', () => {
    const src = '[00:01.00]中文一\n[00:01.00]中文二\n'
    expect(rt(src)).toBe(src)
  })

  test('双语合并：异脚本同时间戳相邻行，合并后可还原', () => {
    const src = '[00:01.00]中文\n[00:01.00]English\n'
    expect(rt(src)).toBe(src)
    const doc = parseOk(src)
    expect(doc.lines).toHaveLength(1)
    expect(doc.lines[0].translation).toBe('English')
    expect(doc.lines[0].translationSeparator).toBeNull()
  })

  test('一行多时间戳：保留为同一行的多个时间戳', () => {
    const src = '[00:15.50][00:18.00]同一句\n'
    expect(rt(src, RAW)).toBe(src)
  })

  test('增强型字级标签：往返写回', () => {
    const src = '[00:01.00]<00:01.00>你<00:01.50>好\n'
    expect(rt(src, RAW)).toBe(src)
    expect(parseOk(src, RAW).format.detectedFormat).toBe('enhanced-lrc')
  })

  test('offset / length：往返写回', () => {
    const src = '[offset:-500][length:03:20]\n[00:01.00]a\n'
    expect(rt(src, RAW)).toBe(src)
  })

  test('纯文本（无时间戳）文件：整篇原样写回', () => {
    const src = '这是第一行\n这是第二行\n'
    expect(rt(src)).toBe(src)
  })

  test('幂等性：已规范化的输出是往返不动点', () => {
    const src = '[ti:a][ar:b]\n[00:01.00]s\n'
    const once = rt(src, RAW)
    expect(rt(once, RAW)).toBe(once)
  })
})

describe('往返漏洞（test.fails：修复后须摘除 .fails）', () => {
  test('V1 重复标准标签保持：[ti:a][ti:b] → [ti:a][ti:b]', () => {
    const src = '[ti:a][ti:b]\n[00:01.00]s\n'
    expect(rt(src, RAW)).toBe(src)
  })

  test('V2 重复自定义标签保持：[xx:1][xx:2] → [xx:1][xx:2]', () => {
    const src = '[xx:1][xx:2]\n[00:01.00]s\n'
    expect(rt(src, RAW)).toBe(src)
  })

  test.fails('V4 混合换行符被统一：CRLF 中夹一个 LF', () => {
    const src = '[00:01.00]a\r\n[00:02.00]b\n[00:03.00]c\r\n'
    expect(rt(src, RAW)).toBe(src)
  })

  test('V5 多标签行顺序保持：[ar:b][ti:a] → [ar:b][ti:a]', () => {
    const src = '[ar:b][ti:a]\n[00:01.00]s\n'
    expect(rt(src, RAW)).toBe(src)
  })

  test('V6 元数据跨行保持：[ti:a]\\n[ar:b] → [ti:a]\\n[ar:b]', () => {
    const src = '[ti:a]\n[ar:b]\n[00:01.00]s\n'
    expect(rt(src, RAW)).toBe(src)
  })
})

describe('元数据标签序列（additive 字段 metadataTags）', () => {
  test('无记录回退：程序化构造的文档仍按单行标准序写回', () => {
    // 不提供 metadataTags（缺省）→ 与今天行为逐字一致：单行、标准顺序。
    const doc = createLyricDocument({
      meta: { artist: 'b', title: 'a' },
      lines: [],
      format: { lineEnding: '\n' },
    })
    expect(doc.format.metadataTags).toBeUndefined()
    expect(serializeLrc(doc)).toBe('[ti:a][ar:b]\n')
  })

  test('多行序列 + 未知标签混排：逐行保真', () => {
    const src = '[ti:标题][xx:foo]\n[ar:歌手]\n[00:01.00]a\n'
    expect(rt(src, RAW)).toBe(src)
    expect(parseOk(src, RAW).format.metadataTags).toEqual([
      [
        { name: 'ti', value: '标题' },
        { name: 'xx', value: 'foo' },
      ],
      [{ name: 'ar', value: '歌手' }],
    ])
    expect(parseOk(src, RAW).format.unknownTags).toEqual(['xx'])
  })

  test('非 pristine：改动单个标签 → 整体退回现状（单行标准序）', () => {
    const src = '[ti:a]\n[ar:b]\n'
    const doc = parseOk(src, RAW)
    const edited = { ...doc, meta: { ...doc.meta, title: 'c' } }
    expect(serializeLrc(edited)).toBe('[ti:c][ar:b]\n')
  })

  test('非 pristine：重复标签 + 改动 → 整体退回现状（重复不再保真）', () => {
    const src = '[ti:a][ti:b]\n'
    const doc = parseOk(src, RAW)
    const edited = { ...doc, meta: { ...doc.meta, title: 'c' } }
    expect(serializeLrc(edited)).toBe('[ti:c]\n')
  })
})

describe('空行保真（additive 字段 blankLines）', () => {
  test('V3 空行保持：行间空行（行 ID 锚定）', () => {
    const src = '[00:01.00]a\n\n[00:02.00]b\n'
    expect(rt(src, RAW)).toBe(src)
    const doc = parseOk(src, RAW)
    // 空行不进 lines：只有两条歌词行。
    expect(doc.lines.map((line) => line.text)).toEqual(['a', 'b'])
    // 空行挂在后一行 id 之前。
    expect(doc.format.blankLines?.beforeLine?.[doc.lines[1].id]).toEqual([''])
  })

  test('V3 空行保持：首尾空行（leading + trailing）', () => {
    const src = '\n[00:01.00]a\n\n'
    expect(rt(src, RAW)).toBe(src)
    const doc = parseOk(src, RAW)
    expect(doc.format.blankLines?.leading).toEqual([''])
    expect(doc.format.blankLines?.trailing).toEqual([''])
  })

  test('缺省：无空行的文档 blankLines 为 undefined，输出与既有行为一致', () => {
    const src = '[00:01.00]a\n[00:02.00]b\n'
    const doc = parseOk(src, RAW)
    expect(doc.format.blankLines).toBeUndefined()
    expect(serializeLrc(doc)).toBe(src)
  })

  test('CRLF 空行：换行符为 CRLF 时逐字往返', () => {
    const src = '[00:01.00]a\r\n\r\n[00:02.00]b\r\n'
    expect(rt(src, RAW)).toBe(src)
  })

  test('空白字符行：按空行处理且存原文（保字节无损）', () => {
    const src = '[00:01.00]a\n   \n[00:02.00]b\n'
    expect(rt(src, RAW)).toBe(src)
    const doc = parseOk(src, RAW)
    expect(doc.format.blankLines?.beforeLine?.[doc.lines[1].id]).toEqual(['   '])
  })

  test('元数据前空行：记入 leading', () => {
    const src = '\n[ti:a]\n[00:01.00]x\n'
    expect(rt(src, RAW)).toBe(src)
    expect(parseOk(src, RAW).format.blankLines?.leading).toEqual([''])
  })

  test('双尾随空行：trailing 记两个空行', () => {
    const src = '[00:01.00]a\n\n\n'
    expect(rt(src, RAW)).toBe(src)
    expect(parseOk(src, RAW).format.blankLines?.trailing).toEqual(['', ''])
  })

  test('源不以换行结尾：补一个换行（既有行为不变）', () => {
    const src = '[00:01.00]a'
    expect(rt(src, RAW)).toBe(`${src}\n`)
  })

  test('交叉点：元数据非 pristine 时，歌词区空行仍写回', () => {
    const src = '[ti:a]\n\n[00:01.00]x\n'
    const doc = parseOk(src, RAW)
    const edited = { ...doc, meta: { ...doc.meta, title: 'c' } }
    expect(serializeLrc(edited)).toBe('[ti:c]\n\n[00:01.00]x\n')
  })

  test('降级：锚点行被删除 → 该批空行丢弃（不顺延）', () => {
    const src = '[00:01.00]a\n\n[00:02.00]b\n'
    const doc = parseOk(src, RAW)
    // 模拟删除 b：lines 中移除 b，b 前的空行随之丢弃。
    const withoutB = { ...doc, lines: doc.lines.filter((line) => line.text !== 'b') }
    expect(serializeLrc(withoutB)).toBe('[00:01.00]a\n')
  })
})

describe('元数据前缀识别', () => {
  /** 开启元数据前缀识别（默认关，须显式开启）。 */
  const PREFIX: ParseOptions = { metadataPrefix: { enabled: true } }

  test('a. 基本：作词行转元数据、不进 lines、导出含 [lyricist:张三]', () => {
    const src = '作词：张三\n[00:01.00]x\n'
    const doc = parseOk(src, PREFIX)
    expect(doc.meta.lyricist).toBe('张三')
    expect(doc.lines.map((line) => line.text)).toEqual(['x'])
    expect(serializeLrc(doc)).toBe('[lyricist:张三]\n[00:01.00]x\n')
  })

  test('b. 四种分隔符：中文冒号 / 英文冒号 / 半角空格 / Tab', () => {
    const cases: Array<[string, string]> = [
      ['作词：张三\n[00:01.00]x\n', '张三'],
      ['作词:李四\n[00:01.00]x\n', '李四'],
      ['作词 王五\n[00:01.00]x\n', '王五'],
      ['作词\t赵六\n[00:01.00]x\n', '赵六'],
    ]
    for (const [src, value] of cases) {
      const doc = parseOk(src, PREFIX)
      expect(doc.meta.lyricist).toBe(value)
      expect(serializeLrc(doc)).toBe(`[lyricist:${value}]\n[00:01.00]x\n`)
    }
  })

  test('c. 非标准前缀：制作人 → meta.custom + unknownTags；导出并往返', () => {
    const src = '制作人：李四\n[00:01.00]x\n'
    const doc = parseOk(src, PREFIX)
    expect(doc.meta.custom?.producer).toBe('李四')
    expect(doc.format.unknownTags).toEqual(['producer'])
    const out = serializeLrc(doc)
    expect(out).toBe('[producer:李四]\n[00:01.00]x\n')
    // 再导入仍归 custom（往返）
    const again = parseOk(out, PREFIX)
    expect(again.meta.custom?.producer).toBe('李四')
  })

  test('d. 与 [ti:] 混排：metadataTags 顺序 = 源顺序', () => {
    const src = '[ti:歌名]\n作词：张三\n[00:01.00]x\n'
    const doc = parseOk(src, PREFIX)
    expect(doc.format.metadataTags).toEqual([
      [{ name: 'ti', value: '歌名' }],
      [{ name: 'lyricist', value: '张三' }],
    ])
    expect(serializeLrc(doc)).toBe('[ti:歌名]\n[lyricist:张三]\n[00:01.00]x\n')
  })

  test('e. pristine 守护：多行元数据 + 识别一行 → 导出仍为多行（不塌成单行）', () => {
    const src = '[ti:歌名]\n[ar:歌手]\n作词：张三\n[00:01.00]x\n'
    const doc = parseOk(src, PREFIX)
    expect(serializeLrc(doc)).toBe('[ti:歌名]\n[ar:歌手]\n[lyricist:张三]\n[00:01.00]x\n')
  })

  test('f. 默认关（不传 option）→ 作词行保留为歌词行', () => {
    const src = '作词：张三\n[00:01.00]x\n'
    const doc = parseOk(src)
    expect(doc.meta.lyricist).toBeUndefined()
    expect(doc.lines.map((line) => line.text)).toEqual(['作词：张三', 'x'])
    expect(serializeLrc(doc)).toBe(src)
  })

  test('g. 带时间戳的行不识别', () => {
    const src = '[00:01.00]作词：张三\n'
    const doc = parseOk(src, PREFIX)
    expect(doc.meta.lyricist).toBeUndefined()
    expect(doc.lines.map((line) => line.text)).toEqual(['作词：张三'])
  })

  test('h. 第 11 条内容行不识别（窗口上限 10）', () => {
    const src = 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n作词：张三\n[00:01.00]x\n'
    const doc = parseOk(src, PREFIX)
    expect(doc.meta.lyricist).toBeUndefined()
    expect(doc.lines.filter((line) => line.text === '作词：张三')).toHaveLength(1)
  })

  test('i. 空值不识别', () => {
    const src = '作词：\n[00:01.00]x\n'
    const doc = parseOk(src, PREFIX)
    expect(doc.meta.lyricist).toBeUndefined()
    expect(doc.lines.filter((line) => line.text === '作词：')).toHaveLength(1)
  })

  test('j. 无分隔符不识别', () => {
    const src = '作词张三\n[00:01.00]x\n'
    const doc = parseOk(src, PREFIX)
    expect(doc.meta.lyricist).toBeUndefined()
    expect(doc.lines.filter((line) => line.text === '作词张三')).toHaveLength(1)
  })

  test('k. 第一条带时间戳行之后的前缀行不识别', () => {
    const src = '[00:01.00]x\n作词：张三\n[00:02.00]y\n'
    const doc = parseOk(src, PREFIX)
    expect(doc.meta.lyricist).toBeUndefined()
    expect(doc.lines.filter((line) => line.text === '作词：张三')).toHaveLength(1)
  })

  test('l. 总闸门关（applyRecognizers:false）+ 前缀识别开 → 不识别', () => {
    const src = '作词：张三\n[00:01.00]x\n'
    const doc = parseOk(src, { applyRecognizers: false, metadataPrefix: { enabled: true } })
    expect(doc.meta.lyricist).toBeUndefined()
    expect(doc.lines.map((line) => line.text)).toEqual(['作词：张三', 'x'])
  })
})
