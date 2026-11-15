# 安卓 PWA 全屏化 · 交接文档

> **用途**：记录本轮的背景、做法、验收与边界。配合主交接文档阅读。
> **状态**：✅ 轮 4a 已闭合。
> **基线**：harness 588/588；core vitest 208/208；tsc 退出码 0。
> **上游/依赖**：UI 架构重构轮 3a–3d 已把窄屏结构与间距收口；本轮解决「安卓浏览器地址栏 + 底部手势条占屏」的形态问题，让「添加到主屏幕」后以 standalone 形态打开。

## 一、本轮范围

让应用可被安装为 PWA 并以无地址栏的 standalone 形态打开：新增 `manifest.webmanifest` 与两张图标，`index.html` 挂 manifest / `apple-touch-icon`，`src/index.css` 给最外层容器补安全区避让。零业务组件改动。

## 二、核心接口与契约变更（极其重要）

无新增 / 修改业务接口。以下为新增的静态契约：

- **新增静态资源**：
  - `public/manifest.webmanifest`：`name` = `LRC 歌词编辑器`，`short_name` = `LRC 编辑器`，`start_url` / `scope` = `/lyric-block-forge/`，`display` = `standalone`，`orientation` = `any`，`background_color` / `theme_color` = `#14161a`，`icons` 两项（192 / 512，`purpose: "any maskable"`）。
  - `public/icons/icon-192.png`、`public/icons/icon-512.png`：脚本生成，`#14161a` 底 + 三条 `#4c8dff` 横线。
- **`index.html` 新增节点**：
  - `<link rel="manifest" href="%BASE_URL%manifest.webmanifest" />`
  - `<link rel="apple-touch-icon" href="%BASE_URL%icons/icon-192.png" />`
  - `<meta name="theme-color" content="#14161a" />` **原本已存在且值一致，未改**。
- **CSS 契约（供后续 harness 依赖）**：
  - `#root > div > header`：`height: calc(2.75rem + env(safe-area-inset-top))` + `padding-top: env(safe-area-inset-top)`。
  - `#root > div > main > div`：`padding-bottom: calc(0.25rem + env(safe-area-inset-bottom))`，`@media (min-width: 768px)` 下为 `calc(0.75rem + …)`。
  - 选择器依赖 DOM 层级（`#root > div > header`），若 App 外壳结构变动需同步迁移；**不可简化为裸 `header`**——`PanelFrame` 内部也有 `<header>`。
- **DOM 契约**：未新增 / 移除任何 `data-*` 或 class，面板与交互结构零变化。

## 三、关键设计与做法

1. **`base` 亲和**：manifest 是 `public/` 下的静态文件，Vite 不会做 `%BASE_URL%` 替换，因此 `start_url` / `scope` / 图标路径直接写死生产前缀 `/lyric-block-forge/`（与 `vite.config.ts` 的 `base` 一致）；`index.html` 里则用 `%BASE_URL%` 由构建注入，不写死。
2. **`theme_color` 取真实值**：从 `tailwind.config.ts` 的 `canvas`（`#14161a`）取值，与 `index.html` 既有 `theme-color` 一致，不臆造。
3. **图标零依赖生成**：`public/` 原本不存在、无 logo，故用临时 Node 脚本（写在 `%TEMP%`，手写最小 PNG 编码器：`zlib.deflateSync` + CRC32 分块）生成 192 / 512 两张，图形落在 maskable 安全区内（最宽条 62.5% < 80% 安全直径），跑完即删脚本，仓库不留生成物。
4. **安全区只挂两个最外层容器**：顶栏 `<header>` 加 `padding-top`，并把 `height` 同步加同一个 `env()`，保证边框盒内留给内容的高度仍是原 `h-11`（44px），不会把顶栏压扁；底部挂在 `ThreeColumnLayout` 根节点（footer 在其内、窄屏无 footer 时也能盖住最底部的歌词面板），用 `calc(既有内边距 + env())` 叠加，**不覆盖** `p-1` / `p-3`，桌面 `env()` 为 0 → 窄屏 4px、桌面 12px，与改动前逐像素一致。
5. **不碰组件的原因**：第零步核实 UI 内 0 处外链（无 `<a href="http…">` / `window.open`）、无路由与 `pushState`（`LogPanel` 只读 `history.length`），故「外链补 `target="_blank"`」一项无需执行；安卓返回键在无应用内历史时即退出应用，符合预期。
6. **有意不做**：Service Worker / 离线缓存、`requestFullscreen`、横屏锁定、应用内全屏与退出按钮。`window.close()` 对「添加到主屏幕」启动的 PWA 无效，加了是假按钮。

## 四、改动文件清单

| 文件 | 改动内容 | 影响范围/关联模块 |
| :--- | :--- | :--- |
| `public/manifest.webmanifest` | 新增，PWA 清单（`standalone`、`#14161a`、192/512 图标） | 安装性 / 启动形态；不影响运行时 DOM |
| `public/icons/icon-192.png` | 新增，脚本生成 192×192 | 桌面图标 / 启动图 |
| `public/icons/icon-512.png` | 新增，脚本生成 512×512 | 桌面图标 / splash |
| `index.html:7-8` | 新增 manifest link 与 `apple-touch-icon`（`%BASE_URL%`） | 构建产物 head；`theme-color` 未改 |
| `src/index.css`（`body` 规则之后） | 新增安全区避让三条规则（顶栏 top、内容区 bottom ×2 断点） | 仅 `env()` 非零环境生效，桌面零变化 |

## 五、验收证据

- **tsc**：`npx tsc -b --noEmit` 退出码 **0**。
- **vitest**：**208/208**（12 文件）。
- **harness**：**588/588，0 失败**（本轮零新增断言；`BN.a` 窄屏 `innerWidth` 仍 375、`BN.f` 恢复桌面后 footer 距底仍 12px，说明 `calc(0.75rem + env(…))` 在 `env() = 0` 时与 `p-3` 等值）。
- **`npx vite build`**：成功；`dist/manifest.webmanifest` 存在，`dist/icons/icon-192.png` / `icon-512.png` 存在，`dist/index.html` 中 manifest / `apple-touch-icon` 的 `%BASE_URL%` 已替换为 `/lyric-block-forge/`，产物 CSS 中三条安全区规则保留。
- **图标自检**：两文件 PNG 签名正确，尺寸分别 192×192 / 512×512。
- **`git status --short`**：`M index.html`、`M src/index.css`、`?? public/`（manifest + 2 张图标），业务文件恰 2 个 + 新增静态资源，无组件文件被碰。

## 六、已知取舍与未验证

- **取舍**：
  - 不做 Service Worker，因此无离线缓存，PWA 的「离线可用」本轮不成立，留到打包轮。
  - 不做 `requestFullscreen` 与横屏锁定；iOS 不支持全屏 API，安卓也需用户手势触发。
  - `env(safe-area-inset-*)` 在桌面浏览器恒为 0，桌面视觉不变；安卓有手势条的机型底部会多出内边距。
  - 不提供应用内「退出」按钮：standalone 下 `window.close()` 无效，退出依赖系统手势；若未来做 `requestFullscreen` / 横屏锁定，必须补显式退出按钮。
  - PWA 内无地址栏：本轮核实 UI 外链为 0 处，暂无「打开后无路可退」的风险；后续若引入外链，必须补 `target="_blank" rel="noreferrer"`。
  - 图标为脚本生成的纯色图（深底 + 三条蓝线），观感朴素，后续可替换为正式 logo。
  - 横向安全区（`safe-area-inset-left/right`）**未加**：竖屏恒为 0；横屏刘海场景需要横屏 UI 适配，本轮 `orientation: any` 但不做横屏专门处理。
- **未验证**：安卓 Chrome / iOS Safari 真机的「安装应用」入口、standalone 打开后无地址栏与手势条避让的实际观感、系统返回手势退出行为；只能人工目测。

## 七、否决的备选方案

- **把安全区 `padding` 撒到每个面板 / 每个卡片上**：否决。`env()` 只需在最外层容器避让一次，往里撒会叠加出多份内边距，桌面虽为 0 但语义混乱、后续难维护。
- **用裸 `header` 选择器加 `padding-top`**：否决。`PanelFrame` 内部同样是 `<header>`，裸选择器会把安全区顶部内边距加到每个面板标题栏，窄屏出现多条异常留白。
- **把 `ThreeColumnLayout` 的 `p-1 md:p-3` 直接改成含 `env()` 的值（覆盖而非叠加）**：否决。会覆盖 Tailwind 的既有内边距，桌面 `env() = 0` 时底部变成 0、破坏「桌面零变化」。
- **在 `public/` 里手写一张 SVG 当图标**：否决。安卓 Chrome 对 maskable 图标要求 PNG 位图（SVG 支持不稳定），且 `apple-touch-icon` 也不接受 SVG。
- **引入 `vite-plugin-pwa` 顺带做 SW**：否决。任务书明确不新增依赖、本轮不做离线；生成的 SW 会让「改一行代码刷新看不到」的调试陷阱提前出现。
