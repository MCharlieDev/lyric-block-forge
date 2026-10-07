// LRC-Editor 多选拖动：A~M（第一批/第二批拖动回归）+ N~S（选择层去类型化 / 入口拒绝 / 多选删除）+ T（单行删除同步集合）
// + AL~AW（视口跟随平滑动画 / 屏外播放头箭头 / 三项设置）
// 运行: node run.mjs   （可传测试 id，如 `node run.mjs N O`）
import process from 'node:process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const PORT = 9333
const APP = 'http://localhost:5177/'
const MOD = { alt: 1, ctrl: 2, meta: 4, shift: 8 }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const J = (v) => JSON.stringify(v)
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

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
  const r = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (r.exceptionDetails) {
    throw new Error('eval error: ' + (r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)))
  }
  return r.result.value
}

/* ------------------------------ bootstrap ----------------------------- */
const BOOTSTRAP = `
(() => {
  if (window.__bootStarted) return;
  window.__bootStarted = true;
  window.__bootReady = false;
  window.__bootError = null;
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  (async function () {
    var findUrl = function (needle) {
      var es = performance.getEntriesByType('resource');
      for (var i = 0; i < es.length; i++) {
        if (es[i].name.indexOf(needle) >= 0) return es[i].name;
      }
      return null;
    };
    var find = async function (needle) {
      var url = null;
      for (var i = 0; i < 400 && !url; i++) { url = findUrl(needle); if (!url) await sleep(20); }
      return url;
    };
    var url = await find('/stores/editorStore.ts');
    if (!url) throw new Error('editorStore module url not found');
    var mod = await import(url);
    var store = mod.useEditorStore;
    var selectVisibleLines = mod.selectVisibleLines;
    // 导出组装必须与 App 共用同一个具名函数，禁止在此自拼 serializeLrc
    var buildExportText = mod.buildExportText;
    // 字级清空场景：store 无「单字清空」入口，只能按回放层语义注入 absolute（null = 删键）
    var appendOperation = null;
    var _undoEntries = null;
    var _replayMod = null;
    var logUrl = await find('/operations/log.ts');
    if (logUrl) { try { var logMod = await import(logUrl); appendOperation = logMod.appendOperation; _undoEntries = logMod.undoEntries; } catch (e) {} }
    var replayUrl = await find('/operations/replay.ts');
    if (replayUrl) { try { _replayMod = await import(replayUrl); } catch (e) {} }
    var settingsUrl = await find('/stores/settingsStore.ts');
    if (!settingsUrl) throw new Error('settingsStore module url not found');
    var settingsMod = await import(settingsUrl);
    var settingsStore = settingsMod.useSettingsStore;
    var toastUrl = await find('/stores/toastStore.ts');
    if (!toastUrl) throw new Error('toastStore module url not found');
    var toastMod = await import(toastUrl);
    var toastStore = toastMod.useToastStore;
    // 跟随目标比例：从应用常量取，避免在 harness 里硬编码 0.2 造成口径漂移
    var _ftr = 0.2;
    var constUrl = await find('/timeline/constants.ts');
    if (constUrl) {
      try {
        var constMod = await import(constUrl);
        if (typeof constMod.FOLLOW_TARGET_RATIO === 'number') _ftr = constMod.FOLLOW_TARGET_RATIO;
      } catch (e) { /* 用默认值兜底 */ }
    }
    // 网格吸附：档位换算与刻度尺共用 adaptiveGridMs + LABEL_MIN_GAP_PX，禁止在 harness 里硬编码
    var _adaptiveGridMs = null;
    var _labelMinGapPx = null;
    if (constUrl) {
      try {
        var constMod2 = await import(constUrl);
        if (typeof constMod2.LABEL_MIN_GAP_PX === 'number') _labelMinGapPx = constMod2.LABEL_MIN_GAP_PX;
      } catch (e) { /* 用默认值兜底 */ }
    }
    var timeMapUrl = await find('/timeline/timeMap.ts');
    if (timeMapUrl) {
      try {
        var timeMapMod = await import(timeMapUrl);
        if (typeof timeMapMod.adaptiveGridMs === 'function') _adaptiveGridMs = timeMapMod.adaptiveGridMs;
      } catch (e) { /* 用默认值兜底 */ }
    }
    // ---- 视口观测：fiber 扫描拿 kernel / adapters（含函数，不能经 ev 返回） ----
    var _kernel = null;
    var _adapters = null;
    var _isKernel = function (v) {
      return v && typeof v.getSnapshot === 'function' && typeof v.followPlayhead === 'function' && typeof v.subscribeFrame === 'function';
    };
    var _isAdapters = function (v) {
      return v && v.audio && typeof v.audio.getCurrentTimeMs === 'function' && typeof v.audio.seek === 'function';
    };
    var _rootFiber = function () {
      var root = document.getElementById('root');
      if (!root) return null;
      var keys = Object.keys(root);
      for (var i = 0; i < keys.length; i++) {
        if (keys[i].indexOf('__reactContainer$') === 0) return root[keys[i]];
      }
      return null;
    };
    var _scanFiber = function (fiber) {
      if (!fiber) return 0;
      var stack = [fiber];
      var guard = 0;
      while (stack.length && guard < 40000) {
        guard++;
        var f = stack.pop();
        var props = f.memoizedProps;
        if (props && props.value) {
          // TimelineViewportContext 的 value 是 { kernel, durationMs }，kernel 在 .kernel 上
          if (!_kernel) {
            if (_isKernel(props.value)) _kernel = props.value;
            else if (_isKernel(props.value.kernel)) _kernel = props.value.kernel;
          }
          if (!_adapters && _isAdapters(props.value)) _adapters = props.value;
        }
        if (f.child) stack.push(f.child);
        if (f.sibling) stack.push(f.sibling);
      }
      return guard;
    };
    var _ensureAll = function () {
      if (_kernel && _adapters) return true;
      var start = _rootFiber();
      if (start) _scanFiber(start);
      return !!(_kernel && _adapters);
    };
    // ---- viewStartMs 镜像（snapshot 不含此值，只能从 frame 广播观测） ----
    var _last = { startMs: 0, seq: 0 };
    var _unsubMirror = null;
    var _mrStart = null;
    var _mrSamples = [];
    var _startMirror = function () {
      if (!_ensureAll()) return false;
      if (!_unsubMirror) {
        _unsubMirror = _kernel.subscribeFrame(function (frame) {
          _last.startMs = frame.view.startMs;
          _last.seq++;
          if (_mrStart !== null) {
            _mrSamples.push({ t: Date.now(), s: frame.view.startMs, p: frame.view.pixelsPerMs });
            if (_mrSamples.length > 8000) _mrSamples.shift();
          }
        });
      }
      return true;
    };
    var api = {
      store: store,
      state: function () { return store.getState(); },
      ids: function () { return store.getState().document.lines.map(function (l) { return l.id; }); },
      texts: function () { return store.getState().document.lines.map(function (l) { return l.text; }); },
      times: function (id) { return (store.getState().replay.lineTimestamps[id] || []).slice(); },
      logLen: function () { return store.getState().log.entries.length; },
      last: function () { var e = store.getState().log.entries; return e.length ? e[e.length - 1] : null; },
      sel: function () {
        var s = store.getState().selection;
        return { lineIds: s.lineIds.slice(), activeLineId: s.activeLineId, anchorLineId: s.anchorLineId };
      },
      visibleIds: function () {
        return selectVisibleLines(store.getState().document, store.getState().replay).map(function (l) { return l.id; });
      },
      // 导出文本：与 App.handleExportLrc 共用 buildExportText（不做任何自拼）
      buildExport: function (ms) {
        return buildExportText(store.getState().document, store.getState().replay, ms);
      },
      settings: function () { return settingsStore.getState().settings; },
      settingsStore: settingsStore,
      updateSettings: function (patch) {
        settingsStore.getState().update(patch);
        return settingsStore.getState().settings;
      },
      storedSettingsRaw: function () { return localStorage.getItem('lrc-editor:lrc-editor/settings'); },
      block: function (id) { return document.querySelector('[data-lyric-block][data-line-id="' + id + '"]'); },
      rect: function (id) {
        var el = api.block(id); if (!el) return null;
        var r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, width: r.width, height: r.height };
      },
      style: function (id) {
        var el = api.block(id); if (!el) return null;
        return { transform: el.style.transform, zIndex: el.style.zIndex, cursor: el.style.cursor };
      },
      ppms: function () {
        var ids = api.ids();
        var a = api.rect(ids[0]); var b = api.rect(ids[3]);
        var ta = api.times(ids[0])[0]; var tb = api.times(ids[3])[0];
        if (!a || !b || ta === undefined || tb === undefined) return null;
        return (b.left - a.left) / (tb - ta);
      },
      point: function (id, dx) {
        var r = api.rect(id); if (!r) return null;
        return { x: r.left + 10 + (dx || 0), y: r.top + r.height / 2 };
      },
      elementAt: function (x, y) {
        var el = document.elementFromPoint(x, y); if (!el) return null;
        var b = el.closest('[data-lyric-block]');
        return b ? (b.getAttribute('data-line-id') || 'block') : (el.tagName || 'unknown');
      },
      addBlank: function (t) { return store.getState().appendBlankLine(t); },
      clearSel: function () { store.getState().clearLineSelection(); },
      blur: function () { var a = document.activeElement; if (a && a.blur) a.blur(); return document.activeElement ? document.activeElement.tagName : 'none'; },
      activeTag: function () { return document.activeElement ? document.activeElement.tagName : 'none'; },
      // R 条：真实 ⋮ 弹窗路径 —— 点击第 index 个面板「行操作」按钮打开 LineActionSheet
      openSheet: function (index) {
        var btns = document.querySelectorAll('button[aria-label="行操作"]');
        var i = index == null ? 0 : index;
        if (!btns[i]) return -1;
        btns[i].click();
        return btns.length;
      },
      dialogOpen: function () { return document.querySelector('[role="dialog"]') !== null; },
      // 弹窗里新增了「行级时间戳」输入框（置顶），不能再靠"第一个 text 输入"定位主文本
      focusDialogField: function () {
        var el = document.querySelector('[role="dialog"] [data-primary-text]');
        if (!el) return false;
        el.focus();
        return document.activeElement === el;
      },
      // React 受控输入：必须用原生 setter + 派发 input 事件，直接改 .value 不会触发 onChange
      _setNativeValue: function (el, value) {
        var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        var setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        setter.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return el.value;
      },
      lineTimeInputEl: function () { return document.querySelector('[role="dialog"] [data-line-time-input]'); },
      lineTimeInputValue: function () { var el = api.lineTimeInputEl(); return el ? el.value : null; },
      setLineTimeInput: function (value) {
        var el = api.lineTimeInputEl(); if (!el) return false;
        api._setNativeValue(el, value);
        return el.value;
      },
      lineTimeInvalid: function () {
        var el = api.lineTimeInputEl(); return el ? el.getAttribute('aria-invalid') === 'true' : null;
      },
      wordInputs: function () { return document.querySelectorAll('[role="dialog"] [data-word-input]'); },
      wordInputCount: function () { return api.wordInputs().length; },
      wordInputValue: function (index) { var el = api.wordInputs()[index]; return el ? el.value : null; },
      setWordInput: function (index, value) {
        var el = api.wordInputs()[index]; if (!el) return false;
        api._setNativeValue(el, value);
        return el.value;
      },
      _dialogBtn: function (label) {
        var btns = document.querySelectorAll('[role="dialog"] button');
        for (var i = 0; i < btns.length; i++) {
          if ((btns[i].textContent || '').trim() === label) return btns[i];
        }
        return null;
      },
      dialogSaveDisabled: function () { var b = api._dialogBtn('保存'); return b ? b.disabled === true : null; },
      clickDialogSave: function () { var b = api._dialogBtn('保存'); if (!b) return false; b.click(); return true; },
      wordTimes: function (id) {
        var st = store.getState();
        var line = st.document.lines.find(function (l) { return l.id === id; });
        if (!line) return null;
        return line.wordTimestamps.map(function (_, i) {
          var v = st.replay.wordTimestamps[id + '#' + i];
          return v === undefined ? null : v;
        });
      },
      // 字级清空场景：store 无「单字清空」入口（setWordTimestamps 过滤非有限值），
      // 只能按回放层语义注入 absolute（timeMs=null → 删键），并自行重建 replay。
      absWord: function (lineId, wordIndex, timeMs) {
        var st = store.getState();
        if (!appendOperation || !_replayMod) return { ok: false, reason: 'modules-missing' };
        var line = st.document.lines.find(function (l) { return l.id === lineId; });
        if (!line) return { ok: false, reason: 'no-line' };
        var wordRefs = line.wordTimestamps.map(function (_, i) { return { lineId: lineId, wordIndex: i }; });
        var next = appendOperation(st.log, {
          kind: 'word-timestamp',
          scope: { lineIds: [lineId], wordRefs: wordRefs, timeRange: null },
          delta: { mode: 'absolute', values: [{ lineId: lineId, wordIndex: wordIndex, timeMs: timeMs }] },
          description: (timeMs === null ? '清空字级时间戳' : '设置字级时间戳') + '（harness）',
          baseVersion: st.document.version,
        });
        var replay = _replayMod.replayOperations(next, _replayMod.buildBaselineFromDocument(st.document));
        store.setState({ log: next, replay: replay });
        return { ok: true, logLen: next.entries.length };
      },
      // 「撤销行级时间」：链头无行级的唯一自产路径（clear-timestamps 会进 clearedLineLines，
      // 走不到 buildExportText 的继承链），故此处用 undo 目标行级打轴记录来复现。
      undoLineStamp: function (lineId) {
        var st = store.getState();
        if (!_undoEntries || !_replayMod) return { ok: false, reason: 'modules-missing' };
        var entry = null;
        for (var i = 0; i < st.log.entries.length; i++) {
          var e = st.log.entries[i];
          if (e.kind === 'manual-timestamp' && e.status === 'active' && e.delta && e.delta.mode === 'absolute'
            && e.scope && e.scope.lineIds.length === 1 && e.scope.lineIds[0] === lineId) { entry = e; break; }
        }
        if (!entry) return { ok: false, reason: 'no-entry' };
        var next = _undoEntries(st.log, [entry.id]);
        var replay = _replayMod.replayOperations(next, _replayMod.buildBaselineFromDocument(st.document));
        store.setState({ log: next, replay: replay });
        return { ok: true, entryId: entry.id };
      },
      // 日志条目：li[data-entry-id] 内第一个 button 是展开/收起开关
      expandLogEntry: function (entryId) {
        var li = document.querySelector('[data-entry-id="' + entryId + '"]');
        if (!li) return false;
        var b = li.querySelector('button');
        if (!b) return false;
        b.click();
        return true;
      },
      logEntryText: function (entryId) {
        var li = document.querySelector('[data-entry-id="' + entryId + '"]');
        return li ? li.textContent : null;
      },
      closeDialog: function () {
        var b = document.querySelector('[role="dialog"] button[aria-label="关闭"]');
        if (!b) return false;
        b.click();
        return true;
      },
      // R 条：注入聚焦 textarea（无弹窗）作隔离验证
      injectProbe: function () {
        var el = document.createElement('textarea');
        el.id = '__probe_input';
        document.body.appendChild(el);
        el.focus();
        return document.activeElement === el;
      },
      dropProbe: function () {
        var el = document.getElementById('__probe_input');
        if (el && el.parentNode) el.parentNode.removeChild(el);
        var a = document.activeElement;
        if (a && a.blur) a.blur();
        return true;
      },
      // T 条：单行删除按钮定位 —— 行内「删除」按钮仅在面板不窄时渲染；收窄时只存在于 ⋮ 弹窗
      rowDeleteCount: function () { return document.querySelectorAll('button[aria-label="删除"]').length; },
      clickInlineDelete: function (index) {
        var btns = document.querySelectorAll('button[aria-label="删除"]');
        if (!btns[index]) return false;
        btns[index].click();
        return true;
      },
      clickSheetDelete: function () {
        var btns = document.querySelectorAll('[role="menu"][aria-label="行操作"] button');
        for (var i = 0; i < btns.length; i++) {
          if ((btns[i].textContent || '').trim() === '删除') { btns[i].click(); return true; }
        }
        return false;
      },
      // 重大改变确认框：只认自研弹窗（aria-label 唯一标识），不与 LineActionSheet 混淆
      majorDialogEl: function () { return document.querySelector('[aria-label="确认重大改变"]'); },
      majorDialogOpen: function () { return api.majorDialogEl() !== null; },
      majorDialogText: function () { var el = api.majorDialogEl(); return el ? el.textContent : null; },
      majorDialogLineCount: function () { var el = api.majorDialogEl(); return el ? el.querySelectorAll('li').length : -1; },
      majorDialogDelta: function () {
        var el = api.majorDialogEl(); if (!el) return null;
        var m = (el.textContent || '').match(/[+-]?\\d+ ms/);
        return m ? m[0] : null;
      },
      _majorBtn: function (label) {
        var el = api.majorDialogEl(); if (!el) return null;
        var btns = el.querySelectorAll('button');
        for (var i = 0; i < btns.length; i++) {
          if ((btns[i].textContent || '').trim() === label) return btns[i];
        }
        return null;
      },
      clickMajorConfirm: function () { var b = api._majorBtn('确认'); if (!b) return false; b.click(); return true; },
      clickMajorCancel: function () { var b = api._majorBtn('取消'); if (!b) return false; b.click(); return true; },
      clickMajorClose: function () {
        var el = api.majorDialogEl(); if (!el) return false;
        var b = el.querySelector('button[aria-label="关闭"]'); if (!b) return false; b.click(); return true;
      },
      toggleMajorDontShow: function () {
        var el = api.majorDialogEl(); if (!el) return false;
        var c = el.querySelector('input[type="checkbox"]'); if (!c) return false;
        c.click(); return c.checked;
      },
      // 提示宿主（非模态，role=status）
      toastOpen: function () { return document.querySelector('[role="status"]') !== null; },
      toastText: function () { var el = document.querySelector('[role="status"]'); return el ? el.textContent : null; },
      toastSeq: function () { return toastStore.getState().seq; },
      // ================== 视口跟随 / 屏外箭头 观测（AL~AW） ==================
      kernelReady: function () { return _ensureAll(); },
      clockPatched: function () { return window.__clkPatched === true; },
      clockPatchError: function () { return window.__clkPatchError || null; },
      clockResumePatched: function () { return window.__clkResumePatched === true; },
      setClockMs: function (ms) { window.__clk = (ms || 0) / 1000; return window.__clk * 1000; },
      getClockMs: function () { return (window.__clk || 0) * 1000; },
      // 快照本身不含 viewStartMs：startMs 只能从 frame 镜像读
      viewInfo: function () {
        if (!_ensureAll()) return null;
        var s = _kernel.getSnapshot();
        return {
          startMs: _last.startMs,
          windowStartMs: s.windowStartMs,
          windowEndMs: s.windowEndMs,
          pixelsPerMs: s.pixelsPerMs,
          durationMs: s.durationMs,
          minPixelsPerMs: s.minPixelsPerMs,
          viewportWidthPx: s.viewportWidthPx,
        };
      },
      viewStartMs: function () { _startMirror(); return _last.startMs; },
      viewSeq: function () { return _last.seq; },
      // 绝对定位：zoomToFit 后 viewStart 恒为 0，故可用绝对 pan 达到目标起点
      setView: function (startMs, visibleMs) {
        if (!_ensureAll()) return null;
        _startMirror();
        _kernel.zoomToFit();
        var s = _kernel.getSnapshot();
        var W = s.viewportWidthPx;
        if (!(W > 0) || !(visibleMs > 0)) return null;
        _kernel.zoomAt(0, (W / visibleMs) / s.pixelsPerMs);
        var s2 = _kernel.getSnapshot();
        var pp = s2.pixelsPerMs;
        _kernel.panByPixels(startMs * pp);
        return { startMs: _last.startMs, pixelsPerMs: pp, viewportWidthPx: W, durationMs: s2.durationMs };
      },
      followTargetFor: function (ms) {
        if (!_ensureAll()) return null;
        var s = _kernel.getSnapshot();
        var raw = ms - (s.viewportWidthPx * _ftr) / s.pixelsPerMs;
        var maxStart = Math.max(0, s.durationMs - s.viewportWidthPx / s.pixelsPerMs);
        return Math.max(0, Math.min(raw, maxStart));
      },
      setFollowPaused: function (b) { if (!_ensureAll()) return false; _kernel.setFollowPaused(!!b); return true; },
      snapView: function () { if (!_ensureAll()) return false; _kernel.snapViewToPlayhead(_adapters.audio.getCurrentTimeMs()); return true; },
      cancelFollowAnim: function () { if (!_ensureAll()) return false; _kernel.cancelFollowAnimation(); return true; },
      // ---- 音频观测 / 驱动 ----
      audioTimeMs: function () { return _ensureAll() ? _adapters.audio.getCurrentTimeMs() : null; },
      audioDurationMs: function () { return _ensureAll() ? _adapters.audio.getDurationMs() : null; },
      audioSpec: function () { return _ensureAll() ? _adapters.audio.getSpec() : null; },
      peakState: function () { return _ensureAll() ? _adapters.audio.getPeakState() : null; },
      peaks: function (s, e, b) {
        if (!_ensureAll()) return null;
        var p = _adapters.audio.getPeaks(s, e, b);
        return p ? 'ok:' + p.min.length : null;
      },
      isPlaying: function () { return store.getState().playback.isPlaying; },
      playAudio: function () { return _ensureAll() ? _adapters.audio.play() : null; },
      pauseAudio: function () { return _ensureAll() ? _adapters.audio.pause() : null; },
      seekAudio: function (ms) { return _ensureAll() ? _adapters.audio.seek(ms) : null; },
      // ---- 设置（hydrate 走白名单，用于验非法值回退） ----
      hydrateSettings: function (raw) {
        settingsStore.getState().hydrate(raw);
        return settingsStore.getState().settings;
      },
      // ---- viewStartMs 采样（frame 广播镜像） ----
      recordStart: function () { _startMirror(); _mrSamples = []; _mrStart = Date.now(); return _mrStart; },
      recSamples: function () { return _mrSamples.slice(); },
      recStop: function () { _mrStart = null; return _mrSamples.slice(); },
      recClear: function () { _mrSamples = []; return true; },
      // ---- DOM 定位 ----
      _rectOf: function (el) {
        if (!el) return null;
        var r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, width: r.width, height: r.height, right: r.right, bottom: r.bottom, x: r.left + r.width / 2, y: r.top + r.height / 2 };
      },
      importAudioButtonRect: function () {
        var btns = document.querySelectorAll('button');
        for (var i = 0; i < btns.length; i++) {
          if ((btns[i].textContent || '').trim().indexOf('导入音频') >= 0) return api._rectOf(btns[i]);
        }
        return null;
      },
      rulerRect: function () {
        var cs = document.querySelectorAll('canvas');
        for (var i = 0; i < cs.length; i++) {
          var cls = cs[i].className || '';
          if (cls.indexOf('cursor-col-resize') >= 0) {
            var r = cs[i].getBoundingClientRect();
            if (r.height > 0 && r.height <= 30) return api._rectOf(cs[i]);
          }
        }
        return null;
      },
      _scrollbarEls: function () {
        var ds = document.querySelectorAll('div');
        for (var i = 0; i < ds.length; i++) {
          var st = ds[i].style;
          if (st && st.height === '12px') {
            var th = ds[i].querySelector('div.rounded-full');
            if (th) return { track: ds[i], thumb: th };
          }
        }
        return null;
      },
      scrollbarTrackRect: function () { var e = api._scrollbarEls(); return api._rectOf(e && e.track); },
      scrollbarThumbRect: function () { var e = api._scrollbarEls(); return api._rectOf(e && e.thumb); },
      hintEl: function () { return document.querySelector('button[aria-label="跳转到屏幕外的播放头"]'); },
      resetEl: function () { return document.querySelector('button[aria-label="归位到播放头"]'); },
      hintDisplay: function () { var e = api.hintEl(); return e ? e.style.display : null; },
      hintOpacity: function () { var e = api.hintEl(); return e ? e.style.opacity : null; },
      hintVisible: function () { var e = api.hintEl(); return !!e && e.style.display !== 'none'; },
      hintMounted: function () { return api.hintEl() !== null; },
      hintText: function () { var e = api.hintEl(); return e ? e.textContent : null; },
      hintRect: function () { return api._rectOf(api.hintEl()); },
      hintHostRect: function () { var e = api.hintEl(); return api._rectOf(e && e.parentElement); },
      hintSide: function () {
        var e = api.hintEl();
        if (!e || e.style.display === 'none') return null;
        var host = api.hintHostRect();
        if (!host || host.width <= 0) return null;
        return api.hintRect().x < (host.left + host.width / 2) ? 'left' : 'right';
      },
      resetDisplay: function () { var e = api.resetEl(); return e ? e.style.display : null; },
      resetRect: function () { var e = api.resetEl(); return api._rectOf(e); },
      // 播放头层：className 含 will-change-transform，transform = translate3d(<x>px, 0, 0)
      playheadX: function () {
        var ds = document.querySelectorAll('div');
        for (var i = 0; i < ds.length; i++) {
          var cls = ds[i].className || '';
          if (cls.indexOf('will-change-transform') < 0) continue;
          var t = ds[i].style.transform || '';
          if (t.indexOf('translate3d') === 0) {
            var v = parseFloat(t.slice(t.indexOf('(') + 1, t.indexOf(',')));
            if (!isNaN(v)) return v;
          }
        }
        return null;
      },
      // ================== 音量滚轮 / 网格吸附 / 辅助线 / 设置面板（AY~BB） ==================
      volume: function () { return store.getState().playback.volume; },
      setVolume: function (v) { store.getState().setVolume(v); return store.getState().playback.volume; },
      volumeControlEl: function () { return document.querySelector('[data-volume-control] input[type="range"]'); },
      volumeControlRect: function () { return api._rectOf(api.volumeControlEl()); },
      // 对齐辅助线：inline display + dataset.snapMs（全程命令式，不落 React state）
      guideEl: function () { return document.querySelector('[data-snap-guide]'); },
      guideVisible: function () { var e = api.guideEl(); return !!e && e.style.display !== 'none'; },
      guideRect: function () { return api._rectOf(api.guideEl()); },
      guideTargetMs: function () {
        var e = api.guideEl();
        if (!e) return null;
        var v = e.dataset.snapMs;
        return v === undefined ? null : Number(v);
      },
      // 网格档位：与 LyricTrack 用同一 adaptiveGridMs + LABEL_MIN_GAP_PX 现算，不由 harness 猜测
      gridStepMs: function () {
        if (!_ensureAll()) return null;
        if (!_adaptiveGridMs || !(_labelMinGapPx > 0)) return null;
        var ppms = _kernel.getFrame().view.pixelsPerMs;
        if (!(ppms > 0)) return null;
        return _adaptiveGridMs(ppms, _labelMinGapPx);
      },
      // ---- 设置面板（固定搜索框 / 滚动内容区 / 固定 footer） ----
      openSettings: function () {
        var btns = document.querySelectorAll('button');
        for (var i = 0; i < btns.length; i++) {
          if ((btns[i].textContent || '').trim() === '设置') { btns[i].click(); return true; }
        }
        return false;
      },
      settingsPanelEl: function () { return document.querySelector('[data-settings-panel]'); },
      settingsPanelRect: function () { return api._rectOf(api.settingsPanelEl()); },
      settingsSearchEl: function () { return document.querySelector('[data-settings-search]'); },
      settingsSearchRect: function () { return api._rectOf(api.settingsSearchEl()); },
      settingsSearchSet: function (value) {
        var el = api.settingsSearchEl(); if (!el) return false;
        api._setNativeValue(el, value);
        return el.value;
      },
      settingsFooterEl: function () { return document.querySelector('[data-settings-footer]'); },
      settingsFooterRect: function () { return api._rectOf(api.settingsFooterEl()); },
      settingsScrollEl: function () { return document.querySelector('[data-settings-scroll]'); },
      settingsScrollSet: function (top) {
        var el = api.settingsScrollEl(); if (!el) return null;
        el.scrollTop = top;
        return el.scrollTop;
      },
      settingsScrollTop: function () { var el = api.settingsScrollEl(); return el ? el.scrollTop : null; },
      settingsVisibleItems: function () {
        var els = document.querySelectorAll('[data-settings-item]');
        var out = [];
        for (var i = 0; i < els.length; i++) out.push(els[i].getAttribute('data-settings-item'));
        return out;
      },
      settingsSelectOptions: function (id) {
        var el = document.querySelector('[data-settings-item="' + id + '"] select');
        if (!el) return null;
        var out = [];
        for (var i = 0; i < el.options.length; i++) {
          out.push({ value: el.options[i].value, label: (el.options[i].textContent || '').trim() });
        }
        return out;
      },
      settingsVisibleSections: function () {
        var els = document.querySelectorAll('[data-settings-section]');
        var out = [];
        for (var i = 0; i < els.length; i++) out.push(els[i].getAttribute('data-settings-section'));
        return out;
      },
      settingsItemChecked: function (id) {
        var el = document.querySelector('[data-settings-item="' + id + '"] input[type="checkbox"]');
        return el ? el.checked : null;
      },
      settingsItemDisabled: function (id) {
        var el = document.querySelector('[data-settings-item="' + id + '"] input[type="checkbox"]');
        return el ? el.disabled === true : null;
      },
      clickSettingsItem: function (id) {
        var el = document.querySelector('[data-settings-item="' + id + '"] input[type="checkbox"]');
        if (!el) return false;
        el.click();
        return true;
      },
      clickSettingsReset: function () {
        var footer = api.settingsFooterEl(); if (!footer) return false;
        var btns = footer.querySelectorAll('button');
        for (var i = 0; i < btns.length; i++) {
          if ((btns[i].textContent || '').trim() === '恢复默认') { btns[i].click(); return true; }
        }
        return false;
      },
      settingsResetInFooter: function () {
        var footer = api.settingsFooterEl(); if (!footer) return false;
        var btns = footer.querySelectorAll('button');
        for (var i = 0; i < btns.length; i++) {
          if ((btns[i].textContent || '').trim() === '恢复默认') return true;
        }
        return false;
      },
      settingsEmpty: function () { return document.querySelector('[data-settings-empty]') !== null; }
    };
    window.__lrc = api;
    window.__bootReady = true;
  })().catch(function (e) { window.__bootError = String((e && e.stack) || e); });
})();
`

/*
 * 假时钟注入（新文档、页面脚本之前执行）。
 * 只覆盖 AudioContext.prototype.currentTime 的 getter，让音频适配器读到 harness 可控时钟；
 * 其余（decodeAudioData / createBufferSource / onended）保持真实实现 → 真实 tick（16ms）。
 */
const CLOCK_BOOTSTRAP = `
(() => {
  window.__clk = 0;
  window.__clkPatched = false;
  window.__clkPatchError = null;
  window.__clkResumePatched = false;
  try {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { window.__clkPatchError = 'no AudioContext'; return; }
    var proto = AC.prototype;
    // currentTime 的 getter 可能挂在基类（BaseAudioContext）上，沿原型链找
    var desc = null, o = proto;
    while (o && !desc) {
      desc = Object.getOwnPropertyDescriptor(o, 'currentTime');
      if (!desc) o = Object.getPrototypeOf(o);
    }
    if (desc && typeof desc.get === 'function') {
      Object.defineProperty(proto, 'currentTime', { configurable: true, get: function () { return window.__clk; } });
      window.__clkPatched = true;
    } else {
      window.__clkPatchError = 'no currentTime getter on prototype chain';
    }
    if (typeof AC.prototype.resume === 'function') {
      AC.prototype.resume = function () { return Promise.resolve(); };
      window.__clkResumePatched = true;
    }
  } catch (e) {
    window.__clkPatchError = String((e && e.message) || e);
  }
})();
`

/* ------------------------------- helpers ------------------------------ */
function mouse(cdp, type, x, y, o = {}) {
  return cdp.send('Input.dispatchMouseEvent', {
    type,
    x,
    y,
    button: o.button ?? 'left',
    buttons: o.buttons ?? (type === 'mouseReleased' ? 0 : 1),
    clickCount: o.clickCount ?? 1,
    modifiers: o.modifiers ?? 0,
    pointerType: 'mouse',
  })
}

async function keyPress(cdp, code, key, vk) {
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown', code, key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk,
  })
  await sleep(10)
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp', code, key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk,
  })
  await sleep(30)
}

async function waitReady(cdp) {
  for (let i = 0; i < 400; i++) {
    let s
    try {
      s = await ev(cdp, 'window.__bootError ? ("err:" + window.__bootError) : (window.__bootReady === true ? "ready" : "wait")')
    } catch {
      s = 'wait'
    }
    if (s === 'ready') return
    if (typeof s === 'string' && s.startsWith('err:')) throw new Error(s)
    await sleep(50)
  }
  throw new Error('boot timeout')
}

async function reset(cdp) {
  const loaded = cdp.waitEvent('Page.loadEventFired').catch(() => {})
  await cdp.send('Page.navigate', { url: APP + '?run=' + Date.now() })
  await loaded
  await waitReady(cdp)
  // 稳定一帧（等 layout / ResizeObserver 完成首次 fit）
  await sleep(150)
}

async function readState(cdp, ids) {
  const [l0, l1, l2, l3] = ids
  return ev(
    cdp,
    `({ n: __lrc.logLen(),
        times: { l0: __lrc.times(${J(l0)}), l1: __lrc.times(${J(l1)}), l2: __lrc.times(${J(l2)}), l3: __lrc.times(${J(l3)}) },
        sel: __lrc.sel(),
        version: __lrc.state().document.version })`,
  )
}

function assert(checks, name, cond, detail = '') {
  checks.push({ name, ok: !!cond, detail })
}

async function clickBlock(cdp, id, modifiers = 0) {
  const p = await ev(cdp, `__lrc.point(${J(id)})`)
  if (!p) throw new Error('no rect for ' + id)
  const x = Math.round(p.x)
  const y = Math.round(p.y)
  const hit = await ev(cdp, `__lrc.elementAt(${x}, ${y})`)
  if (hit !== id) throw new Error(`click miss: at (${x},${y}) hit=${hit}, want ${id}`)
  await mouse(cdp, 'mousePressed', x, y, { modifiers, buttons: 1 })
  await sleep(15)
  await mouse(cdp, 'mouseReleased', x, y, { modifiers, buttons: 0 })
  await sleep(35)
}

/** 按下 → 两次 move 越过阈值 → 可选 mid 观测 → 松手。 */
async function dragBlock(cdp, id, dx, mid) {
  const p = await ev(cdp, `__lrc.point(${J(id)})`)
  if (!p) throw new Error('no rect for ' + id)
  const x0 = Math.round(p.x)
  const y0 = Math.round(p.y)
  const hit = await ev(cdp, `__lrc.elementAt(${x0}, ${y0})`)
  if (hit !== id) throw new Error(`drag miss: at (${x0},${y0}) hit=${hit}, want ${id}`)
  await mouse(cdp, 'mousePressed', x0, y0, { buttons: 1 })
  await sleep(20)
  await mouse(cdp, 'mouseMoved', x0 + Math.round(dx / 2), y0, { buttons: 1, button: 'left' })
  await sleep(15)
  await mouse(cdp, 'mouseMoved', x0 + dx, y0, { buttons: 1, button: 'left' })
  await sleep(20)
  if (mid) await mid()
  await mouse(cdp, 'mouseReleased', x0 + dx, y0, { buttons: 0 })
  await sleep(60)
  return { x0, y0, x1: x0 + dx }
}

/**
 * 点击可见行 index 的删除按钮（走单行 removeLine）。
 * 行内「删除」按钮仅在面板不窄时渲染；收窄时回退到 ⋮ 弹窗底部菜单。
 * 两条路径都真实触发 onClick -> removeLine(line.id)。
 * @returns {'inline'|'sheet'} 实际走到的路径
 */
async function deleteRow(cdp, index) {
  const count = await ev(cdp, '__lrc.rowDeleteCount()')
  if (count > index) {
    const ok = await ev(cdp, `__lrc.clickInlineDelete(${index})`)
    if (!ok) throw new Error('inline delete click failed: index=' + index)
    await sleep(60)
    return 'inline'
  }
  const opened = await ev(cdp, `__lrc.openSheet(${index})`)
  if (opened < 0) throw new Error('openSheet failed: index=' + index)
  await sleep(200)
  const ok = await ev(cdp, '__lrc.clickSheetDelete()')
  if (!ok) throw new Error('sheet delete click failed: index=' + index)
  await sleep(60)
  return 'sheet'
}

/* ------------- AL~AW：视口跟随 / 屏外箭头 验收基础设施 ------------- */

/** 静音 WAV 路径：8kHz / 16bit / mono / 60s，data 全零 = 静音。 */
const WAV_PATH = path.join(os.tmpdir(), 'lrc-cdp', 'silence-60s.wav')

/** 生成静音 WAV（幂等）：真实 decode 得真 buffer，走真实文件入口导入。 */
function ensureSilenceWav() {
  fs.mkdirSync(path.dirname(WAV_PATH), { recursive: true })
  if (fs.existsSync(WAV_PATH) && fs.statSync(WAV_PATH).size > 44) return WAV_PATH
  const sampleRate = 8000
  const channels = 1
  const bits = 16
  const dataSize = sampleRate * 60 * channels * (bits / 8)
  const buf = Buffer.alloc(44 + dataSize) // 全零即静音
  buf.write('RIFF', 0, 'ascii')
  buf.writeUInt32LE(36 + dataSize, 4)
  buf.write('WAVE', 8, 'ascii')
  buf.write('fmt ', 12, 'ascii')
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20) // PCM
  buf.writeUInt16LE(channels, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * channels * (bits / 8), 28) // byteRate
  buf.writeUInt16LE(channels * (bits / 8), 32) // blockAlign
  buf.writeUInt16LE(bits, 34)
  buf.write('data', 36, 'ascii')
  buf.writeUInt32LE(dataSize, 40)
  fs.writeFileSync(WAV_PATH, buf)
  return WAV_PATH
}

/** 点「导入音频」→ 拦截文件选择框 → 塞入静音 WAV（真实 decode 路径）。 */
async function importAudio(cdp) {
  ensureSilenceWav()
  const rect = await ev(cdp, '__lrc.importAudioButtonRect()')
  if (!rect) throw new Error('import audio button not found')
  const x = Math.round(rect.x)
  const y = Math.round(rect.y)
  const chooser = cdp.waitEvent('Page.fileChooserOpened', 12000).catch(() => null)
  await mouse(cdp, 'mousePressed', x, y, { buttons: 1 })
  await mouse(cdp, 'mouseReleased', x, y, { buttons: 0 })
  const params = await chooser
  if (params && params.backendNodeId) {
    await cdp.send('DOM.setFileInputFiles', { files: [WAV_PATH], backendNodeId: params.backendNodeId })
    return 'chooser'
  }
  // 兜底：直接找页面上的隐藏 input[type=file]
  const doc = await cdp.send('DOM.getDocument', { depth: -1 })
  const q = await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[type=file]' })
  if (!q || !q.nodeId) throw new Error('no file input for fallback')
  await cdp.send('DOM.setFileInputFiles', { files: [WAV_PATH], nodeId: q.nodeId })
  return 'fallback'
}

/** 等音频时长就绪 + 峰值金字塔 ready。返回时长（ms）。 */
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

/** 导入静音 WAV 并等到时长 / 峰值都就绪。 */
async function setupAudio(cdp) {
  await importAudio(cdp)
  return waitAudioReady(cdp)
}

/** 把假时钟对准 atMs 并开始播放（真实 16ms tick）。 */
async function armPlayback(cdp, atMs) {
  await ev(cdp, `__lrc.setClockMs(${atMs})`)
  await ev(cdp, '__lrc.pauseAudio()')
  await ev(cdp, `__lrc.seekAudio(${atMs})`)
  await ev(cdp, '__lrc.playAudio()')
  for (let i = 0; i < 40; i++) {
    if (await ev(cdp, '__lrc.isPlaying()')) return true
    await sleep(25)
  }
  return false
}

/** 推进假时钟并等真实 tick 把视口 / 箭头刷到新状态。 */
async function advanceTo(cdp, targetMs, settleMs = 320) {
  await ev(cdp, `__lrc.setClockMs(${targetMs})`)
  await sleep(settleMs)
}

/** 绝对设定视口：起点 startMs + 可见 visibleMs；返回落定后的实际参数。 */
async function setView(cdp, startMs, visibleMs) {
  const req = await ev(cdp, `__lrc.setView(${startMs}, ${visibleMs})`)
  await sleep(60)
  const info = await ev(cdp, '__lrc.viewInfo()')
  return { req, info }
}

/** 真实滚轮；不设 button（滚轮不是按键）。 */
async function wheelAt(cdp, x, y, deltaX, deltaY, modifiers = 0) {
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseWheel', x, y, deltaX, deltaY, modifiers, pointerType: 'mouse',
  })
}

function pressAt(cdp, x, y, modifiers = 0) {
  return mouse(cdp, 'mousePressed', x, y, { buttons: 1, modifiers })
}
function moveTo(cdp, x, y, modifiers = 0) {
  return mouse(cdp, 'mouseMoved', x, y, { buttons: 1, button: 'left', modifiers })
}
function releaseAt(cdp, x, y, modifiers = 0) {
  return mouse(cdp, 'mouseReleased', x, y, { buttons: 0, modifiers })
}

/** 相邻去重后的采样序列（只看落在 [lo, hi] 的值），用于数"中间值个数"。 */
function distinctValues(samples, lo, hi) {
  const out = []
  for (const s of samples) {
    const v = s.s
    if (v < lo || v > hi) continue
    if (out.length === 0 || Math.abs(out[out.length - 1] - v) > 0.5) out.push(v)
  }
  return out
}

async function viewStart(cdp) {
  return ev(cdp, '__lrc.viewStartMs()')
}

/** 视口几何（pixelsPerMs / viewportWidthPx / durationMs），用于运行时现算期望值。 */
async function viewGeom(cdp) {
  const info = await ev(cdp, '__lrc.viewInfo()')
  return info
}

/** 选一个当前可见的歌词块，返回其命中点。 */
async function pickBlockPoint(cdp) {
  const ids = await ev(cdp, '__lrc.ids()')
  for (const id of ids) {
    const p = await ev(cdp, `__lrc.point(${J(id)})`)
    if (!p) continue
    const hit = await ev(cdp, `__lrc.elementAt(${Math.round(p.x)}, ${Math.round(p.y)})`)
    if (hit === id) return { id, x: Math.round(p.x), y: Math.round(p.y) }
  }
  throw new Error('no clickable block')
}

/** 时间轴条内的一个可命中点（ruler 中点，兜底 hint 宿主中点），供滚轮定位。 */
async function stripPoint(cdp) {
  const r = (await ev(cdp, '__lrc.rulerRect()')) || (await ev(cdp, '__lrc.hintHostRect()'))
  if (!r || !(r.width > 0)) throw new Error('no strip point')
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
}

/* -------------------------------- tests ------------------------------- */
async function testA(cdp, checks) {
  const ids = await ev(cdp, '__lrc.ids()')
  const [l0, l1, l2, l3] = ids
  // 本用例验「拖动即落盘」的旧路径：关掉重大改变确认，避免卡在弹窗（确认框有独立用例 Y/Z/AA）
  await ev(cdp, '__lrc.updateSettings({ confirmMajorChange: false })')
  await clickBlock(cdp, l0)
  await clickBlock(cdp, l1, MOD.ctrl)
  const setup = await ev(cdp, '__lrc.sel()')
  assert(checks, 'A.setup 选中 [l0,l1]，锚点=l1', eq(setup.lineIds, [l0, l1]) && setup.anchorLineId === l1, J(setup))
  const ppms = await ev(cdp, '__lrc.ppms()')
  const dx = Math.round(900 * ppms)
  const before = await readState(cdp, ids)
  await dragBlock(cdp, l0, dx)
  const after = await readState(cdp, ids)
  const last = await ev(cdp, '__lrc.last()')
  const off = last.delta.offsetMs
  assert(checks, 'A.新增恰好一条日志', after.n === before.n + 1, `${before.n} -> ${after.n}`)
  assert(checks, 'A.kind=selection-offset', last.kind === 'selection-offset', last.kind)
  assert(checks, 'A.scope=参与集{l0,l1}', eq(last.scope.lineIds.slice().sort(), [l0, l1].sort()), J(last.scope.lineIds))
  const d0 = after.times.l0[0] - before.times.l0[0]
  const d1 = after.times.l1[0] - before.times.l1[0]
  assert(checks, 'A.整组等量位移', d0 === off && d1 === off, `Δl0=${d0} Δl1=${d1} offsetMs=${off}`)
  assert(checks, 'A.位移量 ≥ 10ms', Math.abs(off) >= 10, String(off))
  assert(checks, 'A.非参与行不动', eq(after.times.l2, before.times.l2) && eq(after.times.l3, before.times.l3), `${J(after.times.l2)} ${J(after.times.l3)}`)
  assert(checks, 'A.[附加] 拖动后选区保持', eq(after.sel.lineIds, before.sel.lineIds), J(after.sel))
}

async function testB(cdp, checks) {
  const ids = await ev(cdp, '__lrc.ids()')
  const [l0, l1] = ids
  await clickBlock(cdp, l0)
  await clickBlock(cdp, l1, MOD.ctrl)
  const ppms = await ev(cdp, '__lrc.ppms()')
  const dx = Math.round(900 * ppms)
  const p = await ev(cdp, `__lrc.point(${J(l0)})`)
  const x0 = Math.round(p.x)
  const y0 = Math.round(p.y)
  const before = await readState(cdp, ids)
  await mouse(cdp, 'mousePressed', x0, y0, { buttons: 1 })
  await sleep(20)
  await mouse(cdp, 'mouseMoved', x0 + Math.round(dx / 2), y0, { buttons: 1, button: 'left' })
  await sleep(20)
  await mouse(cdp, 'mouseMoved', x0 + dx, y0, { buttons: 1, button: 'left' })
  await sleep(30)
  const mid = await readState(cdp, ids)
  assert(checks, 'B.拖动中日志零新增', mid.n === before.n, `${before.n} -> ${mid.n}`)
  assert(checks, 'B.拖动中行时间戳不变', eq(mid.times.l0, before.times.l0) && eq(mid.times.l1, before.times.l1), `${J(mid.times.l0)} ${J(mid.times.l1)}`)
  assert(checks, 'B.拖动中 document.version 不变', mid.version === before.version, `${before.version} -> ${mid.version}`)
  await mouse(cdp, 'mouseReleased', x0 + dx, y0, { buttons: 0 })
  await sleep(60)
}

async function testC(cdp, checks) {
  const ids = await ev(cdp, '__lrc.ids()')
  const [l0, l1] = ids
  await clickBlock(cdp, l0)
  await clickBlock(cdp, l1, MOD.ctrl)
  const ppms = await ev(cdp, '__lrc.ppms()')
  const dx = Math.round(900 * ppms)
  const p = await ev(cdp, `__lrc.point(${J(l0)})`)
  const x0 = Math.round(p.x)
  const y0 = Math.round(p.y)
  await mouse(cdp, 'mousePressed', x0, y0, { buttons: 1 })
  await sleep(20)
  await mouse(cdp, 'mouseMoved', x0 + dx, y0, { buttons: 1, button: 'left' })
  await sleep(30)
  const s0 = await ev(cdp, `__lrc.style(${J(l0)})`)
  const s1 = await ev(cdp, `__lrc.style(${J(l1)})`)
  const okTransform = (s) => typeof s.transform === 'string' && s.transform.indexOf('translate3d') === 0
  assert(checks, 'C.l0 命令式 transform 生效', okTransform(s0), J(s0))
  assert(checks, 'C.l1 命令式 transform 生效', okTransform(s1), J(s1))
  assert(checks, 'C.l0 层级抬升 zIndex=10', s0.zIndex === '10', J(s0))
  assert(checks, 'C.l0 光标 grabbing', s0.cursor === 'grabbing', J(s0))
  await mouse(cdp, 'mouseReleased', x0 + dx, y0, { buttons: 0 })
  await sleep(60)
}

async function testD(cdp, checks) {
  const ids = await ev(cdp, '__lrc.ids()')
  const [l0, l1] = ids
  // 关确认框：本用例验「松手即清理命令式样式」，需走拖动即落盘的旧路径
  await ev(cdp, '__lrc.updateSettings({ confirmMajorChange: false })')
  await clickBlock(cdp, l0)
  await clickBlock(cdp, l1, MOD.ctrl)
  const ppms = await ev(cdp, '__lrc.ppms()')
  const dx = Math.round(900 * ppms)
  await dragBlock(cdp, l0, dx)
  const s0 = await ev(cdp, `__lrc.style(${J(l0)})`)
  const s1 = await ev(cdp, `__lrc.style(${J(l1)})`)
  const clean = (s) => s.transform === '' && s.zIndex === '' && s.cursor === ''
  assert(checks, 'D.l0 松手后命令式样式清理', clean(s0), J(s0))
  assert(checks, 'D.l1 松手后命令式样式清理', clean(s1), J(s1))
}

async function testE(cdp, checks) {
  const ids = await ev(cdp, '__lrc.ids()')
  const [l0, l1] = ids
  await clickBlock(cdp, l0)
  const ppms = await ev(cdp, '__lrc.ppms()')
  const dx = Math.round(900 * ppms)
  const before = await readState(cdp, ids)
  await dragBlock(cdp, l0, dx)
  const after = await readState(cdp, ids)
  const last = await ev(cdp, '__lrc.last()')
  assert(checks, 'E.单块已打轴拖动 → 一条 manual-nudge', last.kind === 'manual-nudge', last.kind)
  assert(checks, 'E.scope=[l0]', eq(last.scope.lineIds, [l0]), J(last.scope.lineIds))
  assert(checks, 'E.日志+1', after.n === before.n + 1, `${before.n} -> ${after.n}`)
  assert(checks, 'E.l0 位移 = offsetMs', after.times.l0[0] - before.times.l0[0] === last.delta.offsetMs, `Δ=${after.times.l0[0] - before.times.l0[0]} off=${last.delta.offsetMs}`)
  assert(checks, 'E.l1 未动', eq(after.times.l1, before.times.l1), J(after.times.l1))
}

async function testF(cdp, checks) {
  const ids = await ev(cdp, '__lrc.ids()')
  const u = await ev(cdp, `__lrc.addBlank('未打轴F')`)
  await sleep(80)
  await clickBlock(cdp, u)
  const selBefore = await ev(cdp, '__lrc.sel()')
  assert(checks, 'F.setup 选中未打轴行', eq(selBefore.lineIds, [u]), J(selBefore))
  const ppms = await ev(cdp, '__lrc.ppms()')
  const dx = Math.round(900 * ppms)
  const n0 = await ev(cdp, '__lrc.logLen()')
  const before = await ev(cdp, `__lrc.times(${J(u)})`)
  await dragBlock(cdp, u, dx)
  const after = await ev(cdp, `__lrc.times(${J(u)})`)
  const last = await ev(cdp, '__lrc.last()')
  const n1 = await ev(cdp, '__lrc.logLen()')
  assert(checks, 'F.单块未打轴拖动 → 一条 manual-timestamp', last.kind === 'manual-timestamp', last.kind)
  assert(checks, 'F.scope=[u]', eq(last.scope.lineIds, [u]), J(last.scope.lineIds))
  assert(checks, 'F.日志+1', n1 === n0 + 1, `${n0} -> ${n1}`)
  assert(checks, 'F.未打轴 → 已打轴（1 个时间戳）', before.length === 0 && after.length === 1, `${J(before)} -> ${J(after)}`)
  assert(checks, 'F.落点 ≥ 10ms', after[0] >= 10, J(after))
}

async function testG(cdp, checks) {
  const ids = await ev(cdp, '__lrc.ids()')
  const [l0, l1, l2] = ids
  const sel0 = await ev(cdp, '__lrc.sel()')
  assert(checks, 'G.setup 初始无选中', sel0.lineIds.length === 0, J(sel0))
  const n0 = await ev(cdp, '__lrc.logLen()')
  const p = await ev(cdp, `__lrc.point(${J(l2)})`)
  const x0 = Math.round(p.x)
  const y0 = Math.round(p.y)
  await mouse(cdp, 'mousePressed', x0, y0, { buttons: 1 })
  await sleep(20)
  await mouse(cdp, 'mouseMoved', x0 + 2, y0, { buttons: 1, button: 'left' })
  await sleep(20)
  await mouse(cdp, 'mouseReleased', x0 + 2, y0, { buttons: 0 })
  await sleep(50)
  const sel = await ev(cdp, '__lrc.sel()')
  const n1 = await ev(cdp, '__lrc.logLen()')
  const st = await ev(cdp, `__lrc.style(${J(l2)})`)
  assert(checks, 'G.阈值内 → 普通单选 l2', eq(sel.lineIds, [l2]) && sel.activeLineId === l2, J(sel))
  assert(checks, 'G.零日志（零.3）', n1 === n0, `${n0} -> ${n1}`)
  assert(checks, 'G.未留下命令式样式', st.transform === '' && st.zIndex === '', J(st))
  assert(checks, 'G.l0/l1 未被选中', !sel.lineIds.includes(l0) && !sel.lineIds.includes(l1), J(sel.lineIds))
}

async function testH(cdp, checks) {
  const ids = await ev(cdp, '__lrc.ids()')
  const [l0, l1] = ids
  await clickBlock(cdp, l0)
  const s1 = await ev(cdp, '__lrc.sel()')
  assert(checks, 'H.点击 l0 → [l0]', eq(s1.lineIds, [l0]) && s1.activeLineId === l0, J(s1))
  await clickBlock(cdp, l1, MOD.ctrl)
  const s2 = await ev(cdp, '__lrc.sel()')
  assert(checks, 'H.Ctrl 加选 l1 → [l0,l1]', eq(s2.lineIds, [l0, l1]) && s2.activeLineId === l1, J(s2))
  await clickBlock(cdp, l1, MOD.ctrl)
  const s3 = await ev(cdp, '__lrc.sel()')
  assert(checks, 'H.Ctrl 再点 l1 → 减选 [l0]', eq(s3.lineIds, [l0]), J(s3))
}

async function testI(cdp, checks) {
  const ids = await ev(cdp, '__lrc.ids()')
  const [l0, l1, l2] = ids
  await clickBlock(cdp, l0)
  await clickBlock(cdp, l2, MOD.shift)
  const sel = await ev(cdp, '__lrc.sel()')
  assert(checks, 'I.Shift 范围选 l0..l2 = [l0,l1,l2]', eq(sel.lineIds, [l0, l1, l2]), J(sel))
  assert(checks, 'I.activeLineId=l2（目标本身是同类型成员）', sel.activeLineId === l2, J(sel))
  assert(checks, 'I.锚点不变 = l0', sel.anchorLineId === l0, J(sel))
}

async function testJ(cdp, checks) {
  const u1 = await ev(cdp, `__lrc.addBlank('未打轴J1')`)
  await sleep(40)
  const u2 = await ev(cdp, `__lrc.addBlank('未打轴J2')`)
  await sleep(80)
  await clickBlock(cdp, u1)
  await clickBlock(cdp, u2, MOD.ctrl)
  const setup = await ev(cdp, '__lrc.sel()')
  assert(checks, 'J.setup 未打轴多选 [u1,u2]', eq(setup.lineIds, [u1, u2]), J(setup))

  const ppms = await ev(cdp, '__lrc.ppms()')
  const dx = Math.round(900 * ppms)
  const p = await ev(cdp, `__lrc.point(${J(u1)})`)
  const x0 = Math.round(p.x)
  const y0 = Math.round(p.y)
  const n0 = await ev(cdp, '__lrc.logLen()')

  await mouse(cdp, 'mousePressed', x0, y0, { buttons: 1 })
  await sleep(20)
  const stDown = await ev(cdp, `__lrc.style(${J(u1)})`)
  assert(checks, 'J.按下 → 光标 not-allowed', stDown.cursor === 'not-allowed', J(stDown))

  await mouse(cdp, 'mouseMoved', x0 + dx, y0, { buttons: 1, button: 'left' })
  await sleep(30)
  const stMove = await ev(cdp, `__lrc.style(${J(u1)})`)
  const n1 = await ev(cdp, '__lrc.logLen()')
  const selMove = await ev(cdp, '__lrc.sel()')
  assert(checks, 'J.越阈值拖动 → 不位移（无 transform）', stMove.transform === '', J(stMove))
  assert(checks, 'J.拖动中零日志', n1 === n0, `${n0} -> ${n1}`)
  assert(checks, 'J.拖动中选区不变', eq(selMove.lineIds, [u1, u2]), J(selMove))

  await mouse(cdp, 'mouseReleased', x0 + dx, y0, { buttons: 0 })
  await sleep(60)
  const selAfter = await ev(cdp, '__lrc.sel()')
  const n2 = await ev(cdp, '__lrc.logLen()')
  const stAfter = await ev(cdp, `__lrc.style(${J(u1)})`)
  assert(checks, 'J.松手 → 零日志、选区不变', n2 === n0 && eq(selAfter.lineIds, [u1, u2]), `${n0} -> ${n2} ${J(selAfter)}`)
  assert(checks, 'J.松手 → not-allowed 光标清理', stAfter.cursor === '', J(stAfter))
}

async function testK(cdp, checks) {
  const u1 = await ev(cdp, `__lrc.addBlank('未打轴K1')`)
  await sleep(40)
  const u2 = await ev(cdp, `__lrc.addBlank('未打轴K2')`)
  await sleep(80)
  await clickBlock(cdp, u1)
  await clickBlock(cdp, u2, MOD.ctrl)
  const setup = await ev(cdp, '__lrc.sel()')
  assert(checks, 'K.setup 未打轴多选 [u1,u2]', eq(setup.lineIds, [u1, u2]), J(setup))

  const n0 = await ev(cdp, '__lrc.logLen()')
  const p = await ev(cdp, `__lrc.point(${J(u1)})`)
  const x0 = Math.round(p.x)
  const y0 = Math.round(p.y)
  await mouse(cdp, 'mousePressed', x0, y0, { buttons: 1 })
  await sleep(20)
  await mouse(cdp, 'mouseMoved', x0 + 2, y0, { buttons: 1, button: 'left' })
  await sleep(20)
  await mouse(cdp, 'mouseReleased', x0 + 2, y0, { buttons: 0 })
  await sleep(50)
  const sel = await ev(cdp, '__lrc.sel()')
  const n1 = await ev(cdp, '__lrc.logLen()')
  assert(checks, 'K.blocked 未越阈值 → 当普通点击（选区归为被按行）', eq(sel.lineIds, [u1]) && sel.activeLineId === u1, J(sel))
  assert(checks, 'K.零日志', n1 === n0, `${n0} -> ${n1}`)
}

async function testL(cdp, checks) {
  const ids = await ev(cdp, '__lrc.ids()')
  const [l0, l1, , l3] = ids
  await clickBlock(cdp, l0)
  const ppms = await ev(cdp, '__lrc.ppms()')
  const dx = Math.round(900 * ppms)
  const before = await readState(cdp, ids)

  const p = await ev(cdp, `__lrc.point(${J(l3)})`)
  const x0 = Math.round(p.x)
  const y0 = Math.round(p.y)
  await mouse(cdp, 'mousePressed', x0, y0, { buttons: 1 })
  await sleep(20)
  const selDown = await ev(cdp, '__lrc.sel()')
  assert(checks, 'L.按下未选中块 → 先归为单选 [l3]', eq(selDown.lineIds, [l3]), J(selDown))
  await mouse(cdp, 'mouseMoved', x0 + dx, y0, { buttons: 1, button: 'left' })
  await sleep(30)
  await mouse(cdp, 'mouseReleased', x0 + dx, y0, { buttons: 0 })
  await sleep(60)

  const after = await readState(cdp, ids)
  const last = await ev(cdp, '__lrc.last()')
  assert(checks, 'L.拖动只动 l3（scope=[l3]）', last.kind === 'manual-nudge' && eq(last.scope.lineIds, [l3]), `${last.kind} ${J(last.scope.lineIds)}`)
  assert(checks, 'L.l3 已移动', after.times.l3[0] !== before.times.l3[0], `${J(before.times.l3)} -> ${J(after.times.l3)}`)
  assert(checks, 'L.l0 未动（原选中被归位）', eq(after.times.l0, before.times.l0), `${J(before.times.l0)} -> ${J(after.times.l0)}`)
  assert(checks, 'L.l1 未动', eq(after.times.l1, before.times.l1), `${J(before.times.l1)} -> ${J(after.times.l1)}`)
}

async function testM(cdp, checks) {
  const ids = await ev(cdp, '__lrc.ids()')
  const [l0, l1, l2] = ids
  // 多选
  await clickBlock(cdp, l0)
  await clickBlock(cdp, l1, MOD.ctrl)
  const before = await readState(cdp, ids)
  await ev(cdp, '__lrc.blur()')
  await keyPress(cdp, 'ArrowRight', 'ArrowRight', 39)
  const mid = await readState(cdp, ids)
  const lastMulti = await ev(cdp, '__lrc.last()')
  assert(checks, 'M.多选方向键 → 一条 selection-offset', lastMulti.kind === 'selection-offset' && mid.n === before.n + 1, `${lastMulti.kind} ${before.n} -> ${mid.n}`)
  assert(checks, 'M.多选步长 = +10ms', lastMulti.delta.offsetMs === 10, String(lastMulti.delta.offsetMs))
  assert(checks, 'M.整组 +10ms', mid.times.l0[0] - before.times.l0[0] === 10 && mid.times.l1[0] - before.times.l1[0] === 10, `${mid.times.l0[0] - before.times.l0[0]} ${mid.times.l1[0] - before.times.l1[0]}`)
  assert(checks, 'M.非选中 l2 不动', eq(mid.times.l2, before.times.l2), J(mid.times.l2))

  // 单选
  await clickBlock(cdp, l2)
  const before1 = await readState(cdp, ids)
  await ev(cdp, '__lrc.blur()')
  await keyPress(cdp, 'ArrowRight', 'ArrowRight', 39)
  const after1 = await readState(cdp, ids)
  const lastSingle = await ev(cdp, '__lrc.last()')
  assert(checks, 'M.单选方向键 → 一条 manual-nudge', lastSingle.kind === 'manual-nudge' && after1.n === before1.n + 1, `${lastSingle.kind} ${before1.n} -> ${after1.n}`)
  assert(checks, 'M.单选步长 = +10ms', after1.times.l2[0] - before1.times.l2[0] === 10, `${before1.times.l2[0]} -> ${after1.times.l2[0]}`)
}

/* -------------------- 第二批 N~S：去类型化 / 入口拒绝 / 多选删除 -------------------- */

// N. 选择层去类型化：Ctrl toggle 异类、Shift 范围跨类型全纳入
async function testN(cdp, checks) {
  const ids = await ev(cdp, '__lrc.ids()')
  const [, , , l3] = ids
  const u1 = await ev(cdp, `__lrc.addBlank('未打轴N1')`)
  await sleep(40)
  const u2 = await ev(cdp, `__lrc.addBlank('未打轴N2')`)
  await sleep(80)

  // N1: Ctrl+点击异类（已打轴 l0 + 未打轴 u1）→ 正常加选
  await clickBlock(cdp, ids[0])
  await clickBlock(cdp, u1, MOD.ctrl)
  const s1 = await ev(cdp, '__lrc.sel()')
  assert(checks, 'N.异类 Ctrl 加选 → [l0,u1]', eq(s1.lineIds, [ids[0], u1]) && s1.activeLineId === u1, J(s1))

  // N2: Ctrl 再点已打轴成员 → 正常减选
  await clickBlock(cdp, ids[0], MOD.ctrl)
  const s2 = await ev(cdp, '__lrc.sel()')
  assert(checks, 'N.异类 Ctrl 减选 → [u1]', eq(s2.lineIds, [u1]), J(s2))

  // N3: Shift 范围跨类型全纳入（anchor=l3 → target=u2 → [l3,u1,u2]）
  await ev(cdp, '__lrc.clearSel()')
  await clickBlock(cdp, l3)
  await clickBlock(cdp, u2, MOD.shift)
  const s3 = await ev(cdp, '__lrc.sel()')
  assert(checks, 'N.Shift 范围跨类型全纳入 → [l3,u1,u2]', eq(s3.lineIds, [l3, u1, u2]), J(s3))
  assert(checks, 'N.Shift 范围 active=目标 u2', s3.activeLineId === u2, J(s3))
  assert(checks, 'N.Shift 范围 anchor=l3 不变', s3.anchorLineId === l3, J(s3))
}

// O. 拖动入口集合级判定：混合→not-allowed；纯已打轴→整组
async function testO(cdp, checks) {
  const ids = await ev(cdp, '__lrc.ids()')
  const [l0, l1, l2, l3] = ids
  const u = await ev(cdp, `__lrc.addBlank('未打轴O')`)
  await sleep(80)
  // O2 验「纯已打轴多选 → 拖动即落盘」的旧路径：关确认框（确认框流程另见 Y/Z/AA）
  await ev(cdp, '__lrc.updateSettings({ confirmMajorChange: false })')

  // O1: 混合集合 [l0,u] → blocked
  await clickBlock(cdp, l0)
  await clickBlock(cdp, u, MOD.ctrl)
  const setup = await ev(cdp, '__lrc.sel()')
  assert(checks, 'O.setup 混合集合 [l0,u]', eq(setup.lineIds, [l0, u]), J(setup))

  const ppms = await ev(cdp, '__lrc.ppms()')
  const dx = Math.round(900 * ppms)
  const p = await ev(cdp, `__lrc.point(${J(l0)})`)
  const x0 = Math.round(p.x)
  const y0 = Math.round(p.y)
  const n0 = await ev(cdp, '__lrc.logLen()')
  const t0 = await ev(cdp, `__lrc.times(${J(l0)})`)

  await mouse(cdp, 'mousePressed', x0, y0, { buttons: 1 })
  await sleep(20)
  const stDown = await ev(cdp, `__lrc.style(${J(l0)})`)
  assert(checks, 'O.混合集合按下 → not-allowed', stDown.cursor === 'not-allowed', J(stDown))
  await mouse(cdp, 'mouseMoved', x0 + dx, y0, { buttons: 1, button: 'left' })
  await sleep(30)
  const stMove = await ev(cdp, `__lrc.style(${J(l0)})`)
  const n1 = await ev(cdp, '__lrc.logLen()')
  const selMove = await ev(cdp, '__lrc.sel()')
  assert(checks, 'O.混合集合越阈值 → 不位移', stMove.transform === '', J(stMove))
  assert(checks, 'O.混合集合拖动中零日志', n1 === n0, `${n0} -> ${n1}`)
  assert(checks, 'O.混合集合拖动中选区不变', eq(selMove.lineIds, [l0, u]), J(selMove))
  await mouse(cdp, 'mouseReleased', x0 + dx, y0, { buttons: 0 })
  await sleep(60)
  const n2 = await ev(cdp, '__lrc.logLen()')
  const t1 = await ev(cdp, `__lrc.times(${J(l0)})`)
  const selAfter = await ev(cdp, '__lrc.sel()')
  assert(checks, 'O.混合集合松手 → 零日志、零位移、选区不变', n2 === n0 && eq(t1, t0) && eq(selAfter.lineIds, [l0, u]), `${n0} -> ${n2} ${J(t1)} ${J(selAfter)}`)

  // O2: 纯已打轴多选 [l0,l1,l2] → multi（整组）
  await clickBlock(cdp, l0)
  await clickBlock(cdp, l1, MOD.ctrl)
  await clickBlock(cdp, l2, MOD.ctrl)
  const before = await readState(cdp, ids)
  await dragBlock(cdp, l0, dx)
  const after = await readState(cdp, ids)
  const last = await ev(cdp, '__lrc.last()')
  assert(checks, 'O.已打轴多选拖动 → 一条 selection-offset', last.kind === 'selection-offset' && after.n === before.n + 1, `${last.kind} ${before.n} -> ${after.n}`)
  assert(checks, 'O.scope=[l0,l1,l2]', eq(last.scope.lineIds.slice().sort(), [l0, l1, l2].sort()), J(last.scope.lineIds))
  const d0 = after.times.l0[0] - before.times.l0[0]
  const d1 = after.times.l1[0] - before.times.l1[0]
  const d2 = after.times.l2[0] - before.times.l2[0]
  assert(checks, 'O.整组等量位移 = offsetMs', d0 === last.delta.offsetMs && d1 === last.delta.offsetMs && d2 === last.delta.offsetMs, `${d0} ${d1} ${d2} off=${last.delta.offsetMs}`)
  assert(checks, 'O.非参与 l3 不动', eq(after.times.l3, before.times.l3), J(after.times.l3))
}

// P. 微调入口判定：混合拒绝；纯已打轴整组；单选未打轴/无选中静默
async function testP(cdp, checks) {
  const ids = await ev(cdp, '__lrc.ids()')
  const [l0, l1] = ids
  const u = await ev(cdp, `__lrc.addBlank('未打轴P')`)
  await sleep(80)

  // P1: 混合集合 [l0,u] → 静默拒绝
  await clickBlock(cdp, l0)
  await clickBlock(cdp, u, MOD.ctrl)
  await ev(cdp, '__lrc.blur()')
  const p0 = await readState(cdp, ids)
  await keyPress(cdp, 'ArrowRight', 'ArrowRight', 39)
  const p1 = await readState(cdp, ids)
  const selP1 = await ev(cdp, '__lrc.sel()')
  assert(checks, 'P.混合集合微调 → 零日志', p1.n === p0.n, `${p0.n} -> ${p1.n}`)
  assert(checks, 'P.混合集合微调 → 零位移', eq(p1.times.l0, p0.times.l0), `${J(p0.times.l0)} -> ${J(p1.times.l0)}`)
  assert(checks, 'P.混合集合微调 → 选区不变', eq(selP1.lineIds, [l0, u]), J(selP1))

  // P2: 纯已打轴 ≥2 → 一条 selection-offset +10ms
  await clickBlock(cdp, l0)
  await clickBlock(cdp, l1, MOD.ctrl)
  await ev(cdp, '__lrc.blur()')
  const q0 = await readState(cdp, ids)
  await keyPress(cdp, 'ArrowRight', 'ArrowRight', 39)
  const q1 = await readState(cdp, ids)
  const last2 = await ev(cdp, '__lrc.last()')
  assert(checks, 'P.已打轴多选微调 → selection-offset +10ms', last2.kind === 'selection-offset' && last2.delta.offsetMs === 10 && q1.n === q0.n + 1, `${last2.kind} ${last2.delta.offsetMs} ${q0.n} -> ${q1.n}`)

  // P3: 单选未打轴 → 静默（不落脏日志）
  await clickBlock(cdp, u)
  await ev(cdp, '__lrc.blur()')
  const r0 = await ev(cdp, '__lrc.logLen()')
  await keyPress(cdp, 'ArrowRight', 'ArrowRight', 39)
  const r1 = await ev(cdp, '__lrc.logLen()')
  const ut = await ev(cdp, `__lrc.times(${J(u)})`)
  assert(checks, 'P.单选未打轴微调 → 零日志', r1 === r0, `${r0} -> ${r1}`)
  assert(checks, 'P.未打轴仍无时间戳', ut.length === 0, J(ut))

  // P4: 无选中 → 静默
  await ev(cdp, '__lrc.clearSel()')
  await ev(cdp, '__lrc.blur()')
  const s0 = await ev(cdp, '__lrc.logLen()')
  await keyPress(cdp, 'ArrowRight', 'ArrowRight', 39)
  const s1 = await ev(cdp, '__lrc.logLen()')
  assert(checks, 'P.无选中微调 → 零日志', s1 === s0, `${s0} -> ${s1}`)
}

// Q. 多选删除：一条日志 / 一次撤销 / Backspace 别名
async function testQ(cdp, checks) {
  const ids = await ev(cdp, '__lrc.ids()')
  const [l0, l1, l2, l3] = ids
  const u = await ev(cdp, `__lrc.addBlank('未打轴Q')`)
  await sleep(80)

  await clickBlock(cdp, l0)
  await clickBlock(cdp, l1, MOD.ctrl)
  await clickBlock(cdp, u, MOD.ctrl)
  const setup = await ev(cdp, '__lrc.sel()')
  assert(checks, 'Q.setup 选中 [l0,l1,u]', eq(setup.lineIds, [l0, l1, u]), J(setup))

  const visibleBefore = await ev(cdp, '__lrc.visibleIds()')
  const timesL0Before = await ev(cdp, `__lrc.times(${J(l0)})`)
  const n0 = await ev(cdp, '__lrc.logLen()')
  await ev(cdp, '__lrc.blur()')
  await keyPress(cdp, 'Delete', 'Delete', 46)
  const n1 = await ev(cdp, '__lrc.logLen()')
  const last = await ev(cdp, '__lrc.last()')
  const visibleAfter = await ev(cdp, '__lrc.visibleIds()')
  const selAfter = await ev(cdp, '__lrc.sel()')

  assert(checks, 'Q.删除恰好一条日志', n1 === n0 + 1, `${n0} -> ${n1}`)
  assert(checks, 'Q.kind=remove-line', last.kind === 'remove-line', last.kind)
  assert(checks, 'Q.scope 含 3 行', eq(last.scope.lineIds.slice().sort(), [l0, l1, u].sort()), J(last.scope.lineIds))
  assert(checks, 'Q.三行移出可见集', !visibleAfter.includes(l0) && !visibleAfter.includes(l1) && !visibleAfter.includes(u), `${J(visibleBefore)} -> ${J(visibleAfter)}`)
  assert(checks, 'Q.保留 l2/l3', visibleAfter.includes(l2) && visibleAfter.includes(l3), J(visibleAfter))
  assert(checks, 'Q.移除集含未打轴行（类型无关）', visibleBefore.includes(u) && !visibleAfter.includes(u), `${J(visibleBefore)} -> ${J(visibleAfter)}`)
  assert(checks, 'Q.选区全清（anchor 亦在删除集）', selAfter.lineIds.length === 0 && selAfter.activeLineId === null && selAfter.anchorLineId === null, J(selAfter))

  // 一次撤销整组复原（undo 只改状态，不减日志长度）
  await ev(cdp, '__lrc.store.getState().undoLastAction()')
  await sleep(40)
  const visibleUndo = await ev(cdp, '__lrc.visibleIds()')
  const timesL0Undo = await ev(cdp, `__lrc.times(${J(l0)})`)
  const lastUndo = await ev(cdp, '__lrc.last()')
  assert(checks, 'Q.一次撤销 → 三行复原', visibleUndo.includes(l0) && visibleUndo.includes(l1) && visibleUndo.includes(u), J(visibleUndo))
  assert(checks, 'Q.撤销 → l0 时间戳复原', eq(timesL0Undo, timesL0Before), `${J(timesL0Before)} -> ${J(timesL0Undo)}`)
  assert(checks, 'Q.撤销 → remove-line 记录置 undone', lastUndo.kind === 'remove-line' && lastUndo.status === 'undone', `${lastUndo.kind} ${lastUndo.status}`)

  // Backspace 别名（在撤销复原的状态上）
  await clickBlock(cdp, l2)
  await clickBlock(cdp, l3, MOD.ctrl)
  const b0 = await ev(cdp, '__lrc.logLen()')
  await ev(cdp, '__lrc.blur()')
  await keyPress(cdp, 'Backspace', 'Backspace', 8)
  const b1 = await ev(cdp, '__lrc.logLen()')
  const lastB = await ev(cdp, '__lrc.last()')
  assert(checks, 'Q.Backspace → 一条 remove-line', lastB.kind === 'remove-line' && b1 === b0 + 1, `${lastB.kind} ${b0} -> ${b1}`)
  assert(checks, 'Q.Backspace scope=[l2,l3]', eq(lastB.scope.lineIds.slice().sort(), [l2, l3].sort()), J(lastB.scope.lineIds))
}

// R. 输入框优先：真实 ⋮ 弹窗聚焦输入框 / 注入 textarea，Delete 均不生效
async function testR(cdp, checks) {
  const ids = await ev(cdp, '__lrc.ids()')
  const [l0, l1] = ids

  // R1: 真实弹窗路径
  await clickBlock(cdp, l0)
  await clickBlock(cdp, l1, MOD.ctrl)
  const btnCount = await ev(cdp, '__lrc.openSheet(0)')
  await sleep(200)
  const dlg = await ev(cdp, '__lrc.dialogOpen()')
  assert(checks, 'R.点击 ⋮ → 弹出 role=dialog', dlg === true, `panelButtons=${J(btnCount)} dialogOpen=${J(dlg)}`)
  const focused = await ev(cdp, '__lrc.focusDialogField()')
  assert(checks, 'R.聚焦弹窗文本输入框', focused === true, J(focused))
  const v0 = await ev(cdp, '__lrc.visibleIds()')
  const n0 = await ev(cdp, '__lrc.logLen()')
  await keyPress(cdp, 'Delete', 'Delete', 46)
  await keyPress(cdp, 'Backspace', 'Backspace', 8)
  const n1 = await ev(cdp, '__lrc.logLen()')
  const v1 = await ev(cdp, '__lrc.visibleIds()')
  const selR = await ev(cdp, '__lrc.sel()')
  assert(checks, 'R.弹窗内 Delete/Backspace → 零日志', n1 === n0, `${n0} -> ${n1}`)
  assert(checks, 'R.弹窗内 → 无行被删', eq(v1, v0), `${J(v0)} -> ${J(v1)}`)
  assert(checks, 'R.弹窗内 → 选区不变', eq(selR.lineIds, [l0, l1]), J(selR))
  await ev(cdp, '__lrc.closeDialog()')
  await sleep(150)
  const closed = await ev(cdp, '__lrc.dialogOpen()')
  assert(checks, 'R.关闭弹窗', closed === false, J(closed))

  // R2: 注入聚焦 textarea（无弹窗）隔离验证「输入控件优先」
  await ev(cdp, '__lrc.clearSel()')
  await clickBlock(cdp, l0)
  await clickBlock(cdp, l1, MOD.ctrl)
  const probeOk = await ev(cdp, '__lrc.injectProbe()')
  assert(checks, 'R.注入聚焦 textarea（无弹窗）', probeOk === true, `active=${J(await ev(cdp, '__lrc.activeTag()'))}`)
  const p0 = await ev(cdp, '__lrc.logLen()')
  const pv0 = await ev(cdp, '__lrc.visibleIds()')
  await keyPress(cdp, 'Delete', 'Delete', 46)
  const p1 = await ev(cdp, '__lrc.logLen()')
  const pv1 = await ev(cdp, '__lrc.visibleIds()')
  const selP = await ev(cdp, '__lrc.sel()')
  assert(checks, 'R.textarea 聚焦 Delete → 零日志', p1 === p0, `${p0} -> ${p1}`)
  assert(checks, 'R.textarea 聚焦 → 无行被删、选区不变', eq(pv1, pv0) && eq(selP.lineIds, [l0, l1]), `${J(pv1)} ${J(selP)}`)
  await ev(cdp, '__lrc.dropProbe()')
}

// S. 多选删除落点：Delete/Backspace 直接落「无选中」（三字段全清），不挑最近剩余行
async function testS(cdp, checks) {
  const ids = await ev(cdp, '__lrc.ids()')
  const [l0, l1, l2] = ids

  // S1: 多选 + anchor 在删除集 → 三条引用全清
  await clickBlock(cdp, l0)
  await clickBlock(cdp, l1, MOD.ctrl)
  const setup1 = await ev(cdp, '__lrc.sel()')
  assert(checks, 'S1.setup [l0,l1] anchor=l1', eq(setup1.lineIds, [l0, l1]) && setup1.anchorLineId === l1, J(setup1))
  await ev(cdp, '__lrc.blur()')
  await keyPress(cdp, 'Delete', 'Delete', 46)
  const after1 = await ev(cdp, '__lrc.sel()')
  assert(checks, 'S1.全删 → {lineIds:[],active:null,anchor:null}', after1.lineIds.length === 0 && after1.activeLineId === null && after1.anchorLineId === null, J(after1))

  // 复原 S1 的删除，让后续用例仍有足够可见行可选
  await ev(cdp, '__lrc.store.getState().undoLastAction()')
  await sleep(40)

  // S2: anchor 经 Ctrl-toggle 移出选中集（仍可见）→ 多选删除后 anchor 同样清空（不再保留）
  await clickBlock(cdp, l0)
  await clickBlock(cdp, l1, MOD.ctrl)
  await clickBlock(cdp, l2, MOD.ctrl)
  await clickBlock(cdp, l2, MOD.ctrl) // 减选 l2 → lineIds=[l0,l1]，anchor 重设为 l2（可见、不在选中集）
  const setup2 = await ev(cdp, '__lrc.sel()')
  assert(checks, 'S2.setup lineIds=[l0,l1] anchor=l2', eq(setup2.lineIds, [l0, l1]) && setup2.anchorLineId === l2, J(setup2))
  await ev(cdp, '__lrc.blur()')
  await keyPress(cdp, 'Delete', 'Delete', 46)
  const after2 = await ev(cdp, '__lrc.sel()')
  const vis2 = await ev(cdp, '__lrc.visibleIds()')
  assert(checks, 'S2.多选删除 → lineIds 清空、active=null', after2.lineIds.length === 0 && after2.activeLineId === null, J(after2))
  assert(checks, 'S2.anchor 也清空 =null（不挑最近剩余、不保留）', after2.anchorLineId === null, `${J(after2)} visible=${J(vis2)}`)

  // S3: 单行选区 Delete → 落点与多选删除一致（直接无选中）
  await clickBlock(cdp, l2)
  const setup3 = await ev(cdp, '__lrc.sel()')
  assert(checks, 'S3.setup 单行选区 [l2]', eq(setup3.lineIds, [l2]), J(setup3))
  await ev(cdp, '__lrc.blur()')
  await keyPress(cdp, 'Delete', 'Delete', 46)
  const after3 = await ev(cdp, '__lrc.sel()')
  const vis3 = await ev(cdp, '__lrc.visibleIds()')
  assert(checks, 'S3.单行删除 → {lineIds:[],active:null,anchor:null}（与多选一致）', after3.lineIds.length === 0 && after3.activeLineId === null && after3.anchorLineId === null, J(after3))
  assert(checks, 'S3.单行删除：l2 移出可见集', !vis3.includes(l2), `${J(vis3)}`)
}

// T. 多选上下文 + 单行按钮删除：集合逐次收缩、无幽灵引用
// 守第一批已修的「删行同步集合」不变量（走单行 removeLine）。
// 落点与 Delete 路径（removeLines → 直接无选中）**不同**：这里是 removeLine 的
// 「active 落最近剩余、anchor 未被删则保留」，两条路径不得合并断言。
async function testT(cdp, checks) {
  const ids = await ev(cdp, '__lrc.ids()')
  const [l0, l1, l2, l3] = ids
  const u = await ev(cdp, `__lrc.addBlank('T未打轴')`)
  await sleep(80)

  // ---- T1：active 非 B（active=C=u），删 B=l1 → B 出集合、active 保持不变 ----
  await clickBlock(cdp, l0)
  await clickBlock(cdp, l1, MOD.ctrl)
  await clickBlock(cdp, u, MOD.ctrl)
  const setup1 = await ev(cdp, '__lrc.sel()')
  assert(
    checks,
    'T1.setup 选中 [A=l0,B=l1,C=u]（含未打轴）且 active=C(u)',
    eq(setup1.lineIds, [l0, l1, u]) && setup1.activeLineId === u,
    J(setup1),
  )

  const vis0 = await ev(cdp, '__lrc.visibleIds()')
  const idxL1 = vis0.indexOf(l1)
  const n0 = await ev(cdp, '__lrc.logLen()')
  const path1 = await deleteRow(cdp, idxL1)
  const n1 = await ev(cdp, '__lrc.logLen()')
  const last1 = await ev(cdp, '__lrc.last()')
  const vis1 = await ev(cdp, '__lrc.visibleIds()')
  const sel1 = await ev(cdp, '__lrc.sel()')

  assert(checks, 'T1.删除恰好一条 remove-line', n1 === n0 + 1 && last1.kind === 'remove-line', `path=${path1} ${n0} -> ${n1} kind=${last1.kind}`)
  assert(checks, 'T1.scope.lineIds 只含 B(l1)', eq(last1.scope.lineIds, [l1]), J(last1.scope.lineIds))
  assert(checks, 'T1.B(l1) 被删（移出可见集）', !vis1.includes(l1), `${J(vis0)} -> ${J(vis1)}`)
  assert(checks, 'T1.selection.lineIds=[A,C]（B 不留残影）', eq(sel1.lineIds.slice().sort(), [l0, u].sort()), J(sel1.lineIds))
  assert(checks, 'T1.active 非 B → 保持不变 = C(u)', sel1.activeLineId === u, J(sel1))

  // 复原 T1 的删除（供 T2 复用 l1 可见）
  await ev(cdp, '__lrc.store.getState().undoLastAction()')
  await sleep(40)
  const visRestored = await ev(cdp, '__lrc.visibleIds()')
  assert(checks, 'T1.撤销复原 B(l1)', visRestored.includes(l1), J(visRestored))

  // ---- T2：active 为 B（active=l1），连续删 C=u、再删 B=l1 → 集合逐次收缩、无残留已删 id ----
  await clickBlock(cdp, l0)
  await clickBlock(cdp, u, MOD.ctrl)
  await clickBlock(cdp, l1, MOD.ctrl)
  const setup2 = await ev(cdp, '__lrc.sel()')
  assert(
    checks,
    'T2.setup 选中 [A=l0,C=u,B=l1] 且 active=B(l1)',
    eq(setup2.lineIds, [l0, u, l1]) && setup2.activeLineId === l1,
    J(setup2),
  )

  const vis2a = await ev(cdp, '__lrc.visibleIds()')
  const idxU = vis2a.indexOf(u)
  const path2 = await deleteRow(cdp, idxU)
  const vis2b = await ev(cdp, '__lrc.visibleIds()')
  const sel2b = await ev(cdp, '__lrc.sel()')
  assert(checks, 'T2.先删 C(u)：集合收缩为 [A,B]', eq(sel2b.lineIds.slice().sort(), [l0, l1].sort()), `path=${path2} ${J(sel2b.lineIds)}`)
  assert(checks, 'T2.先删 C(u)：无 u 残留、active=B(l1) 不变', !sel2b.lineIds.includes(u) && sel2b.activeLineId === l1, J(sel2b))
  assert(checks, 'T2.C(u) 移出可见集', !vis2b.includes(u), `${J(vis2a)} -> ${J(vis2b)}`)

  const idxL1b = vis2b.indexOf(l1)
  const n2 = await ev(cdp, '__lrc.logLen()')
  const path3 = await deleteRow(cdp, idxL1b)
  const n3 = await ev(cdp, '__lrc.logLen()')
  const last3 = await ev(cdp, '__lrc.last()')
  const vis2c = await ev(cdp, '__lrc.visibleIds()')
  const sel2c = await ev(cdp, '__lrc.sel()')
  assert(
    checks,
    'T2.再删 B(l1)：恰好一条 remove-line、scope 只含 l1',
    n3 === n2 + 1 && last3.kind === 'remove-line' && eq(last3.scope.lineIds, [l1]),
    `path=${path3} ${n2} -> ${n3} kind=${last3.kind} scope=${J(last3.scope.lineIds)}`,
  )
  assert(checks, 'T2.再删 B(l1)：集合收缩为 [A=l0]', eq(sel2c.lineIds, [l0]), J(sel2c))
  assert(checks, 'T2.无残留已删 id（u/l1 均不在集合）', !sel2c.lineIds.includes(u) && !sel2c.lineIds.includes(l1), J(sel2c))
  assert(checks, 'T2.active 为 B → 落到相邻剩余可见行 = A(l0)', sel2c.activeLineId === l0, `${J(sel2c)} visible=${J(vis2c)}`)
  assert(
    checks,
    'T2.visible 仅剩 l0/l2/l3（u、l1 已删）',
    vis2c.includes(l0) && vis2c.includes(l2) && vis2c.includes(l3) && !vis2c.includes(u) && !vis2c.includes(l1),
    J(vis2c),
  )
}

/* ------------- 第三批 U~X：导出链（buildExportText）与设置持久化 ------------- */

/** 去掉空行后的导出文本行。 */
function exportRows(text) {
  return text.split(/\r?\n/).filter((s) => s.trim() !== '')
}

/** 去掉行首 [..] 行级标签与全部 <..> 字级标签，仅留文本（用于按文本匹配行）。 */
function stripTags(row) {
  return row.replace(/^(\[[^\]]*\])+/, '').replace(/<[^>]+>/g, '')
}

/** 三位小数 mm:ss.mmm（与 formatTimestamp(ms, 1) 同口径）。 */
function fmt3(ms) {
  const total = Math.round(ms)
  const p = (n, w) => String(n).padStart(w, '0')
  const m = Math.floor(total / 60000)
  const s = Math.floor((total % 60000) / 1000)
  const frac = total % 1000
  return `${p(m, 2)}:${p(s, 2)}.${p(frac, 3)}`
}

// U. 导出链反映编辑：demo 不再空 + 打轴反映 + 偏移反映（全部走 buildExportText）
async function testU(cdp, checks) {
  const ids = await ev(cdp, '__lrc.ids()')
  const [l0] = ids

  // U1: 默认 demo 的行时间全部来自回放（文档本身无行级时间戳）→ 导出必须带时间标签
  const text = await ev(cdp, '__lrc.buildExport(1)')
  const rows = exportRows(text)
  const lyric = rows.slice(1)
  assert(checks, 'U.demo 导出 4 行歌词', lyric.length === 4, J(rows))
  assert(checks, 'U.demo 每行都带 [mm:ss.xxx]（修复前为原文直出）', lyric.every((s) => /^\[\d{2}:\d{2}\.\d{3}\]/.test(s)), J(lyric))
  assert(checks, 'U.demo l0 = 回放值 00:12.120', lyric[0] && lyric[0].startsWith('[00:12.120]'), lyric[0])
  assert(checks, 'U.demo l1 = 回放值 00:16.670（全局+120 + 多选+50，nudge 已撤销）', lyric[1] && lyric[1].startsWith('[00:16.670]'), lyric[1])
  assert(checks, 'U.demo l2 = 回放值 00:21.370', lyric[2] && lyric[2].startsWith('[00:21.370]'), lyric[2])
  assert(checks, 'U.demo l3 = 回放值 00:25.920', lyric[3] && lyric[3].startsWith('[00:25.920]'), lyric[3])

  // U2: 打轴反映 —— 新增未打轴行先原文直出，stampLine 后必须带时间标签
  const u = await ev(cdp, `__lrc.addBlank('打轴反映')`)
  await sleep(60)
  const before = exportRows(await ev(cdp, '__lrc.buildExport(1)'))
  // 反向证据：未打轴行不被错误加上时间戳 —— 证明导出链修复无副作用，
  // 非仅正向的"打轴反映"。
  assert(checks, 'U.未打轴新行导出为原文（无时间标签）', before.some((s) => s.trim() === '打轴反映'), J(before))
  await ev(cdp, `__lrc.store.getState().stampLine(${J(u)}, 5000)`)
  await sleep(40)
  const after = exportRows(await ev(cdp, '__lrc.buildExport(1)'))
  assert(checks, 'U.打轴后导出带 [00:05.000]', after.some((s) => s.startsWith('[00:05.000]') && s.indexOf('打轴反映') >= 0), J(after))

  // U3: 偏移反映 —— moveLinesByOffset +1000 后导出值同步
  await ev(cdp, `__lrc.store.getState().moveLinesByOffset([${J(u)}], 1000)`)
  await sleep(40)
  const offsetText = exportRows(await ev(cdp, '__lrc.buildExport(1)'))
  assert(checks, 'U.偏移后导出 = 00:06.000', offsetText.some((s) => s.startsWith('[00:06.000]') && s.indexOf('打轴反映') >= 0), J(offsetText))
}

// V. 精度统一：两位（10）vs 三位（1），行级 / 字级同受控
async function testV(cdp, checks) {
  const three = exportRows(await ev(cdp, '__lrc.buildExport(1)'))
  const two = exportRows(await ev(cdp, '__lrc.buildExport(10)'))

  assert(checks, 'V.三位：4 行全为 .xxx', three.slice(1).length === 4 && three.slice(1).every((s) => /^\[\d{2}:\d{2}\.\d{3}\]/.test(s)), J(three))
  assert(checks, 'V.两位：4 行全为 .xx', two.slice(1).length === 4 && two.slice(1).every((s) => /^\[\d{2}:\d{2}\.\d{2}\]/.test(s)), J(two))
  assert(checks, 'V.三位 l0 = [00:12.120]', three[1] && three[1].startsWith('[00:12.120]'), three[1])
  assert(checks, 'V.两位 l0 = [00:12.12]', two[1] && two[1].startsWith('[00:12.12]'), two[1])
  assert(checks, 'V.三位 l1 = [00:16.670]', three[2] && three[2].startsWith('[00:16.670]'), three[2])
  assert(checks, 'V.两位 l1 = [00:16.67]', two[2] && two[2].startsWith('[00:16.67]'), two[2])
  // 字级同样受统一精度控制：首字 12008ms
  assert(checks, 'V.字级三位 <00:12.008>', three[1] && three[1].indexOf('<00:12.008>') >= 0, three[1])
  assert(checks, 'V.字级两位 <00:12.01>', two[1] && two[1].indexOf('<00:12.01>') >= 0, two[1])
}

// W. 删除行不导出；文本编辑仍反映
async function testW(cdp, checks) {
  const ids = await ev(cdp, '__lrc.ids()')
  const [l0, l1] = ids
  const l1text = await ev(cdp, `__lrc.state().document.lines.find(function(l){return l.id===${J(l1)}}).text`)

  await ev(cdp, `__lrc.store.getState().removeLine(${J(l1)})`)
  await sleep(40)
  const afterDel = exportRows(await ev(cdp, '__lrc.buildExport(1)'))
  assert(checks, 'W.删除后导出 3 行', afterDel.slice(1).length === 3, J(afterDel))
  assert(checks, 'W.被删行的文本不出现在导出中', !afterDel.join('\n').includes(l1text), `want-missing=${J(l1text)}`)

  const edited = '改过的第一行'
  // 固化既有行为：editLineText 触发 clearWordTimestamps（src 既有逻辑），
  // 非本轮设计决定；将来若要"只改错别字不动字级"，需回看此处。
  await ev(cdp, `__lrc.store.getState().editLineText(${J(l0)}, { text: ${J(edited)} })`)
  await sleep(40)
  const afterEdit = exportRows(await ev(cdp, '__lrc.buildExport(1)'))
  assert(checks, 'W.文本编辑反映到导出', afterEdit.join('\n').includes(edited), J(afterEdit))
  assert(checks, 'W.编辑后仍保留行级时间标签', afterEdit.some((s) => s.startsWith('[00:12.120]') && s.indexOf(edited) >= 0), J(afterEdit))
}

// X. 设置持久化：默认三位、更新写回 localStorage、非法值白名单回退
async function testX(cdp, checks) {
  await sleep(120)
  const d = await ev(cdp, '__lrc.settings()')
  assert(checks, 'X.默认 timestampPrecisionMs=1（三位）', d.timestampPrecisionMs === 1, J(d))
  const s0 = await ev(cdp, '__lrc.storedSettingsRaw()')
  assert(checks, 'X.默认设置已持久化到 localStorage', typeof s0 === 'string' && s0.indexOf('"timestampPrecisionMs":1') >= 0, String(s0))

  await ev(cdp, '__lrc.updateSettings({ timestampPrecisionMs: 10 })')
  await sleep(150)
  const s1 = await ev(cdp, '__lrc.storedSettingsRaw()')
  assert(checks, 'X.改为两位后写回存储', typeof s1 === 'string' && s1.indexOf('"timestampPrecisionMs":10') >= 0, String(s1))

  const bad = await ev(
    cdp,
    `(function(){ var st = __lrc.settingsStore.getState(); st.hydrate({ timestampPrecisionMs: 7 }); return __lrc.settingsStore.getState().settings.timestampPrecisionMs; })()`,
  )
  assert(checks, 'X.非法精度 7 → 白名单回退 1', bad === 1, String(bad))

  await ev(cdp, '__lrc.updateSettings({ timestampPrecisionMs: 1 })')
  await sleep(80)
}

/* ---------------- 第四批 Y~AB：重大改变确认框 + 拒绝提示 toast ---------------- */

// Y. 确认框：多选拖动先弹框、零落盘；点确认才落一条 selection-offset，行时间戳=落点
async function testY(cdp, checks) {
  const ids = await ev(cdp, '__lrc.ids()')
  const [l0, l1, l2, l3] = ids
  await ev(cdp, '__lrc.updateSettings({ confirmMajorChange: true })')
  await clickBlock(cdp, l0)
  await clickBlock(cdp, l1, MOD.ctrl)
  const setup = await ev(cdp, '__lrc.sel()')
  assert(checks, 'Y.setup 选中 [l0,l1]', eq(setup.lineIds, [l0, l1]), J(setup))

  const l0text = await ev(cdp, `__lrc.state().document.lines.find(function(l){return l.id===${J(l0)}}).text`)
  const l1text = await ev(cdp, `__lrc.state().document.lines.find(function(l){return l.id===${J(l1)}}).text`)

  const ppms = await ev(cdp, '__lrc.ppms()')
  const dx = Math.round(900 * ppms)
  const before = await readState(cdp, ids)
  await dragBlock(cdp, l0, dx)

  // 松手后：弹窗出现、零落盘、块保留临时位移停在落点
  const dlgOpen = await ev(cdp, '__lrc.majorDialogOpen()')
  const dlgText = await ev(cdp, '__lrc.majorDialogText()')
  const lineCount = await ev(cdp, '__lrc.majorDialogLineCount()')
  const deltaText = await ev(cdp, '__lrc.majorDialogDelta()')
  const nAfterDrag = await ev(cdp, '__lrc.logLen()')
  const stHeld = await ev(cdp, `__lrc.style(${J(l0)})`)
  assert(checks, 'Y.松手 → 确认框出现', dlgOpen === true, J(dlgOpen))
  assert(checks, 'Y.松手未落盘（日志长度不变）', nAfterDrag === before.n, `${before.n} -> ${nAfterDrag}`)
  assert(checks, 'Y.弹窗列出受影响 2 行', lineCount === 2, String(lineCount))
  assert(checks, 'Y.弹窗含两行文本（行号+文本）', typeof dlgText === 'string' && dlgText.indexOf(l0text) >= 0 && dlgText.indexOf(l1text) >= 0, J(dlgText))
  assert(checks, 'Y.弹窗含变化量（+整数 ms）', typeof deltaText === 'string' && /^\+\d+ ms$/.test(deltaText), J(deltaText))
  assert(checks, 'Y.弹窗含可撤销性说明', typeof dlgText === 'string' && dlgText.indexOf('selection-offset') >= 0, J(dlgText))
  assert(checks, 'Y.块保留临时 transform（停在落点）', typeof stHeld.transform === 'string' && stHeld.transform.indexOf('translate3d') === 0, J(stHeld))
  assert(checks, 'Y.块层级抬升 zIndex=10', stHeld.zIndex === '10', J(stHeld))
  assert(checks, 'Y.块光标 grabbing', stHeld.cursor === 'grabbing', J(stHeld))

  // 点确认 → 落一条 selection-offset、行时间戳=落点
  const okBtn = await ev(cdp, '__lrc.clickMajorConfirm()')
  await sleep(80)
  const dlgClosed = await ev(cdp, '__lrc.majorDialogOpen()')
  const nAfterConfirm = await ev(cdp, '__lrc.logLen()')
  const last = await ev(cdp, '__lrc.last()')
  const after = await readState(cdp, ids)
  const stAfter = await ev(cdp, `__lrc.style(${J(l0)})`)
  assert(checks, 'Y.点确认成功', okBtn === true, J(okBtn))
  assert(checks, 'Y.确认后弹窗关闭', dlgClosed === false, J(dlgClosed))
  assert(checks, 'Y.确认才落盘（日志 +1）', nAfterConfirm === before.n + 1, `${before.n} -> ${nAfterConfirm}`)
  assert(checks, 'Y.kind=selection-offset', last.kind === 'selection-offset', last.kind)
  assert(checks, 'Y.scope=[l0,l1]', eq(last.scope.lineIds.slice().sort(), [l0, l1].sort()), J(last.scope.lineIds))
  assert(checks, 'Y.弹窗变化量 = 实际 offsetMs', deltaText === `${last.delta.offsetMs > 0 ? '+' : ''}${last.delta.offsetMs} ms`, `${deltaText} vs ${last.delta.offsetMs}`)
  const d0 = after.times.l0[0] - before.times.l0[0]
  const d1 = after.times.l1[0] - before.times.l1[0]
  assert(checks, 'Y.两行位移 = offsetMs（落点）', d0 === last.delta.offsetMs && d1 === last.delta.offsetMs, `${d0} ${d1} off=${last.delta.offsetMs}`)
  assert(checks, 'Y.非参与行不动', eq(after.times.l2, before.times.l2) && eq(after.times.l3, before.times.l3), `${J(after.times.l2)} ${J(after.times.l3)}`)
  assert(checks, 'Y.确认后命令式样式清理', stAfter.transform === '' && stAfter.zIndex === '' && stAfter.cursor === '', J(stAfter))
}

// Z. 取消路径：取消按钮 / Esc 均不落盘、块弹回原位
async function testZ(cdp, checks) {
  const ids = await ev(cdp, '__lrc.ids()')
  const [l0, l1] = ids
  const ppms = await ev(cdp, '__lrc.ppms()')
  const dx = Math.round(900 * ppms)
  await ev(cdp, '__lrc.updateSettings({ confirmMajorChange: true })')

  // Z1: 点「取消」
  await clickBlock(cdp, l0)
  await clickBlock(cdp, l1, MOD.ctrl)
  const before = await readState(cdp, ids)
  await dragBlock(cdp, l0, dx)
  const dlgOpen = await ev(cdp, '__lrc.majorDialogOpen()')
  const stHeld = await ev(cdp, `__lrc.style(${J(l0)})`)
  assert(checks, 'Z1.拖动 → 弹窗出现', dlgOpen === true, J(dlgOpen))
  assert(checks, 'Z1.弹窗中块仍保留临时 transform', typeof stHeld.transform === 'string' && stHeld.transform.indexOf('translate3d') === 0, J(stHeld))
  const okBtn = await ev(cdp, '__lrc.clickMajorCancel()')
  await sleep(80)
  const dlgClosed = await ev(cdp, '__lrc.majorDialogOpen()')
  const after = await readState(cdp, ids)
  const stAfter = await ev(cdp, `__lrc.style(${J(l0)})`)
  assert(checks, 'Z1.点取消成功', okBtn === true, J(okBtn))
  assert(checks, 'Z1.取消后弹窗关闭', dlgClosed === false, J(dlgClosed))
  assert(checks, 'Z1.取消不落盘（日志不变）', after.n === before.n, `${before.n} -> ${after.n}`)
  assert(checks, 'Z1.取消不落盘（行起点不变）', eq(after.times.l0, before.times.l0) && eq(after.times.l1, before.times.l1), `${J(after.times.l0)} ${J(after.times.l1)}`)
  assert(checks, 'Z1.取消 → 块弹回（transform 清空）', stAfter.transform === '', J(stAfter))
  assert(checks, 'Z1.取消 → 层级/光标清理', stAfter.zIndex === '' && stAfter.cursor === '', J(stAfter))

  // Z2: Esc 取消
  const selKeep = await ev(cdp, '__lrc.sel()')
  assert(checks, 'Z2.setup 选区保持 [l0,l1]', eq(selKeep.lineIds, [l0, l1]), J(selKeep))
  const before2 = await readState(cdp, ids)
  await dragBlock(cdp, l0, dx)
  assert(checks, 'Z2.拖动 → 弹窗出现', (await ev(cdp, '__lrc.majorDialogOpen()')) === true)
  await ev(cdp, '__lrc.blur()')
  await keyPress(cdp, 'Escape', 'Escape', 27)
  await sleep(80)
  const dlgClosed2 = await ev(cdp, '__lrc.majorDialogOpen()')
  const after2 = await readState(cdp, ids)
  const stAfter2 = await ev(cdp, `__lrc.style(${J(l0)})`)
  assert(checks, 'Z2.Esc → 弹窗关闭', dlgClosed2 === false, J(dlgClosed2))
  assert(checks, 'Z2.Esc → 日志不变', after2.n === before2.n, `${before2.n} -> ${after2.n}`)
  assert(checks, 'Z2.Esc → 行起点不变', eq(after2.times.l0, before2.times.l0), `${J(before2.times.l0)} -> ${J(after2.times.l0)}`)
  assert(checks, 'Z2.Esc → 块弹回', stAfter2.transform === '', J(stAfter2))
}

// AA. 弹窗内「以后不再显示」：勾选+确认 → 关总开关并持久化；再拖不弹、立即落盘
async function testAA(cdp, checks) {
  const ids = await ev(cdp, '__lrc.ids()')
  const [l0, l1] = ids
  await ev(cdp, '__lrc.updateSettings({ confirmMajorChange: true })')
  await clickBlock(cdp, l0)
  await clickBlock(cdp, l1, MOD.ctrl)
  const ppms = await ev(cdp, '__lrc.ppms()')
  const dx = Math.round(900 * ppms)
  const before = await readState(cdp, ids)
  await dragBlock(cdp, l0, dx)
  assert(checks, 'AA.拖动 → 弹窗出现', (await ev(cdp, '__lrc.majorDialogOpen()')) === true)
  const checked = await ev(cdp, '__lrc.toggleMajorDontShow()')
  assert(checks, 'AA.勾选「以后不再显示」', checked === true, J(checked))
  await ev(cdp, '__lrc.clickMajorConfirm()')
  await sleep(120)
  const setting = await ev(cdp, '__lrc.settings().confirmMajorChange')
  const raw = await ev(cdp, '__lrc.storedSettingsRaw()')
  assert(checks, 'AA.确认后 settings.confirmMajorChange=false', setting === false, J(setting))
  assert(checks, 'AA.且已持久化到 localStorage', typeof raw === 'string' && raw.indexOf('"confirmMajorChange":false') >= 0, String(raw))

  // 再拖多选 → 无弹窗、pointerup 后立即一条 selection-offset
  const before2 = await readState(cdp, ids)
  await dragBlock(cdp, l0, dx)
  const dlgNow = await ev(cdp, '__lrc.majorDialogOpen()')
  const n2 = await ev(cdp, '__lrc.logLen()')
  const last2 = await ev(cdp, '__lrc.last()')
  assert(checks, 'AA.关开关后再拖 → 无弹窗', dlgNow === false, J(dlgNow))
  assert(checks, 'AA.关开关后再拖 → 立即落盘 +1', n2 === before2.n + 1, `${before2.n} -> ${n2}`)
  assert(checks, 'AA.且 kind=selection-offset', last2.kind === 'selection-offset', last2.kind)
}

// AB. 拒绝提示 toast：blocked 拖动 / 混合微调各弹一条；~3.5s 自动消失；同文案去重
async function testAB(cdp, checks) {
  const ids = await ev(cdp, '__lrc.ids()')
  const [l0] = ids
  const u = await ev(cdp, `__lrc.addBlank('未打轴AB')`)
  await sleep(80)
  const ppms = await ev(cdp, '__lrc.ppms()')
  const dx = Math.round(900 * ppms)

  // 1) 混合集合拖动 → blocked → toast 含「未打轴」（不弹确认框）
  await clickBlock(cdp, l0)
  await clickBlock(cdp, u, MOD.ctrl)
  const n0 = await ev(cdp, '__lrc.logLen()')
  await dragBlock(cdp, l0, dx)
  const toastOn = await ev(cdp, '__lrc.toastOpen()')
  const toastMsg = await ev(cdp, '__lrc.toastText()')
  const dlg = await ev(cdp, '__lrc.majorDialogOpen()')
  assert(checks, 'AB.混合拖动 → 出现提示', toastOn === true, J(toastOn))
  assert(checks, 'AB.提示文本含「未打轴」', typeof toastMsg === 'string' && toastMsg.indexOf('未打轴') >= 0, J(toastMsg))
  assert(checks, 'AB.混合拖动 → 零日志', (await ev(cdp, '__lrc.logLen()')) === n0, `${n0}`)
  assert(checks, 'AB.混合拖动不弹确认框', dlg === false, J(dlg))

  // 2) ~3.5s 后自动消失
  await sleep(3700)
  const toastGone = await ev(cdp, '__lrc.toastOpen()')
  assert(checks, 'AB.~3.5s 后提示自动消失', toastGone === false, J(toastGone))

  // 3) 混合集合连按方向键微调 N 次 → 同文案仅一条（去重，不刷新计时）
  await clickBlock(cdp, l0)
  await clickBlock(cdp, u, MOD.ctrl)
  await ev(cdp, '__lrc.blur()')
  const seq0 = await ev(cdp, '__lrc.toastSeq()')
  for (let i = 0; i < 5; i += 1) await keyPress(cdp, 'ArrowRight', 'ArrowRight', 39)
  await sleep(50)
  const seq1 = await ev(cdp, '__lrc.toastSeq()')
  const toastMsg2 = await ev(cdp, '__lrc.toastText()')
  assert(checks, 'AB.连按 5 次微调 → 仅一条新提示（seq +1）', seq1 === seq0 + 1, `${seq0} -> ${seq1}`)
  assert(checks, 'AB.微调提示文本含「未打轴」', typeof toastMsg2 === 'string' && toastMsg2.indexOf('未打轴') >= 0, J(toastMsg2))
}

/* -------- 第五批 AC~AI：行级时间戳输入 / 清空 / 解析规则 / 导出防复活 -------- */

/** 打开第 index 行的行操作弹窗并等一帧。 */
async function openLineSheet(cdp, index) {
  await ev(cdp, `__lrc.openSheet(${index})`)
  await sleep(200)
}

// AC. 行级输入纯数字 = 秒；保存后才换算并归一化呈现
async function testAC(cdp, checks) {
  const ids = await ev(cdp, '__lrc.ids()')
  const [l0] = ids
  await clickBlock(cdp, l0)
  await openLineSheet(cdp, 0)
  assert(checks, 'AC.弹窗打开', (await ev(cdp, '__lrc.dialogOpen()')) === true, 'dialog')

  // 初值 = 回放行时间 00:12.120（不是文档基线，也不是行级数组下标）
  const init = await ev(cdp, '__lrc.lineTimeInputValue()')
  assert(checks, 'AC.行级初值 = 回放值 00:12.120', init === '00:12.120', J(init))

  // 纯数字 125 = 125 秒（不是 125 毫秒）
  await ev(cdp, `__lrc.setLineTimeInput('125')`)
  await sleep(30)
  assert(checks, 'AC.125 合法（非 aria-invalid）', (await ev(cdp, '__lrc.lineTimeInvalid()')) === false, 'invalid')
  assert(checks, 'AC.编辑期间保持原文 125（不改写）', (await ev(cdp, '__lrc.lineTimeInputValue()')) === '125', J(await ev(cdp, '__lrc.lineTimeInputValue()')))

  const n0 = await ev(cdp, '__lrc.logLen()')
  await ev(cdp, '__lrc.clickDialogSave()')
  await sleep(60)
  const n1 = await ev(cdp, '__lrc.logLen()')
  const t = await ev(cdp, `__lrc.times(${J(l0)})`)
  assert(checks, 'AC.保存落一条日志', n1 === n0 + 1, `${n0} -> ${n1}`)
  assert(checks, 'AC.125 秒 = 125000ms', eq(t, [125000]), J(t))

  // 重开弹窗 → 归一化呈现 02:05.000（大数进位）
  await openLineSheet(cdp, 0)
  const shown = await ev(cdp, '__lrc.lineTimeInputValue()')
  assert(checks, 'AC.保存后归一化呈现 02:05.000', shown === '02:05.000', J(shown))
  await ev(cdp, '__lrc.closeDialog()')
}

// AD. 归一化时机：编辑与失焦都不改写原文，保存时才归一化（共用解析函数）
async function testAD(cdp, checks) {
  const ids = await ev(cdp, '__lrc.ids()')
  const [l0] = ids
  await clickBlock(cdp, l0)
  await openLineSheet(cdp, 0)

  // 非零填充的 mm:ss（1:5）—— 若在失焦时归一化，会被改写成 01:05.000
  await ev(cdp, `__lrc.setLineTimeInput('1:5')`)
  await sleep(30)
  assert(checks, 'AD.编辑期间原文 1:5', (await ev(cdp, '__lrc.lineTimeInputValue()')) === '1:5', J(await ev(cdp, '__lrc.lineTimeInputValue()')))
  // 聚焦再失焦：仍不得改写
  await ev(cdp, `(function(){ var el = __lrc.lineTimeInputEl(); el.focus(); el.blur(); return true; })()`)
  await sleep(30)
  assert(checks, 'AD.失焦仍为原文 1:5（归一化推迟到保存）', (await ev(cdp, '__lrc.lineTimeInputValue()')) === '1:5', J(await ev(cdp, '__lrc.lineTimeInputValue()')))

  await ev(cdp, '__lrc.clickDialogSave()')
  await sleep(60)
  const t = await ev(cdp, `__lrc.times(${J(l0)})`)
  assert(checks, 'AD.1:5 = 65000ms', eq(t, [65000]), J(t))
  await openLineSheet(cdp, 0)
  assert(checks, 'AD.保存后归一化呈现 01:05.000', (await ev(cdp, '__lrc.lineTimeInputValue()')) === '01:05.000', J(await ev(cdp, '__lrc.lineTimeInputValue()')))
  await ev(cdp, '__lrc.closeDialog()')
}

// AE. 清空行级时间：只清时间，保留字级切分（弹窗槽位仍在，显示未打轴）
async function testAE(cdp, checks) {
  const ids = await ev(cdp, '__lrc.ids()')
  const [l0] = ids
  await clickBlock(cdp, l0)
  await openLineSheet(cdp, 0)

  // setup：l0 有行时间 + 2 个字级
  assert(checks, 'AE.setup 行时间 [12120]', eq(await ev(cdp, `__lrc.times(${J(l0)})`), [12120]), J(await ev(cdp, `__lrc.times(${J(l0)})`)))
  assert(checks, 'AE.setup 字级 [12008,13600]', eq(await ev(cdp, `__lrc.wordTimes(${J(l0)})`), [12008, 13600]), J(await ev(cdp, `__lrc.wordTimes(${J(l0)})`)))

  await ev(cdp, `__lrc.setLineTimeInput('')`)
  await sleep(30)
  assert(checks, 'AE.空串合法（非 aria-invalid）', (await ev(cdp, '__lrc.lineTimeInvalid()')) === false, 'invalid')
  await ev(cdp, '__lrc.clickDialogSave()')
  await sleep(60)

  const last = await ev(cdp, '__lrc.last()')
  assert(checks, 'AE.落一条 manual-timestamp', last.kind === 'manual-timestamp', J(last.kind))
  assert(checks, 'AE.delta.mode = clear-timestamps', last.delta && last.delta.mode === 'clear-timestamps', J(last.delta))
  assert(checks, 'AE.清空后行时间 []', eq(await ev(cdp, `__lrc.times(${J(l0)})`), []), J(await ev(cdp, `__lrc.times(${J(l0)})`)))
  assert(checks, 'AE.清空后字级时间全 null', eq(await ev(cdp, `__lrc.wordTimes(${J(l0)})`), [null, null]), J(await ev(cdp, `__lrc.wordTimes(${J(l0)})`)))

  // 保留切分的关键证据：重开弹窗仍有 2 个槽位（deriveVisibleLines 未抹掉 wordTimestamps）
  await openLineSheet(cdp, 0)
  assert(checks, 'AE.重开弹窗仍有 2 个字级槽位（切分保留）', (await ev(cdp, '__lrc.wordInputCount()')) === 2, String(await ev(cdp, '__lrc.wordInputCount()')))
  assert(checks, 'AE.字级槽位显示未打轴（空值）', (await ev(cdp, '__lrc.wordInputValue(0)')) === '' && (await ev(cdp, '__lrc.wordInputValue(1)')) === '', `${J(await ev(cdp, '__lrc.wordInputValue(0)'))} ${J(await ev(cdp, '__lrc.wordInputValue(1)'))}`)
  assert(checks, 'AE.行级框显示未打轴（空值）', (await ev(cdp, '__lrc.lineTimeInputValue()')) === '', J(await ev(cdp, '__lrc.lineTimeInputValue()')))
  await ev(cdp, '__lrc.closeDialog()')
}

// AF. 清空一步撤销：行时间与字级时间一并复原（一条记录内完成）
async function testAF(cdp, checks) {
  const ids = await ev(cdp, '__lrc.ids()')
  const [l0] = ids
  await clickBlock(cdp, l0)
  await openLineSheet(cdp, 0)
  await ev(cdp, `__lrc.setLineTimeInput('')`)
  await sleep(30)
  await ev(cdp, '__lrc.clickDialogSave()')
  await sleep(60)

  await ev(cdp, '__lrc.store.getState().undoLastAction()')
  await sleep(60)
  assert(checks, 'AF.一步撤销 → 行时间复原 [12120]', eq(await ev(cdp, `__lrc.times(${J(l0)})`), [12120]), J(await ev(cdp, `__lrc.times(${J(l0)})`)))
  assert(checks, 'AF.一步撤销 → 字级复原 [12008,13600]', eq(await ev(cdp, `__lrc.wordTimes(${J(l0)})`), [12008, 13600]), J(await ev(cdp, `__lrc.wordTimes(${J(l0)})`)))
}

// AG. 非法输入被拒：红框 / aria-invalid / 保存禁用 / 不落盘
async function testAG(cdp, checks) {
  const ids = await ev(cdp, '__lrc.ids()')
  const [l0] = ids
  await clickBlock(cdp, l0)
  await openLineSheet(cdp, 0)
  const n0 = await ev(cdp, '__lrc.logLen()')

  // 秒 >= 60 非法
  await ev(cdp, `__lrc.setLineTimeInput('00:75')`)
  await sleep(30)
  assert(checks, 'AG.00:75 → aria-invalid=true', (await ev(cdp, '__lrc.lineTimeInvalid()')) === true, 'invalid')
  assert(checks, 'AG.00:75 → 保存禁用', (await ev(cdp, '__lrc.dialogSaveDisabled()')) === true, 'disabled')

  // 完全无法解析
  await ev(cdp, `__lrc.setLineTimeInput('abc')`)
  await sleep(30)
  assert(checks, 'AG.abc → aria-invalid=true', (await ev(cdp, '__lrc.lineTimeInvalid()')) === true, 'invalid')
  assert(checks, 'AG.abc → 保存禁用', (await ev(cdp, '__lrc.dialogSaveDisabled()')) === true, 'disabled')

  // 点禁用按钮不触发 onClick → 零落盘
  await ev(cdp, '__lrc.clickDialogSave()')
  await sleep(40)
  assert(checks, 'AG.非法 → 零落盘', (await ev(cdp, '__lrc.logLen()')) === n0, `${n0}`)
  assert(checks, 'AG.非法 → 行时间不变 [12120]', eq(await ev(cdp, `__lrc.times(${J(l0)})`), [12120]), J(await ev(cdp, `__lrc.times(${J(l0)})`)))

  // 改回合法 → 提示消失、保存可用
  await ev(cdp, `__lrc.setLineTimeInput('00:20.000')`)
  await sleep(30)
  assert(checks, 'AG.合法 → aria-invalid=false 且保存可用', (await ev(cdp, '__lrc.lineTimeInvalid()')) === false && (await ev(cdp, '__lrc.dialogSaveDisabled()')) === false, 'ok')
  await ev(cdp, '__lrc.closeDialog()')
}

// AH. 导出防复活：清空后该行导出为纯文本（无行级 / 字级标签）
async function testAH(cdp, checks) {
  const ids = await ev(cdp, '__lrc.ids()')
  const [l0] = ids
  const l0text = await ev(cdp, `__lrc.state().document.lines.find(function(l){return l.id===${J(l0)}}).text`)

  const before = exportRows(await ev(cdp, '__lrc.buildExport(1)'))
  assert(checks, 'AH.清空前 l0 带行级标签', before.some((s) => s.startsWith('[00:12.120]')), J(before))
  assert(checks, 'AH.清空前 l0 带字级标签', before.some((s) => s.indexOf('<00:12.008>') >= 0), J(before))

  await clickBlock(cdp, l0)
  await openLineSheet(cdp, 0)
  await ev(cdp, `__lrc.setLineTimeInput('')`)
  await sleep(30)
  await ev(cdp, '__lrc.clickDialogSave()')
  await sleep(60)

  const after = exportRows(await ev(cdp, '__lrc.buildExport(1)'))
  const row = after.find((s) => s.indexOf(l0text) >= 0)
  assert(checks, 'AH.清空后 l0 导出为原文纯文本', row === l0text, J(row))
  assert(checks, 'AH.清空后无行级标签（防复活）', typeof row === 'string' && !/^\[\d{2}:\d{2}/.test(row), J(row))
  assert(checks, 'AH.清空后无字级标签（防复活）', typeof row === 'string' && row.indexOf('<') < 0, J(row))
  assert(checks, 'AH.清空后导出仍 4 行歌词', after.slice(1).length === 4, J(after))
}

// AI. 日志展示：清空显示「清空时间戳」，不得显示「无时间变化」
async function testAI(cdp, checks) {
  const ids = await ev(cdp, '__lrc.ids()')
  const [l0] = ids
  await clickBlock(cdp, l0)
  await openLineSheet(cdp, 0)
  await ev(cdp, `__lrc.setLineTimeInput('')`)
  await sleep(30)
  await ev(cdp, '__lrc.clickDialogSave()')
  await sleep(100)

  const entry = await ev(cdp, '__lrc.last()')
  assert(checks, 'AI.清空落一条 manual-timestamp（不新增 kind）', entry.kind === 'manual-timestamp', J(entry.kind))
  const ok = await ev(cdp, `__lrc.expandLogEntry(${J(entry.id)})`)
  assert(checks, 'AI.日志条目可展开', ok === true, J(ok))
  await sleep(60)
  const txt = await ev(cdp, `__lrc.logEntryText(${J(entry.id)})`)
  assert(checks, 'AI.展开显示「清空时间戳」', typeof txt === 'string' && txt.indexOf('清空时间戳') >= 0, J(txt))
  assert(checks, 'AI.不显示「无时间变化」', typeof txt === 'string' && txt.indexOf('无时间变化') < 0, J(txt))
}

// AJ. 字级输入框走同一套解析：纯数字 = 秒（不是毫秒）
async function testAJ(cdp, checks) {
  const ids = await ev(cdp, '__lrc.ids()')
  const [l0] = ids
  await clickBlock(cdp, l0)
  await openLineSheet(cdp, 0)

  // setup：l0 已打行级轴，字级框可用；两个槽位初值 00:12.008 / 00:13.600
  assert(checks, 'AJ.setup 行时间 [12120]（字级框可用）', eq(await ev(cdp, `__lrc.times(${J(l0)})`), [12120]), J(await ev(cdp, `__lrc.times(${J(l0)})`)))
  assert(checks, 'AJ.setup 2 个字级槽位', (await ev(cdp, '__lrc.wordInputCount()')) === 2, String(await ev(cdp, '__lrc.wordInputCount()')))
  assert(checks, 'AJ.setup 字级框未禁用', (await ev(cdp, '__lrc.wordInputs()[0].disabled')) === false, 'disabled')
  assert(checks, 'AJ.setup 字级初值 00:12.008 / 00:13.600', (await ev(cdp, '__lrc.wordInputValue(0)')) === '00:12.008' && (await ev(cdp, '__lrc.wordInputValue(1)')) === '00:13.600', `${J(await ev(cdp, '__lrc.wordInputValue(0)'))} ${J(await ev(cdp, '__lrc.wordInputValue(1)'))}`)

  // 纯数字 13 = 13 秒（不是 13 毫秒）——与行级共用 parseTimeInput
  await ev(cdp, `__lrc.setWordInput(0, '13')`)
  await sleep(30)
  assert(checks, 'AJ.编辑期间保持原文 13（不改写）', (await ev(cdp, '__lrc.wordInputValue(0)')) === '13', J(await ev(cdp, '__lrc.wordInputValue(0)')))

  const n0 = await ev(cdp, '__lrc.logLen()')
  await ev(cdp, '__lrc.clickDialogSave()')
  await sleep(60)
  assert(checks, 'AJ.保存落一条日志', (await ev(cdp, '__lrc.logLen()')) === n0 + 1, `${n0}`)
  assert(checks, 'AJ.13 = 13000ms（另一字级不变）', eq(await ev(cdp, `__lrc.wordTimes(${J(l0)})`), [13000, 13600]), J(await ev(cdp, `__lrc.wordTimes(${J(l0)})`)))

  // 重开弹窗 → 归一化呈现 00:13.000
  await openLineSheet(cdp, 0)
  assert(checks, 'AJ.保存后字级归一化呈现 00:13.000', (await ev(cdp, '__lrc.wordInputValue(0)')) === '00:13.000', J(await ev(cdp, '__lrc.wordInputValue(0)')))
  await ev(cdp, '__lrc.closeDialog()')
}

// AK. 改行级时间时字级跟随平移：新字级 = 原字级 + (新行级 − 原行级)
async function testAK(cdp, checks) {
  const ids = await ev(cdp, '__lrc.ids()')
  const [l0] = ids
  await clickBlock(cdp, l0)
  await openLineSheet(cdp, 0)

  // setup：行 12120，字级 [12008, 13600]
  assert(checks, 'AK.setup 行时间 [12120]', eq(await ev(cdp, `__lrc.times(${J(l0)})`), [12120]), J(await ev(cdp, `__lrc.times(${J(l0)})`)))
  assert(checks, 'AK.setup 字级 [12008,13600]', eq(await ev(cdp, `__lrc.wordTimes(${J(l0)})`), [12008, 13600]), J(await ev(cdp, `__lrc.wordTimes(${J(l0)})`)))

  // 行级 13 = 13000；offset = 13000 − 12120 = 880
  await ev(cdp, `__lrc.setLineTimeInput('13')`)
  await sleep(30)
  await ev(cdp, '__lrc.clickDialogSave()')
  await sleep(60)

  assert(checks, 'AK.行级 = 13000', eq(await ev(cdp, `__lrc.times(${J(l0)})`), [13000]), J(await ev(cdp, `__lrc.times(${J(l0)})`)))
  assert(checks, 'AK.字级随行级平移 +880 → [12888,14480]', eq(await ev(cdp, `__lrc.wordTimes(${J(l0)})`), [12888, 14480]), J(await ev(cdp, `__lrc.wordTimes(${J(l0)})`)))
}

/* -------------------------------- driver ------------------------------ */
async function testPRE(cdp, checks) {
  assert(checks, 'PRE.kernelReady', await ev(cdp, '__lrc.kernelReady()'), '')
  assert(checks, 'PRE.clockPatched', await ev(cdp, '__lrc.clockPatched()'), J(await ev(cdp, '__lrc.clockPatchError()')))
  const dur = await setupAudio(cdp)
  assert(checks, 'PRE.audioDurationMs > 0', typeof dur === 'number' && dur > 0, String(dur))
  const spec = await ev(cdp, '__lrc.audioSpec()')
  assert(checks, 'PRE.spec', !!spec && spec.durationMs > 0, J(spec))
  assert(checks, 'PRE.peakState ready', (await ev(cdp, '__lrc.peakState()')) === 'ready', J(await ev(cdp, '__lrc.peakState()')))
  const pk = await ev(cdp, '__lrc.peaks(0, 10000, 200)')
  assert(checks, 'PRE.peaks ok', typeof pk === 'string' && pk.indexOf('ok:') === 0, String(pk))
  // 播放驱动
  const ok = await armPlayback(cdp, 13000)
  assert(checks, 'PRE.playing', ok, '')
  const t = await ev(cdp, '__lrc.audioTimeMs()')
  assert(checks, 'PRE.audioTimeMs ≈ 13000', Math.abs(t - 13000) < 200, String(t))
}

/* ---------------- AL~AX：视口跟随 / 屏外箭头 / 三项设置 ---------------- */

// AL：屏内越过触发点 → 平滑翻页（有中间值，非瞬移）
async function testAL(cdp, checks) {
  await ev(cdp, `__lrc.updateSettings({ followResumeMode: 'snap' })`)
  await setupAudio(cdp)
  await setView(cdp, 12000, 5000)
  const ok = await armPlayback(cdp, 13000)
  assert(checks, 'AL.开始播放', ok, '')
  await sleep(60)
  const pre = await viewStart(cdp)
  await ev(cdp, '__lrc.recordStart()')
  await advanceTo(cdp, 16200, 320) // offset 4200 = 0.84W → 触发
  const samples = await ev(cdp, '__lrc.recStop()')
  const final = await viewStart(cdp)
  const mid = distinctValues(samples, 12001, 15190)
  assert(checks, 'AL.起跳前 viewStart≈12000', Math.abs(pre - 12000) <= 3, String(pre))
  assert(checks, 'AL.动画中间值≥3（平滑非瞬移）', mid.length >= 3, J(mid))
  assert(checks, 'AL.final≈15200±3', Math.abs(final - 15200) <= 3, String(final))
  assert(checks, 'AL.isPlaying 真', (await ev(cdp, '__lrc.isPlaying()')) === true, '')
}

// AM：播放头已在屏外 → 直接跳（无中间值）
async function testAM(cdp, checks) {
  await ev(cdp, `__lrc.updateSettings({ followResumeMode: 'snap' })`)
  await setupAudio(cdp)
  await setView(cdp, 12000, 5000)
  const ok = await armPlayback(cdp, 13000)
  assert(checks, 'AM.开始播放', ok, '')
  await sleep(60)
  await ev(cdp, '__lrc.recordStart()')
  await advanceTo(cdp, 18000, 320) // offset 6000 = 1.2W → 屏外
  const samples = await ev(cdp, '__lrc.recStop()')
  const final = await viewStart(cdp)
  const mid = distinctValues(samples, 12001, 16995)
  assert(checks, 'AM.屏外直跳无中间值', mid.length === 0, J(mid))
  assert(checks, 'AM.final≈17000±2', Math.abs(final - 17000) <= 2, String(final))
}

// AN：翻页到位后不重复触发（单调不减、不冲过目标）
async function testAN(cdp, checks) {
  await ev(cdp, `__lrc.updateSettings({ followResumeMode: 'snap' })`)
  await setupAudio(cdp)
  await setView(cdp, 12000, 5000)
  await armPlayback(cdp, 13000)
  await sleep(60)
  await ev(cdp, '__lrc.recordStart()')
  await advanceTo(cdp, 16200, 500)
  const samples = await ev(cdp, '__lrc.recStop()')
  const final = await viewStart(cdp)
  let mono = true
  for (let i = 1; i < samples.length; i++) if (samples[i].s < samples[i - 1].s - 0.5) mono = false
  const maxS = samples.reduce((m, s) => Math.max(m, s.s), -Infinity)
  const mid = distinctValues(samples, 12001, 15190)
  assert(checks, 'AN.final≈15200±3', Math.abs(final - 15200) <= 3, String(final))
  assert(checks, 'AN.单调不减', mono, '')
  assert(checks, 'AN.不冲过目标 max ≤ target+1', maxS <= 15201, String(maxS))
  assert(checks, 'AN.动画中间值≥4', mid.length >= 4, J(mid))
}

// AO：动画进行中的用户手势 → 立即停在当前位置
async function testAO(cdp, checks) {
  await ev(cdp, `__lrc.updateSettings({ pauseAudioOnPan: true, followResumeMode: 'snap' })`)
  await setupAudio(cdp)
  await setView(cdp, 12000, 5000)
  const ok = await armPlayback(cdp, 13000)
  assert(checks, 'AO.开始播放', ok, '')
  await sleep(60)
  await ev(cdp, '__lrc.setClockMs(16200)')
  await sleep(70) // 动画进行中
  const p = await stripPoint(cdp)
  await wheelAt(cdp, p.x, p.y, 0, 40)
  await sleep(250) // ≥2.5× 滚轮收敛（~100ms）：取样前先落定
  const vA = await viewStart(cdp)
  await sleep(150)
  const vB = await viewStart(cdp)
  assert(checks, 'AO.手势后视口落定且不再推进 |vB-vA|<=0.5', Math.abs(vB - vA) <= 0.5, `${vA} -> ${vB}`)
  assert(checks, 'AO.滚轮真暂停 isPlaying=false', (await ev(cdp, '__lrc.isPlaying()')) === false, '')
  assert(checks, 'AO.停在中间位置（非终点15200）', Math.abs(vB - 15200) > 5, String(vB))
}

// AP：拖块挂起（snap 子案：松手立即拉回；pause 子案：松手不拉回） 
async function testAP(cdp, checks) {
  await ev(cdp, `__lrc.updateSettings({ confirmMajorChange: false, followResumeMode: 'snap' })`)
  await setupAudio(cdp)
  await setView(cdp, 11000, 5000)
  await armPlayback(cdp, 13000) // offset 2000 = 0.4W 安全区
  await sleep(60)
  const blk = await pickBlockPoint(cdp)
  await ev(cdp, '__lrc.recordStart()')
  await pressAt(cdp, blk.x, blk.y)
  await sleep(30)
  await ev(cdp, '__lrc.setClockMs(15250)') // offset 0.85W（无挂起会触发）
  await sleep(120)
  const during = await viewStart(cdp)
  await moveTo(cdp, blk.x + 30, blk.y)
  await sleep(20)
  await moveTo(cdp, blk.x + 55, blk.y)
  await sleep(20)
  await releaseAt(cdp, blk.x + 55, blk.y)
  await sleep(400)
  const samples = await ev(cdp, '__lrc.recStop()')
  const final = await viewStart(cdp)
  const mid = distinctValues(samples, 11001, 14245)
  assert(checks, 'AP.snap 挂起期视口不动 |during-11000|<=2', Math.abs(during - 11000) <= 2, String(during))
  assert(checks, 'AP.snap 松手后动画中间值≥3', mid.length >= 3, J(mid))
  assert(checks, 'AP.snap final≈14250±3', Math.abs(final - 14250) <= 3, String(final))

  // pause 子案：松手不拉回，且此后持续不跟随
  await ev(cdp, '__lrc.setFollowPaused(false)')
  await ev(cdp, '__lrc.setClockMs(13000)')
  await ev(cdp, `__lrc.updateSettings({ followResumeMode: 'pause' })`)
  await setView(cdp, 11000, 5000)
  await armPlayback(cdp, 13000)
  await sleep(60)
  const blk2 = await pickBlockPoint(cdp)
  await pressAt(cdp, blk2.x, blk2.y)
  await sleep(30)
  await ev(cdp, '__lrc.setClockMs(15250)')
  await sleep(120)
  await moveTo(cdp, blk2.x + 30, blk2.y)
  await sleep(20)
  await moveTo(cdp, blk2.x + 55, blk2.y)
  await sleep(20)
  await releaseAt(cdp, blk2.x + 55, blk2.y)
  await sleep(300)
  const afterRelease = await viewStart(cdp)
  await ev(cdp, '__lrc.setClockMs(18000)')
  await sleep(200)
  const afterMore = await viewStart(cdp)
  assert(checks, 'AP.pause 松手后不拉回 |afterRelease-11000|<=2', Math.abs(afterRelease - 11000) <= 2, String(afterRelease))
  assert(checks, 'AP.pause 继续播放仍不跟随 |afterMore-11000|<=2', Math.abs(afterMore - 11000) <= 2, String(afterMore))
}

// AQ：B 模式 + 滚轮平移 → followPaused；再按播放不瞬移（A 模式对照会拉回）
async function testAQ(cdp, checks) {
  await ev(cdp, `__lrc.updateSettings({ pauseAudioOnPan: false, followResumeMode: 'pause' })`)
  await setupAudio(cdp)
  await ev(cdp, '__lrc.setFollowPaused(false)')
  await setView(cdp, 12000, 5000)
  await armPlayback(cdp, 13000)
  await sleep(60)
  const p = await stripPoint(cdp)
  await wheelAt(cdp, p.x, p.y, 0, 40)
  await sleep(250) // ≥2.5× 滚轮收敛（~100ms）：基线取落定后值
  const V0 = await viewStart(cdp)
  assert(checks, 'AQ.B 滚轮后仍在播放（pauseAudioOnPan 关）', (await ev(cdp, '__lrc.isPlaying()')) === true, '')
  assert(checks, 'AQ.B 滚轮确实平移了视口 V0>12000', V0 > 12000 + 5, String(V0))
  const geom = await viewGeom(cdp)
  const wheelTarget = 12000 + (40 * 1.0) / geom.pixelsPerMs
  assert(checks, 'AQ.B 滚轮最终收敛到目标 ±3', Math.abs(V0 - wheelTarget) <= 3, `${V0} vs ${wheelTarget}`)
  await ev(cdp, '__lrc.pauseAudio()')
  await sleep(30)
  await ev(cdp, '__lrc.playAudio()')
  await sleep(120)
  const V1 = await viewStart(cdp)
  assert(checks, 'AQ.B 再按播放不瞬移 |V1-V0|<=2', Math.abs(V1 - V0) <= 2, `${V0} -> ${V1}`)
  await ev(cdp, '__lrc.setClockMs(18000)')
  await sleep(200)
  const V2 = await viewStart(cdp)
  assert(checks, 'AQ.B 播放头跑远仍不跟随 |V2-V0|<=2', Math.abs(V2 - V0) <= 2, `${V0} -> ${V2}`)

  // A 模式对照：snap → 出屏后自动拉回
  await ev(cdp, `__lrc.updateSettings({ followResumeMode: 'snap' })`)
  await ev(cdp, '__lrc.setFollowPaused(false)')
  await ev(cdp, '__lrc.setClockMs(13000)')
  await setView(cdp, 12000, 5000)
  await armPlayback(cdp, 13000)
  await sleep(60)
  const p2 = await stripPoint(cdp)
  await wheelAt(cdp, p2.x, p2.y, 0, 40)
  await sleep(80)
  await ev(cdp, '__lrc.setClockMs(18000)')
  await sleep(320)
  const V3 = await viewStart(cdp)
  assert(checks, 'AQ.A 对照：出屏后拉回 ≈17000', Math.abs(V3 - 17000) <= 3, String(V3))
}

// AR：B 模式 + 滚动条拖拽 → followPaused；再按播放不瞬移（A 模式对照会拉回）
async function testAR(cdp, checks) {
  await ev(cdp, `__lrc.updateSettings({ pauseAudioOnPan: false, followResumeMode: 'pause' })`)
  await setupAudio(cdp)
  await ev(cdp, '__lrc.setFollowPaused(false)')
  await setView(cdp, 12000, 5000)
  await armPlayback(cdp, 13000)
  await sleep(60)
  const th = await ev(cdp, '__lrc.scrollbarThumbRect()')
  assert(checks, 'AR.拇指可见', !!th && th.width > 0, J(th))
  await pressAt(cdp, Math.round(th.x), Math.round(th.y))
  await sleep(30)
  await moveTo(cdp, Math.round(th.x + 10), Math.round(th.y))
  await sleep(30)
  await releaseAt(cdp, Math.round(th.x + 10), Math.round(th.y))
  await sleep(80)
  const V0 = await viewStart(cdp)
  assert(checks, 'AR.B 拖拽确实平移了视口 V0>12000', V0 > 12000 + 100, String(V0))
  assert(checks, 'AR.B 拖拽未暂停（pauseAudioOnPan 关）', (await ev(cdp, '__lrc.isPlaying()')) === true, '')
  await ev(cdp, '__lrc.pauseAudio()')
  await sleep(30)
  await ev(cdp, '__lrc.playAudio()')
  await sleep(120)
  const V1 = await viewStart(cdp)
  assert(checks, 'AR.B 再按播放不瞬移 |V1-V0|<=2', Math.abs(V1 - V0) <= 2, `${V0} -> ${V1}`)
  await ev(cdp, '__lrc.setClockMs(30000)')
  await sleep(200)
  const V2 = await viewStart(cdp)
  assert(checks, 'AR.B 播放头跑远仍不跟随 |V2-V0|<=2', Math.abs(V2 - V0) <= 2, `${V0} -> ${V2}`)

  // A 模式对照：snap → 出屏后自动拉回
  await ev(cdp, `__lrc.updateSettings({ followResumeMode: 'snap' })`)
  await ev(cdp, '__lrc.setFollowPaused(false)')
  await ev(cdp, '__lrc.setClockMs(13000)')
  await setView(cdp, 12000, 5000)
  await armPlayback(cdp, 13000)
  await sleep(60)
  const th2 = await ev(cdp, '__lrc.scrollbarThumbRect()')
  await pressAt(cdp, Math.round(th2.x), Math.round(th2.y))
  await sleep(30)
  await moveTo(cdp, Math.round(th2.x + 10), Math.round(th2.y))
  await sleep(30)
  await releaseAt(cdp, Math.round(th2.x + 10), Math.round(th2.y))
  await sleep(80)
  await ev(cdp, '__lrc.setClockMs(30000)')
  await sleep(320)
  const V3 = await viewStart(cdp)
  assert(checks, 'AR.A 对照：出屏后拉回 ≈29000', Math.abs(V3 - 29000) <= 3, String(V3))
}

// AS：B 模式上限跟随 → 点归位按钮 → 拉回（带动画）+ 恢复跟随
async function testAS(cdp, checks) {
  await ev(cdp, `__lrc.updateSettings({ followResumeMode: 'pause', pauseAudioOnPan: false })`)
  await setupAudio(cdp)
  await setView(cdp, 10000, 5000)
  await ev(cdp, '__lrc.setFollowPaused(true)')
  await armPlayback(cdp, 18000) // offset 8000 = 1.6W 屏外右侧
  await sleep(150)
  assert(checks, 'AS.屏外箭头出现', await ev(cdp, '__lrc.hintVisible()'), String(await ev(cdp, '__lrc.hintDisplay()')))
  assert(checks, 'AS.侧别 right', (await ev(cdp, '__lrc.hintSide()')) === 'right', String(await ev(cdp, '__lrc.hintSide()')))
  assert(checks, 'AS.归位按钮同时出现', (await ev(cdp, '__lrc.resetDisplay()')) !== 'none', String(await ev(cdp, '__lrc.resetDisplay()')))
  const rr = await ev(cdp, '__lrc.resetRect()')
  assert(checks, 'AS.归位按钮 rect 可命中', !!rr && rr.width > 0, J(rr))
  await ev(cdp, '__lrc.recordStart()')
  await pressAt(cdp, Math.round(rr.x), Math.round(rr.y))
  await sleep(30)
  await releaseAt(cdp, Math.round(rr.x), Math.round(rr.y))
  await sleep(400)
  const samples = await ev(cdp, '__lrc.recStop()')
  const final = await viewStart(cdp)
  const mid = distinctValues(samples, 10001, 16990)
  assert(checks, 'AS.归位动画中间值≥3', mid.length >= 3, J(mid))
  assert(checks, 'AS.归位到 17000±3', Math.abs(final - 17000) <= 3, String(final))
  await ev(cdp, '__lrc.setClockMs(24000)')
  await sleep(320)
  const final2 = await viewStart(cdp)
  assert(checks, 'AS.归位后恢复跟随 ≈23000', Math.abs(final2 - 23000) <= 3, String(final2))
}

// AT：屏外箭头出现 / 消失 / 侧别（含归位同步）
async function testAT(cdp, checks) {
  await setupAudio(cdp)
  await setView(cdp, 10000, 5000)
  await ev(cdp, '__lrc.seekAudio(4000)')
  await sleep(120)
  assert(checks, 'AT.左侧箭头显示', await ev(cdp, '__lrc.hintVisible()'), String(await ev(cdp, '__lrc.hintDisplay()')))
  assert(checks, 'AT.侧别 left', (await ev(cdp, '__lrc.hintSide()')) === 'left', String(await ev(cdp, '__lrc.hintSide()')))
  assert(checks, 'AT.箭头文字 ◀', (await ev(cdp, '__lrc.hintText()')) === '◀', String(await ev(cdp, '__lrc.hintText()')))
  assert(checks, 'AT.归位按钮显示', (await ev(cdp, '__lrc.resetDisplay()')) !== 'none', String(await ev(cdp, '__lrc.resetDisplay()')))
  await ev(cdp, '__lrc.seekAudio(18000)')
  await sleep(120)
  assert(checks, 'AT.右侧箭头显示', await ev(cdp, '__lrc.hintVisible()'), String(await ev(cdp, '__lrc.hintDisplay()')))
  assert(checks, 'AT.侧别 right', (await ev(cdp, '__lrc.hintSide()')) === 'right', String(await ev(cdp, '__lrc.hintSide()')))
  assert(checks, 'AT.箭头文字 ▶', (await ev(cdp, '__lrc.hintText()')) === '▶', String(await ev(cdp, '__lrc.hintText()')))
  await ev(cdp, '__lrc.seekAudio(13000)')
  await sleep(120)
  assert(checks, 'AT.视窗内箭头隐藏', (await ev(cdp, '__lrc.hintDisplay()')) === 'none', String(await ev(cdp, '__lrc.hintDisplay()')))
  assert(checks, 'AT.视窗内归位隐藏', (await ev(cdp, '__lrc.resetDisplay()')) === 'none', String(await ev(cdp, '__lrc.resetDisplay()')))
}

// AU：箭头拖动（只往视窗内、反向拖不动；拖动中保持挂载）
async function testAU(cdp, checks) {
  await setupAudio(cdp)
  await setView(cdp, 10000, 5000)
  await ev(cdp, '__lrc.setFollowPaused(true)')
  await ev(cdp, '__lrc.seekAudio(20000)')
  await sleep(150)
  const hr = await ev(cdp, '__lrc.hintRect()')
  const host = await ev(cdp, '__lrc.hintHostRect()')
  const geom = await viewGeom(cdp)
  const W = geom.viewportWidthPx
  const ppms = geom.pixelsPerMs
  assert(checks, 'AU.右侧箭头存在', (await ev(cdp, '__lrc.hintSide()')) === 'right', String(await ev(cdp, '__lrc.hintSide()')))
  await pressAt(cdp, Math.round(hr.x), Math.round(hr.y))
  await sleep(40)
  const t1 = await ev(cdp, '__lrc.audioTimeMs()')
  const exp1 = 10000 + (W - 14) / ppms
  assert(checks, 'AU.按下→播放头瞬移到箭头处', Math.abs(t1 - exp1) < 80, `${t1} vs ${exp1}`)
  assert(checks, 'AU.拖动中不透明度 0 且仍挂载', (await ev(cdp, '__lrc.hintOpacity()')) === '0' && (await ev(cdp, '__lrc.hintMounted()')), `op=${await ev(cdp, '__lrc.hintOpacity()')}`)
  await moveTo(cdp, Math.round(host.left + W * 0.5), Math.round(hr.y))
  await sleep(40)
  const t2 = await ev(cdp, '__lrc.audioTimeMs()')
  const exp2 = 10000 + (W * 0.5) / ppms
  assert(checks, 'AU.拖到中部 ≈ 视窗中点时间', Math.abs(t2 - exp2) < 80, `${t2} vs ${exp2}`)
  await moveTo(cdp, Math.round(host.left + W + 300), Math.round(hr.y))
  await sleep(40)
  const t3 = await ev(cdp, '__lrc.audioTimeMs()')
  const exp3 = 10000 + W / ppms
  assert(checks, 'AU.反向拖出右侧被 clamp 到右边界', Math.abs(t3 - exp3) < 80, `${t3} vs ${exp3}`)
  await moveTo(cdp, Math.round(host.left + W * 0.3), Math.round(hr.y))
  await sleep(40)
  const t4 = await ev(cdp, '__lrc.audioTimeMs()')
  const exp4 = 10000 + (W * 0.3) / ppms
  assert(checks, 'AU.拖到 30% 位置', Math.abs(t4 - exp4) < 80, `${t4} vs ${exp4}`)
  await releaseAt(cdp, Math.round(host.left + W * 0.3), Math.round(hr.y))
  await sleep(150)
  assert(checks, 'AU.松手后箭头隐藏', (await ev(cdp, '__lrc.hintDisplay()')) === 'none', String(await ev(cdp, '__lrc.hintDisplay()')))
  assert(checks, 'AU.松手后不透明度复位 1', (await ev(cdp, '__lrc.hintOpacity()')) === '1', String(await ev(cdp, '__lrc.hintOpacity()')))
  assert(checks, 'AU.松手后仍挂载', await ev(cdp, '__lrc.hintMounted()'), '')
}

// AV：三项设置的默认值 / 持久化 / 非法值白名单回退
async function testAV(cdp, checks) {
  await ev(cdp, `localStorage.removeItem('lrc-editor:lrc-editor/settings')`)
  await reset(cdp)
  const d = await ev(cdp, '__lrc.settings()')
  assert(checks, 'AV.默认 followResumeMode=snap', d.followResumeMode === 'snap', String(d.followResumeMode))
  assert(checks, 'AV.默认 pauseAudioOnPan=true', d.pauseAudioOnPan === true, String(d.pauseAudioOnPan))
  assert(checks, 'AV.默认 pauseAudioOnSeek=true', d.pauseAudioOnSeek === true, String(d.pauseAudioOnSeek))
  await ev(cdp, `__lrc.updateSettings({ followResumeMode: 'pause', pauseAudioOnPan: false, pauseAudioOnSeek: false })`)
  await sleep(400)
  const raw = await ev(cdp, '__lrc.storedSettingsRaw()')
  assert(checks, 'AV.写盘 followResumeMode:pause', typeof raw === 'string' && raw.indexOf('"followResumeMode":"pause"') >= 0, String(raw).slice(0, 220))
  assert(checks, 'AV.写盘 pauseAudioOnPan:false', typeof raw === 'string' && raw.indexOf('"pauseAudioOnPan":false') >= 0, String(raw).slice(0, 220))
  assert(checks, 'AV.写盘 pauseAudioOnSeek:false', typeof raw === 'string' && raw.indexOf('"pauseAudioOnSeek":false') >= 0, String(raw).slice(0, 220))
  const bad = await ev(cdp, `__lrc.hydrateSettings({ followResumeMode: 'nope', pauseAudioOnPan: 'yes', pauseAudioOnSeek: 123 })`)
  assert(checks, 'AV.非法值回退 [snap,true,true]', eq([bad.followResumeMode, bad.pauseAudioOnPan, bad.pauseAudioOnSeek], ['snap', true, true]), J([bad.followResumeMode, bad.pauseAudioOnPan, bad.pauseAudioOnSeek]))
  const good = await ev(cdp, `__lrc.hydrateSettings({ followResumeMode: 'pause', pauseAudioOnPan: false, pauseAudioOnSeek: false })`)
  assert(checks, 'AV.合法值 [pause,false,false]', eq([good.followResumeMode, good.pauseAudioOnPan, good.pauseAudioOnSeek], ['pause', false, false]), J([good.followResumeMode, good.pauseAudioOnPan, good.pauseAudioOnSeek]))
}

// AW：平移视窗 → 暂停音频（范围=滚动条拖拽 + 滚轮；ctrl+滚轮缩放不触发）
async function testAW(cdp, checks) {
  await ev(cdp, `__lrc.updateSettings({ pauseAudioOnPan: true })`)
  await setupAudio(cdp)
  let ok = await armPlayback(cdp, 13000)
  assert(checks, 'AW.a 开始播放', ok, '')
  const th = await ev(cdp, '__lrc.scrollbarThumbRect()')
  assert(checks, 'AW.拇指可见', !!th && th.width > 0, J(th))
  await pressAt(cdp, Math.round(th.x), Math.round(th.y))
  await sleep(60)
  assert(checks, 'AW.a 拇指按下即暂停', (await ev(cdp, '__lrc.isPlaying()')) === false, '')
  await moveTo(cdp, Math.round(th.x + 40), Math.round(th.y))
  await sleep(30)
  await releaseAt(cdp, Math.round(th.x + 40), Math.round(th.y))
  await sleep(60)
  assert(checks, 'AW.a 松手后仍暂停', (await ev(cdp, '__lrc.isPlaying()')) === false, '')

  await ev(cdp, `__lrc.updateSettings({ pauseAudioOnPan: false })`)
  ok = await armPlayback(cdp, 13000)
  assert(checks, 'AW.b 开始播放', ok, '')
  let p = await stripPoint(cdp)
  await wheelAt(cdp, p.x, p.y, 0, 40)
  await sleep(60)
  assert(checks, 'AW.b 滚轮不暂停（设置关）', (await ev(cdp, '__lrc.isPlaying()')) === true, '')

  await ev(cdp, `__lrc.updateSettings({ pauseAudioOnPan: true })`)
  ok = await armPlayback(cdp, 13000)
  assert(checks, 'AW.c 开始播放', ok, '')
  p = await stripPoint(cdp)
  await wheelAt(cdp, p.x, p.y, 0, 40)
  await sleep(60)
  assert(checks, 'AW.c 滚轮即暂停', (await ev(cdp, '__lrc.isPlaying()')) === false, '')

  ok = await armPlayback(cdp, 13000)
  assert(checks, 'AW.d 开始播放', ok, '')
  const before = await ev(cdp, '__lrc.viewInfo()')
  await wheelAt(cdp, p.x, p.y, 0, -100, MOD.ctrl)
  await sleep(60)
  const after = await ev(cdp, '__lrc.viewInfo()')
  assert(checks, 'AW.d 缩放改变 ppms', Math.abs(after.pixelsPerMs - before.pixelsPerMs) > 1e-9, `${before.pixelsPerMs} -> ${after.pixelsPerMs}`)
  assert(checks, 'AW.d 缩放不暂停', (await ev(cdp, '__lrc.isPlaying()')) === true, '')
}

// AX：移动播放头 → 暂停音频（范围=尺子擦洗 + 箭头拖动；缩放 / 打轴不触发）
async function testAX(cdp, checks) {
  await ev(cdp, `__lrc.updateSettings({ pauseAudioOnSeek: true })`)
  await setupAudio(cdp)
  let ok = await armPlayback(cdp, 13000)
  assert(checks, 'AX.a 开始播放', ok, '')
  let rr = await ev(cdp, '__lrc.rulerRect()')
  await pressAt(cdp, Math.round(rr.x), Math.round(rr.y))
  await sleep(60)
  assert(checks, 'AX.a 尺子按下即暂停', (await ev(cdp, '__lrc.isPlaying()')) === false, '')
  await releaseAt(cdp, Math.round(rr.x), Math.round(rr.y))
  await sleep(60)
  assert(checks, 'AX.a 松手后仍暂停', (await ev(cdp, '__lrc.isPlaying()')) === false, '')

  await ev(cdp, `__lrc.updateSettings({ pauseAudioOnSeek: false })`)
  ok = await armPlayback(cdp, 13000)
  assert(checks, 'AX.b 开始播放', ok, '')
  rr = await ev(cdp, '__lrc.rulerRect()')
  await pressAt(cdp, Math.round(rr.x), Math.round(rr.y))
  await sleep(50)
  await releaseAt(cdp, Math.round(rr.x), Math.round(rr.y))
  await sleep(60)
  assert(checks, 'AX.b 尺子不暂停（设置关）', (await ev(cdp, '__lrc.isPlaying()')) === true, '')

  await ev(cdp, `__lrc.updateSettings({ pauseAudioOnSeek: true })`)
  const ids = await ev(cdp, '__lrc.ids()')
  await ev(cdp, `__lrc.store.getState().selectLine(${J(ids[0])})`)
  await ev(cdp, '__lrc.blur()')
  const n0 = await ev(cdp, '__lrc.logLen()')
  ok = await armPlayback(cdp, 13000)
  assert(checks, 'AX.c 开始播放', ok, '')
  await keyPress(cdp, 'Space', ' ', 32)
  await sleep(80)
  assert(checks, 'AX.c 打轴不暂停', (await ev(cdp, '__lrc.isPlaying()')) === true, '')
  assert(checks, 'AX.c 打轴落一条日志', (await ev(cdp, '__lrc.logLen()')) === n0 + 1, `${n0} -> ${await ev(cdp, '__lrc.logLen()')}`)

  ok = await armPlayback(cdp, 13000)
  assert(checks, 'AX.d 开始播放', ok, '')
  const p = await stripPoint(cdp)
  await wheelAt(cdp, p.x, p.y, 0, -100, MOD.ctrl)
  await sleep(60)
  assert(checks, 'AX.d 缩放不暂停', (await ev(cdp, '__lrc.isPlaying()')) === true, '')
}

/* ------------- AY~BB：音量滚轮 / 网格吸附 / 辅助线 / 设置面板 验收基础设施 ------------- */

/** 浮点近似相等。 */
function closeTo(a, b, t = 1e-6) {
  return typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= t
}

/** 只开网格吸附（隔离播放头 / 其他行时间戳两个目标）。 */
const SNAP_GRID_ONLY = { snapEnabled: true, snapToPlayhead: false, snapToLineTimes: false, snapToGrid: true }
/** 只吸「其他行时间戳」。 */
const SNAP_LINE_ONLY = { snapEnabled: true, snapToPlayhead: false, snapToLineTimes: true, snapToGrid: false }
/** 总开关关掉、但分目标网格仍显式 true（验证总开关优先）。 */
const SNAP_OFF_GRID_ON = { snapEnabled: false, snapToPlayhead: false, snapToLineTimes: false, snapToGrid: true }

/** 音量控件中心点（原生 wheel 需落在 label 内才会被监听器收到）。 */
async function volumePoint(cdp) {
  const r = await ev(cdp, '__lrc.volumeControlRect()')
  if (!r || !(r.width > 0)) throw new Error('no volume control')
  return { x: Math.round(r.x), y: Math.round(r.y) }
}

/**
 * 吸附用例前置：清空持久化 → 重载（拿干净默认）→ 导入音频（durationMs>0，
 * 否则 setView 的起点会被夹到 0）→ 应用吸附设置 → 绝对设定视口。
 * 返回运行时现算的 pixelsPerMs（P）/ 视口宽（W）/ 实际起点。
 */
async function setupSnapCase(cdp, patch, startMs, visibleMs) {
  await ev(cdp, `localStorage.removeItem('lrc-editor:lrc-editor/settings')`)
  await reset(cdp)
  await setupAudio(cdp)
  if (patch) await ev(cdp, `__lrc.updateSettings(${J(patch)})`)
  await sleep(60)
  await setView(cdp, startMs, visibleMs)
  const info = await ev(cdp, '__lrc.viewInfo()')
  return { P: info.pixelsPerMs, W: info.viewportWidthPx, startMs: info.startMs }
}

/** 默认设置（吸附四项 = T/T/T/F，网格关）+ 音频 + 视口。 */
async function setupSnapDefault(cdp, startMs, visibleMs) {
  return setupSnapCase(cdp, null, startMs, visibleMs)
}

/** 打开设置面板（先清空持久化后重载，确保默认值 + 面板初始关闭）。 */
async function ensureSettings(cdp) {
  await ev(cdp, `localStorage.removeItem('lrc-editor:lrc-editor/settings')`)
  await reset(cdp)
  const opened = await ev(cdp, '__lrc.openSettings()')
  await sleep(80)
  return opened
}

/**
 * 按控件类型设置某一项：checkbox（click 到目标态）/ select（原型 setter + change）/
 * number / text（原型 setter + input）。返回控件当前值。
 */
async function setSettingsControl(cdp, id, value) {
  return ev(
    cdp,
    `(function(){
      var item = document.querySelector('[data-settings-item="${id}"]');
      if (!item) return 'no-item';
      var cb = item.querySelector('input[type="checkbox"]');
      if (cb) { if (cb.checked !== (${J(value)} === true)) cb.click(); return cb.checked; }
      var sel = item.querySelector('select');
      if (sel) {
        var setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
        setter.call(sel, ${J(String(value))});
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        return sel.value;
      }
      var num = item.querySelector('input[type="number"]');
      if (num) { __lrc._setNativeValue(num, ${J(String(value))}); return num.value; }
      var txt = item.querySelector('input[type="text"]');
      if (txt) { __lrc._setNativeValue(txt, ${J(String(value))}); return txt.value; }
      return 'no-control';
    })()`,
  )
}

// AY：音量滚轮（同向累加 / 反向清零 / 跨事件保留余数 / 边界 clamp）
async function testAY(cdp, checks) {
  // a：0.5 → 4 次 deltaY=-50（滚轮向上）→ 每两次凑满一格 → 0.55 → 0.60（音量增大）
  await reset(cdp)
  await ev(cdp, '__lrc.setVolume(0.5)')
  let vp = await volumePoint(cdp)
  for (let i = 0; i < 4; i += 1) { await wheelAt(cdp, vp.x, vp.y, 0, -50); await sleep(20) }
  await sleep(40)
  let v = await ev(cdp, '__lrc.volume()')
  assert(checks, 'AY.a 4×(-50) → 0.60', closeTo(v, 0.6), String(v))

  // b：单次 -50 不足一格 → 音量不变
  await reset(cdp)
  await ev(cdp, '__lrc.setVolume(0.5)')
  vp = await volumePoint(cdp)
  await wheelAt(cdp, vp.x, vp.y, 0, -50)
  await sleep(40)
  v = await ev(cdp, '__lrc.volume()')
  assert(checks, 'AY.b 单次 -50 → 0.50 不变', closeTo(v, 0.5), String(v))

  // c：2×(-60) 余数保留 → 0.55；反向 +60 清零（不足一格）→ 仍 0.55；再 +60 凑满 → 0.50
  await reset(cdp)
  await ev(cdp, '__lrc.setVolume(0.5)')
  vp = await volumePoint(cdp)
  await wheelAt(cdp, vp.x, vp.y, 0, -60); await sleep(20)
  await wheelAt(cdp, vp.x, vp.y, 0, -60); await sleep(40)
  v = await ev(cdp, '__lrc.volume()')
  assert(checks, 'AY.c 2×(-60) → 0.55', closeTo(v, 0.55), String(v))
  await wheelAt(cdp, vp.x, vp.y, 0, 60); await sleep(40)
  v = await ev(cdp, '__lrc.volume()')
  assert(checks, 'AY.c 反向 +60 清零余数 → 0.55', closeTo(v, 0.55), String(v))
  await wheelAt(cdp, vp.x, vp.y, 0, 60); await sleep(40)
  v = await ev(cdp, '__lrc.volume()')
  assert(checks, 'AY.c +60 凑满 → 0.50', closeTo(v, 0.5), String(v))

  // d：上 / 下界 clamp（上界需 steps<0：deltaY 为负；下界需 steps>0：deltaY 为正）
  await reset(cdp)
  await ev(cdp, '__lrc.setVolume(0.98)')
  vp = await volumePoint(cdp)
  await wheelAt(cdp, vp.x, vp.y, 0, -100); await sleep(20)
  await wheelAt(cdp, vp.x, vp.y, 0, -100); await sleep(40)
  v = await ev(cdp, '__lrc.volume()')
  assert(checks, 'AY.d 上界 clamp → 1.0', closeTo(v, 1), String(v))
  await ev(cdp, '__lrc.setVolume(0.02)')
  await wheelAt(cdp, vp.x, vp.y, 0, 100); await sleep(20)
  await wheelAt(cdp, vp.x, vp.y, 0, 100); await sleep(40)
  v = await ev(cdp, '__lrc.volume()')
  assert(checks, 'AY.d 下界 clamp → 0.0', closeTo(v, 0), String(v))

  // e：命中体即音量 range 输入
  const hit = await ev(cdp, `__lrc.elementAt(${vp.x}, ${vp.y})`)
  assert(checks, 'AY.e 音量控件命中 INPUT', hit === 'INPUT', String(hit))
  const type = await ev(cdp, `(function(){ var e = __lrc.volumeControlEl(); return e ? e.type : null; })()`)
  assert(checks, 'AY.e type=range', type === 'range', String(type))
}

// AZ：网格吸附（仅网格贴合 / 超阈值不吸 / 总开关优先 / 视窗越界裁剪）
async function testAZ(cdp, checks) {
  // 每次 setupSnapCase 都会重载页面（demo 行 id 会重新生成）→ 取块 id 必须在其后
  let s = await setupSnapCase(cdp, SNAP_GRID_ONLY, 10000, 6000)
  let ids = await ev(cdp, '__lrc.ids()')
  let l0 = ids[0]
  let t0 = (await ev(cdp, `__lrc.times(${J(l0)})`))[0]

  // a：仅网格 → 贴到 12000（落点在 8px 阈值内）
  let step = await ev(cdp, '__lrc.gridStepMs()')
  assert(checks, 'AZ.a 网格档位=1000', step === 1000, String(step))
  let dx = Math.round((12000 - t0) * s.P)
  await dragBlock(cdp, l0, dx)
  let landed = (await ev(cdp, `__lrc.times(${J(l0)})`))[0]
  assert(checks, 'AZ.a 落点吸到 12000', landed === 12000, `landed=${landed} dx=${dx} P=${s.P}`)

  // b：dx=-40 超出 8px → 不吸，按像素取整落点
  s = await setupSnapCase(cdp, SNAP_GRID_ONLY, 10000, 6000)
  ids = await ev(cdp, '__lrc.ids()'); l0 = ids[0]
  t0 = (await ev(cdp, `__lrc.times(${J(l0)})`))[0]
  dx = -40
  await dragBlock(cdp, l0, dx)
  landed = (await ev(cdp, `__lrc.times(${J(l0)})`))[0]
  const rawB = t0 + Math.round(dx / s.P)
  assert(checks, 'AZ.b 超出阈值不吸', landed === rawB && landed !== 12000, `landed=${landed} raw=${rawB} P=${s.P}`)

  // c：默认设置（网格关）→ 同一位移不吸
  s = await setupSnapDefault(cdp, 10000, 6000)
  ids = await ev(cdp, '__lrc.ids()'); l0 = ids[0]
  t0 = (await ev(cdp, `__lrc.times(${J(l0)})`))[0]
  dx = Math.round((12000 - t0) * s.P)
  await dragBlock(cdp, l0, dx)
  landed = (await ev(cdp, `__lrc.times(${J(l0)})`))[0]
  const rawC = t0 + Math.round(dx / s.P)
  assert(checks, 'AZ.c 默认网格关 → 不吸', landed === rawC && landed !== 12000, `landed=${landed} raw=${rawC}`)

  // c2：仅网格、同一位移 → 吸（隔离对照，证明差异只来自 snapToGrid）
  s = await setupSnapCase(cdp, SNAP_GRID_ONLY, 10000, 6000)
  ids = await ev(cdp, '__lrc.ids()'); l0 = ids[0]
  t0 = (await ev(cdp, `__lrc.times(${J(l0)})`))[0]
  dx = Math.round((12000 - t0) * s.P)
  await dragBlock(cdp, l0, dx)
  landed = (await ev(cdp, `__lrc.times(${J(l0)})`))[0]
  assert(checks, 'AZ.c2 仅网格同位移 → 12000', landed === 12000, String(landed))

  // d：总开关关（分目标网格仍 true）→ 一律不吸
  s = await setupSnapCase(cdp, SNAP_OFF_GRID_ON, 10000, 6000)
  ids = await ev(cdp, '__lrc.ids()'); l0 = ids[0]
  t0 = (await ev(cdp, `__lrc.times(${J(l0)})`))[0]
  dx = Math.round((12000 - t0) * s.P)
  await dragBlock(cdp, l0, dx)
  landed = (await ev(cdp, `__lrc.times(${J(l0)})`))[0]
  const rawD = t0 + Math.round(dx / s.P)
  assert(checks, 'AZ.d 总开关关 → 不吸', landed === rawD && landed !== 12000, `landed=${landed} raw=${rawD}`)

  // e：越窗网格不作为候选。zoom 上限 P=0.5 → 最小窗宽≈1844ms；
  //    setView(10600,1500) 实际窗口≈[10600,12444]，12800 在窗外（裁剪），
  //    落点 12790 距 12800 仅 10ms（若 12800 是候选必吸）→ 近窗网格 12400 距 390ms 不吸
  s = await setupSnapCase(cdp, SNAP_GRID_ONLY, 10600, 1500)
  ids = await ev(cdp, '__lrc.ids()'); l0 = ids[0]
  t0 = (await ev(cdp, `__lrc.times(${J(l0)})`))[0]
  step = await ev(cdp, '__lrc.gridStepMs()')
  assert(checks, 'AZ.e 网格档位=200', step === 200, String(step))
  const rightEdgeMs = s.startMs + s.W / s.P
  assert(checks, 'AZ.e 12800 在窗口右缘外', rightEdgeMs < 12800, `right=${rightEdgeMs}`)
  dx = Math.round((12790 - t0) * s.P)
  const res = await dragBlock(cdp, l0, dx)
  landed = (await ev(cdp, `__lrc.times(${J(l0)})`))[0]
  const rawE = t0 + Math.round(dx / s.P)
  assert(checks, 'AZ.e 越窗 12800 不吸', landed === rawE && landed !== 12800, `landed=${landed} raw=${rawE} dx=${dx} x0=${res.x0} x1=${res.x1} P=${s.P}`)
}

// BA：吸附对齐辅助线（命中显示对齐 / 未命中隐藏 / 高度=轨道高）
async function testBA(cdp, checks) {
  // 每次 setupSnapCase 都会重载页面（demo 行 id 会重新生成）→ 取块 id 必须在其后
  let s = await setupSnapCase(cdp, SNAP_GRID_ONLY, 10000, 6000)
  let ids = await ev(cdp, '__lrc.ids()')
  let l0 = ids[0]
  let t0 = (await ev(cdp, `__lrc.times(${J(l0)})`))[0]

  // a：仅网格 → 命中；抓拍辅助线可见 / 目标 / 与块左缘对齐 / 高度；松手隐藏 + 落盘
  let dx = Math.round((12000 - t0) * s.P) + 1
  await dragBlock(cdp, l0, dx, async () => {
    const vis = await ev(cdp, '__lrc.guideVisible()')
    const target = await ev(cdp, '__lrc.guideTargetMs()')
    const g = await ev(cdp, '__lrc.guideRect()')
    const b = await ev(cdp, `__lrc.rect(${J(l0)})`)
    assert(checks, 'BA.a 拖动中辅助线可见', vis === true, String(vis))
    assert(checks, 'BA.a 辅助线目标=12000', target === 12000, String(target))
    assert(checks, 'BA.a 辅助线与块左缘对齐', !!g && !!b && Math.abs(g.left - b.left) <= 1.5, `g=${g && g.left} b=${b && b.left}`)
    assert(checks, 'BA.a 辅助线高=112', !!g && Math.abs(g.height - 112) <= 1, `h=${g && g.height}`)
  })
  assert(checks, 'BA.a 松手辅助线隐藏', (await ev(cdp, '__lrc.guideVisible()')) === false, '')
  let landed = (await ev(cdp, `__lrc.times(${J(l0)})`))[0]
  assert(checks, 'BA.a 落盘 12000', landed === 12000, String(landed))

  // b：仅其他行时间戳 → 吸到 l1 的时间
  s = await setupSnapCase(cdp, SNAP_LINE_ONLY, 11000, 6000)
  ids = await ev(cdp, '__lrc.ids()')
  l0 = ids[0]
  const l1 = ids[1]
  t0 = (await ev(cdp, `__lrc.times(${J(l0)})`))[0]
  const t1 = (await ev(cdp, `__lrc.times(${J(l1)})`))[0]
  dx = Math.round((t1 - t0) * s.P) + 1
  await dragBlock(cdp, l0, dx, async () => {
    const vis = await ev(cdp, '__lrc.guideVisible()')
    const target = await ev(cdp, '__lrc.guideTargetMs()')
    assert(checks, 'BA.b 拖动中辅助线可见', vis === true, String(vis))
    assert(checks, 'BA.b 辅助线目标=l1 时间', target === t1, `${target} vs ${t1}`)
  })
  landed = (await ev(cdp, `__lrc.times(${J(l0)})`))[0]
  assert(checks, 'BA.b 落盘 = l1 时间', landed === t1, `${landed} vs ${t1}`)

  // c：仅网格、超出阈值 → 拖动中辅助线不出现
  s = await setupSnapCase(cdp, SNAP_GRID_ONLY, 10000, 6000)
  ids = await ev(cdp, '__lrc.ids()'); l0 = ids[0]
  await dragBlock(cdp, l0, -40, async () => {
    assert(checks, 'BA.c 未命中不显示辅助线', (await ev(cdp, '__lrc.guideVisible()')) === false, '')
  })

  // d：未打轴行拖动 → 辅助线 + 松手打轴落盘
  s = await setupSnapCase(cdp, SNAP_GRID_ONLY, 0, 6000)
  const blank = await ev(cdp, `__lrc.addBlank('BA辅助线')`)
  await sleep(80)
  await setView(cdp, 0, 6000)
  dx = Math.round((1000 - 0) * s.P) + 1
  await dragBlock(cdp, blank, dx, async () => {
    const vis = await ev(cdp, '__lrc.guideVisible()')
    const target = await ev(cdp, '__lrc.guideTargetMs()')
    assert(checks, 'BA.d 未打轴拖动辅助线可见', vis === true, String(vis))
    assert(checks, 'BA.d 辅助线目标=1000', target === 1000, String(target))
  })
  landed = (await ev(cdp, `__lrc.times(${J(blank)})`))[0]
  assert(checks, 'BA.d 未打轴落盘 1000', landed === 1000, String(landed))
}

// BB：设置面板（固定搜索框 / 滚动内容 / 固定 footer / 过滤 / 吸附四项 / 既有项回归）
// 项集合的单一期望来源在此：按 SettingsMenu 的 SECTIONS 渲染顺序枚举（搜索清空时全部可见）。
// 比较用「排序后集合相等」（顺序不敏感），失败时 detail 打出多出/缺少的 id。
const SETTINGS_ALL_ITEM_IDS = [
  'bilingualEnabled', 'bilingualSeparator', 'primaryLanguage', 'mergeToleranceMs', 'metadataPrefixMode',
  'closeDialogOnBackdropClick', 'confirmMajorChange',
  'timestampPrecisionMs',
  'followResumeMode', 'pauseAudioOnPan', 'pauseAudioOnSeek',
  'snapEnabled', 'snapToPlayhead', 'snapToLineTimes', 'snapToGrid',
]
async function testBB(cdp, checks) {
  await ensureSettings(cdp)

  // a：面板定高 + 搜索框不随内容滚动 + footer 贴底
  const panel = await ev(cdp, '__lrc.settingsPanelRect()')
  assert(checks, 'BB.a 面板高=420', !!panel && Math.abs(panel.height - 420) <= 2, `h=${panel && panel.height}`)
  const searchTop0 = (await ev(cdp, '__lrc.settingsSearchRect()')).top
  const scrolled = await ev(cdp, '__lrc.settingsScrollSet(200)')
  await sleep(40)
  const searchTop1 = (await ev(cdp, '__lrc.settingsSearchRect()')).top
  assert(checks, 'BB.a 内容区可滚动', typeof scrolled === 'number' && scrolled > 0, String(scrolled))
  assert(checks, 'BB.a 搜索框不随滚动移动', Math.abs(searchTop1 - searchTop0) <= 0.5, `${searchTop0} -> ${searchTop1}`)
  const footer = await ev(cdp, '__lrc.settingsFooterRect()')
  assert(checks, 'BB.a footer 贴面板底', !!footer && !!panel && Math.abs(footer.bottom - panel.bottom) <= 2, `f=${footer && footer.bottom} p=${panel && panel.bottom}`)

  // b：过滤（段标题命中 / 项命中 / 清空）
  await ev(cdp, `__lrc.settingsSearchSet('界面')`); await sleep(40)
  let secs = await ev(cdp, '__lrc.settingsVisibleSections()')
  assert(checks, 'BB.b 「界面」段=[ui]', eq(secs, ['ui']), J(secs))
  let items = await ev(cdp, '__lrc.settingsVisibleItems()')
  assert(checks, 'BB.b 「界面」项=2', eq(items, ['closeDialogOnBackdropClick', 'confirmMajorChange']), J(items))
  await ev(cdp, `__lrc.settingsSearchSet('合并容差')`); await sleep(40)
  secs = await ev(cdp, '__lrc.settingsVisibleSections()')
  assert(checks, 'BB.b 「合并容差」段=[import]', eq(secs, ['import']), J(secs))
  items = await ev(cdp, '__lrc.settingsVisibleItems()')
  assert(checks, 'BB.b 「合并容差」项=[mergeToleranceMs]', eq(items, ['mergeToleranceMs']), J(items))
  await ev(cdp, `__lrc.settingsSearchSet('')`); await sleep(40)
  secs = await ev(cdp, '__lrc.settingsVisibleSections()')
  assert(checks, 'BB.b 清空段=5', eq(secs, ['import', 'ui', 'export', 'follow', 'snap']), J(secs))
  items = await ev(cdp, '__lrc.settingsVisibleItems()')
  const gotIds = [...items].sort()
  const expIds = [...SETTINGS_ALL_ITEM_IDS].sort()
  const extraIds = gotIds.filter((id) => expIds.indexOf(id) < 0)
  const missingIds = expIds.filter((id) => gotIds.indexOf(id) < 0)
  assert(checks, 'BB.b 清空项集合=期望 15 项', extraIds.length === 0 && missingIds.length === 0, `多=${J(extraIds)} 缺=${J(missingIds)}`)

  // c：空态
  await ev(cdp, `__lrc.settingsSearchSet('zzzqqq')`); await sleep(40)
  assert(checks, 'BB.c 无匹配空态', (await ev(cdp, '__lrc.settingsEmpty()')) === true, '')
  await ev(cdp, `__lrc.settingsSearchSet('')`); await sleep(40)

  // d：吸附四项默认 / 持久化 / 非法回退 / 总开关置灰 / 恢复默认
  const d0 = await ev(cdp, '__lrc.settings()')
  const four0 = [d0.snapEnabled, d0.snapToPlayhead, d0.snapToLineTimes, d0.snapToGrid]
  assert(checks, 'BB.d 默认吸附 [T,T,T,F]', eq(four0, [true, true, true, false]), J(four0))
  await ev(cdp, `__lrc.updateSettings({ snapEnabled: false, snapToPlayhead: false, snapToLineTimes: false, snapToGrid: true })`)
  await sleep(400)
  const raw = await ev(cdp, '__lrc.storedSettingsRaw()')
  assert(checks, 'BB.d 写盘四 key', typeof raw === 'string' && raw.indexOf('"snapEnabled":false') >= 0 && raw.indexOf('"snapToPlayhead":false') >= 0 && raw.indexOf('"snapToLineTimes":false') >= 0 && raw.indexOf('"snapToGrid":true') >= 0, String(raw).slice(0, 260))
  const bad = await ev(cdp, `__lrc.hydrateSettings({ snapEnabled: 'yes', snapToPlayhead: 1, snapToLineTimes: null, snapToGrid: 'x' })`)
  const fourBad = [bad.snapEnabled, bad.snapToPlayhead, bad.snapToLineTimes, bad.snapToGrid]
  assert(checks, 'BB.d 非法吸附回退 [T,T,T,F]', eq(fourBad, [true, true, true, false]), J(fourBad))
  await ev(cdp, `__lrc.updateSettings({ snapEnabled: false })`); await sleep(60)
  const dis = [await ev(cdp, `__lrc.settingsItemDisabled('snapToPlayhead')`), await ev(cdp, `__lrc.settingsItemDisabled('snapToLineTimes')`), await ev(cdp, `__lrc.settingsItemDisabled('snapToGrid')`)]
  assert(checks, 'BB.d 总开关关 → 三子项 disabled', eq(dis, [true, true, true]), J(dis))
  assert(checks, 'BB.d 恢复默认在 footer', (await ev(cdp, '__lrc.settingsResetInFooter()')) === true, '')
  await ev(cdp, '__lrc.clickSettingsReset()'); await sleep(80)
  const d1 = await ev(cdp, '__lrc.settings()')
  const four1 = [d1.snapEnabled, d1.snapToPlayhead, d1.snapToLineTimes, d1.snapToGrid]
  assert(checks, 'BB.d 恢复默认 → 四项 [T,T,T,F]', eq(four1, [true, true, true, false]), J(four1))

  // e：既有 11 项 DOM 驱动回归（改值 → 落盘 → 重载保持）
  const target = {
    bilingualEnabled: false,
    bilingualSeparator: '/',
    primaryLanguage: 'ja',
    mergeToleranceMs: 120,
    metadataPrefixMode: 'meta+line',
    closeDialogOnBackdropClick: true,
    confirmMajorChange: false,
    timestampPrecisionMs: 10,
    followResumeMode: 'pause',
    pauseAudioOnPan: false,
    pauseAudioOnSeek: false,
  }
  for (const [id, value] of Object.entries(target)) {
    await setSettingsControl(cdp, id, value)
    await sleep(40)
  }
  await sleep(500)
  const raw2 = await ev(cdp, '__lrc.storedSettingsRaw()')
  for (const [id, value] of Object.entries(target)) {
    const token = `"${id}":${JSON.stringify(value)}`
    assert(checks, `BB.e 写盘 ${id}`, typeof raw2 === 'string' && raw2.indexOf(token) >= 0, `${token} @ ${String(raw2).slice(0, 240)}`)
  }
  await reset(cdp)
  await sleep(250)
  const back = await ev(cdp, '__lrc.settings()')
  for (const [id, value] of Object.entries(target)) {
    assert(checks, `BB.e 重载保持 ${id}`, eq(back[id], value), `${J(back[id])} vs ${J(value)}`)
  }

  // f/g/h：元数据前缀三态的界面可达性（BB.e 的 reset 已关面板，这里重新打开，不清存储）
  await ev(cdp, '__lrc.openSettings()'); await sleep(80)
  await ev(cdp, `__lrc.settingsSearchSet('前缀')`); await sleep(40)
  const prefixItems = await ev(cdp, '__lrc.settingsVisibleItems()')
  assert(checks, 'BB.f 搜索「前缀」→ 命中 metadataPrefixMode', Array.isArray(prefixItems) && prefixItems.indexOf('metadataPrefixMode') >= 0, J(prefixItems))
  const opts = await ev(cdp, `__lrc.settingsSelectOptions('metadataPrefixMode')`)
  const optValues = (opts || []).map((o) => o.value)
  const optLabels = (opts || []).map((o) => o.label)
  assert(checks, 'BB.g 三态 option 值', eq(optValues, ['off', 'meta', 'meta+line']), J(optValues))
  assert(checks, 'BB.h 三态 option 文案', eq(optLabels, ['关', '仅元数据', '元数据 + 保留歌词行']), J(optLabels))
  await ev(cdp, `__lrc.settingsSearchSet('')`); await sleep(40)
}

// BC：元数据前缀 mode 的旧值迁移（boot 读盘路径 + store 白名单路径）
async function testBC(cdp, checks) {
  const KEY = 'lrc-editor:lrc-editor/settings'
  // boot 路径：写旧形状 → 重载 → App 启动读盘走 normalizeSettings 迁移
  const seedAndReset = async (raw) => {
    await ev(cdp, `localStorage.setItem(${J(KEY)}, ${J(JSON.stringify(raw))})`)
    await reset(cdp)
  }

  // a：旧 true → meta（boot 读盘迁移）
  await seedAndReset({ metadataPrefixEnabled: true })
  const a1 = await ev(cdp, '__lrc.settings()')
  assert(checks, 'BC.a1 旧 true → meta', a1.metadataPrefixMode === 'meta', String(a1.metadataPrefixMode))
  // a2/a3：惰性写回发生在 React effect，落盘有时序 → 有界轮询（等新键出现，~1.5s 超时）
  let raw = null
  for (let i = 0; i < 30; i += 1) {
    raw = await ev(cdp, '__lrc.storedSettingsRaw()')
    if (typeof raw === 'string' && raw.indexOf('"metadataPrefixMode":"meta"') >= 0) break
    await sleep(50)
  }
  assert(checks, 'BC.a2 惰性写回 → meta', typeof raw === 'string' && raw.indexOf('"metadataPrefixMode":"meta"') >= 0, String(raw).slice(0, 240))
  assert(checks, 'BC.a3 旧键写回后消失', typeof raw === 'string' && raw.indexOf('metadataPrefixEnabled') < 0, String(raw).slice(0, 240))

  // b：旧 false → off（boot 读盘迁移）
  await seedAndReset({ metadataPrefixEnabled: false })
  const b = await ev(cdp, '__lrc.settings()')
  assert(checks, 'BC.b 旧 false → off', b.metadataPrefixMode === 'off', String(b.metadataPrefixMode))

  // c：旧键缺失 → off（boot 读盘迁移）
  await seedAndReset({})
  const c = await ev(cdp, '__lrc.settings()')
  assert(checks, 'BC.c 旧键缺失 → off', c.metadataPrefixMode === 'off', String(c.metadataPrefixMode))

  // d：store 路径 —— 非法新值 → off（白名单回退）
  const d = await ev(cdp, `__lrc.hydrateSettings({ metadataPrefixMode: '垃圾' })`)
  assert(checks, 'BC.d 非法新值 → off', d.metadataPrefixMode === 'off', J(d.metadataPrefixMode))

  // e：store 路径 —— 合法新值 meta+line 保留
  const e = await ev(cdp, `__lrc.hydrateSettings({ metadataPrefixMode: 'meta+line' })`)
  assert(checks, 'BC.e 合法新值 → meta+line', e.metadataPrefixMode === 'meta+line', J(e.metadataPrefixMode))

  // f：store 路径 —— 新旧并存，新字段优先
  const f = await ev(cdp, `__lrc.hydrateSettings({ metadataPrefixEnabled: true, metadataPrefixMode: 'off' })`)
  assert(checks, 'BC.f 新旧并存新字段优先 → off', f.metadataPrefixMode === 'off', J(f.metadataPrefixMode))
}

// BD. 字级清空导出 —— D4 链式向前继承：首字落行级 / 中间字落前一有效字 / 整行全清仍带标签 /
//     链头无行级时跳过该字标签但保留文本
async function testBD(cdp, checks) {
  const ids = await ev(cdp, '__lrc.ids()')
  const [l0] = ids
  const l0text = await ev(cdp, `__lrc.state().document.lines.find(function(l){return l.id===${J(l0)}}).text`)
  const lineTime = (await ev(cdp, `__lrc.times(${J(l0)})`))[0]
  const w = await ev(cdp, `__lrc.wordTimes(${J(l0)})`)
  const w0 = w[0]
  const w1 = w[1]
  // 该行导出文本：行级前缀 + 字级标签，故用「去标签后按文本匹配」
  const rowOf = async () => exportRows(await ev(cdp, '__lrc.buildExport(1)')).find((s) => stripTags(s) === l0text)

  // ---------- Case B：清空首字（链头）→ 落行级时间戳 ----------
  await ev(cdp, `__lrc.absWord(${J(l0)}, 0, null)`)
  await sleep(40)
  const afterB = await ev(cdp, `__lrc.wordTimes(${J(l0)})`)
  assert(checks, 'BD.B 清空首字后回放 [null,' + w1 + ']', eq(afterB, [null, w1]), J(afterB))
  let row = await rowOf()
  assert(checks, 'BD.0 现状证据：清空首字后该行导出字符串', true, J(row))
  assert(checks, 'BD.B 首字标签落行级 <' + fmt3(lineTime) + '>', typeof row === 'string' && row.indexOf('<' + fmt3(lineTime) + '>') >= 0, J(row))
  assert(checks, 'BD.B 次字标签仍为 <' + fmt3(w1) + '>', typeof row === 'string' && row.indexOf('<' + fmt3(w1) + '>') >= 0, J(row))
  assert(checks, 'BD.B 行级标签仍在 [' + fmt3(lineTime) + ']', typeof row === 'string' && row.startsWith('[' + fmt3(lineTime) + ']'), J(row))

  // ---------- Case A：恢复首字、清空次字 → 继承前一个有效字 ----------
  await ev(cdp, `__lrc.absWord(${J(l0)}, 0, ${w0})`)
  await sleep(40)
  await ev(cdp, `__lrc.absWord(${J(l0)}, 1, null)`)
  await sleep(40)
  const afterA = await ev(cdp, `__lrc.wordTimes(${J(l0)})`)
  assert(checks, 'BD.A 清空次字后回放 [' + w0 + ',null]', eq(afterA, [w0, null]), J(afterA))
  row = await rowOf()
  assert(checks, 'BD.A 次字标签继承前一有效字 <' + fmt3(w0) + '>', typeof row === 'string' && row.indexOf('<' + fmt3(w0) + '>') >= 0, J(row))
  assert(checks, 'BD.A 原次字时间不复活（无 <' + fmt3(w1) + '>）', typeof row === 'string' && row.indexOf('<' + fmt3(w1) + '>') < 0, J(row))

  // ---------- Case C：整行字级全清 + 有行级 → 每字落行级、仍带标签 ----------
  await ev(cdp, `__lrc.absWord(${J(l0)}, 0, null)`)
  await sleep(40)
  const afterC = await ev(cdp, `__lrc.wordTimes(${J(l0)})`)
  assert(checks, 'BD.C 整行字级全清回放 [null,null]', eq(afterC, [null, null]), J(afterC))
  row = await rowOf()
  const tags = typeof row === 'string' ? (row.match(/<[^>]+>/g) || []) : []
  assert(checks, 'BD.C 仍写 2 个字级标签（不退纯文本）', tags.length === 2, J(tags))
  assert(checks, 'BD.C 两字均落行级 <' + fmt3(lineTime) + '>', tags.length === 2 && tags.every((t) => t === '<' + fmt3(lineTime) + '>'), J(tags))

  // ---------- Case D：链头连行级也没有（撤销行级）→ 跳过该字标签、保留文本 ----------
  await ev(cdp, `__lrc.absWord(${J(l0)}, 1, ${w1})`)
  await sleep(40)
  const undone = await ev(cdp, `__lrc.undoLineStamp(${J(l0)})`)
  await sleep(60)
  assert(checks, 'BD.D 撤销行级成功', undone && undone.ok === true, J(undone))
  assert(checks, 'BD.D 行时间已空 []', eq(await ev(cdp, `__lrc.times(${J(l0)})`), []), J(await ev(cdp, `__lrc.times(${J(l0)})`)))
  assert(checks, 'BD.D 未进 clearedLineLines（撤销路径）', (await ev(cdp, `__lrc.state().replay.clearedLineLines.has(${J(l0)})`)) === false, 'cleared')
  row = await rowOf()
  assert(checks, 'BD.D 首字跳过标签：导出行不以 < 开头且保留文本', typeof row === 'string' && row.length > 0 && row[0] !== '<' && stripTags(row) === l0text, J(row))
  assert(checks, 'BD.D 次字标签仍在 <' + fmt3(w1) + '>', typeof row === 'string' && row.indexOf('<' + fmt3(w1) + '>') >= 0, J(row))
}

const TESTS = [
  ['A', '多选拖动 → 一条 selection-offset 整组等量位移', testA],
  ['B', '拖动中零 store 写入', testB],
  ['C', '拖动中命令式 transform 生效', testC],
  ['D', '松手后命令式样式清理', testD],
  ['E', '单块已打轴拖动 → manual-nudge', testE],
  ['F', '单块未打轴拖动 → manual-timestamp（二.8）', testF],
  ['G', '阈值内点击 → 普通单选 + 零日志（零.3）', testG],
  ['H', 'Ctrl 点击 → toggle 增/减选', testH],
  ['I', 'Shift 点击 → 范围选（同类型成员）', testI],
  ['J', 'blocked → not-allowed / 不位移 / 零日志 / 选区不变', testJ],
  ['K', 'blocked 未越阈值 → 当普通点击派发', testK],
  ['L', '无修饰键点未选中块 → 归位单选并只动该块', testL],
  ['M', '方向键多选微调 → selection-offset；单选 → manual-nudge', testM],
  ['N', '选择层去类型化：Ctrl toggle 异类 / Shift 范围跨类型全纳入', testN],
  ['O', '拖动入口集合级：混合集合 not-allowed；纯已打轴整组', testO],
  ['P', '微调入口判定：混合拒绝 / 已打轴整组 / 未打轴·无选中静默', testP],
  ['Q', '多选删除：一条 remove-line / 一次撤销 / Backspace 别名', testQ],
  ['R', '输入框优先：⋮ 弹窗聚焦输入框 / 注入 textarea，Delete 均不生效', testR],
  ['S', '多选/单行删除落点：Delete 直接落「无选中」（三字段全清，不挑最近剩余）', testS],
  ['T', '多选上下文 + 单行按钮删除：removeLine 落点（active 落最近剩余）与 Delete 路径分开验', testT],
  ['U', '导出链：demo 不再空 + 打轴/偏移反映（buildExportText 走回放）', testU],
  ['V', '导出精度统一：两位 vs 三位（行级 / 字级同受控）', testV],
  ['W', '导出：删除行不写、文本编辑仍反映', testW],
  ['X', '设置持久化：默认三位 / 更新写回 / 非法值白名单回退', testX],
  ['Y', '重大改变确认框：多选拖动先弹框、零落盘；点确认才落 selection-offset', testY],
  ['Z', '确认框取消路径：取消按钮 / Esc 均不落盘、块弹回原位', testZ],
  ['AA', '弹窗勾选「以后不再显示」：关总开关并持久化；再拖不弹、立即落盘', testAA],
  ['AB', '拒绝提示 toast：blocked 拖动/混合微调提示、~3.5s 消失、同文案去重', testAB],
  ['AC', '行级时间输入：纯数字=秒；保存后归一化呈现（大数进位）', testAC],
  ['AD', '归一化时机：编辑/失焦不改写原文，保存时才归一化', testAD],
  ['AE', '清空行级时间：只清时间、保留字级切分（槽位仍在，显示未打轴）', testAE],
  ['AF', '清空一步撤销：行时间与字级时间一并复原', testAF],
  ['AG', '非法输入被拒：aria-invalid / 保存禁用 / 不落盘', testAG],
  ['AH', '导出防复活：清空后该行导出为纯文本（无行级/字级标签）', testAH],
  ['AI', '日志展示：清空显示「清空时间戳」而非「无时间变化」', testAI],
  ['AJ', '字级时间输入：同一解析规则（纯数字=秒），保存后归一化呈现', testAJ],
  ['AK', '改行级时间：字级跟随平移（原字级 + 行级增量）', testAK],
  ['PRE', 'preflight：假时钟 + 真实静音 WAV 导入 + preparePeaks', testPRE],
  ['AL', '跟随触发：屏内越过 0.8W → 平滑翻页（有中间值）', testAL],
  ['AM', '跟随触发：播放头已在屏外 → 直接跳（无中间值）', testAM],
  ['AN', '跟随不重复翻页：单调不减、不冲过目标', testAN],
  ['AO', '动画进行中手势打断 → 立即停在当前位置', testAO],
  ['AP', '拖块挂起：snap 松手拉回 / pause 松手不拉回', testAP],
  ['AQ', 'B 模式 + 滚轮平移 → followPaused；再按播放不瞬移（A 对照拉回）', testAQ],
  ['AR', 'B 模式 + 滚动条拖拽 → followPaused；再按播放不瞬移（A 对照拉回）', testAR],
  ['AS', 'B 模式归位：箭头/归位按钮 → 拉回动画 + 恢复跟随', testAS],
  ['AT', '屏外箭头出现/消失/侧别（含归位同步）', testAT],
  ['AU', '箭头拖动：往里可拖、反向不动、拖动中保持挂载', testAU],
  ['AV', '设置：默认值 / 持久化 / 非法值白名单回退', testAV],
  ['AW', '平移视窗 → 暂停音频（滚轮 + 滚动条；缩放不触发）', testAW],
  ['AX', '移动播放头 → 暂停音频（尺子 + 箭头；缩放/打轴不触发）', testAX],
  ['AY', '音量滚轮：同向累加 / 反向清零 / 保留余数 / 边界 clamp', testAY],
  ['AZ', '网格吸附：仅网格贴合 / 超阈值不吸 / 总开关优先 / 视窗越界裁剪', testAZ],
  ['BA', '吸附对齐辅助线：命中显示对齐 / 未命中隐藏 / 高度=轨道高', testBA],
  ['BB', '设置面板：固定搜索与 footer / 过滤 / 吸附四项 / 既有项回归', testBB],
  ['BC', '设置：元数据前缀 mode 三态迁移（boot 读盘 + store 白名单）', testBC],
  ['BD', '字级清空导出：D4 链式向前继承（首字落行级 / 中间字落前一字 / 整行全清仍带标签 / 链头无行级跳过标签）', testBD],
]

async function main() {
  const only = process.argv.slice(2)
  const cdp = await connect()
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1280, height: 900, deviceScaleFactor: 1, mobile: false,
  })
  // 假时钟必须比 app 脚本更早打补丁 → 同一新文档注入，顺序在 BOOTSTRAP 之前
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: CLOCK_BOOTSTRAP })
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: BOOTSTRAP })
  // 真实文件入口：拦截文件选择框，直接塞入本地静音 WAV
  await cdp.send('DOM.enable')
  await cdp.send('Page.setInterceptFileChooserDialog', { enabled: true })

  // 运行前清掉持久化设置：reset 只重载页面、不清 localStorage，
  // 否则上一轮结尾（如 BB.e）写入的设置会污染本轮早期「默认值」断言（如 X）。
  await cdp.send('Page.navigate', { url: APP + '?clean=' + Date.now() })
  await cdp.waitEvent('Page.loadEventFired').catch(() => {})
  await waitReady(cdp)
  await ev(cdp, `localStorage.removeItem('lrc-editor:lrc-editor/settings')`)

  const all = []
  for (const [id, title, fn] of TESTS) {
    if (only.length > 0 && !only.includes(id)) continue
    const checks = []
    console.log(`\n=== ${id}. ${title} ===`)
    try {
      await reset(cdp)
      await fn(cdp, checks)
    } catch (e) {
      assert(checks, `${id}.异常`, false, String((e && e.message) || e))
    }
    for (const c of checks) {
      const tag = c.ok ? 'PASS' : 'FAIL'
      console.log(`  [${tag}] ${c.name}${c.detail ? '  :: ' + c.detail : ''}`)
      all.push(c)
    }
    const failed = checks.filter((c) => !c.ok).length
    console.log(`  -- ${id}: ${checks.length - failed}/${checks.length} 通过`)
  }

  const total = all.length
  const passed = all.filter((c) => c.ok).length
  console.log(`\n================ 汇总 ================`)
  console.log(`断言总数 ${total}，通过 ${passed}，失败 ${total - passed}`)
  if (total - passed > 0) {
    console.log('\n失败明细:')
    for (const c of all) if (!c.ok) console.log(`  [FAIL] ${c.name}  :: ${c.detail}`)
  }
  process.exit(total - passed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('FATAL', e)
  process.exit(2)
})
