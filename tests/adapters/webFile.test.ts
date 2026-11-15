/**
 * Web 文件端口 · 拖拽读取测试（`readDroppedFile`）。
 *
 * 覆盖三条契约：
 * 1. UTF-8 BOM：BOM 被剥离，`encoding` 记为 `utf-8`；
 * 2. GBK：严格 UTF-8 试探失败后回退 GBK（Node 缺 ICU 时跳过）；
 * 3. 引用登记：`ref` 与 `File` 元数据一致，且 `readText(ref)` 能重读到同一段文本。
 *
 * 不覆盖 `.docx` 分支：`isDocxFile` / `readDocxText` 保持模块私有，
 * 且需要真实的 Word 二进制 fixture 才能构造出可解析的容器。
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createWebFilePort } from '../../src/adapters/web/file'

/**
 * `createWebFilePort` 创建时会探测 `window.showSaveFilePicker`。
 * Node 测试环境没有 `window`，补一个空对象让探测返回 `null`，
 * 等价于"不支持原生保存对话框"的浏览器；本文件不涉及保存。
 */
beforeAll(() => {
  vi.stubGlobal('window', {})
})

afterAll(() => {
  vi.unstubAllGlobals()
})

/** 当前 Node 是否内置 GBK 解码（无 full-icu 时 `TextDecoder('gbk')` 会抛错）。 */
function supportsGbk(): boolean {
  try {
    new TextDecoder('gbk')
    return true
  } catch {
    return false
  }
}

describe('webFile · readDroppedFile', () => {
  it('UTF-8 BOM 文件：剥离 BOM 并把 encoding 记为 utf-8', async () => {
    const payload = new TextEncoder().encode('[00:01.00]你好')
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...payload])
    const file = new File([bytes], 'a.lrc')

    const content = await createWebFilePort().readDroppedFile(file)

    expect(content.text).toBe('[00:01.00]你好')
    expect(content.encoding).toBe('utf-8')
  })

  it.skipIf(!supportsGbk())('GBK 文件：严格 UTF-8 试探失败后回退 gbk', async () => {
    // "你好"的 GBK 字节，无 BOM，且不是合法 UTF-8 序列
    const bytes = new Uint8Array([0xc4, 0xe3, 0xba, 0xc3])
    const file = new File([bytes], 'b.lrc')

    const content = await createWebFilePort().readDroppedFile(file)

    expect(content.text).toBe('你好')
    expect(content.encoding).toBe('gbk')
  })

  it('ref 与 File 元数据一致，且 readText(ref) 能重读到同一段文本', async () => {
    const port = createWebFilePort()
    const file = new File([new TextEncoder().encode('[00:02.00]世界')], 'c.lrc')

    const content = await port.readDroppedFile(file)

    expect(content.ref.name).toBe('c.lrc')
    expect(content.ref.sizeBytes).toBe(file.size)
    expect(content.ref.mimeType).toBeNull()

    const reread = await port.readText(content.ref)
    expect(reread.text).toBe(content.text)
    expect(reread.encoding).toBe(content.encoding)
  })
})
