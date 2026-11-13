# Lyric Block Forge

[![Vite](https://img.shields.io/badge/Vite-B73BFE?style=flat-square&logo=vite&logoColor=white)](https://vitejs.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-20232A?style=flat-square&logo=react&logoColor=61DAFB)](https://react.dev/)
[![Zustand](https://img.shields.io/badge/Zustand-2C2C2C?style=flat-square&logo=react&logoColor=white)]()
[![TailwindCSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=flat-square&logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![tests](https://img.shields.io/badge/tests-717%20passed-success?style=flat-square)](#当前状态与路线图)
[![license](https://img.shields.io/badge/license-BSL%201.1-blue?style=flat-square)](LICENSE)

> 一个给歌词创作者用的离线 LRC 编辑器：把歌词当成时间轴上的**块**来拖，而不是表格里的**行**来填。

Lyric Block Forge（工程内名 `lrc-editor`）面向真正要打轴的人：看得见波形、拖得动歌词块、改得了字级切分、退得回任何一步，而且**所有数据都留在你自己的机器上**。

🌐 **在线体验**：<https://mcharliedev.github.io/lyric-block-forge/>
*(建议使用桌面端 Chrome / Edge 体验，移动端布局仍在开发中)*

---

## 📖 目录

- [为什么做这个项目](#为什么做这个项目)
- [设计哲学](#设计哲学)
- [核心亮点](#核心亮点)
- [功能一览](#功能一览)
- [技术架构](#技术架构)
- [快速开始](#快速开始)
- [当前状态与路线图](#当前状态与路线图)
- [License](#license)

---

## 为什么做这个项目

大多数 LRC 编辑器只提供一种改时间的方式：在输入框里敲时间戳。可创作者面对的是一段声音，不是一串数字。

这个项目的初衷只有一句话：**给创作者最大的方便和权限，但不替创作者做表达决定。**

- 想对齐某一句？直接拖那个块，眼睛盯着波形。
- 想微调某个字？放大到字级，拖那个字卡。
- 改错了？日志里每一条都在，可以按条撤销，也可以按类型整批回退。
- 工具发现格式有坑？它自己填平，不拿确认框骚扰你。

它刻意不做“傻瓜编辑器”：不自动猜你想怎么切分，不偷偷改你的时间戳，不在波形上盖满标记。

---

## 设计哲学

**1. 创作者管意图，工具管合法性**
畸形标签、编码残留、时间戳错位等格式缺陷静默归一化；歌词文本、时间值、切分方式等表达意图，修改前必须确认。无损的对象是创作者的“意图”，而非机器产生的“字节”。

**2. 日志是唯一真源**
所有时间修改均写入带类型的操作日志。当前状态 = 基线按顺序回放日志。撤销不删记录，只翻转状态；历史永远可见、可恢复、可追溯。

**3. 重大改变必须显式确认**
多选整组位移、清空时间、正文变更导致字级作废等破坏性操作，默认弹窗说明后果，且确认形态完全可配置。

**4. 绝对离线与隐私优先**
无账号、无服务端、无同步、无遥测。设置存本地，音频不出浏览器。

---

## 核心亮点

### 1. 时间轴上的“块级”编辑
传统编辑器把歌词当表格里的行，本编辑器将其视为时间轴上的**块**。
放大态下，一行歌词会拆成按时间锚定的**字卡（chip）**：每个字有自己的横向位置、拖拽区域和独立时间。重叠字卡阶梯错开、倒序绘制，确保极致的所见即所得。

### 2. 类型化操作日志（而非传统 Undo 栈）
`manual-timestamp`、`selection-offset`、`global-offset`、`word-segments`…… 每种操作都有独立的类型与范围。
这使得用户可以做到普通编辑器做不到的事：**按类型撤销**（例如只撤销全局偏移，保留手动打轴成果），或**按条展开、单独恢复**。

---

## 功能一览

### 📥 导入
- 支持标准 LRC、增强型 LRC（字级标签）与纯文本。
- 文件、剪贴板、手动输入三条入口。
- 双语歌词自动识别，分隔符可配置；元数据前缀（作词/作曲等）智能识别。
- 重复标签、未知标签、空行、换行符、BOM 尽量原样保留；字级时间错位静默修复。

### 🎛️ 打轴与编辑
- 空格打轴、方向键 ±10ms 微调、行级时间数值输入。
- 文本、翻译、罗马音、行注释编辑。
- **显式切分**：在字符缝隙点出切缝生成草案，每块时间可单独编辑，正文修改自动作废草案。
- 多选支持：`Ctrl/Cmd+Enter` 开关选中、`Shift+↑/↓` 范围选。

### 🌊 时间轴与波形
- 波形 / 刻度尺 / 分析轨 / 歌词轨四层共享毫秒坐标系。
- `Ctrl/Cmd + 滚轮` 以指针为锚点缩放，普通滚轮横向平移。
- 播放中视口跟随、屏外播放头箭头提示、吸附与对齐辅助线。
- 音频时钟是播放的唯一基准，拖动中每帧写 store，松手才 seek。

### 🖱️ 拖动
- 单块拖动、多选整组等量位移、字级字卡拖动、行首“推土机”拖动。
- 拖动过程零 store 写入、松手落一条日志。
- 重大改变提交前弹窗确认（可配置关闭）。

### ⏪ 日志与回退
- 工作日志面板：总 / 修改 / 报错 / 已归档 / 忽略。
- 按条撤销、恢复、批量撤销、按类型整批撤销。
- 已撤销记录灰显留痕，生命周期完整可查。

### 📤 导出
- 导出为 LRC / 增强型 LRC，只写当前可见行。
- 精度统一在导出层（两位或三位小数）。删除的行不写，未知标签原样写回。

### ⚙️ 快捷键
| 键 | 行为 |
| --- | --- |
| `Space` | 给当前行打轴 |
| `E` | 播放 / 暂停 |
| `↑` / `↓` | 移动光标到相邻可见行（重置为单选） |
| `Ctrl/Cmd + ↑ / ↓` | 移动光标，保留选区 |
| `Shift + ↑ / ↓` | 从锚点范围选到新行 |
| `Ctrl/Cmd + Enter` | 光标行加入 / 移出选区 |
| `Esc` | 清空选区，光标不动 |
| `←` / `→` | 当前行时间 ∓10ms |
| `Delete` / `Backspace` | 删除选中行 |

---

## 技术架构

项目采用**核心一套、UI 共享、平台隔离**的架构，技术栈为 **React 18 + TypeScript + Vite + Zustand + TailwindCSS**。

```text
├── src
│   ├── core        纯 TS 领域层：文档模型、解析/序列化、操作日志、纯函数
│   ├── adapters    平台端口与 Web 实现：File/Audio/Storage/Clipboard 等
│   ├── ui          React 表现层：时间轴、歌词块、日志面板、弹窗、设置
│   └── shells      外壳：web / desktop / mobile（当前仅 Web 可用）
├── docs            设计文档、迭代记录（rounds）、交接文档
├── harness         基于 CDP 的 headless UI 测试套件
└── tests           vitest 纯函数测试
```
- **时间统一**：所有时间统一为毫秒整数，只在展示层格式化。
- **单向数据流**：任何文档修改都经由操作日志，不直接改写字段。
- **无损解析**：解析/序列化尽量无损，无法识别的内容原样保留。

详细设计见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)；交接断点见 [docs/交接文档.md](docs/交接文档.md)。

---

## 快速开始

环境：Node.js 18+，npm。建议使用 Chrome / Edge（依赖 Web Audio、Canvas 与 Pointer Events）。

```bash
# 1. 克隆项目并安装依赖
npm install

# 2. 启动开发服务器
npm run dev        # http://localhost:5177
```

**常用命令：**

```bash
npm run build      # tsc -b && vite build
npm run typecheck  # 类型检查
npm test           # 运行 vitest 测试
npm run harness    # 启动 headless Chrome 跑 UI 断言
npm run deploy     # 构建并发布到 gh-pages 分支
```

(注：`npm run harness -- AX` 只跑指定断言组；`npm run harness:keep` 保留进程便于调试。)

**GitHub Pages 部署说明：**
运行 `npm run deploy` 会将 `dist/` 推送到 `gh-pages` 分支。随后在仓库 **Settings → Pages** 把 Source 设为 **Deploy from a branch**，并选择 `gh-pages` 分支的 `/root` 目录即可。生产构建自动使用子路径 `/lyric-block-forge/`。

---

## 当前状态与路线图

仍在持续开发中。已闭合的能力包括：波形时间轴、多种拖动模式、吸附与辅助线、双语与元数据识别、字级切分、工作日志与分级回退等。

**质量基线：**
- `tsc -b --noEmit` 退出码 0
- `vitest` 207 / 207 通过
- `harness` 510 / 510 通过，0 失败

**下一步计划 (Roadmap)：**

- [ ] 音频分析（频率微调、人声边界识别）
- [ ] 字级拖动的边缘自动滚动
- [ ] 移动端打轴布局（横屏大按键 + 震动反馈）

---

## License

本项目采用 **Business Source License 1.1 (BSL 1.1)**，完整条款见 [LICENSE](LICENSE)。

- **允许**：复制、修改、衍生、再分发；个人与内部使用（含生产环境）无需付费。
- **限制**：不得将本作品或其衍生作品作为商业托管/分发服务提供给第三方。
- **Change Date**：`2030-11-10`；该日起自动转为 **Apache License 2.0**。
- **商业许可**：商业使用请联系 Licensor（MCharlieDev）获取授权。

> BSL 1.1 是「源码可见」协议，不是 OSI 认证的开源协议。选择它是为了在源码透明与商业保护之间留出明确边界。

---

**Forge（锻炉）**：时间不是填进去的，是一块一块锻出来的。

```