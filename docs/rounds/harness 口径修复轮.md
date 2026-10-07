# harness 口径修复轮 · 交接文档

> **用途**：记录本轮背景、根因、做法、验收、边界。
> **状态**：✅ 已闭合。基线 **428/428、0 失败**（原 424/427）；core vitest 50/50；`tsc` 退出码 0。
> **上游**：三条长期红的 harness 断言（`AO` / `AQ.B×2`）。
> **下游**：harness 基线全绿；后续轮次可在干净基线上跑。

## 一、本轮范围

把 harness 里长期红的 **3 条「零尾巴」断言**改成与产品实际行为一致的口径，使
基线回到全绿。**只改仓外 `run.mjs`**，产品源码零改动。

## 二、三条失败与根因

**三条失败**：
- `AO.被打断后停止推进 |vB-vA|<=0.5`
- `AQ.B 再按播放不瞬移 |V1-V0|<=2`
- `AQ.B 播放头跑远仍不跟随 |V2-V0|<=2`

**根因（三条同源）**：断言的基线取于滚轮后 `sleep(80)`，而滚轮 lerp
（`WHEEL_LERP=0.6`，[constants.ts](file:///d:/CodeProjects/LRC-Editor/src/ui/timeline/constants.ts)）设计上约
**100ms** 才落定 → 基线是「平滑尾巴中途」值，与落定值差 **5.5ms**。

**最强判据**：`AR` 用例断言文本与 `AQ.B` **逐字相同**却**通过**；唯一差别是
输入通道——`AR` 走滚动条拖拽 `panByPixels`（直连 1:1、无 lerp）。→ 产品机制
正确，**无 bug**，仅取样点太早。

## 三、改动（仅仓外 run.mjs）

- `testAO`：`sleep(80)` → `sleep(250)`；断言名改为
  `AO.手势后视口落定且不再推进 |vB-vA|<=0.5`（表达式不变）；保留
  `AO.停在中间位置（非终点15200）`。
- `testAQ.B`：`sleep(80)` → `sleep(250)`；**新增硬断言**
  `AQ.B 滚轮最终收敛到目标 ±3`（`12000 + (40 * 1.0)/pixelsPerMs`）；
  `|V1-V0|<=2`、`|V2-V0|<=2`、`V0>12005` 原样保留。
- `testAR` / `testAQ.A` / 其它用例 / 辅助函数：不动。

## 四、验收

- `node run.mjs` → **断言总数 428，通过 428，失败 0**（427 原有 + 新增 1 条）。
- 关键实测：`AO.手势后视口落定且不再推进` = `13679.0718 -> 13679.0718`（差 0）；
  `AQ.B 滚轮最终收敛到目标 ±3` = `12216.9197 vs 12216.9197`（完全相等）。
- `npx tsc --noEmit` → 退出码 0；`git status` 干净；HEAD 未动。

## 五、变异测试（本轮重点：证明断言有牙）

| 变异 | 目标 | 期望 | 实测 |
| :--- | :--- | :--- | :--- |
| 1 | 去 [TimelineStrip.tsx L110](file:///d:/CodeProjects/LRC-Editor/src/ui/timeline/TimelineStrip.tsx) 的 `setFollowPaused(true)` | 红 | ✅ 红：`AQ.B 播放头跑远仍不跟随 :: 12216.92 -> 17000` |
| 2 | 去 [useTimelineViewport.ts L552](file:///d:/CodeProjects/LRC-Editor/src/ui/timeline/useTimelineViewport.ts) 的 `wheelSuspendsFollow` 守卫 | 红 | ❌ 未红 |
| 3 | 去 [useTimelineViewport.ts L374](file:///d:/CodeProjects/LRC-Editor/src/ui/timeline/useTimelineViewport.ts) 的精确对齐 | 红 | ❌ 未红（残差 2.221ms < ±3） |
| 3′ | 还原精确对齐 + 阈值 0.5→6px | 红 | ❌ 未红（设计失效） |
| 决定性 | `WHEEL_MULTIPLIER` 1.0 → 0.5 | 红 | ✅ 红：`12108.4599 vs 12216.9197`（偏差 108.46ms） |

- **变异 2 未红的根因**：`wheelSuspendsFollow` 被更前位的 return 遮蔽——B 模式已置
  `followPaused=true`（L552 里 `followPaused` 先 return），AO 场景滚轮即暂停
  (`isPlaying=false`，播放不驱动 `followPlayhead`）。→ 该守卫在现有用例
  **不可判别**，非断言无牙。
- **变异 3 / 3′ 无效**：去精确对齐后误差被 settle 阈值封顶（≤0.5px ≈ 2.2ms 且可
  趋 0）→ 任何固定容差都无法稳定捕获；3′ 更因「先还原精确对齐」使阈值只决定
  「何时停循环」、不决定「停在哪」，落点恒等于目标 → 设计失效。
- **决定性变异**（位移减半 → 偏差 108ms）稳定命中红，证明**新增硬断言确有牙**。

## 六、已知取舍

- 基线取样 80 → 250ms（≈2.5× 收敛时长）；放弃「必须 ~100ms 内落定」的严格时限。
- **5.5ms 级「滚轮中途 vs 落定」瞬时差不再被立即拦截**（本非缺陷，确为放松掉的
  敏感度）。
- 容差**维持 ±3**；曾议收紧到 ±1（动机是「放大 2.2ms 残差」），随无效变异一并撤回。
- `AQ.B 滚轮最终收敛到目标 ±3` 内**硬编码 `40 * 1.0`**；若改 `WHEEL_MULTIPLIER`，
  该断言应同步更新（属测试期望值的正常联动，非隐患）。
- 变异测试为临时改 src 后立即还原；最终 src 与 HEAD 一致；本轮未提交。

## 七、未验证

- 变异 2 的守卫（`wheelSuspendsFollow`）无独立断言覆盖，本轮记挂账、未处理。
- 单次实测；未做多轮 flake 观测。

## 八、否决的备选方案

- 保留 `sleep(80)` 只调容差 → 掩盖真实取早点，否决。
- 仅放松容差、不加硬断言 → 恒绿风险，否决。
- 变异 3′ 原设计（先还原精确对齐 + 抬阈值）→ 实测失效，否决。
- 收紧 ±1 → 动机失效，撤回。

## 九、仓外注记

`run.mjs` 位于 `C:\Users\jiang\AppData\Local\Temp\lrc-cdp\`，**在仓库外、不进
git**。本轮改动不受版本控制；如需重建，以本文第三节「改动」为准。
