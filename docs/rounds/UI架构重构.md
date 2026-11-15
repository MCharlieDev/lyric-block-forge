# UI 架构重构 · 交接文档

> **用途**：记录把主界面布局从「尺寸写死在壳里」重构为「可拆解原语」的过程。配合主交接文档阅读。
> **状态**：轮 1/3 ✅、轮 2a ✅、轮 2b ✅、轮 2c-1 ✅、轮 2c-2 ✅、轮 3a ✅、轮 3b ✅ 已闭合（移动端顶栏与播放条的结构性收口完成；下一轮 = 轮 2d 底部工具栏 / 速率音量入口）。
> **基线**：harness 588/588；core vitest 208/208；tsc 退出码 0。
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

### 补充修正：ActivityBar 宽度与圆角

> 用户真机目测反馈：常驻栏丢了圆角，且 `w-12`（48px）比内部按钮宽一圈，显得笨重。

- `ACTIVITY_BAR_WIDTH_CLASS` 由 `'w-12'` 改回 `'w-9'`（36px，即轮 1 收起态宽度），与内部图标按钮同宽。
- `aside` 补 `rounded-lg`，恢复与 `LogPanel` 卡片一致的圆角语言。
- 按钮由 `h-9 w-9` 改 `h-9 w-full`：铺满栏宽（`aside` 本身无横向 padding，按钮直达内缘），激活态 `border-l-2 border-accent` 因此贴在活动栏最左侧边缘。
- 仅 `ActivityBar.tsx` 一个文件、纯 className 改动，零业务逻辑变更；tsc 退出码 0，harness 577/577 未变。

**取舍**：36px 的点击目标低于 44px 触控建议值，换来的是与面板边框视觉对齐；若移动端（轮 3）需要更大热区，应在轮 3 用 `min-h-11` 或断点加宽单独处理，不回退本轮宽度。

## 轮次 2b：活动栏与面板可切换左右

> **状态**：✅ 已闭合。新增设置项 `sidebarPosition: 'left' | 'right'`（默认 `'right'`），`ActivityBar` 增强调条方向。
> **基线**：harness 577/577（BB 组 42/42）；vitest 208/208；tsc 退出码 0。

### 一、本轮范围

让用户把「ActivityBar + 日志面板」整组停靠到左侧：新增 `sidebarPosition` 设置项（折叠进现有 `data-settings-item`，不新增容器），`ActivityBar` 按 `side` 切换 2px 强调条方向，`ThreeColumnLayout` 按设置项镜像渲染顺序。

### 二、核心接口与契约变更

- **新增接口**：
  - `AppSettings.sidebarPosition: 'left' | 'right'`，`DEFAULT_SETTINGS.sidebarPosition = 'right'`；`normalizeSettings` 白名单回退（非 `'left'` / `'right'` → 默认 `'right'`）。
- **修改接口**：
  - `ActivityBar`：props 新增 `side: 'left' | 'right'`（必填）。`side === 'right'` 用 `border-l-2`，`side === 'left'` 用 `border-r-2`，非激活态统一 `border-transparent` 占位。
- **DOM 契约（供 harness 依赖）**：
  - `data-settings-item` **计数不变**：源码中该属性仍只有 1 处（渲染模板），运行时仍渲染 15 项——「侧栏位置」`select` 追加在 `closeDialogOnBackdropClick` 这一项内部，未新增容器。
  - `ActivityBar` 的 `button[title="工作日志"][aria-pressed]` 结构不变，仅 class 中的 `border-l-2` 变为动态拼接。

### 三、关键设计与做法

1. **折叠而非扩项**：设置面板按 `SECTIONS[].items[]` 渲染，每项一个 `data-settings-item`。新增独立 item 会让 BB 组「严格 15 项」断言变红，因此「侧栏位置」作为第三行追加进 `closeDialogOnBackdropClick` 的 control `<div>` 内，并把该项 keywords 补上「侧栏 位置 活动栏」保证可搜索。
2. **渲染顺序而非 CSS 定位**：左右切换只改第一行子节点顺序（`left` 为 `ActivityBar → RightSidebar → LeftColumn`），不引入 `order-*`、`flex-row-reverse` 或绝对定位，保持「DOM 顺序 = 视觉顺序」。
3. **强调条永远贴面板**：`side === 'right'` 时面板在活动栏左边 → `border-l-2`；`side === 'left'` 时面板在右边 → `border-r-2`。两侧都用 `border-transparent` 占位，切换与开合都不会产生 2px 跳动。
4. **开合状态跨位置保持**：`isCollapsed` 与 `userToggledRef` 都在 `ThreeColumnLayout` 顶部、与 `sidebarPosition` 无关，切位置不重置开合。
5. **暂不改名**：`LeftColumn` / `RightSidebar` 的名字与「可配置方位」冲突，本轮仅在 `LeftColumn` 注释里记挂账，等 2c / 轮 3 闭环后统一 Rename，避免干扰本轮 diff。

### 四、改动文件清单

| 文件 | 改动内容 | 影响范围/关联模块 |
| :--- | :--- | :--- |
| `src/ui/stores/settingsStore.ts` | 新增 `sidebarPosition` 字段、默认值 `'right'`、`normalizeSettings` 白名单回退。 | 设置持久化；搜索/渲染由元数据自动派生 |
| `src/ui/components/SettingsMenu.tsx` | 「界面」段首项内部追加「侧栏位置」`select`（右 / 左），该项 keywords 补「侧栏 位置 活动栏」；**未新增 `data-settings-item`**。 | 设置面板 UI 密度；15 项断言不变 |
| `src/ui/layout/ActivityBar.tsx` | props 新增 `side`；`highlightEdgeClass` 按 side 取 `border-l-2` / `border-r-2`；注释同步。 | 强调条方向 |
| `src/ui/layout/ThreeColumnLayout.tsx` | 订阅 `settings.sidebarPosition`；第一行按 side 镜像渲染三个子节点；未动 `userToggledRef` / matchMedia / `handleToggle` / 外壳 / footer。 | 布局顺序；开合状态不受影响 |
| `src/ui/layout/LeftColumn.tsx` | 仅注释 +3 行：说明语义为「主内容列」、方位可能翻转、改名留待后续。 | 无代码影响 |

### 五、验收证据

- **tsc**：`npx tsc -b --noEmit` 退出码 0。
- **vitest**：208/208，12 文件全过。
- **harness**：577/577，0 失败；**BB 组 42/42 全绿**（含「设置项严格 15 项」与重载保持类断言），证明折叠方式有效。
- **关键断言/实测**：`data-settings-item` 源码计数新增前后均为 **1**（渲染项 15 → 15）；`git status --short` 业务文件恰 **5 个**（`settingsStore.ts`、`SettingsMenu.tsx`、`ActivityBar.tsx`、`ThreeColumnLayout.tsx`、`LeftColumn.tsx`），另有 `docs/` 归档 2 项不计。

### 六、已知取舍与未验证

- **取舍**：
  - `LeftColumn` 名字与位置不符的问题记入挂账，本轮仅在注释中澄清，不做 Rename（避免干扰 diff）。
  - 新增设置项折叠进现有 `data-settings-item`，「界面」段首项从 2 行变 3 行，UI 密度增加。
  - 面板开合状态（`isCollapsed`）跨切换位置时保持，不重置。
- **未验证**：
  - 左侧停靠下的视觉观感（强调条在右缘、面板在图标右侧）未截图比对。
  - `sidebarPosition` 未加入 harness 的「重载保持」断言（本轮禁改 harness），持久化正确性仅由 `normalizeSettings` 的白名单逻辑保证。
  - 375px 窄屏 + 左侧停靠的组合未测（属轮 2c/3）。

### 七、否决的备选方案

- **新增独立 `data-settings-item` 承载「侧栏位置」**：否决。会让设置项从 15 变 16，直接打红 BB 组断言；按要求只允许折叠。
- **用 CSS `order-*` / `flex-row-reverse` 实现左右镜像**：否决。DOM 顺序与视觉顺序脱节，键盘 Tab 焦点顺序会与视觉相反，读屏也乱。
- **把 `ActivityBar` 的强调条改成 `absolute` 定位以避开 border 拼接**：否决。既有 `border-l-2` / `border-r-2` 已足够，绝对定位会引入层级与定位上下文风险（2a 已否决过同类）。
- **切换位置时重置 `isCollapsed`**：否决。用户意图是「挪位置」而非「改开合」，重置会让面板突然弹开/收起，与 2a 的尊重用户意图原则相悖。
- **本轮顺手把 `LeftColumn` 改名为 `MainColumn`**：否决。任务明确要求等 2c / 轮 3 闭环后统一改名，混入 Rename 会让本轮 diff 无法用 `git status` 的 5 文件口径验收。

## 轮次 2c-1：播放条移入主内容区 + 窄屏结构断言

> **用途**：记录窄视口（< 768px）结构切换第一刀——把播放条从布局页脚搬进主内容列、隐藏活动栏，并给 harness 补上移动端结构断言。
> **状态**：✅ 已闭合。
> **基线**：harness 583/583（BN 组 6/6、AY 组 9/9）；core vitest 208/208；tsc 退出码 0。
> **上游/依赖**：轮 2b 挂账里原规划「轮 2c = 窄视口底部抽屉（z-index < 40）」被本轮**推翻**。用户决定优先解决 375px 下播放条占住黄金位且横向溢出的问题，先把播放条移进主内容区；底部抽屉不再实施。A 段核实结论：harness 视口恒 1280×900，`(max-width: 767px)` 永远不命中，移动端分支无任何机器兜底——故本轮必须自带 BN 组。

### 一、本轮范围

窄视口下把 `PlaybackBar` 从 `ThreeColumnLayout` 的 footer 移入 `LeftColumn`（插在 `TimelineStrip` 与 `LyricBlockPanel` 之间），同时隐藏 `ActivityBar` 与 `RightSidebar`，把屏幕最底部让给歌词列表；桌面端渲染路径逐字不变。**不做任何控件压缩**——375px 下播放条内部依然横向溢出，留给 2c-2。

### 二、核心接口与契约变更

- **新增接口**：
  - `LeftColumnProps.showPlaybackBar?: boolean`（默认 `false`）。用途：由布局层告知主内容列是否要自己渲染播放条，保证全页只渲染一个 `PlaybackBar`。
  - `ThreeColumnLayout` 内部常量 `NARROW_VIEWPORT_QUERY = '(max-width: 767px)'`（不导出）。用途：窄视口结构闸门，与 `WIDE_VIEWPORT_QUERY`（管右栏开合）相互独立。
- **修改接口**：
  - `ThreeColumnLayout` 外部签名不变（仍无 props），`App.tsx` 零改动。新增内部状态 `isNarrow: boolean`（初值 `matchMedia(NARROW_VIEWPORT_QUERY).matches`）。
  - `PlaybackBar` 无签名变更，仅根节点 className 变化。
- **数据模型/类型变更**：无（未新增设置项，`AppSettings` 未动）。
- **DOM 契约（供 harness 依赖）**：
  - **`[data-volume-control]` 全页恒为 1 个实例**：窄屏由 `LeftColumn` 渲染、宽屏由 footer 渲染，二者互斥。这是本轮最核心契约，AY 组（音量滚轮走真实 CDP 坐标 + `elementAt`）依赖它。
  - 窄屏下 `button[title="工作日志"]`（ActivityBar）**不渲染**、`footer` 元素**不渲染**。
  - 宽屏下 `footer > PlaybackBar` 结构与之前一致，仅 `PlaybackBar` 根节点由 `border-t` 改为卡片式边框。

### 三、关键设计与做法

1. **JS 单实例，拒绝 CSS 双份**：不用 `hidden md:block` 之类写法，因为双份渲染会让 DOM 同时存在两个 `[data-volume-control]`，AY 组的真实坐标点击与 `querySelectorAll` 判定全面失准。改为父级按 `isNarrow` 决定由谁渲染，任何时刻只有一个 `PlaybackBar` 挂载。
2. **两个断点闸门互不覆盖**：`WIDE_VIEWPORT_QUERY`（1100px）只管右栏默认开合且受 `userToggledRef` 单向接管；`NARROW_VIEWPORT_QUERY`（768px）只管结构切换。两者各用独立 `useEffect` 监听，互不读写对方状态。
3. **高度无写死**：`TimelineStrip` 内部固定栈 160px + `WaveformLayer` 的 `flex-1` 由 ResizeObserver 实测，`LyricBlockPanel` 吃剩余高度，因此中间插入 `h-14` 播放条不会产生高度下限问题——A 段已核实，无需改任何子组件。
4. **外壳卡片化**：播放条从页脚移入列后不再是「贴底横条」，改为 `rounded-lg border border-divider bg-panel` 与 `TimelineStrip` / `LyricBlockPanel` 的卡片语言一致；`h-14 px-4 shrink-0` 保留，保证桌面端视觉高度不变。
5. **harness 视口兜底**：`reset(cdp)` 原本不重置视口（只有 `main()` 设一次 1280×900），BN 组临时切到 375×667 若异常中断会静默污染后续所有组的左右面板渲染。本轮在 `reset` 顶部补 `Emulation.setDeviceMetricsOverride(1280×900, mobile:false)`，属于验收必需的基建修复。
6. **shrink-to-fit 事实**：CDP `mobile:true` + 375px 时，因内容横向溢出，浏览器把 layout viewport 撑到实测 `innerWidth = 738`。故 BN.a 断言为 `<= 767`（证明结构分支命中）而非精确 375，避免锁定浏览器行为细节。

### 四、改动文件清单

| 文件 | 改动内容 | 影响范围/关联模块 |
| :--- | :--- | :--- |
| `src/ui/layout/ThreeColumnLayout.tsx` | 新增 `NARROW_VIEWPORT_QUERY` + `isNarrow` 状态 + 独立 `matchMedia` effect；渲染改用 `LeftColumn showPlaybackBar={isNarrow}`、`{!isNarrow && !isCollapsed && <RightSidebar />}`、`{!isNarrow && <ActivityBar … />}`、`{!isNarrow && <footer><PlaybackBar /></footer>}`。 | 窄屏结构切换；桌面路径不变 |
| `src/ui/layout/LeftColumn.tsx` | 新增 `LeftColumnProps.showPlaybackBar?: boolean`；引入 `PlaybackBar`；在 `TimelineStrip` 与 `LyricBlockPanel` 之间条件渲染。 | 主内容列装配；窄屏播放条宿主 |
| `src/ui/components/PlaybackBar.tsx` | 仅根节点 className：`border-t border-divider` → `rounded-lg border border-divider bg-panel`（保留 `flex h-14 shrink-0 items-center gap-4 px-4`）。 | 视觉外壳；内部控件与滚轮 effect 零改动 |
| `harness/run.mjs` | `reset(cdp)` 顶部补 1280×900 视口兜底；TESTS 末尾新增 `testBN`（try/finally，finally 恢复桌面视口 + sleep 100ms，再断回页底）+ BN 组 6 条。 | 测试基建 + 移动端结构断言 |

### 五、验收证据

- **tsc**：`npx tsc -b --noEmit` 退出码 0。
- **vitest**：208/208，12 文件全过。
- **harness**：583/583，0 失败（旧 577 + BN 组 6 条）；**AY 组 9/9 通过**（音量滚轮未受单实例改动影响）；BN 组 6/6 通过。
- **关键断言/实测**：窄屏 `innerWidth = 738 ≤ 767`；`[title="工作日志"]` 为 `null`；含 `[data-volume-control]` 的 footer 计数 0；`[data-volume-control]` 计数 1；`volTop 390.17 < lyricTop 438.42`；恢复桌面后 footer `rect.bottom = 888`，`|900 − 888| = 12 ≤ 20`。`git status --short` 业务文件恰 **4 个**（`ThreeColumnLayout.tsx`、`LeftColumn.tsx`、`PlaybackBar.tsx`、`harness/run.mjs`），`docs/` 归档不计。

### 六、已知取舍与未验证

- **取舍**：
  - 移动端隐藏 `ActivityBar` 后，手机端**没有日志面板入口**（日志在手机上暂时不可用）。
  - 375px 下移入 `LeftColumn` 的播放条**内部依然横向溢出**，需 2c-2 解决（本轮刻意不压缩，避免一次改动混两件事）。
  - 播放条不再常驻屏幕最底部，桌面端视觉高度因此减少 56px（页脚槽位整体让给主内容列内部分配）。
  - 播放条与 `sidebarPosition = 'left'` 组合时，跟随主内容列跑到右下侧（不是屏幕底部）。
  - BN 组只断言「结构存在性与相对位置」，不断言任何交互（375px 下控件溢出，坐标点击不可靠）。
  - `reset(cdp)` 的视口兜底修正会影响所有后续组的稳定性（属正向修复）。
- **未验证**：
  - 移动端真机渲染与触控体验未测（无真机，仅 CDP 模拟）。
  - 窄屏断点跨越时（拖窗口 768 ↔ 767）的实时切换未做自动化断言，仅逻辑上由 `matchMedia change` 保证。
  - 窄屏 + `sidebarPosition = 'left'` 的组合未单独断言。

### 七、否决的备选方案

- **CSS 双份渲染（`hidden md:block` 包两份 `PlaybackBar`）**：否决。会同时挂载两个 `[data-volume-control]`，AY 组的真实坐标点击与 `querySelectorAll` 判定全面失准；且两份 `useEffect` 会重复注册 wheel 监听。
- **把播放条做成窄屏底部抽屉（原「轮 2c」规划）**：推翻并否决。抽屉仍占底部黄金位，且引入 overlay 层级与 z-index 契约（须 < 40 避开 `LineActionSheet` / `ConfirmDialog`），成本高于收益。
- **本轮顺手压缩播放条控件以消除 375px 溢出**：否决。任务明确拆分——结构迁移与控件压缩分两轮，混在一轮会让 diff 与回归面失控。
- **给 `PlaybackBar` 加 `isNarrow` prop 自行隐藏部分控件**：否决。会让纯展示组件开始感知视口，破坏「布局层决定结构、组件层只管内容」的分层。
- **在 BN 组里断言精确 `innerWidth === 375`**：否决。shrink-to-fit 会把它撑到 738，锁定该数值等于锁定浏览器实现细节；只断言 `≤ 767` 足以证明结构分支命中。

## 补充修正：轮次 2c-2（播放条极窄屏瘦身止血）

> **用途**：接续轮 2c-1 的「播放条入列」，解决 375px 下播放条内部横向溢出的止血问题。
> **状态**：✅ 已闭合。
> **基线**：harness 583/583（BN 6/6、AY 9/9）；core vitest 208/208；tsc 退出码 0。
> **上游/依赖**：轮 2c-1 已把 `PlaybackBar` 移入 `LeftColumn`，但明确「内部控件零改动、375px 仍溢出」；本轮只做控件瘦身，不改结构。

### 一、本轮范围

在 `< 768px` 下隐藏次要控件（速率、音量、音频文件名、`未加载音频` 占位），缩短时间读数并只保留当前时间，让进度条独占弹性宽度，从而消除播放条内部的横向溢出。**纯 Tailwind 响应式类名，零逻辑改动**，不引入 hook / 新组件，不动 harness。

### 二、核心接口与契约变更

- **新增接口**：无（`PlaybackBar` 仍无 props）。
- **修改接口**：无（函数签名、状态、`data-volume-control` 标记全部不变）。
- **数据模型/类型变更**：无。
- **DOM 契约（供 harness 依赖）**：
  - `[data-volume-control]` 在窄屏下**仍存在于 DOM，但 `display:none`**（`hidden md:flex`）。因此 BN.d 的「计数 === 1」仍成立；AY 组在 1280px 下依然可见可点。
  - 新增类名契约：速率 / 音量 label 含 `hidden` + `md:flex`；文件名 `hidden` + `md:block`；`未加载音频` 占位 `hidden` + `md:inline`；时间读数的 ` / 总时长` 段 `hidden` + `md:inline`。

### 三、关键设计与做法

1. **只做显隐与宽度，不动逻辑**：所有改动均为 className 字符串，`onClick` / `onChange` / `useEffect` / `formatDuration` 调用零改动，避免回归。
2. **断点对齐**：使用 Tailwind `md:`（`min-width: 768px`），与 `ThreeColumnLayout` 的 `(max-width: 767px)` 结构闸门边界互补，同一像素点不会出现「结构已切窄屏、控件还是桌面版」的错档。
3. **时间读数瘦身**：窄屏 `w-[90px]` + `text-[11px]`，并把 ` / 总时长` 整体 `hidden md:inline`——保留当前播放时间这一核心信息，去掉总时长。`00:00.000` 在 11px 等宽字体下约 59px，90px 足够。
4. **进度条唯一弹性项**：其余可见项全部 `shrink-0` 固定宽，进度条保持 `min-w-0 flex-1`，由它吸收剩余宽度，任何固定项都不会被压变形。
5. **溢出兜底**：根节点补 `overflow-hidden`，即使未来某个子项加宽也只会被裁切，不会再撑出横向滚动条把整个页面 layout viewport 撑宽。
6. **间距收窄**：根节点 `gap-4` → `gap-2 md:gap-4`，窄屏省下 24px，把余量让给进度条（375px 下约 77px）。

### 四、改动文件清单

| 文件 | 改动内容 | 影响范围/关联模块 |
| :--- | :--- | :--- |
| `src/ui/components/PlaybackBar.tsx` | 根节点 `gap-2 md:gap-4` + `overflow-hidden`；播放 / 打轴按钮 `w-16 md:w-20`；时间读数 `w-[90px] text-[11px] md:w-40 md:text-xs`；` / 总时长` 段 `hidden md:inline`；速率 / 音量 label `hidden … md:flex`；文件名 `hidden … md:block`；`未加载音频` `hidden … md:inline`。 | 仅播放条内部排版；桌面端 ≥768px 视觉不变 |

### 五、验收证据

- **tsc**：`npx tsc -b --noEmit` 退出码 0。
- **vitest**：208/208（本轮未触碰逻辑）。
- **harness**：583/583，0 失败；**BN 6/6**、**AY 9/9** 未红（桌面端 1280px 控件仍可见，坐标点击与 `querySelectorAll` 均不受影响）。
- **关键算术**：375px 下布局可用宽 = 375 − 24（外层 `p-3`）= 351，播放条内容宽 = 351 − 32（`px-4`）= 319；窄屏固定项 = 64 + 64 + 90 + 8×3 = 242 < 319，进度条获得约 77px，无横向溢出。
- **`git status --short`**：本轮业务文件仅 `src/ui/components/PlaybackBar.tsx` 新增改动（轮 2c-1 的 3 个业务文件尚未提交，仍在工作区）。

### 六、已知取舍与未验证

- **取舍**：
  - 移动端隐藏速率与音量，用户在移动端无法调整这两项（规划在 2d 轮次移入底部工具栏）。
  - 移动端隐藏文件名，用户无法在播放条确认当前音频名。
  - 移动端隐藏总时长，只能看到当前时间。
  - 通过 CSS 隐藏（`hidden md:flex`），DOM 仍存在：不影响桌面端 `querySelector` 与坐标点击，但意味着「窄屏下 `[data-volume-control]` 仍可被脚本查到、只是不可见」。
- **未验证**：
  - 无浏览器内实测的 `scrollWidth` 数字——硬边界禁止新增探针 / 断言，本轮只能给 CSS 算术证明 + 人工目测。
  - BN.a 的 `innerWidth` 仍为 738（与 2c-1 相同），说明页面级溢出另有来源（推断为顶栏，属轮 3），本轮未单独验证。
  - 320px 等更窄设备未预估优化（固定项 242 + gap 24 = 266，接近 320px 可用宽 264 的临界）。
  - 真机渲染未测。

### 七、否决的备选方案

- **用 `useMediaQuery` hook / `isNarrow` prop 条件渲染控件**：否决。任务明确要求纯 CSS 显隐，且会让展示组件感知视口。
- **把速率 / 音量改成图标按钮保留在窄屏**：否决。属 2d「底部工具栏 + 半屏面板」的范围，本轮只做止血。
- **给时间读数写 `truncate` 而不是隐藏总时长**：否决。`truncate` 会切出半个字符（如 `00:12.3`），信息更差；直接隐藏 `/ 总时长` 更干净。
- **只靠 `overflow-hidden` 裁切而不隐藏控件**：否决。控件会被切掉一半，既不可用又难看。
- **调整 `px-4` / 按钮 `px-3` 内边距来挤空间**：否决。省下的像素有限（不足 20px），且会改变桌面端视觉，收益不如隐藏整块次要控件。

## 轮次 3a：顶栏移动端折叠 + `⋯` 菜单

> **状态**：✅ 已闭合。
> **基线**：harness 583/583；core vitest 208/208；tsc 退出码 0。
> **上游/依赖**：轮 2c-2 收尾时记录「BN.a 的 `innerWidth` 仍为 738，页面级溢出另有来源（推断为顶栏）」；轮 3 A 段核实用逐段测量确认顶栏最小内容宽约 850px（字号估算）/ 实测 layout viewport 被撑到 738，并列出 harness 对顶栏的硬依赖清单（`导入音频` 14 处真实坐标点击，`导入 LRC` / `导入 LRC / 文本 / Word` / `手动输入` / `设置` 走文本匹配点击）。

## 一、本轮范围

把顶栏在 `<768px` 折叠：两个桌面控件组整组 `display:none`，新增窄屏 `⋯` 入口与面板接管全部入口（导入三入口 / 导出 / 导入音频 / 设置），使 375px 下页面不再横向溢出。

## 二、核心接口与契约变更

- **新增接口（`SettingsMenu`）**：
  - `SettingsMenuProps`：`open?: boolean`、`onOpenChange?: (open: boolean) => void`、`hideTrigger?: boolean`、`panelAlign?: 'left' | 'right'`，全部可选，**不传即为原自管行为**。
  - `SettingsMenu` 组件签名：`export function SettingsMenu({ open: controlledOpen, onOpenChange, hideTrigger = false, panelAlign = 'left' }: SettingsMenuProps = {})`。
- **修改接口**：
  - `SettingsMenu` 的 `open` 由内部 `useState` 改为「受控 / 非受控双模」：`controlledOpen !== undefined` 为准，否则用内部 `uncontrolledOpen`；`setOpen(next)` 统一收口（非受控时写内部状态，受控时调 `onOpenChange`）。触发按钮 `onClick` 由 `setOpen(v => !v)` 改为 `setOpen(!open)`。
- **数据模型/类型变更**：无。
- **DOM 契约**：
  - 新增窄屏入口按钮 `title="更多"`、文案 `⋯`，容器 `md:hidden`。
  - 窄屏面板为 `w-48`、`absolute right-0 top-full z-20`，配 `fixed inset-0 z-10` 遮罩；条目**仅在 `moreMenuOpen` 为真时渲染**（关闭时不进 DOM）。
  - 两个桌面控件组容器补 `hidden … md:flex`，桌面端 DOM 与文字零变化；桌面 `<SettingsMenu />` 未传任何 props，DOM 不变。

## 三、关键设计与做法

1. **CSS 折叠而非 JS 条件渲染**：harness 在 1280px 下运行，所有依赖顶栏的坐标点击与文本匹配必须保持原样，因此桌面控件一律 `display:none`（DOM 保留），窄屏入口用 `md:hidden` 反向显隐。
2. **防文本重复命中**：`⋯` 面板的 `导入 LRC / 文本 / Word`、`手动输入`、`导入音频`、`设置` 与桌面同名。若面板常驻 DOM，`clickButtonText`（取首个匹配、`.click()` 对 `display:none` 也生效）可能命中隐藏副本。故全部条目**条件渲染**，关闭时不在 DOM。
3. **导入做成二级内联展开**：点「导入歌词…」展开三个缩进条目（`moreImportOpen`），而非 hover 子菜单——触屏无 hover，内联展开只用一个 `useState`，且每次重开 `⋯` 都复位为收起。
4. **设置面板复用而非重写**：窄屏再挂一个 `SettingsMenu`，以 `hideTrigger` 不渲染自带按钮，由 `⋯` 的「设置」条目受控打开；`panelAlign="right"` 让 `w-72`（288px）面板贴右缘，在 375px 视口内不溢出（左对齐会从 `⋯` 位置向右撑出屏幕）。桌面实例保持无 props 的原用法，行为与 DOM 零变化。
5. **关闭路径齐全**：点遮罩（`fixed inset-0 z-10` 的透明 button）关闭、点任一条目先关菜单再执行动作、Esc 由 `moreMenuOpen` 驱动的 `keydown` effect 关闭；`⋯` 按钮本身也走 `setMoreMenuOpen(!open)`。

## 四、改动文件清单

| 文件 | 改动内容 | 影响范围/关联模块 |
| :--- | :--- | :--- |
| `src/ui/App.tsx:66-70` | 新增 `moreMenuOpen` / `moreImportOpen` / `mobileSettingsOpen` 三个 state | 窄屏菜单开合、二级展开复位、受控设置面板 |
| `src/ui/App.tsx:109-116` | 新增 Esc 关闭的 `keydown` effect（依赖 `moreMenuOpen`） | 窄屏菜单键盘关闭 |
| `src/ui/App.tsx:246-248` | 新增 `moreSubItemClass`（二级条目左缩进样式） | 仅窄屏菜单视觉 |
| `src/ui/App.tsx:269` | 右侧组 1 容器 `ml-auto flex shrink-0 items-center gap-2` → 追加 `hidden … md:flex` | 桌面端零视觉变化，窄屏整组隐藏 |
| `src/ui/App.tsx:337` | 右侧组 2 容器 `ml-auto flex items-center gap-2` → 追加 `hidden … md:flex` | 窄屏「分级回退 / 按类型撤销 / 日志数」整组隐藏 |
| `src/ui/App.tsx:368-482` | 新增 `md:hidden` 的 `⋯` 入口 + 条件渲染面板（导入二级三项 / 导出 LRC / 导入音频 / 设置）+ 受控 `SettingsMenu` 实例 | 窄屏全部顶栏入口；桌面端因 `md:hidden` 不参与布局 |
| `src/ui/components/SettingsMenu.tsx:424-432` | 新增可选 `SettingsMenuProps`（`open` / `onOpenChange` / `hideTrigger` / `panelAlign`） | 桌面端不传即旧行为 |
| `src/ui/components/SettingsMenu.tsx:442-460` | 受控 / 非受控双模：`uncontrolledOpen` + `controlled` + 统一 `setOpen` | 桌面自管逻辑等价 |
| `src/ui/components/SettingsMenu.tsx:481-494` | 触发按钮包进 `hideTrigger ? null : (...)`，`onClick` 改 `setOpen(!open)` | 窄屏不渲染重复「设置」按钮，规避文本匹配歧义 |
| `src/ui/components/SettingsMenu.tsx:503-506` | 面板类名 `left-0` → 按 `panelAlign` 取 `left-0` / `right-0` | 窄屏右对齐防溢出 |

## 五、验收证据

- **tsc**：`npx tsc -b --noEmit` 退出码 0。
- **vitest**：208/208（本轮未触碰逻辑与核心模块）。
- **harness**：583/583，0 失败；重点组全部未红——BH 13/13（`导入 LRC` / `手动输入` 文本点击）、BM 2/2（`导入 LRC / 文本 / Word`）、所有含 `setupAudio` 的 14 处 `导入音频` 坐标点击（AL~AY）、AY 9/9 与 BB（`设置` 文本点击 + 15 项 `data-settings-item` 集合）。
- **关键实测**：`BN.a` 的 `window.innerWidth` 由轮 2c-1/2c-2 的 **738 → 375**。CDP `mobile:true` + 375px 下 layout viewport 会被内容撑宽（shrink-to-fit），因此该数字等价于「内容最小宽度 ≤ 375，不再溢出」；本轮 harness 一行未改，属对既有断言的自然观测。
- **`git status --short`**：本轮业务文件 2 个（`src/ui/App.tsx`、`src/ui/components/SettingsMenu.tsx`）；`PlaybackBar.tsx` / `LeftColumn.tsx` / `ThreeColumnLayout.tsx` / `harness/run.mjs` 为 2c-1、2c-2 的未提交存量；`docs/` 变更属归档（豁免条款）。

## 六、已知取舍与未验证

- **取舍**：
  - 移动端整组隐藏「分级回退 / 撤销该类型全部记录」，手机端无法按类型回退（单条撤销仍可用）。
  - 移动端「共 N 条日志」不可见（日志面板在手机端本就无入口）。
  - 「设置 / 导入 / 导出 / 导入音频」在移动端多一次点击。
  - 桌面控件用 `display:none` 而非卸载，DOM 中存在两套入口文本；靠「窄屏条目条件渲染」规避 `clickButtonText` 命中隐藏副本。
  - `SettingsMenu` 由单态变为受控 / 非受控双模；桌面端未传 props，等价于旧行为。
  - 窄屏多挂一个 `SettingsMenu` 实例（只为复用面板），它在桌面端被 `md:hidden` 隐藏且不渲染触发按钮。
  - 「导入歌词…」采用二级内联展开而非 hover 子菜单：触屏无 hover，内联展开只需一个 `useState`。
- **未验证**：
  - 375px 下 `document.documentElement.scrollWidth` 未用探针直接测量（硬边界禁止改 harness）；只有 `innerWidth = 375` 这一间接等价证据。
  - `⋯` 菜单的点选贯通、遮罩/ Esc 关闭、`panelAlign="right"` 的视觉贴合，均未经自动化交互测试，留人工目测。
  - 320px 等更窄机型未预估；焦点顺序 / Tab 是否合理进入 `⋯` 面板未测。

## 七、否决的备选方案

- **用 `isNarrow` / `useMediaQuery` 条件渲染桌面控件组**：否决。会让 1280px 下 DOM 结构随视口变化，且顶栏属 App 层，引入断点状态与 `ThreeColumnLayout` 的闸门语义重复。
- **把 `⋯` 面板常驻 DOM、仅用 CSS 显隐**：否决。`clickButtonText` 对 `display:none` 元素仍会命中并 `.click()`，桌面测试会点到隐藏副本（尤其 `导入音频` 被 14 处坐标点击依赖）。
- **直接把 `SettingsMenu` 的内部 `open` 状态提升到 App、桌面也改为受控**：否决。桌面端需额外传 props 并重排触发按钮位置，DOM 变化风险大于收益；改为「可选 props + 默认旧行为」。
- **抽独立的 `MoreMenu.tsx` 组件**：否决。本轮只有一处使用、状态与 `App` 的三个 handler 强耦合，抽出去要再透传 5 个回调，收益不足；等 2d 底部工具栏出现第二处入口再抽。
- **把「分级回退」也搬进 `⋯` 菜单**：否决。整套回退依赖 `pendingKind` 的 `<select>` 与禁用态联动，塞进窄面板会做成一坨不可用的控件；移动端按类型回退留待后续专门设计。

## 轮次 3b：播放条窄屏高度压缩 + 顶栏折叠回归锁

> **状态**：✅ 已闭合。
> **基线**：harness 588/588（BN 11/11）；core vitest 208/208；tsc 退出码 0。
> **上游/依赖**：轮 3a 已把顶栏在窄屏折叠为 `⋯` 菜单（BN.a 的 `innerWidth` 由 738 → 375），但这些行为当时靠人工目测，没有任何 harness 断言兜底；同时 2c-2 瘦身后的播放条仍是 `h-14`（56px），在 375px 纵向空间里偏厚。

### 一、本轮范围

两件事：① 播放条窄屏高度 56px（`h-14`）压到 40px（`h-10`），桌面保持 56px；② 为轮 3a 的顶栏折叠补 5 条 harness 回归锁（layout viewport 未被撑宽、`⋯` 菜单关闭时入口不进 DOM、点开可见、Esc 关闭）。

### 二、核心接口与契约变更（极其重要）

- **新增接口**：无。
- **修改接口**：无（`PlaybackBar` 仍是零 props 组件）。
- **数据模型/类型变更**：无。
- **DOM 契约（供 harness 依赖）**：
  - 播放条根节点新增响应式高度：窄屏 `h-10`（40px）、`md:` 起 `h-14`（56px）。子结构、`data-volume-control`、`title="播放/暂停（E）"` / `title="打轴（空格）"` 全部未变。
  - 依赖 3a 既有契约：`button[title="更多"]` 为窄屏 `⋯` 入口；其面板条目**条件渲染**，关闭时不在 DOM。
  - harness 新增的判定方式：`getClientRects().length > 0` 判「有渲染盒（可见）」，DOM 存在性用 `querySelectorAll('button')` + `textContent` **前缀**匹配。

### 三、关键设计与做法

1. **高度只改根节点，不动子元素**：`h-14` → `h-10 md:h-14` 是唯一业务改动。逐一核查子元素后确认无人显式写超高：播放 / 打轴按钮 `px-3 py-1 text-xs`（约 24px 高）、时间 `text-[11px]`、进度条 `input[type=range]` 走 flex 居中、速率 / 音量 / 文件名 / `未加载音频` 在窄屏本就是 `hidden md:*`。故 40px 下无需任何子元素 padding 调整，也没有加 `overflow-hidden` 之外的裁剪处理（`overflow-hidden` 是 2c-2 就有的）。
2. **`BN.h` 的口径调整（任务书原文与 3a 设计冲突）**：任务书要求「四个入口文本在 DOM 中不存在」，但 3a 的桌面控件组在窄屏是 `display:none`、**DOM 仍在**，字面实现必然红。因此 `BN.h` 断言的是「四入口**不可见**」（`visible.length === 0`），另拆 `BN.h.2` 只锁菜单**专属**文案「导入歌词…」（它在桌面控件组里不存在，只在 `⋯` 面板出现）确实不在 DOM，等价覆盖了「不能被改成 CSS 隐藏」的意图。
3. **前缀匹配而非全等**：「导入歌词…」按钮的 `textContent` 实际是 `导入歌词…▸`（含展开箭头 span），首版用全等匹配导致 `BN.h.2` / `BN.j` 空转（永远命中不到、断言恒真）。改为 `t.indexOf(texts[k]) === 0` 后，`BN.i` 打印出的 `visible` 为 `["导入歌词…▸","导出 LRC","导入音频","设置"]`，四入口齐全。
4. **点击不依赖文本探针**：`⋯` 按钮文案只有一个 `⋯` 字形，`clickButtonText` 按文本匹配不可靠，直接用 `document.querySelector('[title="更多"]').click()` 的 eval 完成点击，未新增任何 `__lrc` 探针。
5. **Esc 走既有 `keyPress` 工具**：复用 harness 顶层 `keyPress(cdp, 'Escape', 'Escape', 27)`（`Input.dispatchKeyEvent` 的 `rawKeyDown` + `keyUp`），与 3a 里 `window` 上的 `keydown` 监听路径一致；点击与按键后各 `sleep(150)` 等 React 提交。

### 四、改动文件清单

| 文件 | 改动内容 | 影响范围/关联模块 |
| :--- | :--- | :--- |
| `src/ui/components/PlaybackBar.tsx:78` | 根节点 `flex h-14 shrink-0 …` → `flex h-10 shrink-0 … md:h-14 md:gap-4`（`h-14` 保留在 `md:` 上） | 窄屏播放条 56px → 40px；桌面零变化；内部控件零改动 |
| `harness/run.mjs:4552-4571` | 新增 `MORE_TEXTS` 常量与 `scanMoreEntries` 扫描器（区分 `visible` / `all`，前缀匹配） | 仅 BN 组内使用 |
| `harness/run.mjs:4626-4670` | 新增 `BN.g` / `BN.h` / `BN.h.2` / `BN.i` / `BN.j` 五条断言 | 断言总数 583 → 588；既有断言零改动 |
| `harness/run.mjs:4774` | TESTS 里 BN 组描述补「顶栏折叠回归锁」 | 仅测试报告文案 |

### 五、验收证据

- **tsc**：`npx tsc -b --noEmit` 退出码 0。
- **vitest**：208/208（12 个文件）。
- **harness**：588/588，0 失败。BN 11/11（原 6 条 + 新增 5 条）；其中 `BN.a` 的 `innerWidth` 实测 **375**（3a 前为 738）。AY 9/9（音量坐标点击）、BM 2/2（Word 导入冒烟）、BL 14/14 均未红。
- **关键实测**：`BN.g` 通过说明 `mobile:true` + 375px 下 layout viewport 未被内容撑宽（shrink-to-fit 已解除）；`BN.h` 的 `visible` 为空、`BN.h.2` 命中不到「导入歌词…」说明关闭态的 `⋯` 条目确实不在 DOM；`BN.i` / `BN.j` 一开一关证明点击与 Esc 两条路径都通。
- **`git status --short`**：本轮业务文件恰 2 个（`src/ui/components/PlaybackBar.tsx`、`harness/run.mjs`）。同屏另有 `App.tsx` / `SettingsMenu.tsx` / `LeftColumn.tsx` / `ThreeColumnLayout.tsx` 为 2c-1 / 2c-2 / 3a 的未提交存量，非本轮改动。

### 六、已知取舍与未验证

- **取舍**：
  - 窄屏播放条 40px 低于 44px 触控建议值；播放 / 打轴按钮仍是 `py-1` 小控件，未专门放大热区（放大反而会撑破 40px）。
  - `BN.g` 用 `innerWidth <= 380` 而非精确 375，留 5px 容差，避免不同 Chromium 版本的亚像素 / 滚动条差异导致假红。
  - `BN.h` / `BN.i` 只断言「文本可见 / 不存在」，不断言菜单样式、层级与二级展开；视觉贴合仍靠人工。
  - 桌面播放条高度不变（`md:h-14`），AY 组的音量坐标点击不受影响。
  - 为规避 3a 的「桌面控件组 DOM 常驻」事实，`BN.h` 语义由「不存在」调整为「不可见」并拆出 `BN.h.2` 补救，属对任务书口径的主动偏离（已在交付中说明）。
- **未验证**：40px 下按钮 / 时间 / 进度条的视觉舒适度与是否拥挤，未真机目测；`⋯` 菜单的开合仅证到「渲染盒存在与否」，未测动画、焦点顺序与二级展开；320px 等更窄机型未测。

### 七、否决的备选方案

- **按任务书字面写「四入口完全不在 DOM」**：否决。窄屏下桌面控件组只是 `display:none`，DOM 一定存在，断言会永久红；改用「不可见 + 菜单专属文案不在 DOM」的等价口径。
- **`BN.g` 精确断言 `innerWidth === 375`**：否决。亚像素与滚动条实现差异会带来假红，5px 容差足够区分「375」与「738」两种状态。
- **给 `__lrc` 新增 `openMoreMenu()` / `getMoreEntries()` 探针**：否决。任务书明令不新增探针，且 `querySelector('[title="更多"]').click()` 一行 eval 已够用。
- **用 `clickButtonText('⋯')` 点开菜单**：否决。按钮内除 `⋯` 外还有开合态样式差异，文本匹配脆弱；`title="更多"` 是 3a 已定的稳定契约。
- **把 `scanMoreEntries` 抽成 harness 顶层公共函数**：否决。当前只有 BN 组一处使用，抽出会让字符串拼接式 eval 多一层间接；等出现第二处再抽。




