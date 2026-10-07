// 时间轴末端语义 · B 段 —— 追加断言（仓外独立脚本，不修改 run.mjs 既有矩阵）
//
// 运行前置：
//   - dev server 在 http://localhost:5177/ 已就绪
//   - headless Chrome 调试口 9333 已就绪
// 运行： node endtail-assert.mjs
//
// 断言：
//   ① 无音频启动态 viewInfo().durationMs（demo 内容 25920）—— 报实测值
//   ①b 清空歌词文档（removeLines）后的真正空态 durationMs === 10000（验 MIN=5000 下限）
//   ② 有音频（60s）时把播放头拖到尾巴区（61000ms）松手，playheadX() 反算时间 ≈ 目标，而非音频末尾
//   ③ 松手后 底部读数(store) 与 竖线(playheadX) 一致；端口 audioTimeMs() 被夹在音频末尾（已知边界）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = 9333
const APP = 'http://localhost:5177/'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const J = (v) => JSON.stringify(v)

const HERE = path.dirname(fileURLToPath(import.meta.url))
const RUN_SRC = fs.readFileSync(path.join(HERE, 'run.mjs'), 'utf8')

/** 从 run.mjs 文本抽取 `const NAME = \`...\`` 模板字面量（以行首反引号收尾）。 */
function extractTemplate(src, name) {
  const marker = `const ${name} = \``
  const i = src.indexOf(marker)
  if (i < 0) throw new Error('template not found: ' + name)
  const start = i + marker.length
  const end = src.indexOf('\n`', start)
  if (end < 0) throw new Error('template end not found: ' + name)
  return src.slice(start, end)
}

const BOOTSTRAP = extractTemplate(RUN_SRC, 'BOOTSTRAP')
const CLOCK_BOOTSTRAP = extractTemplate(RUN_SRC, 'CLOCK_BOOTSTRAP')

/* ----------------------------- CDP client ----------------------------- */
class Client {
  constructor(ws) {
    this.ws = ws
    this.nextId = 1
    this.waiters = new Map()
    this.eventWaiters = new Map()
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id !== undefined) {
        const w = this.waiters.get(msg.id)
        if (w) {
          this.waiters.delete(msg.id)
          if (msg.error) w.reject(new Error(JSON.stringify(msg.error)))
          else w.resolve(msg.result)
        }
      } else if (msg.method) {
        const list = this.eventWaiters.get(msg.method)
        if (list && list.length) list.shift().resolve(msg.params)
      }
    })
  }
  send(method, params = {}) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.waiters.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  waitEvent(method, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const list = this.eventWaiters.get(method) ?? []
      list.push({ resolve })
      this.eventWaiters.set(method, list)
      setTimeout(() => reject(new Error('timeout waiting ' + method)), timeoutMs)
    })
  }
}

async function connect() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
  const targets = await res.json()
  const page = targets.find((t) => t.type === 'page')
  if (!page) throw new Error('no page target on ' + PORT)
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })
  return new Client(ws)
}

async function ev(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) {
    throw new Error('eval error: ' + (r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)))
  }
  return r.result.value
}

function mouse(cdp, type, x, y, o = {}) {
  return cdp.send('Input.dispatchMouseEvent', {
    type, x, y,
    button: o.button ?? 'left',
    buttons: o.buttons ?? (type === 'mouseReleased' ? 0 : 1),
    clickCount: o.clickCount ?? 1,
    modifiers: o.modifiers ?? 0,
    pointerType: 'mouse',
  })
}
const pressAt = (cdp, x, y) => mouse(cdp, 'mousePressed', x, y, { buttons: 1 })
const moveTo = (cdp, x, y) => mouse(cdp, 'mouseMoved', x, y, { buttons: 1, button: 'left' })
const releaseAt = (cdp, x, y) => mouse(cdp, 'mouseReleased', x, y, { buttons: 0 })

/* ------------------------------- WAV ------------------------------- */
const WAV_PATH = path.join(HERE, 'silence-60s.wav')
function ensureSilenceWav() {
  fs.mkdirSync(path.dirname(WAV_PATH), { recursive: true })
  if (fs.existsSync(WAV_PATH) && fs.statSync(WAV_PATH).size > 44) return WAV_PATH
  const sampleRate = 8000, channels = 1, bits = 16
  const dataSize = sampleRate * 60 * channels * (bits / 8)
  const buf = Buffer.alloc(44 + dataSize)
  buf.write('RIFF', 0, 'ascii')
  buf.writeUInt32LE(36 + dataSize, 4)
  buf.write('WAVE', 8, 'ascii')
  buf.write('fmt ', 12, 'ascii')
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(channels, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * channels * (bits / 8), 28)
  buf.writeUInt16LE(channels * (bits / 8), 32)
  buf.writeUInt16LE(bits, 34)
  buf.write('data', 36, 'ascii')
  buf.writeUInt32LE(dataSize, 40)
  fs.writeFileSync(WAV_PATH, buf)
  return WAV_PATH
}

async function importAudio(cdp) {
  ensureSilenceWav()
  const rect = await ev(cdp, '__lrc.importAudioButtonRect()')
  if (!rect) throw new Error('import audio button not found')
  const x = Math.round(rect.x), y = Math.round(rect.y)
  const chooser = cdp.waitEvent('Page.fileChooserOpened', 12000).catch(() => null)
  await mouse(cdp, 'mousePressed', x, y, { buttons: 1 })
  await mouse(cdp, 'mouseReleased', x, y, { buttons: 0 })
  const params = await chooser
  if (params && params.backendNodeId) {
    await cdp.send('DOM.setFileInputFiles', { files: [WAV_PATH], backendNodeId: params.backendNodeId })
    return 'chooser'
  }
  const doc = await cdp.send('DOM.getDocument', { depth: -1 })
  const q = await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[type=file]' })
  if (!q || !q.nodeId) throw new Error('no file input for fallback')
  await cdp.send('DOM.setFileInputFiles', { files: [WAV_PATH], nodeId: q.nodeId })
  return 'fallback'
}

async function waitAudioReady(cdp, timeoutMs = 12000) {
  const t0 = Date.now()
  let dur = 0
  while (Date.now() - t0 < timeoutMs) {
    dur = await ev(cdp, '__lrc.audioDurationMs()')
    if (typeof dur === 'number' && dur > 0) break
    await sleep(100)
  }
  if (!(dur > 0)) throw new Error('audio duration not ready')
  const t1 = Date.now()
  while (Date.now() - t1 < timeoutMs) {
    const st = await ev(cdp, '__lrc.peakState()')
    if (st === 'ready') return dur
    if (st === 'error') throw new Error('peak build error')
    await sleep(100)
  }
  throw new Error('peak build timeout')
}

async function waitReady(cdp) {
  for (let i = 0; i < 400; i++) {
    let s
    try {
      s = await ev(cdp, 'window.__bootError ? ("err:" + window.__bootError) : (window.__bootReady === true ? "ready" : "wait")')
    } catch { s = 'wait' }
    if (s === 'ready') return
    if (typeof s === 'string' && s.startsWith('err:')) throw new Error(s)
    await sleep(50)
  }
  throw new Error('boot timeout')
}

async function reset(cdp) {
  const loaded = cdp.waitEvent('Page.loadEventFired').catch(() => {})
  await cdp.send('Page.navigate', { url: APP + '?assert=' + Date.now() })
  await loaded
  await waitReady(cdp)
  await sleep(160)
}

const checks = []
function assert(name, cond, detail = '') {
  checks.push({ name, ok: !!cond, detail })
}

async function main() {
  const cdp = await connect()
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: CLOCK_BOOTSTRAP })
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: BOOTSTRAP })
  await cdp.send('DOM.enable')
  await cdp.send('Page.setInterceptFileChooserDialog', { enabled: true })

  await cdp.send('Page.navigate', { url: APP + '?clean=' + Date.now() })
  await cdp.waitEvent('Page.loadEventFired').catch(() => {})
  await waitReady(cdp)
  await ev(cdp, `localStorage.removeItem('lrc-editor:lrc-editor/settings')`)
  await reset(cdp)

  // ---------- ① 无音频启动态 durationMs（demo 内容 25920）----------
  const boot = await ev(cdp, '__lrc.viewInfo()')
  const bootDur = boot ? boot.durationMs : null
  assert('①无音频启动 durationMs 实测', typeof bootDur === 'number', String(bootDur))
  console.log(`  [INFO] 无音频启动 durationMs = ${bootDur}ms  (旧 MIN=30000 → 35000；新 MIN=5000 → max(25920,5000)+5000 = 30920)`)

  // ---------- ①b 真正空态（removeLines 清空歌词）→ MIN=5000 下限 ----------
  const ids = await ev(cdp, '__lrc.ids()')
  await ev(cdp, `__lrc.store.getState().removeLines(${J(ids)})`)
  await sleep(200)
  const empty = await ev(cdp, '__lrc.viewInfo()')
  const emptyDur = empty ? empty.durationMs : null
  assert('①b 空文档 durationMs === 10000（MIN 5000 + 尾 5000）', emptyDur === 10000, `${emptyDur}（ids 数=${(await ev(cdp, '__lrc.ids()')).length}）`)

  // ---------- ② + ③ 有音频时拖播放头到尾巴区 ----------
  await reset(cdp)
  const audioDur = await importAudio(cdp) && await waitAudioReady(cdp)
  assert('②前置 音频时长 ≈ 60000', Math.abs(audioDur - 60000) <= 200, String(audioDur))

  await ev(cdp, '__lrc.pauseAudio()')
  await ev(cdp, '__lrc.seekAudio(0)')
  await sleep(80)

  const info = await ev(cdp, '__lrc.viewInfo()')
  const durationMs = info.durationMs
  assert('②前置 时间轴时长 = 音频 60000 + 尾 5000 = 65000', durationMs === 65000, String(durationMs))

  // 让整条时间轴入屏（fit）；startMs=0
  await ev(cdp, `__lrc.setView(0, ${durationMs})`)
  await sleep(120)
  const after = await ev(cdp, '__lrc.viewInfo()')
  const ppms = after.pixelsPerMs
  const startMs = after.startMs
  const W = after.viewportWidthPx
  const rr = await ev(cdp, '__lrc.rulerRect()')
  assert('②前置 尺子几何可用', !!rr && rr.width > 0 && Math.abs(rr.width - W) < 2, J({ rrW: rr && rr.width, W }))

  const TARGET_MS = 61000 // 尾巴区（> 音频 60000）
  const targetX = rr.left + (TARGET_MS - startMs) * ppms
  const EDGE = 48
  assert('②前置 目标点避开 48px 边缘带', targetX > rr.left + EDGE && targetX < rr.right - EDGE,
    `targetX=${targetX.toFixed(1)} strip=[${rr.left.toFixed(1)}, ${rr.right.toFixed(1)}]`)

  // 拖动：先在尺子上按下（起点偏左），再移到目标 x，最后在目标 x 松手
  const startX = Math.round(rr.left + rr.width * 0.5)
  const y = Math.round(rr.y)
  await pressAt(cdp, startX, y)
  await sleep(30)
  await moveTo(cdp, Math.round(targetX), y)
  await sleep(30)
  await releaseAt(cdp, Math.round(targetX), y)
  await sleep(150)

  // ② 竖线反算时间（scoped 探针：只取播放头元素 —— class 同时含
  //    will-change-transform 与 w-0；避免命中 LyricTrack 的 pan 层）
  const px = await ev(cdp, `(() => {
    const els = document.querySelectorAll('div.will-change-transform');
    for (const el of els) {
      const t = el.style.transform || '';
      if (t.indexOf('translate3d') === 0 && (el.className || '').indexOf('w-0') >= 0) {
        return parseFloat(t.slice(t.indexOf('(') + 1));
      }
    }
    return null;
  })()`)
  const lineMs = px === null ? null : px / ppms + startMs
  assert('②竖线反算时间 ≈ 尾巴目标 61000（未被夹回音频末尾）',
    typeof lineMs === 'number' && Math.abs(lineMs - TARGET_MS) <= 60,
    `x=${px} → lineMs=${typeof lineMs === 'number' ? lineMs.toFixed(1) : null}（目标 ${TARGET_MS}；若回弹会≈60000）`)
  assert('②反算时间确实在尾巴区（> 音频时长）', typeof lineMs === 'number' && lineMs > 60200,
    String(typeof lineMs === 'number' ? lineMs.toFixed(1) : lineMs))

  // ③ 松手后：底部读数(store) 与 竖线 是否一致；端口被夹情况
  const storeMs = await ev(cdp, '__lrc.state().playback.playheadMs')
  const portMs = await ev(cdp, '__lrc.audioTimeMs()')
  assert('③底部读数(store) 与 竖线 一致（不再分裂）',
    typeof lineMs === 'number' && Math.abs(storeMs - lineMs) <= 60,
    `store=${storeMs} line=${typeof lineMs === 'number' ? lineMs.toFixed(1) : null}`)
  console.log(`  [INFO] 端口 audioTimeMs() = ${portMs}（端口 seek 夹回音频末尾 60000，属已知边界：尾巴区端口不可表示）`)
  assert('③端口被夹在音频末尾 60000（如实记录）', Math.abs(portMs - 60000) <= 200, String(portMs))

  // 汇总
  const failed = checks.filter((c) => !c.ok)
  console.log('\n================ endtail 追加断言汇总 ================')
  for (const c of checks) {
    console.log(`  [${c.ok ? 'PASS' : 'FAIL'}] ${c.name}${c.detail ? '  :: ' + c.detail : ''}`)
  }
  console.log(`\n断言总数 ${checks.length}，通过 ${checks.length - failed.length}，失败 ${failed.length}`)
  process.exit(failed.length === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('端到端脚本异常:', (e && e.stack) || e)
  process.exit(2)
})
