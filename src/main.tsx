import './index.css'
import { bootstrapWebShell } from './shells/web'

/**
 * 应用入口：选择外壳并挂载。
 *
 * 第一阶段只实装 Web 外壳；桌面 / 移动外壳在对应目录保留占位模块，
 * 未来按构建目标切换这一处 import 即可，core 与 ui 无需改动。
 */
const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('未找到 React 挂载节点：请检查 index.html 中是否存在 id="root" 的元素')
}

bootstrapWebShell(rootElement)
