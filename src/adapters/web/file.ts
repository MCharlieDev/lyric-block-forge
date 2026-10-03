import type {
  AudioFileContent,
  FileFilter,
  FilePort,
  FileRef,
  OpenFileOptions,
  SaveTextRequest,
  TextFileContent,
} from '../ports'

/**
 * Web 端文件端口实现。
 *
 * - **打开**：`<input type="file">`，取消通过 `cancel` 事件识别；
 * - **保存**：优先 File System Access API（原生"另存为"对话框），
 *   不支持时退回 `Blob + a[download]`；
 * - **编码**：先按 BOM 判定，再以严格 UTF-8 试探，失败退回 GBK。
 *
 * 选中的 `File` 会登记在闭包内的注册表里，`readText(ref)` 依赖它按引用重读；
 * 音频则额外生成 object URL 作为 `uri`，交给 `AudioPort` 自行解码。
 */

/** 把过滤器转成 `<input accept>` 的取值。 */
function toAccept(filters?: FileFilter[]): string | undefined {
  if (filters === undefined || filters.length === 0) return undefined
  return filters.flatMap((filter) => filter.extensions.map((ext) => `.${ext}`)).join(',')
}

/** 把过滤器转成 File System Access API 的 `types` 取值。 */
function toPickerTypes(filters?: FileFilter[]): Array<{ description: string; accept: Record<string, string[]> }> | undefined {
  if (filters === undefined || filters.length === 0) return undefined
  return filters.map((filter) => ({
    description: filter.name,
    accept: { 'text/plain': filter.extensions.map((ext) => `.${ext}`) },
  }))
}

/**
 * 解码文本文件字节流。
 *
 * BOM 优先（UTF-8 / UTF-16），否则用严格 UTF-8 试探；试探失败说明是
 * 中文 LRC 常见的 GBK 编码，退回 GBK 再试一次。
 *
 * @param buffer 文件字节
 * @returns 文本与判定出的编码
 */
function decodeBuffer(buffer: ArrayBuffer): { text: string; encoding: string } {
  const bytes = new Uint8Array(buffer)
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(buffer), encoding: 'utf-8' }
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(buffer), encoding: 'utf-16le' }
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(buffer), encoding: 'utf-16be' }
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buffer), encoding: 'utf-8' }
  } catch {
    try {
      return { text: new TextDecoder('gbk').decode(buffer), encoding: 'gbk' }
    } catch {
      return { text: new TextDecoder('utf-8').decode(buffer), encoding: 'utf-8' }
    }
  }
}

/** File System Access API 的最小可用结构（避免依赖具体 TS lib 版本）。 */
interface WritableLike {
  write(data: Blob): Promise<void>
  close(): Promise<void>
}
interface FileHandleLike {
  readonly name: string
  createWritable(): Promise<WritableLike>
}
interface SavePickerOptions {
  suggestedName?: string
  types?: Array<{ description?: string; accept: Record<string, string[]> }>
}
type SavePicker = (options?: SavePickerOptions) => Promise<FileHandleLike>

/** 读取 `window` 上可能不存在的原生保存能力。 */
function getSavePicker(): SavePicker | null {
  const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker
  return typeof picker === 'function' ? picker : null
}

/**
 * 弹出文件选择框，返回用户选中的第一个文件。
 *
 * @param accept `accept` 属性值
 * @returns 选中的文件；用户取消时为 `null`
 */
function pickFile(accept: string | undefined): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.style.display = 'none'
    if (accept !== undefined) input.accept = accept

    const finish = (file: File | null): void => {
      input.remove()
      resolve(file)
    }

    input.addEventListener('change', () => finish(input.files?.[0] ?? null))
    // Chrome 113+ 支持 cancel 事件；不支持时输入框留在 DOM 中不影响功能
    input.addEventListener('cancel', () => finish(null))

    document.body.appendChild(input)
    input.click()
  })
}

/**
 * 创建 Web 端文件端口。
 *
 * @returns 文件端口实例
 */
export function createWebFilePort(): FilePort {
  /** 已选文件的注册表，`uri` → `File`，供 `readText` 按引用重读 */
  const registry = new Map<string, File>()
  let uriSeq = 0

  const register = (file: File): string => {
    const uri = `file://local/${++uriSeq}/${encodeURIComponent(file.name)}`
    registry.set(uri, file)
    return uri
  }

  const readText = async (ref: FileRef): Promise<TextFileContent> => {
    const file = registry.get(ref.uri)
    if (file === undefined) {
      throw new Error(`无法读取文件：引用 ${ref.uri} 不在本次会话的注册表中`)
    }
    const decoded = decodeBuffer(await file.arrayBuffer())
    return { ref, text: decoded.text, encoding: decoded.encoding }
  }

  return {
    supportsNativeSave: getSavePicker() !== null,

    async openTextFile(options: OpenFileOptions = {}): Promise<TextFileContent | null> {
      const file = await pickFile(toAccept(options.filters))
      if (file === null) return null
      const ref: FileRef = {
        name: file.name,
        uri: register(file),
        sizeBytes: file.size,
        mimeType: file.type === '' ? null : file.type,
      }
      const decoded = decodeBuffer(await file.arrayBuffer())
      return { ref, text: decoded.text, encoding: decoded.encoding }
    },

    async openAudioFile(options: OpenFileOptions = {}): Promise<AudioFileContent | null> {
      const file = await pickFile(toAccept(options.filters) ?? 'audio/*')
      if (file === null) return null
      const ref: FileRef = {
        name: file.name,
        // object URL 作为跨端口传递的定位符，`AudioPort` 用完负责 revoke
        uri: URL.createObjectURL(file),
        sizeBytes: file.size,
        mimeType: file.type === '' ? null : file.type,
      }
      return { ref, data: file }
    },

    readText,

    async saveText(request: SaveTextRequest): Promise<FileRef | null> {
      const blob = new Blob([request.text], { type: 'text/plain;charset=utf-8' })
      const picker = getSavePicker()

      if (picker !== null) {
        try {
          const handle = await picker({
            suggestedName: request.suggestedName,
            types: toPickerTypes(request.filters),
          })
          const writable = await handle.createWritable()
          await writable.write(blob)
          await writable.close()
          return { name: handle.name, uri: handle.name, sizeBytes: blob.size, mimeType: blob.type }
        } catch (error) {
          // 用户在原生对话框中取消，不算失败
          if (error instanceof DOMException && error.name === 'AbortError') return null
          throw error
        }
      }

      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = request.suggestedName
      anchor.style.display = 'none'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      // 下载是异步的，稍后再释放 URL
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
      return { name: request.suggestedName, uri: url, sizeBytes: blob.size, mimeType: blob.type }
    },
  }
}
