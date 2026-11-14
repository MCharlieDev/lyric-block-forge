# Word 导入（纯文本解析）· 交接文档

> **用途**：记录 Word 导入两轮拆分的背景、做法、验收与边界。配合主交接文档阅读。
> **状态**：轮 1、轮 2 均已闭合。
> **基线**：harness 577/577（轮 2 后）；core vitest 208/208；`npx tsc -b --noEmit` 退出码 0。
> **上游/依赖**：A 段核实「导入与识别现状核实」结论——四个识别器全部已接线，唯一缺口是 Word/.docx 文件通道；`.docx` 为 ZIP 容器，需引入 `mammoth` 才能前端离线解析。

## 一、本轮范围

只做底层端口与类型：让 `FilePort` 的文本读取能把 `.docx` 解析成纯文本、并把「二进制容器没有文本编码」这件事如实体现在类型上。**不接 UI 菜单、不改 `accept`、不碰 harness。**

## 二、核心接口与契约变更（极其重要）

- **修改接口**：
  - `TextFileContent.encoding`：原 `string` → 现 `string | null`。修改原因：`.docx` 是二进制容器，没有文本编码；用 `utf-8` 冒充会让「导入预设回写编码」拿到假值。
    - 说明：任务书写「从 `'utf-8' | 'gbk'` 扩展」，但真实代码是 `string`，且 `decodeBuffer` 会返回 `utf-8` / `utf-16le` / `utf-16be` / `gbk`，收窄成字面量联合会误伤 UTF-16 分支，故按放宽处理。
  - `ParseOptions.encoding`（`parse.ts:23`）：`string` → `string | null`。`null` 表示二进制容器，`undefined` 仍回落 `utf-8`。
  - `LyricFormatInfo.encoding`（`document.ts:45`）：`string` → `string | null`，与解析入口对齐。
  - `App.tsx:122` `applyTextImport` 第三参：`encoding?: string` → `encoding?: string | null`。仅类型放宽，逻辑零改动。
- **新增接口（适配层内部，不导出）**：
  - `isDocxFile(file: File): boolean`（`web/file.ts:70`）：扩展名大小写不敏感判定。
  - `readDocxText(file: File): Promise<string>`（`web/file.ts:83`）：动态 `import('mammoth')` + `extractRawText({ arrayBuffer })`，返回纯文本。
- **数据模型/类型变更**：见上三条。
- **DOM 契约（供 harness 依赖）**：无变更。

## 三、关键设计与做法

1. **解析器按需加载**：`readDocxText` 内 `await import('mammoth')`，Vite 打包后 mammoth 落在独立 chunk（`index-*.js` 312.37 kB / gzip 99.44 kB），主包 304.33 kB / gzip 98.54 kB 不受影响。只有用户真正选中 `.docx` 才会下载该 chunk。
2. **编码语义不撒谎**：`.docx` 分支返回 `encoding: null`；`parse.ts` 把原来的 `options.encoding ?? 'utf-8'` 改为「仅 `undefined` 回落 `utf-8`」，否则 `null` 会被 `??` 吞掉、又变回 `utf-8`。
3. **`readText` 同源处理**：`readText(ref)`（按引用重读）也走 `isDocxFile` 分支。否则「最近文件 / 恢复副本」路径会把 docx 二进制当文本解码成乱码——这是本轮引入的必然连带面，留在同一文件内修掉。
4. **错误透传**：`readDocxText` 不捕获异常，由 `openTextFile` 的调用方（`App.handleImportLrc`）现有 `try/catch` 转 toast，避免两层错误文案。
5. **文件数偏差**（必须记录）：执行清单写 4 个文件，实际动了 5 个 `src/` 文件 —— `document.ts` 由清单第 4.3 条「同步修正 format 类型」授权；`App.tsx` 是端口契约放宽后的强制连带（`TextFileContent.encoding` 为 `string | null` 时，原签名 `encoding?: string` 无法通过 tsc），只改一行类型。另 `package-lock.json` 由 `npm install` 自动更新。

## 四、改动文件清单

| 文件 | 改动内容 | 影响范围/关联模块 |
| :--- | :--- | :--- |
| `package.json:19` | 新增 `"mammoth": "^1.13.0"` | 仅 `.docx` 懒加载 chunk 使用 |
| `package-lock.json` | `npm install` 自动生成 | 依赖锁定 |
| `src/adapters/ports/file.ts:49-54` | `encoding` 放宽为 `string \| null` + JSDoc 说明二进制容器 | 所有 `FilePort` 实现与调用方；`App.tsx` 受牵连 |
| `src/adapters/web/file.ts:70-88` | 新增 `isDocxFile` / `readDocxText`（动态 import mammoth） | 只在 `.docx` 分支生效 |
| `src/adapters/web/file.ts:158-161` | `openTextFile` 按扩展名分派：docx → mammoth，其余 → `decodeBuffer` | 文本导入主路径 |
| `src/adapters/web/file.ts:176-179` | `readText` 同样分派，避免按引用重读退化成二进制解码 | 最近文件 / 恢复副本（尚未实现，先埋正） |
| `src/core/lyrics/parse.ts:18-23` | `ParseOptions.encoding` 允许 `null` | 解析入口契约 |
| `src/core/lyrics/parse.ts:592-594` | `?? 'utf-8'` 改为「仅 `undefined` 回落」 | `format.encoding` 写入值 |
| `src/core/types/document.ts:39-45` | `LyricFormatInfo.encoding` 允许 `null` | 文档模型；导出层仅注释引用、无读取 |
| `src/ui/App.tsx:118-122` | `applyTextImport` 第三参类型放宽（含 JSDoc 一句） | 三条导入入口共用的唯一管道，逻辑未动 |

## 五、验收证据

- **tsc**：`npx tsc -b --noEmit` 退出码 0。
- **vitest**：207/207 通过，零新增用例（见「已知取舍」第 2 条）。
- **harness**：本轮未运行（未碰 `harness/`，沿用上一轮 575/575）。
- **构建**：`npx vite build` 成功；mammoth 落在独立 chunk（312.37 kB / gzip 99.44 kB），主包 304.33 kB / gzip 98.54 kB。
- **动态导入形态**：`node --input-type=module -e "await import('mammoth')"` 输出 `named: function`，即 ESM 互操作下 `mammoth.extractRawText` 可直接取到（Vite / esbuild 与 Node 的 CJS 命名导出探测行为一致）。
- **改动文件**：`git status --short` 为 5 个 `src/` 文件 + `package.json` + `package-lock.json` + `docs/交接文档.md`（归档豁免）。

## 六、已知取舍与未验证

- **取舍 1（任务书要求）**：`mammoth` 已引入但 UI 尚未露出，属"死代码"阶段——`LRC_FILTER` 仍为 `['lrc','txt']`（`App.tsx:23`），用户选不到 `.docx`，等轮 2 接线。
- **取舍 2**：未补 `encoding: null` 的 parse 单测，以守住业务文件数量；该行为目前只由类型与代码路径保证，见「未验证」。
- **取舍 3**：只支持 `.docx`，不支持老 `.doc` 二进制、加密文档；mammoth 对图片/文本框/页眉页脚只做丢弃或 best-effort。
- **未验证 1**：`format.encoding` 允许 `null` 后，下游导出层（LRC/TXT）对 `null` 的容忍度未验证。已确认 `serialize.ts` 不读 `document.format.encoding`（仅 `SerializeOptions.encoding` 注释提及），但导出 UI 与回写路径未实测。
- **未验证 2**：`parseLrc({ encoding: null })` 的实际返回未跑单测。
- **未验证 3**：真实 Word 文档（中文、表格、文本框、脚注、批注）的 `extractRawText` 结果未人工目测；`.docx` 在浏览器中的真实选择路径未跑（`accept` 未包含 docx，UI 层无法触发）。
- **未验证 4**：`.doc` 与加密 docx 的报错文案。

## 七、否决的备选方案

- **收窄为 `'utf-8' | 'gbk' | null`**：任务书原文写法，但会把 `decodeBuffer` 返回的 `utf-16le` / `utf-16be` 判成类型错误，且现有 `ports/file.ts` 本就是 `string`，收窄属于额外的行为收严，否决。
- **在 `App.tsx` 保持 `encoding?: string`、docx 分支返回 `encoding: ''`**：能少改一个文件，但等于把"没有编码"伪装成空字符串，后续导入预设回写会拿到脏值，与任务目标相悖，否决。
- **静态 `import mammoth from 'mammoth'`**：会让所有用户首屏加载 ~100 kB gzip 的解析器，否决；改为 `.docx` 分支内动态 import。
- **把 docx 解析独立成 `src/adapters/web/docx.ts`**：分层更干净，但本轮文件数已超线，且逻辑不足 20 行，留在 `web/file.ts` 内更符合最小改动。

## 八、轮次 2 待办（已在轮次 2 执行；端到端未做）

1. `App.tsx:23` `LRC_FILTER.extensions` 加 `'docx'`，菜单文案改为「导入 LRC / 文本 / Word」。**已执行**（✅ 见轮次 2）。
2. `harness/run.mjs`：文本导入按钮坐标探针 + Node 侧生成最小 `.docx` fixture（`zlib.deflateRaw` 手搓 zip）+ `Page.fileChooserOpened` → `DOM.setFileInputFiles` 端到端断言（行数 / 首行文本 / 是否带时间戳）。**未执行**：改为 BM 组只断 `accept` 含 `.docx`；端到端留人工目测（成本 / 收益不划算）。
3. 可选：`TextImportDialog` 增加"也支持 .docx 文件"提示（不新增入口）。**未执行**（任务书未列入）。

## 轮次 2：UI 接线与无时间戳双语行为锁定

> **状态**：✅ 已闭合。
> **基线**：harness 577/577；core vitest 208/208；`npx tsc -b --noEmit` 退出码 0。
> **上游/依赖**：轮 1 底层端口已支持 `.docx`；A 段核实结论——无时间戳行在 `bilingual.ts:144` 因「时间戳数量 ≠ 1」直接判不可合并，行为安全。

### 一、本轮范围

把轮 1 的死代码接到 UI：文件过滤器扩展 `.docx`、菜单文案更新；并用一条 vitest 用例锁住「Word 导入的无时间戳中英交替不会被双语合并」这一语义。完全不动 `bilingual.ts` / `parse.ts`。

### 二、核心接口与契约变更

- **新增接口**：无。
- **修改接口**：无（函数签名、Props、常量一个未动）。
- **数据模型/类型变更**：无。
- **DOM 契约（供 harness 依赖）**：
  - 菜单按钮文案：`导入 LRC 文件` → `导入 LRC / 文本 / Word`（`App.tsx:279`）。
  - 文本导入隐藏 `<input type="file">` 的 `accept`：`.lrc,.txt` → `.lrc,.txt,.docx`（由 `toAccept` 动态生成，无第二处硬编码）。

### 三、关键设计与做法

1. **过滤器是唯一开关**：`web/file.ts` 的 `toAccept` 从 `filters.extensions` 动态拼 `accept`，所以只改 `LRC_FILTER` 一处，`<input>` 就自动放行 `.docx`。
2. **行为先核实、再锁定**：`parse.ts:496` 给无时间戳内容行 `timestamps: []`，`isMergeablePair` 的「双方恰好 1 个行级时间戳」在 `bilingual.ts:144` 直接 false → 不会合并。新增用例同时断 `lines.length === 2`、两条 `translation` 均 `undefined`、往返文本一致，防止未来放宽该条件时静默回归。
3. **harness 只断 UI 契约**：真实点击菜单项 → `pickFile` 挂到 body 的隐藏 input → 读 `accept`，断言含 `.docx` / `.lrc` / `.txt`；不手搓 zip fixture，避免为一条冒烟引入脆弱二进制构造。
4. **清理**：BM 组结束移除本次创建的隐藏 input（`pickFile` 仍等待 `change`，页面重载即弃），不影响后续组（BM 为最后一组）。

### 四、改动文件清单

| 文件 | 改动内容 | 影响范围/关联模块 |
| :--- | :--- | :--- |
| `src/ui/App.tsx` | `:23` `LRC_FILTER.extensions` 加 `'docx'`；`:279` 文案改「导入 LRC / 文本 / Word」 | 文本导入入口；`accept` 经 `toAccept` 自动生效 |
| `tests/lyrics/roundtrip.test.ts` | 末尾新增 describe「双语无时间戳（Word 导入行为）」+ 1 条用例 | 锁 `bilingual.ts` 的无时间戳分支语义 |
| `harness/run.mjs` | 新增 `testBM` 与 TESTS 注册（BM 2 条断言） | UI 接线冒烟；不新增探针 |

### 五、验收证据

- **tsc**：`npx tsc -b --noEmit` 退出码 0。
- **vitest**：208/208 通过（roundtrip 62 → 63；其余分组不变）。
- **harness**：577/577 通过（旧 575 + BM 2）；BM.b 实测 `accept = ".lrc,.txt,.docx"`。
- **改动文件**：本轮实际编辑恰 3 个文件；但轮 1 的 6 个业务文件尚未提交，故 `git status --short` 累计 9 个业务文件（`package.json` / `package-lock.json` / `ports/file.ts` / `web/file.ts` / `parse.ts` / `document.ts` + 本轮 3 个）。

### 六、已知取舍与未验证

- **取舍 1**：无时间戳双语不合并是「安全默认」；若未来产品希望合并（无时间锚点也能配对），需另立轮次并新增开关，不能直接改 `isMergeablePair`。
- **取舍 2**：端到端 `.docx` 上传未做 harness 断言（需手搓 zip fixture），只断 `accept` 属性，真实解析效果靠人工目测。
- **取舍 3**：双语合并逻辑本轮零改动（`bilingual.ts` / `parse.ts` 未碰）。
- **未验证 1**：真实 Word 文件（中文 / 表格 / 文本框）经 mammoth 的解析结果未人工目测。
- **未验证 2**：浏览器文件对话框对 `.docx` 的实际过滤与放行行为未实测。
- **未验证 3**：损坏 `.docx` 的报错路径（mammoth 抛错 → toast）未实测。

### 七、否决的备选方案

- **在轮 2 内改 `bilingual.ts` 支持无时间戳合并**：无时间锚点只能靠顺序与脚本交替猜测，单语段落会误判；且需新设置项与默认值决策，超出「UI 接线 + 行为锁定」范围，否决。
- **harness 手搓最小 `.docx` 做端到端上传**：`zlib.deflateRaw` + zip 结构 + `[Content_Types].xml` 等样板代码量大、脆弱，收益仅覆盖「解析成功」这一条，改为人工目测，否决。
- **只改菜单文案不改 `extensions`**：用户仍选不到 `.docx`，等于没接线，否决。
- **顺手修 `serialize.ts:5` 的 JSDoc（声称沿用 `format.encoding` 但实现不读）**：与轮 2 目标无关，避免污染 diff，留作可选挂账。
