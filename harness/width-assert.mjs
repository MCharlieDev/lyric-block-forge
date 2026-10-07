// Ad-hoc CDP assertions for the timeline canvas width bug (B 段验收).
// Does NOT modify run.mjs — additive, standalone.
// Run: node width-assert.mjs
const PORT = 9333
const APP = 'http://localhost:5177/'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
  waitEvent(method, timeoutMs = 20000) {
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
  const page = targets.find((t) => t.type === 'page' && t.url.startsWith('http'))
  if (!page) throw new Error('no page target')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })
  return new Client(ws)
}

async function ev(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error('eval error: ' + (r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)))
  return r.result.value
}

const MEASURE = `(() => {
  const all = Array.from(document.querySelectorAll('canvas'))
  const strip = document.querySelector('.flex.min-h-0.min-w-0.flex-\\\\[1\\\\.4\\\\]')
  return {
    innerW: window.innerWidth,
    dpr: window.devicePixelRatio,
    stripClientW: strip ? strip.clientWidth : null,
    canvases: all.map((c, i) => {
      const p = c.parentElement
      const styleW = parseFloat(c.style.width)
      const parentW = p ? p.clientWidth : NaN
      return {
        i,
        label: i === 0 ? 'TimeRuler' : (i === 1 ? 'Waveform' : ('canvas#' + i)),
        styleW,
        parentW,
        attrW: c.width,
        diff: Math.abs(styleW - parentW),
      }
    }),
  }
})()`

const results = []

const checkAt = async (cdp, width, dpr = 1, note = '') => {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: dpr, mobile: false })
  await sleep(1000)
  const m = await ev(cdp, MEASURE)
  const line = []
  let allPass = true
  for (const c of m.canvases) {
    const ok = c.diff <= 1
    if (!ok) allPass = false
    line.push(`${c.label}: style.width=${c.styleW}px parent.clientWidth=${c.parentW}px diff=${c.diff} ${ok ? 'PASS' : 'FAIL'}`)
  }
  const row = {
    note, requestedW: width, dpr, innerW: m.innerW, stripClientW: m.stripClientW,
    canvases: m.canvases, pass: allPass,
  }
  results.push(row)
  console.log(`\n=== 视口 ${width}px (dpr=${dpr}) ${note} ===`)
  console.log(`  innerW=${m.innerW} strip.clientWidth=${m.stripClientW} ${m.stripClientW === width ? '(跟随)' : '(注意: strip 与视口不等，属正常：右栏占位)'}`)
  for (const l of line) console.log('  ' + l)
  console.log(`  -> ${allPass ? 'PASS' : 'FAIL'}`)
  return allPass
}

const main = async () => {
  const cdp = await connect()
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
  console.log('[assert] reloading', APP)
  await cdp.send('Page.navigate', { url: APP })
  await cdp.waitEvent('Page.loadEventFired').catch(() => {})
  await sleep(2500)

  // 用户实测的三种容器宽度 + 初始/更宽
  await checkAt(cdp, 1280, 1, '(初始)')
  await checkAt(cdp, 900, 1, '(用户实测宽度之一)')
  await checkAt(cdp, 638, 1, '(用户实测宽度之一)')
  await checkAt(cdp, 412, 1, '(用户实测宽度之一)')
  await checkAt(cdp, 1400, 1, '(再放大，验证后续刷新跟随)')
  // dpr 变化但 CSS 宽度不变（缩放）：宽度断言仍应通过
  await checkAt(cdp, 1400, 2, '(dpr 变，CSS 宽度不变)')

  // 复位
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })

  const failed = results.filter((r) => !r.pass)
  console.log('\n================ 汇总（canvas 宽度断言）================')
  console.log(`场景数 ${results.length}，全部通过 ${results.length - failed.length}，失败 ${failed.length}`)
  for (const f of failed) console.log(`  [FAIL] 视口 ${f.requestedW}px ${f.note}`)
  process.exit(failed.length === 0 ? 0 : 1)
}

main().catch((e) => { console.error('FATAL', e); process.exit(2) })
