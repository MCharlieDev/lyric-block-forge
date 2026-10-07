// b3-probe.mjs — 第二轮·键盘多选 B 段 追加断言（仓外独立脚本）
// 独立脚本，只读 run.mjs（抽取 BOOTSTRAP 复用 window.__lrc），不改 run.mjs、不改仓库。
// 运行: node b3-probe.mjs
import { readFileSync } from 'node:fs'

const PORT = 9333
const APP = 'http://localhost:5177/'
// CDP Input modifier bitmask
const MOD = { alt: 1, ctrl: 2, meta: 4, shift: 8 }
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
  await cdp.send('Page.navigate', { url: APP + '?b3probe=' + Date.now() })
  await cdp.waitEvent('Page.loadEventFired').catch(() => {})
  for (let i = 0; i < 40; i += 1) {
    const r = await ev(cdp, `(window.__bootError ? 'err:'+window.__bootError : (window.__lrc ? 'ready':'wait'))`)
    if (r && String(r).startsWith('err')) throw new Error(r)
    if (r === 'ready') break
    await sleep(250)
  }
  await sleep(900)
}

// 补 modifiers 版 keyPress（Ctrl=2 / Shift=8 / Meta=4）
async function pressKey(cdp, { code, key, vk, modifiers = 0 }) {
  const base = { code, key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers }
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base })
  await sleep(30)
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
  await sleep(180)
}
const press = {
  up: (cdp, m = 0) => pressKey(cdp, { code: 'ArrowUp', key: 'ArrowUp', vk: 38, modifiers: m }),
  down: (cdp, m = 0) => pressKey(cdp, { code: 'ArrowDown', key: 'ArrowDown', vk: 40, modifiers: m }),
  left: (cdp, m = 0) => pressKey(cdp, { code: 'ArrowLeft', key: 'ArrowLeft', vk: 37, modifiers: m }),
  right: (cdp, m = 0) => pressKey(cdp, { code: 'ArrowRight', key: 'ArrowRight', vk: 39, modifiers: m }),
  enter: (cdp, m = 0) => pressKey(cdp, { code: 'Enter', key: 'Enter', vk: 13, modifiers: m }),
  esc: (cdp) => pressKey(cdp, { code: 'Escape', key: 'Escape', vk: 27 }),
  space: (cdp) => pressKey(cdp, { code: 'Space', key: ' ', vk: 32 }),
  tab: (cdp) => pressKey(cdp, { code: 'Tab', key: 'Tab', vk: 9 }),
}

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
    lastKind: last ? last.kind : null,
    lastScopeLineIds: last && last.scope ? last.scope.lineIds : null,
  }
})()`

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
  await sleep(220)
}

async function tabUntilRow(cdp, predicate, max = 20) {
  for (let i = 0; i < max; i += 1) {
    await press.tab(cdp)
    const s = await ev(cdp, SNAP)
    if (s.activeIdx >= 0 && predicate(s)) return { snap: s, tabbed: i + 1 }
  }
  return { snap: await ev(cdp, SNAP), tabbed: max }
}

// 每次全新加载 + 保证至少 5 个可见行（前 4 行是 demo 已打轴行）
async function prepare(cdp) {
  await boot(cdp)
  let v = await ev(cdp, '__lrc.visibleIds()')
  while (v.length < 5) {
    await ev(cdp, `__lrc.addBlank('probe填充')`)
    await sleep(60)
    v = await ev(cdp, '__lrc.visibleIds()')
  }
  return v
}

const readTimes = (cdp, id) => ev(cdp, `__lrc.times(${JSON.stringify(id)})`)

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

  // ---- K: Ctrl+↑/↓ 只挪光标保选区 + anchor 跟到新行 ----
  {
    const v = await prepare(cdp)
    await clickRow(cdp, 0)
    await clickRow(cdp, 2, MOD.ctrl) // lineIds=[v0,v2], active=v2, anchor=v2
    const before = await ev(cdp, SNAP)
    check('K1 Ctrl+click 建立 [v0,v2] 且 active=v2',
      JSON.stringify(before.sel.lineIds) === JSON.stringify([v[0], v[2]]) && before.sel.activeLineId === v[2],
      `sel=${JSON.stringify(before.sel)}`)

    await ev(cdp, '__lrc.blur()')
    await press.down(cdp, MOD.ctrl)
    const d = await ev(cdp, SNAP)
    check('K2 Ctrl+↓ → active=v3、lineIds 逐字段不变、anchor=v3',
      d.sel.activeLineId === v[3] && d.sel.anchorLineId === v[3] &&
      JSON.stringify(d.sel.lineIds) === JSON.stringify([v[0], v[2]]),
      `sel=${JSON.stringify(d.sel)}`)

    await press.up(cdp, MOD.ctrl)
    const u = await ev(cdp, SNAP)
    check('K3 Ctrl+↑ → active 回到 v2、lineIds 仍不变、anchor=v2',
      u.sel.activeLineId === v[2] && u.sel.anchorLineId === v[2] &&
      JSON.stringify(u.sel.lineIds) === JSON.stringify([v[0], v[2]]),
      `sel=${JSON.stringify(u.sel)}`)
  }

  // ---- T10/T11: Ctrl+Enter 加减选（可空），光标不动 ----
  {
    const v = await prepare(cdp)
    await clickRow(cdp, 0) // 点选一行使其获焦：lineIds=[v0], active=v0
    await press.esc(cdp)   // 预清：lineIds=[]、active=v0（保留焦点行）
    const pre = await ev(cdp, SNAP)
    check('T10.pre Esc 预清 → lineIds=[] 且 active=v0',
      JSON.stringify(pre.sel.lineIds) === JSON.stringify([]) && pre.sel.activeLineId === v[0],
      `sel=${JSON.stringify(pre.sel)}`)

    await press.enter(cdp, MOD.ctrl)
    const added = await ev(cdp, SNAP)
    check('T10 Ctrl+Enter → 光标行加入 lineIds=[v0]、active 不动',
      JSON.stringify(added.sel.lineIds) === JSON.stringify([v[0]]) && added.sel.activeLineId === v[0],
      `sel=${JSON.stringify(added.sel)}`)

    await press.enter(cdp, MOD.ctrl)
    const removed = await ev(cdp, SNAP)
    check('T11 再按 Ctrl+Enter → 减到空 lineIds=[]、activeLineId 保留 v0',
      JSON.stringify(removed.sel.lineIds) === JSON.stringify([]) && removed.sel.activeLineId === v[0],
      `sel=${JSON.stringify(removed.sel)}`)
  }

  // ---- T12: Esc 清空选区、光标不动 ----
  {
    const v = await prepare(cdp)
    await clickRow(cdp, 0)
    await clickRow(cdp, 2, MOD.ctrl) // [v0,v2], active=v2
    const before = await ev(cdp, SNAP)
    await ev(cdp, '__lrc.blur()')
    await press.esc(cdp)
    const after = await ev(cdp, SNAP)
    check('T12 Esc → lineIds=[]、activeLineId 保留 v2、anchor 保留 v2',
      JSON.stringify(after.sel.lineIds) === JSON.stringify([]) &&
      after.sel.activeLineId === v[2] && after.sel.anchorLineId === v[2],
      `before=${JSON.stringify(before.sel)} after=${JSON.stringify(after.sel)}`)
  }

  // ---- T4/T5: Shift+↓ 范围选、连续递增、anchor 不动 ----
  {
    const v = await prepare(cdp)
    await clickRow(cdp, 0) // anchor=v0, active=v0
    await ev(cdp, '__lrc.blur()')
    await press.down(cdp, MOD.shift)
    const s1 = await ev(cdp, SNAP)
    check('T4 Shift+↓ → 连续区间 [v0,v1]、active=v1、anchor 不动 v0',
      JSON.stringify(s1.sel.lineIds) === JSON.stringify([v[0], v[1]]) && s1.sel.activeLineId === v[1] && s1.sel.anchorLineId === v[0],
      `sel=${JSON.stringify(s1.sel)}`)
    await press.down(cdp, MOD.shift)
    const s2 = await ev(cdp, SNAP)
    check('T5 再 Shift+↓ → 区间递增 [v0,v1,v2]、anchor 仍 v0',
      JSON.stringify(s2.sel.lineIds) === JSON.stringify([v[0], v[1], v[2]]) && s2.sel.activeLineId === v[2] && s2.sel.anchorLineId === v[0],
      `sel=${JSON.stringify(s2.sel)}`)
  }

  // ---- R1: 回归 纯 ↑/↓ 仍单选重置 ----
  {
    const v = await prepare(cdp)
    await clickRow(cdp, 0)
    await clickRow(cdp, 2, MOD.ctrl) // [v0,v2], active=v2
    await ev(cdp, '__lrc.blur()')
    await press.down(cdp)
    const s = await ev(cdp, SNAP)
    check('R1 纯 ↓ → 单选重置 [v3]、active=v3、anchor=v3',
      JSON.stringify(s.sel.lineIds) === JSON.stringify([v[3]]) && s.sel.activeLineId === v[3] && s.sel.anchorLineId === v[3],
      `sel=${JSON.stringify(s.sel)}`)
  }

  // ---- R2: 回归 纯 Enter 仍触发行内 selectLine ----
  {
    const v = await prepare(cdp)
    await clickRow(cdp, 0)
    await clickRow(cdp, 2, MOD.ctrl) // [v0,v2], active=v2；row2 获焦
    await press.enter(cdp)           // 行内 onKeyDown 处理
    const s = await ev(cdp, SNAP)
    check('R2 纯 Enter → 行内 selectLine 该行（单选重置 [v2]，未被当 Esc）',
      JSON.stringify(s.sel.lineIds) === JSON.stringify([v[2]]) && s.sel.activeLineId === v[2] && s.sel.anchorLineId === v[2],
      `sel=${JSON.stringify(s.sel)}`)
  }

  // ---- R3/R4/R5: 回归 nudgeSelection 阈值 2→1（lineIds=[A] 且 active=B → 动 A）----
  {
    const v = await prepare(cdp)
    await clickRow(cdp, 0)
    await ev(cdp, '__lrc.blur()')
    await press.down(cdp, MOD.ctrl) // setActiveLine(v1) → lineIds=[v0], active=v1, anchor=v1
    const setup = await ev(cdp, SNAP)
    check('R3.setup 新状态 lineIds=[v0] 且 active=v1',
      JSON.stringify(setup.sel.lineIds) === JSON.stringify([v[0]]) && setup.sel.activeLineId === v[1],
      `sel=${JSON.stringify(setup.sel)}`)

    const t0Before = await readTimes(cdp, v[0])
    const t1Before = await readTimes(cdp, v[1])
    await ev(cdp, '__lrc.blur()')
    await press.right(cdp) // nudgeSelection(+10ms)
    const t0After = await readTimes(cdp, v[0])
    const t1After = await readTimes(cdp, v[1])
    const last = await ev(cdp, '__lrc.last()')
    check('R4 按 →/← 动的是选中集 v0（+10ms）',
      t0After[0] - t0Before[0] === 10 && JSON.stringify(last.scope.lineIds) === JSON.stringify([v[0]]),
      `v0 ${t0Before[0]}->${t0After[0]} scope=${JSON.stringify(last.scope && last.scope.lineIds)} kind=${last.kind}`)
    check('R5 光标行 v1 未被误动',
      JSON.stringify(t1After) === JSON.stringify(t1Before),
      `v1 ${JSON.stringify(t1Before)} -> ${JSON.stringify(t1After)}`)
  }

  // ---- REG1: 上一轮回归 Tab 清空 ----
  {
    const v = await prepare(cdp)
    await clickRow(cdp, 0)
    const c = await ev(cdp, SNAP)
    check('REG1a 鼠标点行 → lineIds=[v0] 且 active=v0',
      JSON.stringify(c.sel.lineIds) === JSON.stringify([v[0]]) && c.sel.activeLineId === v[0],
      `sel=${JSON.stringify(c.sel)}`)
    const t = await tabUntilRow(cdp, (s) => s.activeIdx !== 0)
    check('REG1b Tab → lineIds 清空 []', JSON.stringify(t.snap.sel.lineIds) === JSON.stringify([]),
      `tabbed=${t.tabbed} sel=${JSON.stringify(t.snap.sel)}`)
    check('REG1c Tab 后 activeLineId 跟到落点行',
      t.snap.activeIdx >= 0 && t.snap.sel.activeLineId === v[t.snap.activeIdx],
      `activeIdx=${t.snap.activeIdx} active=${t.snap.sel.activeLineId}`)
  }

  // ---- REG2: 上一轮回归 空格打光标行 ----
  {
    const v = await prepare(cdp)
    await clickRow(cdp, 0)
    await ev(cdp, `window.__lrc.store.getState().selectLine(${JSON.stringify(v[1])})`)
    await sleep(250)
    const adv = await ev(cdp, SNAP)
    check('REG2a 程序化推进选区后焦点跟随 i+1',
      adv.activeIdx === 1 && adv.sel.activeLineId === v[1],
      `activeIdx=${adv.activeIdx} active=${adv.sel.activeLineId}`)
    await press.space(cdp)
    const sp = await ev(cdp, SNAP)
    check('REG2b Space 打光标行 v1',
      JSON.stringify(sp.lastScopeLineIds) === JSON.stringify([v[1]]),
      `lastScope=${JSON.stringify(sp.lastScopeLineIds)}`)
  }

  // ---- REG3: 上一轮回归 Space ×3 不锁死 ----
  {
    const v = await prepare(cdp)
    await clickRow(cdp, 0)
    await ev(cdp, `window.__lrc.store.getState().selectLine(${JSON.stringify(v[0])})`)
    await sleep(200)
    const seq = []
    for (let i = 0; i < 3; i += 1) {
      await press.space(cdp)
      seq.push((await ev(cdp, SNAP)).lastScopeLineIds)
    }
    const expected = [v[0], v[1], v[2]].map((x) => [x])
    check('REG3 Space ×3 依次推进不锁死',
      JSON.stringify(seq) === JSON.stringify(expected),
      `seq=${JSON.stringify(seq)}`)
  }

  // ---- REG4: 上一轮回归 鼠标点行 + P1 + Space ----
  {
    const v = await prepare(cdp)
    await clickRow(cdp, 0)
    await ev(cdp, `window.__lrc.store.getState().selectLine(${JSON.stringify(v[1])})`)
    await sleep(250)
    const p1 = await ev(cdp, SNAP)
    check('REG4a 鼠标点行 + P1 焦点跟随 i+1', p1.activeIdx === 1, `activeIdx=${p1.activeIdx}`)
    await press.space(cdp)
    const sp = await ev(cdp, SNAP)
    check('REG4b Space 打 i+1',
      JSON.stringify(sp.lastScopeLineIds) === JSON.stringify([v[1]]),
      `lastScope=${JSON.stringify(sp.lastScopeLineIds)}`)
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\n==== b3-probe 汇总：${results.length - failed.length}/${results.length} 通过 ====`)
  if (failed.length) {
    failed.forEach((f) => console.log(`  [FAIL] ${f.name} :: ${f.detail}`))
    process.exit(1)
  }
  process.exit(0)
}

main().catch((e) => { console.error('FATAL', e); process.exit(2) })
