import type { Config } from 'tailwindcss'

/** Tailwind CSS 配置：扫描 index.html 与 src 下所有 ts/tsx。 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        /** 编辑器暗色工作区背景 */
        canvas: '#14161a',
        /** 面板背景 */
        panel: '#1b1e24',
        /** 面板分隔线 */
        divider: '#2a2f38',
        /** 主强调色（播放头 / 选中态） */
        accent: '#4c8dff',
      },
    },
  },
  plugins: [],
} satisfies Config
