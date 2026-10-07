# Tab 键功能轮 · 交接文档

> **用途**：合并记录「Tab 键 / 键盘导航」相关的一组子项，以及同批附带的两个
> 小项。
> **状态**：✅ 全部闭合。core vitest 50/50；`tsc` 退出码 0。
> **说明**：本档案覆盖多个先后闭合的子项，非同一次执行。

## 一、本轮范围

主项（Tab / 键盘导航）：
1. **P1 · 拖动后选中下一可见行**（引出「双当前行」问题的前置）
2. **双当前行同步（丙2）**：光标 `activeLineId` 为唯一真源，DOM 焦点跟随光标
3. **Tab 清空鼠标选中**：Tab 导航改为清空选区、只留光标
4. **键盘多选（第二轮）**：`Ctrl+↑/↓` 保选区、`Ctrl+Enter` 加减选、`Esc` 清空、
   `Shift+↑/↓` 范围选

附带小项：
5. **P4 · 滚动条去边缘自动滚**：改纯 1:1 位置映射
6. **文档欠账清理**：交接文档刷新 + 协作规程补「发货前自检」

## 二、P1 · 拖动后选中下一可见行

- 行为：**单块**拖动（未打轴 stamp / 已打轴 offset）提交后，选中该块的下一可见
  行；到末行则清空选中。**多选拖动不触发**。
- 改动：`LyricTrack.tsx` 新增 `selectNextVisibleLineAfterCommit`。

## 三、双当前行同步（丙2）

- 问题：项目里有**两个「当前行」**——选区（蓝高亮）与 DOM 焦点（黄框），二者
  从不同步。鼠标点击靠浏览器原生聚焦顺带对齐，**程序化改选区**（P1 是第一条）
  漏同步焦点，导致「看着选到下一个、空格却打上一个」。
- 方案（用户拍板「丙2」）：
  - 光标 `activeLineId` 为**唯一真源**；选区 `lineIds` 与之分离。
  - 新增 `setCursorOnly`（只挪光标、不动 `lineIds`）。
  - 焦点跟随 effect：`activeLineId` 变则把 DOM 焦点移到对应行（`preventScroll`，
    目标已是 `activeElement` 则早退防自激）。
  - 行 `onFocus` 双守卫：① 光标已在本行则早退；② 仅 `:focus-visible` 为真
    （键盘来源）才走 `setCursorOnly`，鼠标点击交给 `onClick`。
  - 去掉行默认 outline，焦点视觉由既有高亮承担。
- 改动：`editorStore.ts`、`LyricBlockPanel.tsx`。

## 四、Tab 清空鼠标选中

- 口径**变更**：Tab 由「保住多选」（丙2 首版）改为**清空全部选中**（用户最新
  拍板）。
- 实现：`setCursorOnly` 改为「清空 `lineIds` + 只留光标 + 重设 anchor」；`onFocus`
  双守卫不变。
- 分工：`Tab` / `↑↓` = 挪光标 + 清/重置选中；`Ctrl+↑/↓` = 挪光标 + 保选中。

## 五、键盘多选（第二轮）

键位矩阵（最终）：

| 键 | `activeLineId` | `lineIds` | `anchorLineId` |
| :--- | :--- | :--- | :--- |
| ↑ / ↓ | 挪到相邻可见行 | 重置为「新行」单选 | 跟到新行 |
| `Ctrl/Cmd + ↑ / ↓` | 挪到相邻可见行 | 不动 | 跟到新行 |
| `Ctrl/Cmd + Enter` | 不动 | 光标行加入 / 移出（可减到空） | 跟到光标行 |
| `Esc` | 不动 | 清空 | 跟到光标行 |
| `Shift + ↑ / ↓` | 挪到相邻可见行 | 从 anchor 范围选到新行 | 不动 |

- 新 action：`setActiveLine`、`toggleActiveLineSelection`。
- 新命令：`moveSelectionRange`、`clearSelectionKeepCursor`、`toggleCursorSelection`；
  `moveSelection` 加 `{ keepSelection }`。
- `nudgeSelection` 阈值 2→1：有选中行走集合口径（旧状态等价，新状态
  `{lineIds:[A], active:B}` 下由「动 B」改「动 A」）。
- 行 `onKeyDown` 放行带修饰键的 Enter（`Ctrl/Shift/Alt+Enter` 交给 window，纯
  Enter 仍行内 `selectLine`）。
- 改动：`editorStore.ts`、`editorCommands.ts`、`useEditorHotkeys.ts`、
  `LyricBlockPanel.tsx`。

## 六、附带小项 · P4

- 滚动条拖动去掉「边缘自动滚」（原与播放头共用内核 `startAutoPan`），改纯
  `panByPixels` 1:1 位置映射。
- 改动：`Scrollbar.tsx`。

## 七、附带小项 · 文档欠账清理

- 交接文档刷新；协作规程补「发货前自检」（三条）。

## 八、验收

- `npx tsc --noEmit` 退出码 0；core `vitest` 50/50（各子项分别验证）。
- harness 基线在各子项落地后维持 **424/427**（3 条既存失败与 Tab 无关）。
- 仓外追加断言（`b2-probe.mjs` / `b3-probe.mjs`，不改 run.mjs 矩阵）：Tab 清空、
  `Ctrl+↑/↓` 保选区、`Ctrl+Enter` 加减选、`Esc` 清空保光标、`Shift+↑/↓` 区间选、
  nudge 修正 —— 全部通过。

## 九、已知取舍

- 光标与选区**分离**；`lineIds 非空 ⇒ activeLineId 非空` 为唯一（单向）不变量。
- Tab = 清空选中；`Ctrl+↑/↓` = 保选中。两者语义不同（Delete 行为随之不同）。
- `Ctrl+Enter` 可**减到空**（与 Esc 功能重叠）。
- `Ctrl+↑/↓` **重设 anchor**（对齐鼠标 `Ctrl+click` 口径）。
- Esc **复用 `setCursorOnly`**（只调用、不改其实现）。
- `SettingsMenu` 开着时按 Esc 会清底层选区（非模态、`hasOpenDialog` 不拦；可接受）。
- 行 `onKeyDown` 放行带修饰键 Enter；纯 Enter 行为不变。
- `stampActiveLine` 打完仍 `selectLine(next)`（选区收成单选，既有行为，未动）。

## 十、未验证

- `Cmd`（macOS）路径未测；`Ctrl/Cmd` 的 meta 分流仅按代码推演。
- `:focus-visible` 仅 Chrome 实测；Firefox / Safari / 高对比度模式未测。
- 真机手感（Tab 走行观感、多选高亮对比度）。

## 十一、否决的备选方案

- 「以 DOM 焦点为真源」→ 时间轴块 `tabIndex=-1` 无法承载焦点，否决。
- 「焦点为真源 + 处处 `.focus()`」→ 双写、改动面最大、易漏，否决。
- 「Esc 复用 `clearLineSelection`」→ 会清 `activeLineId`，违背「光标不动」，否决。
- 「`Ctrl+Enter` 复用 `toggleLineSelection`」→ 减选会跳光标/清空，否决。
- 「`nudgeSelection` 另加分支不改阈值」→ 阈值直改 1 更简、旧行为等价，否决前者。

## 十二、仓外注记

行内测试辅助脚本（`b2-probe.mjs` / `b3-probe.mjs`）位于 `%TEMP%\lrc-cdp\`，
**在仓库外、不进 git**。
