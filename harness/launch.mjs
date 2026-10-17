// LRC-Editor harness 启动壳：编排 dev server + headless Chrome + run.mjs。
// 只做编排（探活复用 / 按需启动 / 收尾回收），不重写 run.mjs 的断言逻辑。
//
// 用法：
//   npm run harness            跑全量，跑完回收「本脚本自己启动的」进程
//   npm run harness -- AX      只跑 AX 组（其余参数透传给 run.mjs）
//   npm run harness:keep       --keep-alive：不回收自起进程，供后续热复用
//
// env：LRC_DEV_PORT（默认 5177）/ LRC_CDP_PORT（默认 9333）/ LRC_CHROME（可选）
import process from 'node:process'
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const DEV_PORT = Number(process.env.LRC_DEV_PORT ?? 5177)
const CDP_PORT = Number(process.env.LRC_CDP_PORT ?? 9333)
const APP = `http://localhost:${DEV_PORT}/`
// 复用校验标记：dev server 必须返回本项目页面，避免误复用端口上的其他服务。
const TITLE_MARKER = 'LRC 歌词编辑器'

const TMP = path.join(HERE, '.tmp')
const PROFILE = path.join(TMP, 'profile')
const LOGS = path.join(TMP, 'logs')

const argv = process.argv.slice(2)
const keepAlive = argv.includes('--keep-alive')
const runArgs = argv.filter((a) => a !== '--keep-alive')

// 只记录本脚本自己启动的进程；用户手动起的 vite/chrome 一律不动。
const started = { vite: null, chrome: null }
let viteStderr = ''

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (msg) => console.log(`[launch] ${msg}`)

/* ------------------------------- Chrome 定位 ------------------------------- */
function findChrome() {
  if (process.env.LRC_CHROME && fs.existsSync(process.env.LRC_CHROME)) return process.env.LRC_CHROME
  const candidates =
    process.platform === 'win32'
      ? [
          path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'),
          path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google\\Chrome\\Application\\chrome.exe'),
          path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
        ]
      : process.platform === 'darwin'
        ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
        : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
  for (const c of candidates) if (c && fs.existsSync(c)) return c
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['chrome'], { encoding: 'utf8' })
  const line = (r.stdout || '').split(/\r?\n/).find(Boolean)
  return line && fs.existsSync(line) ? line : null
}

/* --------------------------------- 探活 --------------------------------- */
async function probeDev() {
  try {
    const res = await fetch(APP, { signal: AbortSignal.timeout(3000) })
    if (res.status !== 200) return { up: true, isApp: false }
    const body = await res.text()
    return { up: true, isApp: body.includes(TITLE_MARKER) }
  } catch {
    return { up: false, isApp: false }
  }
}

async function probeCdp() {
  try {
    const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`, { signal: AbortSignal.timeout(3000) })
    return res.ok
  } catch {
    return false
  }
}

async function waitFor(fn, timeoutMs, label) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (await fn()) return
    await sleep(300)
  }
  throw new Error(`等待超时（${label}）`)
}

/* ------------------------------ CDP 小工具 ------------------------------ */
// 抓一次页面真实状态：prewarm 超时 / run.mjs 失败 两处取证共用。
const PAGE_STATE_EXPR = `(function () {
  try {
    return {
      href: location.href,
      readyState: document.readyState,
      resCount: performance.getEntriesByType('resource').length,
      first10: performance.getEntriesByType('resource').slice(0, 10).map(function (e) { return e.name; }),
      bootError: window.__bootError || null,
    }
  } catch (e) { return { evalError: String(e) } }
})()`

// 连上当前 page target，返回 { ws, send, evalValue }；调用方负责 ws.close()。
async function openPage() {
  const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()
  const page = list.find((t) => t.type === 'page')
  if (!page) throw new Error('CDP 无 page target')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', () => reject(new Error('CDP WebSocket 连接失败')), { once: true })
  })
  let nextId = 1
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++
      const onMsg = (ev) => {
        const m = JSON.parse(ev.data)
        if (m.id !== id) return
        ws.removeEventListener('message', onMsg)
        if (m.error) reject(new Error(JSON.stringify(m.error)))
        else resolve(m.result)
      }
      ws.addEventListener('message', onMsg)
      ws.send(JSON.stringify({ id, method, params }))
    })
  const evalValue = async (expression) => {
    const r = await send('Runtime.evaluate', { returnByValue: true, expression })
    return r && r.result ? r.result.value : undefined
  }
  return { ws, send, evalValue }
}

/* --------------------------------- 预热 --------------------------------- */
// Chrome 启动即带 APP，这里只「等」应用首次加载真正跑完再交给 run.mjs。
// 只等 editorStore 出现不够：此时 Vite 依赖预构建 / 整页重载可能仍在进行，
// run.mjs 紧接着导航，BOOTSTRAP 的 8s 窗口会不够。故等「整页完成 + 网络静默」。
async function prewarm() {
  const { ws, send, evalValue } = await openPage()
  try {
    await send('Page.enable')
    const deadline = Date.now() + 30000
    let ok = false
    let lastCount = -1
    let stableSince = Date.now()
    while (Date.now() < deadline) {
      const s = await evalValue(`(function () {
        try {
          var es = performance.getEntriesByType('resource');
          return {
            readyState: document.readyState,
            resCount: es.length,
            hasEditorStore: es.some(function (e) { return e.name.indexOf('/stores/editorStore.ts') >= 0; }),
          }
        } catch (e) { return { evalError: String(e) } }
      })()`)
      if (s && typeof s.resCount === 'number') {
        if (s.resCount !== lastCount) {
          lastCount = s.resCount
          stableSince = Date.now()
        }
        // 必要条件：整页 load 完成 + editorStore 已出现 + 资源数 1.5s 不再增长
        if (s.readyState === 'complete' && s.hasEditorStore && Date.now() - stableSince >= 1500) {
          ok = true
          break
        }
      }
      await sleep(300)
    }
    if (!ok) {
      const state = await evalValue(PAGE_STATE_EXPR)
      throw new Error(
        `预热超时（30s）：页面未达「整页完成 + 网络静默 + editorStore 就绪」\n  取证: ${JSON.stringify(state, null, 2)}`,
      )
    }
    log('预热完成：整页加载完成、网络静默、editorStore 就绪')
  } finally {
    ws.close()
  }
}

// run.mjs 退出码非 0 时抓一次失败现场（在回收进程之前）。
async function dumpFailureState() {
  log('run.mjs 退出码非 0，抓取失败现场 ...')
  try {
    const { ws, send, evalValue } = await openPage()
    try {
      const state = await evalValue(PAGE_STATE_EXPR)
      let navUrl = null
      try {
        const hist = await send('Page.getNavigationHistory')
        const cur = hist && hist.entries && hist.entries[hist.currentIndex]
        navUrl = cur ? cur.url : null
      } catch {
        /* 取不到就算了 */
      }
      const blob = JSON.stringify(state && typeof state === 'object' ? { ...state, navUrl } : { state, navUrl }, null, 2)
      console.error('[launch] 失败现场：\n  ' + blob.replace(/\n/g, '\n  '))
    } finally {
      ws.close()
    }
  } catch (e) {
    console.error('[launch] 抓取失败现场时出错：', (e && e.message) || e)
  }
}

/* --------------------------------- 主流程 --------------------------------- */
async function main() {
  fs.mkdirSync(PROFILE, { recursive: true })
  fs.mkdirSync(LOGS, { recursive: true })

  // 1) dev server：能复用就复用，否则自起
  const dev = await probeDev()
  if (dev.up && dev.isApp) {
    log(`复用已运行的 dev server：${APP}`)
  } else if (dev.up && !dev.isApp) {
    throw new Error(`端口 ${DEV_PORT} 上的服务不是本项目（缺页面标记「${TITLE_MARKER}」），拒绝复用`)
  } else {
    log(`启动 dev server（端口 ${DEV_PORT}）...`)
    started.vite = spawn(
      process.execPath,
      [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(DEV_PORT), '--strictPort'],
      { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'], detached: process.platform !== 'win32' },
    )
    started.vite.stderr.on('data', (d) => {
      viteStderr = (viteStderr + d.toString()).slice(-2000)
    })
    try {
      await waitFor(async () => (await probeDev()).up, 30000, 'dev server 就绪')
    } catch (e) {
      throw new Error(`${e.message}${viteStderr ? '\n  vite stderr: ' + viteStderr.trim() : ''}`)
    }
    const after = await probeDev()
    if (!after.isApp) throw new Error(`dev server 起来了但页面缺标记「${TITLE_MARKER}」`)
    log(`dev server 就绪：${APP}`)
  }

  // 2) Chrome / CDP：能复用就复用，否则自起
  if (await probeCdp()) {
    log(`复用已运行的 CDP（端口 ${CDP_PORT}）`)
  } else {
    const chrome = findChrome()
    if (!chrome) throw new Error('未找到 Chrome，可用 LRC_CHROME 环境变量指定路径')
    log(`启动 headless Chrome：${chrome}`)
    started.chrome = spawn(
      chrome,
      [
        `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${PROFILE}`,
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        // 启动即带 APP：实测 headless 下「about:blank 启动 + CDP 二次导航」拿不到资源
        APP,
      ],
      { stdio: 'ignore', detached: process.platform !== 'win32' },
    )
    await waitFor(probeCdp, 30000, 'CDP 就绪')
    log(`CDP 就绪：127.0.0.1:${CDP_PORT}`)
  }

  // 3) 预热：先把应用首次加载跑完，避免冷启动首轮预打包重载打断 run.mjs
  await prewarm()

  // 4) run.mjs：透传筛选参数，stdout/stderr 同时 tee 到日志文件
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const logPath = path.join(LOGS, `harness-${ts}.txt`)
  const logStream = fs.createWriteStream(logPath)
  log(`跑 harness，日志 → ${path.relative(ROOT, logPath)}`)
  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(HERE, 'run.mjs'), ...runArgs], {
      cwd: ROOT,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout.on('data', (d) => {
      process.stdout.write(d)
      logStream.write(d)
    })
    child.stderr.on('data', (d) => {
      process.stderr.write(d)
      logStream.write(d)
    })
    child.on('close', (c) => resolve(c ?? 1))
  })
  logStream.end()
  // 失败取证：回收进程之前抓一次现场
  if (code !== 0) await dumpFailureState()
  return code
}

/* --------------------------------- 收尾 --------------------------------- */
function cleanup() {
  if (keepAlive) {
    log('--keep-alive：保留自起进程，供后续热复用')
    return
  }
  for (const [name, child] of Object.entries(started)) {
    if (!child || child.exitCode !== null) continue
    log(`回收自起的 ${name}（PID ${child.pid}）`)
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      try {
        process.kill(-child.pid, 'SIGTERM')
      } catch {
        try {
          child.kill('SIGTERM')
        } catch {
          /* 已退出 */
        }
      }
    }
  }
}

main()
  .then((code) => {
    cleanup()
    process.exit(code)
  })
  .catch((e) => {
    console.error('[launch] 失败：', (e && e.message) || e)
    cleanup()
    process.exit(1)
  })
