/**
 * 文件端口：文本与音频的打开、读取、保存。
 *
 * 平台实现提示：
 * - Web：`<input type="file">` + `FileReader`；保存走 Blob 下载（无原生对话框）。
 * - Tauri 2：`@tauri-apps/plugin-dialog` + `plugin-fs`，支持原生保存对话框。
 * - Capacitor：`@capacitor/filesystem` + `@capacitor/share`，
 *   移动端文件位于应用沙箱内，必须有"导出到系统 / 分享"入口。
 */

/** 文件引用。真正内容按需经 {@link FilePort} 读取，避免把大文件常驻内存。 */
export interface FileRef {
  /** 展示用文件名（含扩展名） */
  name: string
  /**
   * 资源定位符：Web 为 blob URL 或 File 对象标识，
   * 桌面为绝对路径，移动端为沙箱内相对路径。
   */
  uri: string
  /** 字节大小，未知为 `null` */
  sizeBytes: number | null
  /** MIME 类型，未知为 `null` */
  mimeType: string | null
}

/** 文件类型过滤器。 */
export interface FileFilter {
  /** 过滤器显示名，例如"LRC 歌词" */
  name: string
  /** 允许的扩展名，不含点，例如 `['lrc', 'txt']` */
  extensions: string[]
}

/** 打开文件时的可选项。 */
export interface OpenFileOptions {
  /** 文件类型过滤器，缺省不限 */
  filters?: FileFilter[]
  /** 是否允许多选，默认 `false` */
  multiple?: boolean
}

/** 读取到的文本文件内容。 */
export interface TextFileContent {
  /** 文件引用 */
  ref: FileRef
  /** 文本内容（已完成编码解码） */
  text: string
  /** 实际使用的编码，供导入预设回写 */
  encoding: string
}

/** 读取到的音频文件内容。 */
export interface AudioFileContent {
  /** 文件引用 */
  ref: FileRef
  /** 二进制内容，交由 AudioPort 解码 */
  data: Blob
}

/** 保存文本文件的请求。 */
export interface SaveTextRequest {
  /** 建议文件名（含扩展名） */
  suggestedName: string
  /** 文本内容 */
  text: string
  /** 文件类型过滤器 */
  filters?: FileFilter[]
}

/**
 * 文本与音频的文件读写端口。
 */
export interface FilePort {
  /** 是否支持原生保存对话框（决定是否提示"另存为"文案差异） */
  readonly supportsNativeSave: boolean

  /**
   * 打开并读取一个文本文件（导入 LRC / 纯文本歌词）。
   *
   * @param options 打开选项
   * @returns 文件内容；用户取消时为 `null`
   */
  openTextFile(options?: OpenFileOptions): Promise<TextFileContent | null>

  /**
   * 打开一个音频文件（加载伴奏 / 人声）。
   *
   * @param options 打开选项
   * @returns 文件内容；用户取消时为 `null`
   */
  openAudioFile(options?: OpenFileOptions): Promise<AudioFileContent | null>

  /**
   * 按引用重新读取文本内容（用于最近文件、恢复副本等场景）。
   *
   * @param ref 文件引用
   * @returns 文本内容
   */
  readText(ref: FileRef): Promise<TextFileContent>

  /**
   * 保存文本文件。
   *
   * @param request 保存请求
   * @returns 保存后的文件引用；用户取消时为 `null`
   */
  saveText(request: SaveTextRequest): Promise<FileRef | null>
}
