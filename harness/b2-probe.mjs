// Ad-hoc CDP probe for B段（Tab 清空鼠标选中）。
// 独立脚本，只读 run.mjs（抽取 BOOTSTRAP 复用 window.__lrc），不改 run.mjs、不改仓库。
// Run: node b2-probe.mjs
import { readFileSync } from 'node:fs'
const PORT = 9333
const APP = 'http://localhost:5177/'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const runSrc = readFileSync(new URL('./run.mjs', import.meta.url), 'utf8')
function extractConst(name) {
  const marker = `const ${name} = \``
  const start = runSrc.indexOf(marker)
  if (start < 0) throw new Error('missing ' + name)
  const bodyStart = start + marker.length
  const end = runSrc.indexOf('\n`', bodyStart)
  if (end < 0) throw new Error('unterminated ' + name)
  return runSrc.slice(bodyStart, end)
}
const BOOTSTRAP = extractConst('BOOTSTRAP')
const CLOCK_BOOTSTRAP = extractConst('CLOCK_BOOTSTRAP')

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

async function boot(cdp) {
  await cdp.send('Page.navigate', { url: APP + '?b2probe=' + Date.now() })
  await cdp.waitEvent('Page.loadEventFired').catch(() => {})
  for (let i = 0; i < 40; i += 1) {
    const r = await ev(cdp, `(window.__bootError ? 'err:'+window.__bootError : (window.__lrc ? 'ready':'wait'))`)
    if (r && String(r).startsWith('err')) throw new Error(r)
    if (r === 'ready') break
    await sleep(250)
  }
  await sleep(900)
}

async function pressKey(cdp, { code, key, vk, modifiers = 0 }) {
  const base = { code, key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers }
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base })
  await sleep(30)
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
  await sleep(220)
}
const pressSpace = (cdp) => pressKey(cdp, { code: 'Space', key: ' ', vk: 32 })
const pressTab = (cdp) => pressKey(cdp, { code: 'Tab', key: 'Tab', vk: 9 })

const SNAP = `(() => {
  const l = window.__lrc
  const last = l.last()
  const rows = Array.from(document.querySelectorAll('[role="button"][tabindex="0"]'))
  const ae = document.activeElement
  return {
    sel: l.sel(),
    activeIdx: rows.indexOf(ae),
    activeTag: ae ? ae.tagName : 'none',
    activeFV: ae && ae.matches ? ae.matches(':focus-visible') : null,
    logLen: l.logLen(),
    lastScopeLineIds: last && last.scope ? last.scope.lineIds : null,
  }
})()`

// modifiers: Ctrl=2, Shift=8, Meta=4
async function clickRow(cdp, index, modifiers = 0) {
  const pt = await ev(cdp, `(() => {
    const rows = Array.from(document.querySelectorAll('[role="button"][tabindex="0"]'))
    const b = rows[${index}].getBoundingClientRect()
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
  })()`)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y, modifiers })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1, modifiers })
  await sleep(30)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1, modifiers })
  await sleep(250)
}

// 自适应 Tab：连按直到焦点落到某一行 div（activeIdx >= 0）且满足 predicate
async function tabUntilRow(cdp, predicate, max = 20) {
  for (let i = 0; i < max; i += 1) {
    await pressTab(cdp)
    const s = await ev(cdp, SNAP)
    if (s.activeIdx >= 0 && predicate(s)) return { snap: s, tabbed: i + 1 }
  }
  return { snap: await ev(cdp, SNAP), tabbed: max }
}

const results = []
function check(name, cond, detail) {
  results.push({ name, ok: !!cond, detail })
  console.log(`${cond ? '[PASS]' : '[FAIL]'} ${name}  :: ${detail}`)
}

const main = async () => {
  const cdp = await connect()
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: CLOCK_BOOTSTRAP })
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: BOOTSTRAP })

  // ---- A: 鼠标点行 → 不按 Tab 保持选中；按 Tab → 清空 ----
  {
    await boot(cdp)
    const v = await ev(cdp, `window.__lrc.visibleIds()`)
    await clickRow(cdp, 0)
    const afterClick = await ev(cdp, SNAP)
    check('A1 鼠标点行 0 → lineIds=[v0]（点击选中不受影响）',
      JSON.stringify(afterClick.sel.lineIds) === JSON.stringify([v[0]]) && afterClick.sel.activeLineId === v[0],
      `lineIds=${JSON.stringify(afterClick.sel.lineIds)}, activeLineId=${afterClick.sel.activeLineId}`)
    console.log(`     [diag] 鼠标点击后 activeElement.matches(':focus-visible') = ${afterClick.activeFV} (期望 false)`)
    const t = await tabUntilRow(cdp, (s) => s.activeIdx !== 0)
    check('A2 Tab 后 lineIds === []（清空）', JSON.stringify(t.snap.sel.lineIds) === JSON.stringify([]),
      `tabbed=${t.tabbed}, lineIds=${JSON.stringify(t.snap.sel.lineIds)}`)
    check('A3 Tab 后 activeLineId === v[落点]', t.snap.activeIdx >= 0 && t.snap.sel.activeLineId === v[t.snap.activeIdx],
      `activeIdx=${t.snap.activeIdx}, activeLineId=${t.snap.sel.activeLineId}`)
    console.log(`     [diag] Tab 聚焦后 activeElement.matches(':focus-visible') = ${t.snap.activeFV} (期望 true)`)
  }

  // ---- B: Ctrl+click 多选 3 行 → 累加；按 Tab → 清空 ----
  {
    await boot(cdp)
    const v = await ev(cdp, `window.__lrc.visibleIds()`)
    await clickRow(cdp, 0)
    await clickRow(cdp, 1, 2)
    await clickRow(cdp, 2, 2)
    const multi = await ev(cdp, SNAP)
    check('B1 Ctrl+click 多选累加 → lineIds 含 3 行',
      multi.sel.lineIds.slice().sort().join(',') === [v[0], v[1], v[2]].sort().join(','),
      `lineIds=${JSON.stringify(multi.sel.lineIds)}`)
    const t = await tabUntilRow(cdp, (s) => s.activeIdx !== multi.activeIdx)
    check('B2 多选后 Tab → lineIds === []（3 行全清）', JSON.stringify(t.snap.sel.lineIds) === JSON.stringify([]),
      `tabbed=${t.tabbed}, lineIds=${JSON.stringify(t.snap.sel.lineIds)}`)
  }

  // ---- C: Ctrl+click 多选 2 行（不加 Tab）→ 累加不受影响 ----
  {
    await boot(cdp)
    const v = await ev(cdp, `window.__lrc.visibleIds()`)
    await clickRow(cdp, 0)
    await clickRow(cdp, 1, 2)
    const s = await ev(cdp, SNAP)
    check('C1 Ctrl+click 多选 2 行 → lineIds 含两行（不被清）',
      s.sel.lineIds.slice().sort().join(',') === [v[0], v[1]].sort().join(','),
      `lineIds=${JSON.stringify(s.sel.lineIds)}`)
  }

  // ---- D: Shift+click 范围选 → 选中一片 ----
  {
    await boot(cdp)
    const v = await ev(cdp, `window.__lrc.visibleIds()`)
    await clickRow(cdp, 0)
    await clickRow(cdp, 2, 8)
    const s = await ev(cdp, SNAP)
    check('D1 Shift+click 范围选 → lineIds=[v0,v1,v2]',
      JSON.stringify(s.sel.lineIds) === JSON.stringify([v[0], v[1], v[2]]),
      `lineIds=${JSON.stringify(s.sel.lineIds)}`)
  }

  // ---- E（回归1）: 焦点行 + Space → 打光标行 ----
  {
    await boot(cdp)
    const v = await ev(cdp, `window.__lrc.visibleIds()`)
    await ev(cdp, `(() => {
      const rows = Array.from(document.querySelectorAll('[role="button"][tabindex="0"]'))
      rows[0].focus()
      window.__lrc.store.getState().selectLine(${JSON.stringify(v[1])})
      return true
    })()`)
    await sleep(250)
    const adv = await ev(cdp, SNAP)
    check('E1 程序化推进选区后焦点跟随到 i+1', adv.activeIdx === 1 && adv.sel.activeLineId === v[1],
      `activeIdx=${adv.activeIdx}, activeLineId=${adv.sel.activeLineId}`)
    await pressSpace(cdp)
    const afterSpace = await ev(cdp, SNAP)
    check('E2 Space 打到 i+1', JSON.stringify(afterSpace.lastScopeLineIds) === JSON.stringify([v[1]]),
      `lastScope=${JSON.stringify(afterSpace.lastScopeLineIds)}`)
  }

  // ---- F（回归2）: Space ×3 不锁死 ----
  {
    await boot(cdp)
    const v = await ev(cdp, `window.__lrc.visibleIds()`)
    await ev(cdp, `(() => {
      const rows = Array.from(document.querySelectorAll('[role="button"][tabindex="0"]'))
      rows[0].focus()
      window.__lrc.store.getState().selectLine(${JSON.stringify(v[0])})
      return true
    })()`)
    await sleep(200)
    const seq = []
    for (let i = 0; i < 3; i += 1) {
      await pressSpace(cdp)
      seq.push((await ev(cdp, SNAP)).lastScopeLineIds)
    }
    const expected = [v[0], v[1], v[2]].map((x) => [x])
    check('F1 Space ×3 不锁死，依次推进', JSON.stringify(seq) === JSON.stringify(expected),
      `seq=${JSON.stringify(seq)}`)
  }

  // ---- G（回归3）: 真实鼠标点行 + P1 + Space → 打 i+1 ----
  {
    await boot(cdp)
    const v = await ev(cdp, `window.__lrc.visibleIds()`)
    await clickRow(cdp, 0)
    await ev(cdp, `window.__lrc.store.getState().selectLine(${JSON.stringify(v[1])})`)
    await sleep(250)
    const afterP1 = await ev(cdp, SNAP)
    check('G1 模拟 P1 后焦点跟随到 i+1', afterP1.activeIdx === 1, `activeIdx=${afterP1.activeIdx}`)
    await pressSpace(cdp)
    const afterSpace = await ev(cdp, SNAP)
    check('G2 Space 打 i+1', JSON.stringify(afterSpace.lastScopeLineIds) === JSON.stringify([v[1]]),
      `lastScope=${JSON.stringify(afterSpace.lastScopeLineIds)}`)
  }

  // ---- H（回归4·口径反转）: 多选 2 行 → Tab → lineIds 清空、activeLineId 更新 ----
  {
    await boot(cdp)
    const v = await ev(cdp, `window.__lrc.visibleIds()`)
    await ev(cdp, `(() => {
      const st = window.__lrc.store.getState()
      st.selectLine(${JSON.stringify(v[0])})
      st.toggleLineSelection(${JSON.stringify(v[1])})
      return true
    })()`)
    await sleep(250)
    const before = await ev(cdp, SNAP)
    check('H1 多选 2 行建立', before.sel.lineIds.slice().sort().join(',') === [v[0], v[1]].sort().join(','),
      `lineIds=${JSON.stringify(before.sel.lineIds)}`)
    const t = await tabUntilRow(cdp, (s) => s.activeIdx !== 1)
    check('H2 多选后 Tab → lineIds === []（口径反转：原「保住」→ 现「清空」）',
      JSON.stringify(t.snap.sel.lineIds) === JSON.stringify([]), `tabbed=${t.tabbed}, lineIds=${JSON.stringify(t.snap.sel.lineIds)}`)
    check('H3 activeLineId 跟到落点行', t.snap.activeIdx >= 0 && t.snap.sel.activeLineId === v[t.snap.activeIdx],
      `activeIdx=${t.snap.activeIdx}, activeLineId=${t.snap.sel.activeLineId}`)
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\n==== 汇总：${results.length - failed.length}/${results.length} 通过 ====`)
  if (failed.length) {
    failed.forEach((f) => console.log(`  [FAIL] ${f.name} :: ${f.detail}`))
    process.exit(1)
  }
  process.exit(0)
}

main().catch((e) => { console.error('FATAL', e); process.exit(2) })
