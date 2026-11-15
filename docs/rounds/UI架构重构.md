# UI 架构重构 · 交接文档

> **用途**：记录把主界面布局从「尺寸写死在壳里」重构为「可拆解原语」的过程。配合主交接文档阅读。
> **状态**：轮 1/3 ✅、轮 2a ✅ 已闭合（轮 2b 活动栏左右切换、轮 2c 窄视口抽屉、轮 3 顶栏/播放条移动端压缩未开始）。
> **基线**：harness 577/577；core vitest 208/208；tsc 退出码 0。
> **上游/依赖**：A 段《UI 架构摸底》核实结论——三个面板是真模块组件，但尺寸策略（`w-80` / `w-9` / `flex-[1.4]` / `min-width:1100px`）全部写死在 `src/ui/layout/ThreeColumnLayout.tsx` 一个文件里，且 `matchMedia` 跨断点会强制覆盖用户手动的展开/收起。

## 一、本轮范围

零视觉变化的地基重构：抽离 `LeftColumn` / `RightSidebar` 两个布局原语，把右侧侧栏的宽度常量与开合状态收拢为可控 props，并修掉「跨断点强制覆盖用户手动开合」的行为缺陷。不新增 ActivityBar、不改任何面板内部实现。

## 二、核心接口与契约变更（极其重要）

- **新增接口**：
  - `LeftColumn`（`src/ui/layout/LeftColumn.tsx`）：无入参，无返回值（React 组件）。用途：左侧主区域（时间轴条 + 歌词块清单）的唯一装配点，根节点固定 `flex min-h-0 min-w-0 flex-1 flex-col gap-3`。
  - `RightSidebar`（`src/ui/layout/RightSidebar.tsx`）：入参 `isCollapsed: boolean`、`onToggle: () => void`（收起态→展开态的「‹」按钮走 `onExpand`）、`onExpand: () => void`。用途：右侧侧栏两种形态（`w-80` 日志卡片 / `w-9` 图标栏）的唯一装配点，内部渲染 `LogPanel`。
  - 常量导出：`RIGHT_SIDEBAR_WIDTH_CLASS = 'w-80'`、`RIGHT_SIDEBAR_RAIL_WIDTH_CLASS = 'w-9'`（原 `LOG_PANEL_WIDTH_CLASS` / `LOG_PANEL_RAIL_WIDTH_CLASS` 改名为侧栏语义）。
- **修改接口**：
  - `ThreeColumnLayout`：外部签名不变（仍无 props，`App.tsx` 调用点零改动）。内部状态由 `logPanelOpen: boolean` 翻转为 `isCollapsed: boolean`（语义取反），新增 `userToggledRef`。
- **数据模型/类型变更**：
  - 新增 `RightSidebarProps`（仅组件内可见）。
- **DOM 契约（供 harness 依赖）**：
  - **零变化**。aside 的 class 组合、`title="收起日志面板"` / `title="展开日志面板"`、`›` / `‹` 文案、`aside > div.h-6 > button` 与 `aside > button + span` 结构均逐字保留，只换宿主文件。harness 检索 `aside|w-80|收起日志|展开日志|ThreeColumn` 本就 0 命中。

## 三、关键设计与做法

1. **原语化但不参数化**：`LeftColumn` 只搬 DOM，不接任何 props。时间轴 `flex-[1.4]` 与歌词列表 `flex-1` 仍写死在各自组件内部——参数化会把改动面扩到 `TimelineStrip.tsx` / `LyricBlockPanel.tsx`，与「只碰 `src/ui/layout/`」的硬边界冲突，留给需要真正改变比例的轮次。
2. **尺寸策略集中在一处**：`w-80` / `w-9` 由 `RightSidebar` 导出为具名常量，断点查询 `WIDE_VIEWPORT_QUERY = '(min-width: 1100px)'` 留在 `ThreeColumnLayout`。轮 2 接抽屉时，只需替换 `RightSidebar` 的宿主容器，不必再动面板组件。
3. **matchMedia 单向接管**：`userToggledRef` 初始 `false`，此时 `matchMedia('change')` 照旧 `setIsCollapsed(!event.matches)`；`handleCollapse` / `handleExpand` 一被点击就置 `true`，此后断点变化直接早退。选择 ref 而不是 state，是因为该标记不参与渲染，避免多一次无意义重渲染。
4. **初始态语义等价**：`useState(() => !matchMedia(...).matches)` 与旧 `useState(() => matchMedia(...).matches)` 结果完全一致，首帧不会有视觉跳变。

## 四、改动文件清单

| 文件 | 改动内容 | 影响范围/关联模块 |
| :--- | :--- | :--- |
| `src/ui/layout/LeftColumn.tsx` | 新增。承载 `TimelineStrip` + `LyricBlockPanel`，根节点 `flex-1`。 | 纯搬移，无逻辑；后续轮次可在此插活动栏/抽屉触点 |
| `src/ui/layout/RightSidebar.tsx` | 新增。展开态 `aside.w-80`（含 `h-6` 收起条 + `LogPanel`）与收起态 `aside.w-9`（展开按钮 + 竖排「日志」）；导出两个宽度常量。 | 纯搬移，无逻辑；轮 2 抽屉化的替换点 |
| `src/ui/layout/ThreeColumnLayout.tsx` | 重写为「外壳 + `LeftColumn` + `RightSidebar` + footer」；`logPanelOpen` → `isCollapsed`；新增 `userToggledRef` 修正跨断点覆盖。 | 影响侧栏开合策略；面板内部与 App 调用点零影响 |

## 五、验收证据

- **tsc**：`npx tsc -b --noEmit` 退出码 0。
- **vitest**：208/208 通过（12 个文件全绿）。
- **harness**：577/577，0 失败；BM 组（Word 导入）与 BK/BL 组（字级游标 / 行首吸附）照旧通过，未改任何断言或期望值。
- **关键断言/实测**：`git status --short` 业务文件恰 3 个（`M ThreeColumnLayout.tsx`、`?? LeftColumn.tsx`、`?? RightSidebar.tsx`）。「视觉零变化」由 harness 577 条端到端断言兜底，另附人工目测清单（像素级比对 / 开合 / 跨 1100px 后手动开合不被覆盖 / 1.4 : 1 比例）。

## 六、已知取舍与未验证

- **取舍**：
  - 本轮不解决移动端（375px）顶栏与播放条横向溢出，属轮 3。
  - `matchMedia` 修正后，用户手动收起后跨断点不再自动展开，这是有意为之（尊重用户意图）。
  - `LeftColumn` 抽离后，`TimelineStrip` 的 `flex-[1.4]` 仍写死在组件内部，本轮不参数化，避免扩大改动面。
- **未验证**：
  - 无自动化断言覆盖「用户手动开合后断点不再覆盖」这条新行为（harness 无布局断言，且本轮禁改 harness），仅靠人工目测清单验证。
  - 未做 375px 真机/模拟器实测（属轮 3 范围）。

## 七、否决的备选方案

- **把 `isCollapsed` 放进 `settingsStore` 持久化**：否决。桌面 ↔ 移动的默认开合是视口策略问题，持久化会把「换设备/换窗口」变成「配置污染」，且本轮硬边界不允许碰 `stores/`。
- **给 `LeftColumn` 加 `ratio` / `className` 参数**：否决。当前唯一调用方传的都是默认值，参数化只会造出无消费者的抽象，并把改动面扩到面板组件。
- **用 `useState` 存 `userToggled`**：否决。该标记只做逻辑闸门、不参与渲染，state 会引入额外重渲染；`useRef` 语义更准。
- **把 `WIDE_VIEWPORT_QUERY` 一并搬进 `RightSidebar`**：否决。断点决定的是「侧栏该不该存在」，属于布局外壳的策略，搬进侧栏会让轮 2 的抽屉逻辑无处安放。

## 轮次 2a：常驻 ActivityBar（固定右侧）

> **状态**：✅ 已闭合。本轮**推翻轮 1 的 RightSidebar 收起态设计**：`w-9` rail 与 `onToggle` / `onExpand` 双回调全部删除，开合入口统一收敛到 ActivityBar 的单个图标 toggle。
> **基线**：harness 577/577；vitest 208/208；tsc 退出码 0（均未变）。

### 一、本轮范围

把右侧「收起态窄栏」升级为常驻活动栏（`w-12`，图标常驻右缘、点击开合面板），删除原「收起 ›」控制条与 `‹` 展开按钮。固定渲染在右侧，不接设置项、不做左右切换（留轮 2b）。

### 二、核心接口与契约变更

- **新增接口**：
  - `ActivityBar`（`src/ui/layout/ActivityBar.tsx`）：入参 `isPanelOpen: boolean`、`onToggle: () => void`。用途：右侧常驻图标栏，唯一开合入口。
  - 常量 `ACTIVITY_BAR_WIDTH_CLASS = 'w-12'`。
- **修改接口（推翻轮 1）**：
  - `RightSidebar`：原入参 `isCollapsed` / `onToggle` / `onExpand` → 现**无 props**。修改原因：收起态形态移交 ActivityBar，组件只保留展开态。
  - 删除常量 `RIGHT_SIDEBAR_RAIL_WIDTH_CLASS`（宽度语义移交 `ACTIVITY_BAR_WIDTH_CLASS`）；保留 `RIGHT_SIDEBAR_WIDTH_CLASS = 'w-80'`。
  - `ThreeColumnLayout`：`handleCollapse` / `handleExpand` 合并为 `handleToggle`（`userToggledRef = true` + `setIsCollapsed(v => !v)`）。
- **DOM 契约（供 harness 依赖）**：
  - 新增 `button[title="工作日志"][aria-pressed]` 与内联 SVG（`aria-hidden="true"`）。
  - 移除 `button[title="收起日志面板"]` 与 `button[title="展开日志面板"]`。harness 无相关断言，577 全绿未变。

### 三、关键设计与做法

1. **单一开合入口**：原先「收起 ›」在面板内、「‹」在窄栏内，两处语义分裂；现在只剩图标 toggle，`aria-pressed` 同时表达状态，可被读屏识别。
2. **无依赖图标**：`package.json` 无任何图标库（dependencies 仅 mammoth / react / react-dom / zustand），按要求内联 24×24 stroke 风格 SVG（三条列表线 + 三个行首圆点），**未新增依赖**。
3. **高亮条不做绝对定位**：激活态用按钮自身的 `border-l-2 border-accent`，非激活态用 `border-l-2 border-transparent` 占位，开合时不会产生 2px 横向跳动。
4. **保留轮 1 的断点闸门**：`userToggledRef` 与 `matchMedia` 早退逻辑一行未改；`handleToggle` 只是把「置标 + 取反」合并成一个回调。

### 四、改动文件清单

| 文件 | 改动内容 | 影响范围/关联模块 |
| :--- | :--- | :--- |
| `src/ui/layout/ActivityBar.tsx` | 新增。`aside.w-12` 常驻，单个日志图标按钮（`title="工作日志"`、`aria-pressed`、内联 SVG、激活态左缘 2px 强调条）。 | 新的唯一开合入口；轮 2b 加 `position` 时在此扩展 |
| `src/ui/layout/RightSidebar.tsx` | 收缩为纯展开态：删除收起态整块与 `h-6` 控制条，props 清零，删 `RIGHT_SIDEBAR_RAIL_WIDTH_CLASS`。 | 无逻辑，纯装配；面板内部零改动 |
| `src/ui/layout/ThreeColumnLayout.tsx` | 第一行改为 `LeftColumn` + `!isCollapsed && <RightSidebar />` + `<ActivityBar />`；`handleCollapse` / `handleExpand` → `handleToggle`；注释同步。 | 开合状态机与渲染顺序；`userToggledRef` / matchMedia 未动 |

### 五、验收证据

- **tsc**：`npx tsc -b --noEmit` 退出码 0。
- **vitest**：208/208。
- **harness**：577/577，0 失败，未改任何断言。
- **关键断言/实测**：全仓检索 `RIGHT_SIDEBAR_RAIL_WIDTH_CLASS` → `src/` 内 0 命中（仅 docs 历史记录保留）；`git status --short` 本轮业务改动 3 个文件（`ActivityBar.tsx` 新增、`RightSidebar.tsx`、`ThreeColumnLayout.tsx`）；`LeftColumn.tsx` 仍显示为未跟踪，是轮 1 产物尚未提交，非本轮改动。

### 六、已知取舍与未验证

- **取舍**：
  - ActivityBar 常驻后，收起态右侧占用 36px → 48px（+12px），左列可用宽度相应减少；这是为触控目标与视觉一致性付出的代价。
  - 面板开合入口由「收起 ›」按钮改为点击图标 toggle，用户操作路径改变（需人工确认可发现性）。
  - 图标无现成库，走内联 SVG，不引入依赖。
  - 本轮固定右侧，不支持左右切换（轮 2b）。
- **未验证**：
  - 图标可发现性与 48px 触控体验未真机验证。
  - 跨断点 + 手动 toggle 的组合仍无自动化断言，靠人工目测（同轮 1）。

### 七、否决的备选方案

- **引入 `lucide-react` 取现成日志图标**：否决。为一个图标新增运行时依赖，与「离线程序、无服务端依赖」的轻量化取向冲突。
- **保留「收起 ›」按钮作为第二入口**：否决。两个入口语义重复，且会把开合状态分散到两处；单一 toggle 更符合活动栏范式。
- **用 `absolute` 画左缘高亮条**：否决。按钮自身 `border-l-2` 足以表达，绝对定位会引入额外定位上下文与层级风险。
- **把 `isCollapsed` 直接透传给 ActivityBar 而非传 `isPanelOpen`**：否决。活动栏语义是「面板是否打开」，取反放在外壳完成，避免每个消费者心里做一次反转。

