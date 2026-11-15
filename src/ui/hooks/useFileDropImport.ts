import { useEffect, useRef, useState } from 'react'

/** 全局拖拽导入的可选项。 */
export interface FileDropImportOptions {
  /** 是否启用监听，默认 `true`（例如弹窗打开时临时关掉）。 */
  enabled?: boolean
}

/** `useFileDropImport` 的返回值。 */
export interface FileDropImportState {
  /** 当前是否有文件悬停在窗口上（决定蒙版显隐）。 */
  isDragging: boolean
}

/**
 * 全局文件拖拽导入。
 *
 * 监听挂在 `window` 上，整页任意位置拖入都能响应；蒙版 JSX 由调用方渲染，
 * 本 Hook 只负责「事件 → `isDragging` 状态」这一段。
 *
 * 防闪烁用**计数器**而非单看 `relatedTarget`：`dragenter` / `dragleave` 会在
 * 划过子元素时成对触发，只看 `relatedTarget` 仍会让蒙版抖一下；计数器保证
 * 「还有元素在悬停」时不会误判为离开。`relatedTarget === null` 表示拖出了窗口，
 * 此时直接把计数器归零兜底。
 *
 * 三个事件都必须 `preventDefault`：不拦 `dragover` 浏览器不会派发 `drop`，
 * 不拦 `drop` 浏览器会直接把文件当成导航打开。
 *
 * @param onDropFiles 松手且确有待处理文件时的回调（只会在 `files.length > 0` 时调用）
 * @param options 可选项
 * @returns 蒙版开关状态
 */
export function useFileDropImport(
  onDropFiles: (files: FileList) => void,
  options: FileDropImportOptions = {},
): FileDropImportState {
  const { enabled = true } = options
  const [isDragging, setIsDragging] = useState(false)
  const dragCounterRef = useRef(0)
  // 回调存进 ref：调用方每次 render 都会传新函数，直接进依赖会让监听反复解绑重绑
  const onDropFilesRef = useRef(onDropFiles)

  useEffect(() => {
    onDropFilesRef.current = onDropFiles
  }, [onDropFiles])

  useEffect(() => {
    if (!enabled) return

    const handleDragEnter = (event: DragEvent): void => {
      event.preventDefault()
      dragCounterRef.current += 1
      setIsDragging(true)
    }

    const handleDragOver = (event: DragEvent): void => {
      event.preventDefault()
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'copy'
    }

    const handleDragLeave = (event: DragEvent): void => {
      dragCounterRef.current = Math.max(0, dragCounterRef.current - 1)
      // relatedTarget 为 null 说明指针已经离开窗口，即使计数没归零也要收起蒙版
      if (dragCounterRef.current === 0 || event.relatedTarget === null) {
        dragCounterRef.current = 0
        setIsDragging(false)
      }
    }

    const handleDrop = (event: DragEvent): void => {
      event.preventDefault()
      dragCounterRef.current = 0
      setIsDragging(false)
      const files = event.dataTransfer === null ? null : event.dataTransfer.files
      if (files !== null && files.length > 0) onDropFilesRef.current(files)
    }

    window.addEventListener('dragenter', handleDragEnter)
    window.addEventListener('dragover', handleDragOver)
    window.addEventListener('dragleave', handleDragLeave)
    window.addEventListener('drop', handleDrop)
    return () => {
      window.removeEventListener('dragenter', handleDragEnter)
      window.removeEventListener('dragover', handleDragOver)
      window.removeEventListener('dragleave', handleDragLeave)
      window.removeEventListener('drop', handleDrop)
      dragCounterRef.current = 0
    }
  }, [enabled])

  return { isDragging }
}
