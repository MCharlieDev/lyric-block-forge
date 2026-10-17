# harness 迁入仓内 · B 段-2（含冷启动修正 1 / 修正 2） · 交接文档

> **用途**：记录本轮的背景、做法、验收与边界。配合主交接文档阅读。
> **状态**：✅ 已闭合（代码未提交）。
> **基线**：harness 444/444（0 失败）；core vitest 55/55；`tsc -b --noEmit` 退出码 0。
> **上游/依赖**：B 段-1 已把仓外 `%TEMP%\lrc-cdp\` 的 5 个 harness 文件原样导入仓库 `harness/` 并单独提交（`e5e0232`），仓内外 SHA256 一致；本轮在同一基线上加启动壳并打通冷启动。

## 一、本轮范围

把「手工先起 dev server + 手工起 headless Chrome + 手工跑 run.mjs」收敛为一条命令 `npm run harness`：新增 `harness/launch.mjs` 只做编排（起服务、预热、跑断言、回收、失败取证），不改 run.mjs 的任何断言逻辑。

## 二、核心接口与契约变更（极其重要）

- **新增接口**：
  - `npm run harness`：无入参，跑完自动回收 vite / chrome；退出码 = run.mjs 退出码（失败取证后仍返回原码）。用途：一键验收。
  - `npm run harness:keep`：等价于 `node harness/launch.mjs --keep-alive`；保留 vite / chrome 进程便于手工连 CDP 调试。用途：排障。
  - `harness/launch.mjs::openPage()`（模块内私有）：无入参，返回 `{ ws, send, evalValue }`；`send(method, params)` 直连 CDP，`evalValue(expression)` 返回 `Runtime.evaluate` 的 `result.value`。用途：prewarm 轮询与失败取证共用同一套 CDP 小工具。
  - `harness/launch.mjs::prewarm()`（模块内私有）：无入参，无返回；超时抛错（错误信息内嵌页面取证）。用途：等首屏真正稳定，避免 run.mjs 自己导航时撞上 Vite 预构建整页重载。
  - `harness/launch.mjs::dumpFailureState()`（模块内私有）：无入参；向 stderr 打印失败现场。用途：run.mjs 退出码非 0 时保留证据。
- **修改接口**：
  - `harness/run.mjs` 顶部常量：`PORT = 9333` → `Number(process.env.LRC_CDP_PORT ?? 9333)`；`APP = 'http://localhost:5177/'` → `` `http://localhost:${process.env.LRC_DEV_PORT ?? 5177}/` ``。修改原因：端口可参数化，验收可用 5277/9433 隔离，不干扰常驻的 5177/9333。
- **数据模型/类型变更**：
  - 无（未触碰 `src/` 任何类型）。
- **DOM 契约（供 harness 依赖）**：
  - 无新增/移除。launch.mjs 依赖既有事实：`performance.getEntriesByType('resource')` 中存在 `/stores/editorStore.ts`，以及 `window.__bootError` / `window.__bootReady`。

## 三、关键设计与做法

1. **只加壳、不复制断言**：`launch.mjs` 不内联任何断言，仅 spawn `node harness/run.mjs <args>` 并把 stdout/stderr tee 到 `harness/.tmp/logs/harness-<ts>.txt`；筛选参数原样透传（`npm run harness -- AX` → `run.mjs AX`）。
2. **服务编排**：先探 dev 端口（占用则复用），否则 `spawn(process.execPath, ['node_modules/vite/bin/vite.js','--port',DEV_PORT,'--strictPort'])`；再探 CDP（`/json/version`），否则按平台找 Chrome 并以 `--headless=new --remote-debugging-port=<CDP_PORT> --user-data-dir=harness/.tmp/profile` 启动。
3. **冷启动根因与修法（修正 2）**：
   - 现象：`run.mjs` 在 `waitReady()` 抛 `FATAL Error: editorStore module url not found`，exit 2。
   - 根因：prewarm 只等「editorStore 出现」就返回，但此时 Vite 依赖预打包会触发整页重载；run.mjs 紧接着 `Page.navigate(?clean=)`，其注入的 BOOTSTRAP 只有 8s 的 `find()` 窗口，重载把 window 上的资源条目与模块解析过程冲掉，窗口内找不到 editorStore。
   - 修法：prewarm 返回条件升级为三合一 —— `document.readyState === 'complete'` + `resource` 条目数量连续 ~1.5s 不增长 + 出现 `/stores/editorStore.ts`；总上限 30s，超时抛错并附取证。
4. **Chrome 启动即带 APP（修正 1 的结论）**：实测 headless 下「`about:blank` 启动 + CDP `Page.navigate(APP)`」的资源条目里始终没有 editorStore；改回启动参数末尾直接带 APP，prewarm 只等待、不再导航。
5. **Vite watcher 与 Chrome profile 冲突**：Chrome 的 `--user-data-dir` 落在 `harness/.tmp/profile`，被 Vite watcher 扫描会抛 EBUSY 打崩 dev server；`watch.ignored` 中绝对路径必须带 `**/` 前缀，故由 `'harness/.tmp/**'` 改为 `'**/harness/.tmp/**'`。
6. **失败取证**：run.mjs 退出码非 0 时，在回收进程之前连一次 CDP，打印 `href` / `readyState` / resource 数量 / 前 10 个 resource 名 / `window.__bootError`，并尽力附 `Page.getNavigationHistory` 当前项 URL。取证失败本身不覆盖原退出码。
7. **进程回收**：Windows 用 `taskkill /PID <pid> /T /F` 收整棵进程树；*nix 用 `detached` 进程组 `process.kill(-pid)`；`--keep-alive` 时整体跳过；`finally` 里注册，异常路径也回收。
8. **隔离验收端口**：全程用 `LRC_DEV_PORT=5277` / `LRC_CDP_PORT=9433` 跑，避免动到常驻 5177/9333。

## 四、改动文件清单

| 文件 | 改动内容 | 影响范围/关联模块 |
| :--- | :--- | :--- |
| `harness/launch.mjs` | **新增**。编排 vite / Chrome / run.mjs；prewarm 三合一等待；失败取证；进程回收；`--keep-alive` | 仅验收工具链，不进入运行时产物 |
| `harness/run.mjs` | 顶部 2 行常量改为读 `LRC_CDP_PORT` / `LRC_DEV_PORT`（默认值不变） | 端口可参数化；断言逻辑与探针零改动 |
| `package.json` | `scripts` 新增 `harness` / `harness:keep` | 一键验收入口 |
| `vite.config.ts` | `watch.ignored` 追加 `'**/harness/.tmp/**'` | 防止 Chrome profile 触发 dev server EBUSY / 整页重载 |
| `harness/.tmp/**` | 运行时生成（profile / logs），已 gitignore | 不进版本库 |
| `.gitignore` | 工作区**既有**未提交改动（`.trae/`、`.context/`），非本轮产生 | 与本轮无关，记录以免误判 |

## 五、验收证据

- **tsc**：`npx tsc -b --noEmit` → 退出码 0。
- **vitest**：`npx vitest run` → Test Files 2 passed / Tests **55 passed (55)**。
- **harness**：**444/444，0 失败**。重点确认：
  - 冷启动 #1（5277/9433）：`断言总数 444，通过 444，失败 0`，`EXIT=0`，日志含 `预热完成：整页加载完成、网络静默、editorStore 就绪`，并回收 vite PID 25280 / chrome PID 17892。
  - 冷启动 #2（紧接重跑）：`444/444/0`，`EXIT=0`，回收 vite PID 31776 / chrome PID 10640 —— 证明可重复。
  - 筛选透传 `npm run harness -- AX`：仅 `=== AX ===` 组 `10/10`，汇总 10/10/0，`EXIT=0`。
- **现场清理**：5277 / 9433 / 5177 均无 Listen，chrome 进程数 0。
- **工作区**：`git status --short` 为 ` M .gitignore`、` M harness/run.mjs`、` M package.json`、` M vite.config.ts`、`?? harness/launch.mjs`（本轮未 commit）。
- **注意**：Trae sandbox 对 Chrome SetupMetrics / GoogleUpdater / Recent 路径会报 "hit restricted"，可能使外层报告非 0 退出码；权威结果以重定向文件末尾 `EXIT=0` 与 `断言总数 444，通过 444，失败 0` 为准。

## 六、已知取舍与未验证

- **取舍**：`launch.mjs` 只做编排，不复制 run.mjs 的断言与探针 —— 避免两份真源漂移；代价是启动链路多一层，问题定位需同时看 launch 日志与 run.mjs 输出。
- **取舍**：prewarm 用「资源数 1.5s 不增长」作为网络静默判据，属于近似；冷启动失败时要等满 30s 才报错，失败暴露变慢。
- **取舍**：端口参数化只落在 run.mjs 两个常量与 launch.mjs，未做 CLI flag；使用 env 变量（Windows PowerShell 写法 `$env:LRC_DEV_PORT='5277'`）。
- **取舍**：复用已占用的 dev / CDP 端口（探针通过即复用），不做强制独占；好处是可接已在跑的服务，代价是可能接错实例。
- **未验证**：macOS / Linux 的进程组回收路径（`detached` + `kill(-pid)`）仅代码推演，未真机跑。
- **未验证**：非默认 Chrome 安装路径（`findChrome()` 的候选列表之外）未测。
- **未验证**：`--keep-alive` 长期驻留后的重复跑稳定性未做长时压测（仅单次验证）。
- **未提交**：本轮按指令不 commit；`harness/launch.mjs` 仍为 untracked。

## 七、否决的备选方案

- **否决：在 `launch.mjs` 内重写/内联断言**。会让断言出现两份真源，日后口径修复（如 AO / AQ.B×2）必须改两处，违反「同口径」原则。
- **否决：`about:blank` 启动 + CDP 二次导航后再跑**。真机实测该路径下资源条目里始终没有 editorStore，headless 行为与预期不符；改为启动即带 APP 后稳定。
- **否决：用固定 `sleep(3000)` 等首屏**。机器差异与依赖预构建耗时不可控，属于赌时间；改用「readyState + 资源静默 + editorStore」三条件判定。
- **否决：删掉 prewarm、只把 run.mjs 的 `find()` 8s 窗口调大**。那会改动 run.mjs 的断言/引导逻辑，超出「只加壳」边界，且掩盖冷启动根因。
