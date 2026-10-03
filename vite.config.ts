import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * Vite 构建配置。
 * 四个别名与 tsconfig 的 paths 一一对应，用于强制分层引用清晰：
 * core / adapters / ui / shells。
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('./src/core', import.meta.url)),
      '@adapters': fileURLToPath(new URL('./src/adapters', import.meta.url)),
      '@ui': fileURLToPath(new URL('./src/ui', import.meta.url)),
      '@shells': fileURLToPath(new URL('./src/shells', import.meta.url)),
    },
  },
  server: {
    port: 5177,
    strictPort: true,
    open: false,
    // 无头浏览器截图会在这个目录里写 Chrome 用户数据，被 Vite 的 watcher
    // 盯上后会抛 EBUSY 把 dev server 打崩，直接忽略掉。
    watch: { ignored: ['**/.tmp-shot/**'] },
  },
})
