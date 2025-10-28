// New: unify via DocsHighlighter
const highlighter = new DocsHighlighter({ getAccessToken: () => accessToken });

window.refreshHighlights = () => SD_refreshHighlightsForSelection();



// Utilities
function escapeHTML(s) {
  return (s ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[ch]);
}
const esc = escapeHTML;

const statusEl = document.getElementById("status");
function setStatus(s) { if (statusEl) statusEl.textContent = s; console.log("[StructDoc]", s); }
const btnAuth = document.getElementById("btn-auth");
const btnOutline = document.getElementById("btn-outline");
const btnExport = document.getElementById("btn-export");
const cbSum = document.getElementById("cb-sum");

// Connect panel + hidden input
const connectPanel = document.getElementById("connectPanel");
const btnConnect = document.getElementById("btn-connect");
const docInput = document.getElementById("docIdInput");

// Graph & overlays
const btnRootFloat = document.getElementById("btn-root-float");
const graphHint = document.getElementById("graphHint");

const elAutoMap = document.getElementById("sdAutoMap");
const elAutoHL = document.getElementById("sdAutoHL");

const btnClear = document.getElementById('btn-clearhl')

if (btnClear) {
  btnClear.onclick = () => SD_clearHighlights().catch(console.warn);
}

if (!('selectedIds' in window)) window.selectedIds = new Set();

SD_installSelectionHooks();




/* ===== Pointer-based Pan & Zoom core (stable) ===== */
(() => {
  if (window._pz) return; // guard against double attach

  window._pz = {
    panX: 0, panY: 0, scale: 1,
    isDragging: false, active: false, pointerId: null,
    startX: 0, startY: 0, panX0: 0, panY0: 0,
    suppressClick: false,
    SCALE_MIN: 0.4, SCALE_MAX: 3.0, DRAG_THRESHOLD: 5,
    graphEl: null, canvasEl: null,
    apply() {
      if (!this.canvasEl) return;
      this.canvasEl.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.scale})`;
    },
    attach(graphEl, canvasEl) {
      this.graphEl = graphEl; this.canvasEl = canvasEl;
      if (!graphEl || !canvasEl) return;

      // pointerdown: prepare drag on any press
      graphEl.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        this.active = true; this.isDragging = false; this.suppressClick = false;
        this.pointerId = e.pointerId;
        this.startX = e.clientX; this.startY = e.clientY;
        this.panX0 = this.panX; this.panY0 = this.panY;
        graphEl.setPointerCapture?.(e.pointerId);
        graphEl.classList.add("dragging");
      });

      // pointermove: enter dragging after threshold
      graphEl.addEventListener("pointermove", (e) => {
        if (!this.active || e.pointerId !== this.pointerId) return;
        const dx = e.clientX - this.startX;
        const dy = e.clientY - this.startY;
        if (!this.isDragging &&
          (Math.abs(dx) > this.DRAG_THRESHOLD || Math.abs(dy) > this.DRAG_THRESHOLD)) {
          this.isDragging = true;
        }
        if (this.isDragging) {
          this.panX = this.panX0 + dx;
          this.panY = this.panY0 + dy;
          this.apply();
          this.suppressClick = true;
          e.preventDefault();
        }
      });

      // pointerup/cancel: end dragging; suppress click/dblclick for one frame
      const endDrag = () => {
        if (!this.active) return;
        this.active = false;
        graphEl.releasePointerCapture?.(this.pointerId);
        graphEl.classList.remove("dragging");
        if (this.isDragging) setTimeout(() => (this.suppressClick = false), 0);
        this.isDragging = false; this.pointerId = null;
      };
      graphEl.addEventListener("pointerup", endDrag);
      graphEl.addEventListener("pointercancel", endDrag);

      // Ctrl/⌘ + wheel zoom (anchor at cursor)
      graphEl.addEventListener("wheel", (e) => {
        if (!(e.ctrlKey || e.metaKey)) return; // Translated comment omitted (English only).
        e.preventDefault();
        const rect = graphEl.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        // Translated comment omitted (English only).
        const cx = (mx - this.panX) / this.scale;
        const cy = (my - this.panY) / this.scale;
        // Translated comment omitted (English only).
        const factor = Math.exp(-e.deltaY * 0.0015);
        const newScale = Math.min(this.SCALE_MAX, Math.max(this.SCALE_MIN, this.scale * factor));
        // Translated comment omitted (English only).
        this.panX = mx - cx * newScale;
        this.panY = my - cy * newScale;
        this.scale = newScale;
        this.apply();
      }, { passive: false });
    }
  };
})();

// Translated comment omitted (English only).
window.graphEl = document.getElementById("graph");
window.canvasEl = document.getElementById("canvas");

// Let the graph capture gestures without blocking toolbar buttons (toolbar is not inside #graph)
if (window.graphEl) window.graphEl.style.pointerEvents = "auto";
if (window.canvasEl) window.canvasEl.style.pointerEvents = "auto";

// Gestures: listen on graph, render on canvas (recommended)
window._pz?.attach(window.graphEl, window.canvasEl);

console.log("[BOOT]", { graphOk: !!window.graphEl, canvasOk: !!window.canvasEl });



// Chat
const chatOut = document.getElementById("chatOut");
const chatInput = document.getElementById("chatInput");
const chatSend = document.getElementById("chatSend");

const H1_BLACKLIST = /^(?:文章结构化助手|写作助手|AI\s*重排大纲|摘要|总结|outline|结构化|table\s*of\s*contents)$/i;

let globalRootTitle = null;

let chatWriter = null;

let AUTO_MAP_AFTER_BUILD = true;

// Toggles (enabled by default)
let SD_AUTO_MAP_AFTER_BUILD = true;
let SD_HIGHLIGHT_ON_SELECTION = true;


// Events
btnAuth.onclick = onAuthorizeClick;
btnConnect.onclick = connectDoc;
btnOutline.onclick = aiOutline;
btnExport.onclick = exportToDoc;
btnRootFloat.onclick = () => { focusRoot(); };
chatSend.onclick = onChatSend;
chatInput.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onChatSend(); } });

// Auto TL;DR init
let summarizer = null, sumEnabled = !!cbSum?.checked, sumDebounceTimer = null, sumBusy = false;
cbSum?.addEventListener("change", () => { sumEnabled = !!cbSum.checked; });


// ① On change: update flag (and pre-check availability when enabled)
cbSum?.addEventListener("change", async (e) => {
  sumEnabled = !!e.target.checked;
  if (sumEnabled) {
    // Translated comment omitted (English only).
    // Translated comment omitted (English only).
    try { if ('Summarizer' in self) await Summarizer.availability(); } catch { }
  }
});

// ===== Init =====
async function init() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const m = tab?.url?.match(/docs\.google\.com\/document\/d\/([^/]+)/);
    if (m) docInput.value = m[1]; // Translated comment omitted (English only).
  } catch { }
  setStatus("Ready");
}
init();

if (elAutoMap) {
  elAutoMap.checked = SD_AUTO_MAP_AFTER_BUILD;
  elAutoMap.onchange = () => { SD_AUTO_MAP_AFTER_BUILD = elAutoMap.checked; };
}
if (elAutoHL) {
  elAutoHL.checked = SD_HIGHLIGHT_ON_SELECTION;
  elAutoHL.onchange = () => {
    SD_HIGHLIGHT_ON_SELECTION = elAutoHL.checked;
    // Translated comment omitted (English only).
    if (SD_HIGHLIGHT_ON_SELECTION) SD_refreshHighlightsForSelection().catch(() => { });
  };
}


/* ===================== Block A — SD Helpers (safe to paste) ===================== */

// -- highlight color configurable
const SD_HL_COLOR = { r: 1, g: 1, b: 0.6 };

// Debounce to avoid rapid repeated triggers
function SD_debounce(fn, ms = 80) {
  let t = null;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

async function SD_refreshHighlightsForSelection() {
  const docId = extractDocId(docInput.value);
  if (!docId) return;

  const ids = Array.from(window.selectedIds || new Set());
  if (!ids.length) { await SD_clearHighlights({ onlySelection: false }).catch(() => { }); return; }

  // ↓↓ Use flatMap: parent nodes may map to multiple ranges
  const flatten = v => (Array.isArray(v) ? v : (v ? [v] : []));
  const ranges = ids
    .flatMap(id => flatten(window.aiToOrigMap?.get(String(id))))
    .filter(r => r && r.end > r.start)
    .sort((a, b) => a.start - b.start)
    .reduce((acc, r) => { const L = acc[acc.length - 1]; if (!L || r.start > L.end) acc.push({ ...r }); else L.end = Math.max(L.end, r.end); return acc; }, []);

  await SD_applyHighlights(docId, ranges, { color: SD_HL_COLOR });;
}

// Paragraph extraction with style (for heading detection)
function SD_buildParas(doc) {
  const out = [];
  for (const el of (doc?.body?.content || [])) {
    const p = el.paragraph; if (!p) continue;
    const s = el.startIndex, e = el.endIndex; if (!(e > s)) continue;
    const txt = (p.elements || []).map(r => r.textRun?.content || '').join('').replace(/\s+/g, ' ').trim();
    if (!txt) continue;
    const style = p.paragraphStyle?.namedStyleType || 'NORMAL_TEXT';
    const wc = txt.split(/\s+/).length;
    out.push({
      pid: out.length, start: s, end: e,
      style,
      wc,
      first12: txt.split(/\s+/).slice(0, 12).join(' '),
      kw: SD_kwTokens(txt)
    });
  }
  return out;
}

// Chunk paragraphs for LLM: headings as single blocks; body accumulates until minWords
function SD_buildBlocksForLLM(paras, opts = {}) {
  const minWords = opts.minWords ?? 50;  // Translated comment omitted (English only).
  const blocks = [];
  let cur = null;

  const pushCur = () => { if (cur) { cur.bid = blocks.length; blocks.push(cur); cur = null; } };

  for (let i = 0; i < paras.length; i++) {
    const p = paras[i];
    const isHeading = /^HEADING_/i.test(p.style || '');

    if (isHeading) {
      pushCur(); // Translated comment omitted (English only).
      blocks.push({
        bid: blocks.length,
        start_pid: i,
        end_pid: i,
        wc: p.wc,
        first12: p.first12,
        kw: p.kw
      });
      continue;
    }

    if (!cur) {
      cur = { bid: -1, start_pid: i, end_pid: i, wc: 0, first12: p.first12, kw: [] };
    } else {
      cur.end_pid = i;
    }
    cur.wc += p.wc;
    // Translated comment omitted (English only).
    cur.kw = Array.from(new Set([...(cur.kw || []), ...p.kw])).slice(0, 8);

    if (cur.wc >= minWords) pushCur();
  }
  pushCur();

  return blocks;
}

// 1) Dynamically estimate block size: based on total word count & leaf count (60–180 words)
function SD_autoMinWords(paras, leaves, opts = {}) {
  const totalWC = paras.reduce((s, p) => s + (p.wc || 0), 0);
  const L = Math.max(1, leaves.length);
  // Translated comment omitted (English only).
  const targetBlocks = Math.max(L + 2, Math.round(L * (opts.multiplier ?? 1.3)));
  const mw = Math.round(totalWC / targetBlocks);
  return Math.max(60, Math.min(180, mw)); // Translated comment omitted (English only).
}

// 2) Fallback: if LLM returns nothing, evenly partition blocks to leaves
function SD_evenPartition(leaves, B) {
  const L = Math.max(1, leaves.length);
  const base = Math.floor(B / L), rem = B % L;
  const out = []; let cur = 0;
  for (let i = 0; i < L; i++) {
    const len = base + (i < rem ? 1 : 0);
    const start = cur, end = Math.max(start, cur + len - 1);
    out.push({ id: String(leaves[i].id), start_bid: start, end_bid: end, confidence: 0.5 });
    cur = end + 1;
  }
  return out;
}

// 3) Coverage repair: enforce continuous coverage [0..B-1] in leaf order, no overlaps or gaps
function SD_repairCoverage(mapping, leaves, blocks) {
  const B = blocks.length;
  const order = new Map(leaves.map((n, i) => [String(n.id), i]));
  const m = mapping
    .filter(r => order.has(String(r.id)))
    .map(r => {
      let a = Number(r.start_bid ?? r.start_pid ?? 0) | 0;
      let b = Number(r.end_bid ?? r.end_pid ?? 0) | 0;
      if (a > b) [a, b] = [b, a];
      a = Math.max(0, Math.min(B - 1, a));
      b = Math.max(0, Math.min(B - 1, b));
      return { id: String(r.id), start_bid: a, end_bid: b, confidence: r.confidence ?? 0.9 };
    })
    .sort((x, y) => order.get(x.id) - order.get(y.id));

  if (!m.length) return m;

  // Translated comment omitted (English only).
  m[0].start_bid = 0;
  for (let i = 0, prevEnd = -1; i < m.length; i++) {
    const r = m[i];
    // Translated comment omitted (English only).
    if (r.start_bid <= prevEnd) r.start_bid = prevEnd + 1;
    if (r.start_bid > r.end_bid) r.end_bid = r.start_bid;
    // Translated comment omitted (English only).
    if (i > 0 && r.start_bid > prevEnd + 1) m[i - 1].end_bid = r.start_bid - 1;
    prevEnd = r.end_bid;
  }
  // Translated comment omitted (English only).
  m[m.length - 1].end_bid = B - 1;
  return m;
}




// Scan existing tree: prefer lastTree (from outline build), otherwise fall back to DOM data-parent
function SD_getTreeModel() {
  // Translated comment omitted (English only).
  if (window.lastTree && typeof window.lastTree === 'object') {
    const map = new Map();
    const dfs = (node, parentId = null, depth = 0) => {
      if (!node) return;
      const id = String(node._id ?? node.id);
      const title = (node.title ?? node.name ?? node.label ?? '').trim();
      const children = (node.children ?? node.items ?? []).filter(Boolean);
      map.set(id, { id, title, parentId, children: children.map(n => String(n._id ?? n.id)), node, depth });
      for (const ch of children) dfs(ch, id, depth + 1);
    };
    dfs(window.lastTree, null, 0);
    // Translated comment omitted (English only).
    let rootId = String(window.lastTree._id ?? window.lastTree.id);
    return { map, rootId };
  }

  // Translated comment omitted (English only).
  const els = [...document.querySelectorAll('.node[data-id]')];
  if (!els.length) return null;

  const map = new Map();
  for (const el of els) {
    const id = String(el.getAttribute('data-id'));
    const parentId = el.getAttribute('data-parent') ?? null;
    const title = (el.querySelector('.title')?.textContent || '').trim();
    if (!map.has(id)) map.set(id, { id, title, parentId, children: [] });
  }
  for (const [id, info] of map) {
    if (info.parentId && map.has(info.parentId)) map.get(info.parentId).children.push(id);
  }
  let rootId = null;
  for (const [id, info] of map) if (!info.parentId) { rootId = id; break; }
  return { map, rootId };
}

// Collect leaf nodes (no children)
function SD_getLeafNodes(tree) {
  if (!tree) return [];
  const leaves = [];
  for (const [id, info] of tree.map) {
    if (!info.children || info.children.length === 0) {
      leaves.push({ id, title: info.title });
    }
  }
  return leaves;
}

// Merge overlapping or touching ranges
function SD_unionRanges(ranges) {
  const src = (ranges || []).filter(r => r && r.end > r.start).sort((a, b) => a.start - b.start);
  const out = [];
  for (const r of src) {
    const L = out[out.length - 1];
    if (!L || r.start > L.end) out.push({ ...r });
    else L.end = Math.max(L.end, r.end);
  }
  return out;
}

// Propagate child ranges upward: store union (may be multi-segment) for each parent
function SD_buildParentMappings(tree, aiToOrigMap) {
  if (!tree) return;
  // Translated comment omitted (English only).
  const asArray = v => (Array.isArray(v) ? v : (v ? [v] : []));
  const rangesOf = (id) => asArray(aiToOrigMap.get(String(id)));

  // Translated comment omitted (English only).
  // Translated comment omitted (English only).
  const nodes = [...tree.map.values()].sort((a, b) => b.depth - a.depth);
  for (const info of nodes) {
    if (info.children && info.children.length) {
      const merged = SD_unionRanges(info.children.flatMap(ch => rangesOf(ch)));
      if (merged.length) aiToOrigMap.set(info.id, merged);
    }
  }
}



// B) Proxy selectedIds add/delete/clear to auto-refresh
function SD_installSelectionHooks() {
  const s = window.selectedIds;
  if (!s || s._sdHooked !== undefined) return;      // Translated comment omitted (English only).
  if (!(s instanceof Set)) { console.warn('[SD] selectedIds 不是 Set'); return; }

  const debouncedPaint = SD_debounce(() => {
    SD_refreshHighlightsForSelection().catch(console.warn);
  }, 80);

  ['add', 'delete', 'clear'].forEach(k => {
    const orig = s[k].bind(s);
    s[k] = function (...args) {
      const ret = orig(...args);
      debouncedPaint();
      return ret;
    };
  });
  s._sdHooked = true;
  console.log('[SD] selection hooks installed');
}

/* ======= selection/highlight wiring ======= */


// Auto-trigger after tree build (mapping only, no full repaint)
const SD_scheduleAutoLLMMap = (() => {
  let t = null, running = false;
  return () => {
    if (!SD_AUTO_MAP_AFTER_BUILD) return;
    if (running) return;
    clearTimeout(t);
    t = setTimeout(async () => {
      running = true;
      try { await SD_mapSelectedWithLLM(); } catch (e) { console.warn("[SD auto]", e); }
      running = false;
    }, 300);
  };
})();


// Make LLM mapping disjoint and ordered by nodes
function SD_makeDisjoint(mapping, nodes) {
  // Translated comment omitted (English only).
  const indexOf = new Map(nodes.map((n, i) => [String(n.id), i]));
  const ordered = mapping
    .filter(m => indexOf.has(String(m.id)))
    .sort((a, b) => indexOf.get(String(a.id)) - indexOf.get(String(b.id)));

  // Translated comment omitted (English only).
  let lastEnd = -1;
  for (let i = 0; i < ordered.length; i++) {
    const cur = ordered[i];
    const nxt = ordered[i + 1];

    // Translated comment omitted (English only).
    cur.start_pid = Math.max(cur.start_pid, lastEnd + 1);

    // Translated comment omitted (English only).
    const nextStart = nxt ? nxt.start_pid : Infinity;
    cur.end_pid = Math.min(cur.end_pid, nextStart - 1);

    // Translated comment omitted (English only).
    if (cur.end_pid < cur.start_pid) cur.end_pid = cur.start_pid;

    lastEnd = cur.end_pid;
  }
  return ordered;
}


// 0) Apply highlights (prefer DocsHighlighter; fallback to direct Docs API)
async function SD_applyHighlights(docId, ranges, options = {}) {
  const color = options.color || SD_HL_COLOR;

  // Translated comment omitted (English only).
  const merged = (ranges || [])
    .filter(r => r && r.end > r.start)
    .sort((a, b) => a.start - b.start)
    .reduce((acc, r) => { const L = acc[acc.length - 1]; if (!L || r.start > L.end) acc.push({ ...r }); else L.end = Math.max(L.end, r.end); return acc; }, []);
  if (!merged.length) return;

  // Translated comment omitted (English only).
  window.SD_lastPaint = { docId, ranges: merged };

  if (typeof DocsHighlighter === 'function') {
    if (!window.highlighter) window.highlighter = new DocsHighlighter({ getAccessToken: () => window.accessToken });
    await window.highlighter.apply(docId, merged, { color, replace: true });
    return;
  }

  // Translated comment omitted (English only).
  const rgb = { red: color.r ?? 1, green: color.g ?? 1, blue: color.b ?? 0.6 };
  const requests = merged.map(r => ({
    updateTextStyle: {
      range: { startIndex: r.start, endIndex: r.end },
      textStyle: { backgroundColor: { color: { rgbColor: rgb } } },
      fields: "backgroundColor"
    }
  }));
  const res = await fetch(`https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${window.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ requests })
  });
  if (!res.ok) console.warn('[SD] batchUpdate failed', res.status, await res.text().catch(() => res.statusText));
}


// 1) Writer factory (no monitor/run dependency; only needs write)
let _sd_writer = null;
async function SD_createWriterSafe() {
  if (_sd_writer) return _sd_writer;
  try {
    if (typeof window.createWriterSafe === 'function') {
      _sd_writer = await window.createWriterSafe();   // Translated comment omitted (English only).
    } else if (typeof Writer?.create === 'function') {
      _sd_writer = await Writer.create();             // Translated comment omitted (English only).
    } else if (typeof Writer === 'object' && typeof Writer === 'function') {
      _sd_writer = await Writer();                    // Translated comment omitted (English only).
    }
  } catch (e) {
    console.warn('[SD] Writer.create failed, will try streaming later', e);
  }
  return _sd_writer;
}

// 2) Call Writer with plain string; auto-compat with write / write({input}) / streaming
async function SD_callWriterText(prompt) {
  const writer = await SD_createWriterSafe();
  const pick = r => r?.outputText || r?.text || r?.response || r?.content || (typeof r === 'string' ? r : '');
  try { const r = await writer.write(prompt); return pick(r); } catch { }
  try { const r = await writer.write({ input: prompt }); return pick(r); } catch { }
  try { const r = await writer.write({ text: prompt }); return pick(r); } catch { }
  if (typeof writer.writeStreaming === 'function') {
    let buf = '';
    try {
      const stream = await writer.writeStreaming(prompt);
      if (stream && typeof stream[Symbol.asyncIterator] === 'function') {
        for await (const ev of stream) buf += (ev?.delta || ev?.text || ev || '');
      }
      return buf;
    } catch { }
  }
  throw new Error('[SD] Writer did not accept any known call shape');
}

// 3) Extract keyword tokens helper returns [{pid,start,end,wc,first12,kw}]
function SD_kwTokens(text, k = 8) {
  const stop = new Set('the a an and or of to in on for with from as is are was were be been being by at it its if than then thus hence this that those these which who whom whose what when where while into over under between among across more most less least very much many few each per such about using use based include includes including'.split(/\s+/));
  const bag = Object.create(null);
  for (const w of (text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [])) if (!stop.has(w)) bag[w] = (bag[w] || 0) + 1;
  return Object.entries(bag).sort((a, b) => b[1] - a[1]).slice(0, k).map(([w]) => w);
}


// 4) CSV parsing and keyword-fallback mapping
function SD_parseCSVToMapping(txt) {
  const arr = [];
  const lines = String(txt || '').split(/\r?\n/);
  for (const line of lines) {
    const L = line.trim();
    if (!L || /start_pid/i.test(L)) continue; // Translated comment omitted (English only).
    const m = L.match(/^([^,]+),\s*(\d+),\s*(\d+),\s*(\d*(?:\.\d+)?)/);
    if (!m) continue;
    arr.push({ id: String(m[1]).trim(), start_pid: +m[2], end_pid: +m[3], confidence: +m[4] });
  }
  return arr;
}
function SD_fallbackKeywordMapping(nodes, paras) {
  const tok = s => (s || '').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').split(/\s+/).filter(w => w.length >= 3);
  return nodes.map(n => {
    const t = tok(n.title); let best = null;
    for (const p of paras) {
      const sc = t.reduce((s, w) => s + ((p.first12.toLowerCase().includes(w) || p.kw.includes(w)) ? 1 : 0), 0);
      if (!best || sc > best.sc) best = { sc, p };
    }
    return { id: n.id, start_pid: best.p.pid, end_pid: best.p.pid, confidence: 0.1 };
  });
}

// 5) Collect nodes from canvas DOM (prefer selection; otherwise all)
function SD_nodesFromDOM() {
  const getTitle = id => (document.querySelector(`.node[data-id="${id}"] .title`)?.textContent || '').trim();
  const selected = Array.from(window.selectedIds || new Set());
  const ids = selected.length
    ? selected
    : Array.from(document.querySelectorAll('.node[data-id]')).map(el => el.getAttribute('data-id'));
  return ids.map(id => ({ id: String(id), title: getTitle(id) })).filter(n => n.title);
}

// 6) Convert mapping to {start,end} and merge
function SD_rangesFromMapping(mapping, paras) {
  const ranges = [];
  for (const m of mapping) {
    const sp = paras[m.start_pid], ep = paras[m.end_pid];
    if (sp && ep && ep.end > sp.start) ranges.push({ start: sp.start, end: ep.end });
  }
  return ranges;
}

async function SD_clearHighlights({ onlySelection = false } = {}) {
  const docId = extractDocId(docInput.value);
  if (!docId) return;

  // Compute ranges to clear
  let ranges = [];
  if (onlySelection && window.selectedIds?.size) {
    ranges = Array.from(window.selectedIds)
      .map(id => window.aiToOrigMap?.get(String(id)))
      .filter(r => r && r.end > r.start);
  } else if (window.SD_lastPaint?.docId === docId) {
    ranges = window.SD_lastPaint.ranges || [];
  }

  // Prefer highlighter.clear (clears the last applied batch)
  if (!onlySelection && typeof window.highlighter?.clear === 'function') {
    await window.highlighter.clear(docId).catch(console.warn);
    window.SD_lastPaint = null;
    return;
  }

  if (!ranges.length) { console.log('[SD] no ranges to clear'); return; }

  // Direct API: set backgroundColor to null
  const requests = ranges.map(r => ({
    updateTextStyle: {
      range: { startIndex: r.start, endIndex: r.end },
      textStyle: { backgroundColor: null },
      fields: "backgroundColor"
    }
  }));
  const res = await fetch(`https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${window.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ requests })
  });
  if (!res.ok) console.warn('[SD] clear failed', res.status, await res.text().catch(() => res.statusText));
}


/* =================== end Block A — SD Helpers =================== */




// ===== Auth =====
async function auth() {
  setStatus("Requesting authorization…");
  accessToken = await getAccessTokenInteractive();
  setStatus("Authorized");
}

// ===== Main: fetch → writer outline → parse → parent-branch view =====
async function aiOutline() {
  try {
    if (!accessToken) return setStatus("Not authorized. Click 'Authorize' first.");
    const raw = docInput.value.trim();
    const docId = extractDocId(raw);
    if (!docId) return setStatus("Invalid docId/URL");

    setStatus("Fetching document…");
    const doc = await fetchDoc(docId);
    fullPlainText = extractPlainText(doc);
    originalSections = buildOriginalSections(doc);

    setStatus("Generating AI outline… (model may download)");
    ensureWriterSupported();

    // 1) Global root title (Summarizer → fallback Writer)
    globalRootTitle = await getGlobalRootTitle();

    // 2) Auto chunking with rolling context
    const parts = chunksAuto(fullPlainText, 1000, 200);

    const mdPieces = [];
    for (let i = 0; i < parts.length; i++) {
      setStatus(`AI outlining… chunk ${i + 1}/${parts.length}`);
      const writer = await createWriterSafe({
        format: "markdown",
        length: "medium",
        tone: "neutral",
        sharedContext:
          "You are a structural writing editor. Different chunks are adjacent parts of the SAME article; keep consistent themes and numbering."
      });
      const md = await writer.write(buildIeltsPrompt(globalRootTitle), {
        context: parts[i].context + "\n\n" + parts[i].text
      });
      writer.destroy?.();

      const mdNorm = normalizeMdPiece(md || "", globalRootTitle, i === 0);
      mdPieces.push(mdNorm.trim() || `## ${globalRootTitle} · Chunk ${i + 1}\n- (no salient points)`);
    }

    // 4) Cross-chunk clustering → rebuild with unified levels
    const clusters = clusterHeadingsAcrossPieces(mdPieces);
    lastTree = rebuildUnifiedTree(mdPieces, clusters);
    lastMarkdown = mdPieces.join("\n\n");

    ({ map: treeMap, parentMap, rootId } = indexTree(lastTree));
    aiToOrigMap = mapAiTreeToBestSections(lastTree, doc /* ← 你 fetchDoc 的返回 */, originalSections);
    focusId = rootId;
    selectedIds.clear();
    updateSelInfo();
    renderParentSubtree(focusId);

    SD_scheduleAutoLLMMap();


    // Chat writer (sharedContext = full doc, trimmed)
    chatWriter?.destroy?.();
    chatWriter = await createWriterSafe({
      format: "plain-text",
      length: "medium",
      tone: "neutral",
      sharedContext: fullPlainText.length > 30000 ? fullPlainText.slice(0, 30000) : fullPlainText
    });

    setStatus("Done (auto-chunk + unified levels)");
  } catch (e) {
    console.error(e);
    setStatus("Error: " + e.message);
  }
}

// ===== Writer prompt (EN) — includes “use original language” =====
function buildIeltsPrompt(rootTitle) {
  return [
    `Re-outline the following text chunk as a clear Markdown outline. Global root title is: ${rootTitle}`,
    "Output Markdown only; no explanations.",
    "",
    "Structure requirements:",
    "1) Levels: # (only once in the first chunk) → ## macro sections → ### finer points; go to #### if necessary.",
    "2) Macro sections (##): include and rename as needed: Introduction / Position or Main Claim / Arguments / Counterpoints or Limitations / Evidence & Examples / Conclusion & Implications; at least 4 second-level sections.",
    "3) Under each second-level section, produce 2–4 third-level points (###), e.g., Topic sentence / Reason / Evidence or Example / Impact or Recommendation.",
    "4) Do NOT use meta titles like 'Outline', 'Summary', 'Writing Assistant', etc.; no headers/footers.",
    "5) Do not fabricate specific data or citations; use placeholders for gaps (e.g., '- missing evidence').",
    "6) Lists start with '- ' and stay concise and academic-neutral.",
    "7) Language: **Use the document’s original language** for all headings and bullets."  // ← REQUIRED LINE
  ].join("\n");
}

// ===== Helpers =====
function extractDocId(s) {
  const m = s.match(/docs\.google\.com\/document\/d\/([^/]+)/);
  if (m) return m[1];
  return /^[a-zA-Z0-9_-]+$/.test(s) ? s : null;
}

async function fetchDoc(docId) {
  const res = await fetch(`https://docs.googleapis.com/v1/documents/${docId}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) throw new Error(`Docs API ${res.status}: ${(await res.text().catch(() => res.statusText))}`);
  return res.json();
}

function extractPlainText(docJson) {
  const out = [];
  for (const el of docJson.body?.content || []) {
    const p = el.paragraph;
    if (!p) continue;
    const style = p.paragraphStyle?.namedStyleType || "NORMAL_TEXT";
    const text = (p.elements || []).map(e => e.textRun?.content || "").join("").replace(/\s+$/g, "");
    if (!text) continue;
    const m = style.match(/^HEADING_([1-6])$/);
    out.push(m ? `${"#".repeat(Number(m[1]))} ${text}` : text);
  }
  return out.join("\n");
}

function buildOriginalSections(docJson) {
  const root = { id: 0, title: "ROOT", level: 0, start: 1, end: null, children: [] };
  const stack = [root];
  let nextId = 1;
  const content = docJson.body?.content || [];
  const headings = [];
  for (const el of content) {
    const p = el.paragraph; if (!p) continue;
    const style = p.paragraphStyle?.namedStyleType || "NORMAL_TEXT";
    const m = style.match(/^HEADING_([1-6])$/); if (!m) continue;
    const title = (p.elements || []).map(e => e.textRun?.content || "").join("").trim();
    const level = Number(m[1]);
    const start = el.startIndex ?? null;
    if (title && start != null) headings.push({ title, level, start });
  }
  const nodes = [root];
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    while (stack.length && stack[stack.length - 1].level >= h.level) {
      const done = stack.pop();
      if (done && done.end == null) done.end = h.start - 1;
    }
    const node = { id: nextId++, title: h.title, level: h.level, start: h.start, end: null, children: [] };
    stack[stack.length - 1].children.push(node);
    stack.push(node);
    nodes.push(node);
  }
  const docEnd = content.length ? (content[content.length - 1].endIndex ?? null) : null;
  while (stack.length) {
    const done = stack.pop();
    if (done && done.end == null) done.end = (docEnd ?? done.start + 1);
  }
  const byId = new Map(nodes.map(n => [n.id, n]));
  return { flat: nodes, byId, root };
}

function flattenSections(section, out = []) {
  for (const c of section.children || []) {
    out.push(c);
    flattenSections(c, out);
  }
  return out;
}

function ensureWriterSupported() {
  if (!('Writer' in self)) {
    throw new Error("Writer API not available (enable Origin Trial or flags).");
  }
}

function parseMarkdownOutline(md) {
  const lines = md.split(/\r?\n/);
  const root = { title: "ROOT", children: [], paras: [] };
  const stack = [{ level: 0, node: root }];
  let lastNode = root;
  for (let line of lines) {
    if (/^\s*$/.test(line)) continue;
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const title = h[2].trim();
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      const parent = stack[stack.length - 1].node;
      const node = { title, children: [], paras: [] };
      parent.children.push(node);
      stack.push({ level, node });
      lastNode = node;
      continue;
    }
    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    (lastNode.paras ||= []).push(bullet ? bullet[1] : line.trim());
  }
  return root;
}

// Translated comment omitted (English only).
// Translated comment omitted (English only).
function extractHeadingsLinear(md) {
  const lines = (md || "").replace(/\r\n?/g, "\n").split("\n");
  const out = [];

  let i = 0;
  while (i < lines.length) {
    const h = lines[i].match(/^\s*(#{1,6})\s+(.*)$/);
    if (!h) { i++; continue; }

    const level = h[1].length;
    const title = h[2].trim();

    // Translated comment omitted (English only).
    const bullets = [];
    let j = i + 1;
    while (j < lines.length) {
      const s = lines[j];
      if (/^\s*(#{1,6})\s+/.test(s)) break;             // Translated comment omitted (English only).
      const m = s.match(/^\s*[-*+]\s+(.*\S)\s*$/);       // bullet
      if (m) bullets.push(m[1].trim());
      j++;
    }

    // Translated comment omitted (English only).
    let summary = bullets[0] || "";
    if (!summary) {
      let k = i + 1;
      while (k < j) {
        const s = lines[k].trim();
        if (s && !s.startsWith("#")) { summary = s; break; }
        k++;
      }
    }

    out.push({ title, level, summary, bullets });
    i = j;
  }

  return out;
}


function indexTree(root) {
  const map = new Map();
  const parentMap = new Map();
  let idCounter = 0;
  (function walk(node, parentId = null) {
    const id = idCounter++;
    node._id = id;
    map.set(id, node);
    if (parentId !== null) parentMap.set(id, parentId);
    for (const c of node.children || []) walk(c, id);
  })(root, null);
  return { map, parentMap, rootId: 0 };
}

function focusRoot() {
  if (rootId == null) return;
  focusId = rootId;
  renderParentSubtree(focusId);
}

function renderParentSubtree(centerId) {
  const NODE_W = 260, NODE_H = 72;
  const LEFT_PADDING = 24, BASE_LEAF_DY = 92;
  const COL_GAP = d => Math.max(72, 176 - 18 * Math.min(d, 6));

  const kids = (n) => Array.isArray(n?.children) ? n.children.filter(Boolean) : [];

  // Clear canvas
  canvasEl.innerHTML = "";
  if (!treeMap || !treeMap.has(centerId)) { setStatus?.("No node to render."); return; }

  const isRootView = (centerId === rootId);
  const center = treeMap.get(centerId);

  // ---------- Build visible tree ----------
  const visibleRoot = { _id: -1, title: "ROOT", children: [] };
  if (isRootView) {
    for (const c of kids(center)) visibleRoot.children.push(c);
  } else {
    const parentId = parentMap?.get(centerId);
    const parent = (parentId != null) ? treeMap.get(parentId) : null;
    if (parent) {
      const parentVis = { _id: parent._id, title: parent.title, paras: parent.paras || [], children: [] };
      const meVis = { _id: center._id, title: center.title, paras: center.paras || [], children: [] };
      for (const c of kids(center)) meVis.children.push({ _id: c._id, title: c.title, paras: c.paras || [], children: [] });
      parentVis.children.push(meVis);
      visibleRoot.children.push(parentVis);
    } else {
      // Fallback: render current node and its children only
      const meVis = { _id: center._id, title: center.title, paras: center.paras || [], children: [] };
      for (const c of kids(center)) meVis.children.push({ _id: c._id, title: c.title, paras: c.paras || [], children: [] });
      visibleRoot.children.push(meVis);
    }
  }
  if (!kids(visibleRoot).length) {
    visibleRoot.children = [{ _id: center._id, title: center.title, paras: center.paras || [], children: [] }];
  }

  // ---------- Layout ----------
  const leafCount = new Map();
  const maxDepth = { v: 0 };
  (function count(node, depth) {
    if (!node) return 0;
    maxDepth.v = Math.max(maxDepth.v, depth);
    const ch = kids(node);
    if (!ch.length) { leafCount.set(node._id, 1); return 1; }
    let s = 0; for (const c of ch) s += count(c, depth + 1);
    s = Math.max(1, s); leafCount.set(node._id, s); return s;
  })(visibleRoot, 0);

  const xCols = [LEFT_PADDING];
  for (let d = 1; d <= maxDepth.v; d++) xCols[d] = xCols[d - 1] + NODE_W + COL_GAP(d - 1);

  const pos = new Map();
  (function layout(node, depth, yTop) {
    if (!node) return;
    const leaves = leafCount.get(node._id) || 1;
    const blockH = leaves * BASE_LEAF_DY;
    if (depth > 0) {
      const x = xCols[depth - 1];
      const y = yTop + blockH / 2 - NODE_H / 2;
      pos.set(node._id, { x, y, depth });
    }
    let childTop = yTop;
    for (const c of kids(node)) {
      const subLeaves = leafCount.get(c._id) || 1;
      const subH = subLeaves * BASE_LEAF_DY;
      layout(c, depth + 1, childTop);
      childTop += subH;
    }
  })(visibleRoot, 0, 12);

  function getBBox(map, w, h) {
    let maxX = 0, maxY = 0;
    for (const v of map.values()) { if (!v) continue; maxX = Math.max(maxX, v.x + w); maxY = Math.max(maxY, v.y + h); }
    return { maxX, maxY };
  }
  const bbox = getBBox(pos, NODE_W, NODE_H);
  let canvasW = Math.max(320, Math.ceil(bbox.maxX + 32));
  let canvasH = Math.max(180, Math.ceil(bbox.maxY + 32));

  canvasEl.style.width = canvasW + "px";
  canvasEl.style.height = canvasH + "px";
  window._pz.apply(); // Translated comment omitted (English only).

  // ---------- SVG Curve layer ----------
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("width", canvasW);
  svg.setAttribute("height", canvasH);
  svg.style.position = "absolute";
  svg.style.left = "0"; svg.style.top = "0";
  svg.style.pointerEvents = "none";   // Make the connector layer not block clicks
  svg.style.zIndex = "1";
  canvasEl.appendChild(svg);

  function strokeColor() {
    const cs = getComputedStyle(document.documentElement);
    return (cs.getPropertyValue('--tree-stroke') || cs.getPropertyValue('--g-border') || '#dadce0').trim();
  }
  function drawCurve(x1, y1, x2, y2) {
    const dx = Math.max(24, (x2 - x1) * 0.5);
    const path = document.createElementNS(svgNS, "path");
    path.setAttribute("d", `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", strokeColor());
    path.setAttribute("stroke-width", "1.2");
    svg.appendChild(path);
  }

  // Root view: branch from an anchor
  if (isRootView) {
    const ch = kids(visibleRoot);
    if (ch.length) {
      const ys = ch.map(c => (pos.get(c._id)?.y || 0) + NODE_H / 2).sort((a, b) => a - b);
      const anchorY = ys[Math.floor(ys.length / 2)] || (bbox.maxY / 2);
      const anchorX = Math.max(8, (xCols[0] ?? LEFT_PADDING) - 18);
      for (const c of ch) {
        const p = pos.get(c._id);
        if (p) drawCurve(anchorX, anchorY, p.x - 12, p.y + NODE_H / 2);
      }
    }
  }

  (function drawTree(node, depth) {
    if (!node) return;
    const ch = kids(node); if (!ch.length) return;
    for (const c of ch) {
      const pa = pos.get(node._id), pb = pos.get(c._id);
      if (node._id !== -1 && pa && pb) {
        const tgx = (xCols[depth] ?? (pa.x + NODE_W + 24)) - 12;
        drawCurve(pa.x + NODE_W, pa.y + NODE_H / 2, tgx, pb.y + NODE_H / 2);
      }
      drawTree(c, depth + 1);
    }
  })(visibleRoot, 0);

  // ---------- Nodes & Popout ----------
  let extraMaxX = 0, extraMaxY = 0;

  (function renderNodes(node) {
    if (!node) return;
    for (const c of kids(node)) { drawNode(c); renderNodes(c); }
  })(visibleRoot);

  function drawNode(n) {
    const p = pos.get(n?._id); if (!n || !p) return;

    const el = document.createElement("div");
    el.className = "node";
    el.style.left = p.x + "px";
    el.style.top = p.y + "px";
    el.style.pointerEvents = "auto";    // Translated comment omitted (English only).
    el.style.zIndex = "2";              // Place nodes above the SVG layer
    el.setAttribute("data-id", n._id);
    if (window.selectedIds?.has(n._id)) el.classList.add("sel");

    el.innerHTML =
      `<div class="title">${escapeHTML(n.title || "")}</div>` +
      (Array.isArray(n.paras) && n.paras.length ? `<div class="snippet">${escapeHTML(n.paras[0]).slice(0, 120)}</div>` : "");
    el.style.cursor = "pointer";


    // ===== Pointer-based node events: tap → select, double-tap → focus =====
    let downX = 0, downY = 0, downT = 0, lastTapT = 0;

    el.addEventListener("pointerdown", (ev) => {
      // Translated comment omitted (English only).
      if (ev.button !== 0) return;
      downX = ev.clientX; downY = ev.clientY; downT = ev.timeStamp || Date.now();
    });

    el.addEventListener("pointerup", (ev) => {
      // Translated comment omitted (English only).
      if (window._pz?.isDragging) return;

      const dx = Math.abs(ev.clientX - downX);
      const dy = Math.abs(ev.clientY - downY);
      const dt = (ev.timeStamp || Date.now()) - downT;

      // Translated comment omitted (English only).
      if (dx < 4 && dy < 4 && dt < 300) {
        ev.stopPropagation();

        // Translated comment omitted (English only).
        if ((ev.timeStamp || Date.now()) - lastTapT < 250) {
          lastTapT = 0;
          // Double-click = focus current node
          window.focusId = n._id;
          renderParentSubtree(window.focusId);
          return;
        }

        // Single-click = select / Ctrl(⌘)+click = mutually exclusive multi-select
        if (ev.ctrlKey || ev.metaKey) toggleSelectMutuallyExclusive(n._id, el);
        else selectSingle(n._id, el);

        lastTapT = ev.timeStamp || Date.now();
      }
    });

    canvasEl.appendChild(el);

    // Translated comment omitted (English only).
    const isFocused = (!isRootView && n._id === centerId);
    const hasChildren = !!kids(n).length;
    if (isFocused && !hasChildren && Array.isArray(n.paras) && n.paras.length) {
      const POPOUT_W = 360;
      const px = p.x + NODE_W + 24;
      const py = p.y;

      const pop = document.createElement("div");
      pop.className = "popout";
      pop.style.left = px + "px";
      pop.style.top = py + "px";
      const items = n.paras.map(x => `<li>${escapeHTML(x)}</li>`).join("");
      pop.innerHTML = `<h4>Details</h4><ul>${items}</ul>`;
      canvasEl.appendChild(pop);

      drawCurve(p.x + NODE_W, p.y + NODE_H / 2, px - 12, py + 18);

      extraMaxX = Math.max(extraMaxX, px + POPOUT_W);
      extraMaxY = Math.max(extraMaxY, py + Math.max(200, pop.offsetHeight || 0));
    }
  }

  // Resize canvas if popout expands
  if (extraMaxX || extraMaxY) {
    canvasW = Math.max(canvasW, extraMaxX + 16);
    canvasH = Math.max(canvasH, extraMaxY + 16);
    svg.setAttribute("width", canvasW);
    svg.setAttribute("height", canvasH);
    canvasEl.style.width = canvasW + "px";
    canvasEl.style.height = canvasH + "px";
    window._pz.apply();
  }
}

/* ===== Global delegate: Delegate: click to select / double-click to focus (with verbose logging) ===== */
(function installNodeDelegate() {
  const log = (...a) => console.log("[DELEGATE]", ...a);

  document.addEventListener("pointerup", (e) => {
    if (window._pz?.isDragging) return;

    // Translated comment omitted (English only).
    const topEl = document.elementFromPoint(e.clientX, e.clientY);
    const nodeFromPoint = topEl?.closest?.(".node") || null;

    // Allow hits on canvas/svg/.node; ignore others
    const inGraph =
      window.canvasEl &&
      (e.target === window.canvasEl ||
        window.canvasEl.contains(e.target) ||
        nodeFromPoint);

    if (!inGraph) return;

    const nodeEl = nodeFromPoint || e.target.closest?.(".node");
    if (!nodeEl) {
      log("up on canvas/svg, not a .node", {
        target: e.target.tagName,
        top: topEl?.tagName,
        hasNodes: document.querySelectorAll(".node").length
      });
      return;
    }

    const id = Number(nodeEl.getAttribute("data-id"));
    log("up on .node", id, {
      target: e.target.tagName,
      top: topEl?.tagName
    });

    if (e.ctrlKey || e.metaKey) toggleSelectMutuallyExclusive?.(id, nodeEl);
    else selectSingle?.(id, nodeEl);
  }, true);

  document.addEventListener("dblclick", (e) => {
    if (window._pz?.isDragging) return;
    const topEl = document.elementFromPoint(e.clientX, e.clientY);
    const nodeEl = topEl?.closest?.(".node") || e.target.closest?.(".node");
    if (!nodeEl) return;
    const id = Number(nodeEl.getAttribute("data-id"));
    console.log("[DELEGATE] dblclick", id);
    window.focusId = id;
    renderParentSubtree(id);
  }, true);
})();



// Map AI nodes → nearest original heading range (for highlight)
function mapAiTreeToOriginal(aiRoot, originalRoot) {
  const map = new Map();
  const origList = flattenSections(originalRoot);
  const norm = s => (s || "").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");

  const origNorm = origList.map(o => ({ o, key: norm(o.title) }));

  (function walk(node) {
    if (node.title && node._id != null) {
      const key = norm(node.title);
      let best = null, bestScore = 0;
      for (const { o, key: ok } of origNorm) {
        if (!ok || !key) continue;
        const L = lcsLen(key, ok);
        const score = L / Math.max(key.length, ok.length);
        if (score > bestScore) { bestScore = score; best = o; }
      }
      if (best && bestScore >= 0.45) {
        map.set(node._id, { start: best.start, end: best.end, sectionId: best.id, score: bestScore });
      }
    }
    for (const c of node.children || []) walk(c);
  })(aiRoot);

  return map;

  function lcsLen(a, b) {
    const m = a.length, n = b.length;
    const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
    return dp[m][n];
  }
}

function toggleSelect(id, el) {
  if (selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id);
  el.classList.toggle("sel");
  updateSelInfo();
  refreshHighlights().catch(err => setStatus("Highlight failed: " + err.message));
  prewarmSummarizerOnClick();
  scheduleSummarize();
}


// ===== Chat =====
async function onChatSend() {
  const q = (chatInput.value || "").trim();
  if (!q) return;

  // Translated comment omitted (English only).
  appendChat("you", q);
  chatInput.value = "";

  try {
    setStatus("Thinking…");
    // Translated comment omitted (English only).
    const shared = [
      "You are an assistant for document understanding and editing.",
      lastMarkdown ? "Below is the current AI-restructured outline in Markdown." : "",
      selectedIds?.size ? `Focus nodes: ${[...selectedIds].map(id => treeMap.get(id)?.title).filter(Boolean).join(" | ")}` : ""
    ].filter(Boolean).join("\n");

    // Translated comment omitted (English only).
    const writer = await createWriterSafe({
      format: "plain-text",
      length: "short",
      tone: "neutral",
      sharedContext: shared
    });

    const context = lastMarkdown || "";
    const res = await writer.write(q, { context });
    writer.destroy?.();

    appendChat("ai", res || "(no answer)");
    setStatus("Ready");
  } catch (e) {
    console.error(e);
    appendChat("ai", "Error: " + e.message);
    setStatus("Error");
  }
}

function appendChat(role, text) {
  if (!chatOut) return;
  const div = document.createElement("div");
  div.className = "msg " + (role === "ai" ? "ai" : "you");
  div.innerHTML = (role === "ai" ? "<strong>AI</strong> " : "<strong>You</strong> ") + escapeHTML(text);
  chatOut.appendChild(div);
  chatOut.scrollTop = chatOut.scrollHeight;
}


function buildChatPrompt(targets, userInput) {
  const goals = (targets && targets.length) ? targets.map(t => `【${t}】`).join(" / ") : "【Entire Document】";
  return [
    "You are a meticulous technical editor and reviewer. Ground every answer strictly in the document.",
    `Targets: ${goals}`,
    `Instruction: ${userInput}`,
    "",
    "Guidelines:",
    "1) Cite only what is supported by the document; if uncertain, say 'uncertain' and note what’s missing.",
    "2) Prioritize sections under Targets; when multiple places are relevant, include the title path like: A > B > C.",
    "3) Output format:",
    "   - Conclusion: 1–3 bullets;",
    "   - Evidence: mention relevant sections (brief paraphrase, no long quotes);",
    "   - Suggestions/Next steps (optional).",
    "4) Language: Use the document’s original language."
  ].join("\n");
}

function buildFocusContext(ids) {
  if (!ids || ids.length === 0) return "";
  const seen = new Set();
  const parts = [];
  for (const id of ids) {
    const node = treeMap.get(id);
    if (!node) continue;
    collect(node, 0);
  }
  return parts.join("\n");

  function collect(node, depth) {
    if (seen.has(node._id)) return;
    seen.add(node._id);
    const h = "#".repeat(Math.min(6, depth + 1));
    parts.push(`${h} ${node.title}`);
    for (const p of (node.paras || [])) parts.push("- " + p);
    for (const c of (node.children || [])) collect(c, depth + 1);
  }
}

// ===== Export to a new page in the same Doc =====
async function exportToDoc() {
  try {
    if (!accessToken) return setStatus("Not authorized.");
    const raw = docInput.value.trim();
    const docId = extractDocId(raw);
    if (!docId) return setStatus("Invalid docId/URL");
    if (!lastMarkdown) return setStatus("No AI outline to export.");

    setStatus("Exporting to a new page…");
    const requests = [
      { insertPageBreak: { endOfSegmentLocation: {} } },
      { insertText: { endOfSegmentLocation: {}, text: "\n## AI Re-outlined (Markdown)\n\n" + lastMarkdown + "\n" } }
    ];
    const res = await fetch(`https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ requests })
    });
    if (!res.ok) throw new Error(`batchUpdate ${res.status}: ${(await res.text().catch(() => res.statusText))}`);
    setStatus("Exported (added to the end as a new page).");
  } catch (e) {
    console.error(e);
    setStatus("Export failed: " + e.message);
  }
}

// Chat UI helpers
function appendMsg(role, text, targets = []) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  if (role === "user" && targets?.length) {
    div.innerHTML = `<strong>You</strong><small> Targets: ${targets.join(" / ")}</small><br>${escapeHTML(text)}`;
  } else if (role === "user") {
    div.innerHTML = `<strong>You</strong><br>${escapeHTML(text)}`;
  } else {
    div.innerHTML = `<strong>AI</strong><br>${escapeHTML(text)}`;
  }
  chatOut.appendChild(div);
  chatOut.scrollTop = chatOut.scrollHeight;
}

// ---- helpers ----
async function callWriterText(writer, prompt) {
  const pick = r => r?.outputText || r?.text || r?.response || r?.content || (typeof r === 'string' ? r : '');
  try { const r = await writer.write(prompt); return pick(r); } catch { }
  try { const r = await writer.write({ input: prompt }); return pick(r); } catch { }
  try { const r = await writer.write({ text: prompt }); return pick(r); } catch { }
  if (typeof writer.writeStreaming === 'function') {
    let buf = ''; try {
      const stream = await writer.writeStreaming(prompt);
      if (stream && typeof stream[Symbol.asyncIterator] === 'function') {
        for await (const ev of stream) buf += (ev?.delta || ev?.text || ev || '');
      }
      return buf;
    } catch { }
  }
  throw new Error('Writer call failed');
}
const kw = (text, k = 8) => {
  const stop = new Set('the a an and or of to in on for with from as is are was were be been being by at it its if than then thus hence this that those these which who whom whose what when where while into over under between among across more most less least very much many few each per such about using use based include includes including'.split(/\s+/));
  const bag = Object.create(null); for (const w of (text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [])) { if (!stop.has(w)) bag[w] = (bag[w] || 0) + 1 }
  return Object.entries(bag).sort((a, b) => b[1] - a[1]).slice(0, k).map(([w]) => w)
}
const getTitle = id => (document.querySelector(`.node[data-id="${id}"] .title`)?.textContent || '').trim();

/* ===================== Block B — main + auto trigger ===================== */

// Main flow: build paras → call LLM for CSV → parse/fallback → highlight
async function SD_mapSelectedWithLLM() {
  const raw = docInput?.value?.trim?.() || "";
  const docId = typeof extractDocId === "function" ? extractDocId(raw) : raw;
  if (!window.accessToken || !docId) { console.warn("[SD] no token or docId"); return; }

  // Translated comment omitted (English only).
  const doc = await fetchDoc(docId);
  const paras = SD_buildParas(doc);

  const tree = SD_getTreeModel();
  const leaves = tree ? SD_getLeafNodes(tree) : SD_nodesFromDOM();
  if (!leaves.length || !paras.length) { console.warn("[SD] no leaves or paras"); return; }

  const minWords = SD_autoMinWords(paras, leaves, { multiplier: 1.3 }); // adjustable 1.2–1.6
  const blocks = SD_buildBlocksForLLM(paras, { minWords });

  // Translated comment omitted (English only).
  const INSTR = [
    `You are given BLOCKS[0..${blocks.length - 1}] each ~${minWords} words (headings may be single-block).`,
    "Align LEAF nodes to CONTIGUOUS block-id ranges in document order.",
    "Partition the block sequence so that the union covers ALL blocks with no gaps.",
    "Avoid overlaps unless necessary; prefer larger contiguous ranges.",
    "OUTPUT ONLY: id,start_bid,end_bid,confidence"
  ].join("\n");


  const prompt =
    `${INSTR}\n\nLEAVES\n${JSON.stringify(leaves)}\n\nBLOCKS\n` +
    `${JSON.stringify(blocks.map(b => ({ bid: b.bid, wc: b.wc, first12: b.first12, kw: b.kw })))}\n`;

  const rawText = await SD_callWriterText(prompt);
  console.log("[SD LLM raw] ~~csv\n" + rawText + "\n~~");

  // Translated comment omitted (English only).
  let mapping = SD_parseCSVToMapping(rawText)
    .map(m => ({ id: m.id, start_bid: m.start_bid ?? m.start_pid, end_bid: m.end_bid ?? m.end_pid, confidence: m.confidence }));

  if (!mapping.length) {
    mapping = SD_evenPartition(leaves, blocks.length);
  }

  // Translated comment omitted (English only).
  mapping = SD_makeDisjoint(
    mapping.map(m => ({ id: m.id, start_pid: m.start_bid, end_pid: m.end_bid, confidence: m.confidence })),
    leaves
  ).map(m => ({ id: m.id, start_bid: m.start_pid, end_bid: m.end_pid, confidence: m.confidence }));

  // Translated comment omitted (English only).
  mapping = SD_repairCoverage(mapping, leaves, blocks);

  console.table(mapping);

  // Translated comment omitted (English only).
  if (!window.aiToOrigMap) window.aiToOrigMap = new Map();
  const blockToRange = (bidx) => {
    const b = blocks[bidx]; if (!b) return null;
    const sp = paras[b.start_pid], ep = paras[b.end_pid];
    return (sp && ep && ep.end > sp.start) ? { start: sp.start, end: ep.end } : null;
  };
  for (const m of mapping) {
    const r1 = blockToRange(m.start_bid);
    const r2 = blockToRange(m.end_bid);
    if (!r1 || !r2) continue;
    const r = { start: Math.min(r1.start, r2.start), end: Math.max(r1.end, r2.end) };
    window.aiToOrigMap.set(String(m.id), r);
  }

  // Translated comment omitted (English only).
  if (tree) SD_buildParentMappings(tree, window.aiToOrigMap);

  // Translated comment omitted (English only).
  if (window.selectedIds?.size) await SD_refreshHighlightsForSelection().catch(() => { });
}


/* ======= end replace ======= */

/* ================= end Block B ================= */


// Create a Writer with sane defaults and availability/monitor handling
async function createWriterSafe(options = {}) {
  const defaults = { tone: 'neutral', format: 'markdown', length: 'medium' };
  const opts = { ...defaults, ...options };

  // Fix legacy value
  if (opts.format === 'plain') opts.format = 'plain-text';

  const availability = await Writer.availability();
  if (availability === 'unavailable') {
    throw new Error('Writer API unavailable on this device/browser');
  }
  // If model needs download, show progress
  return await Writer.create({
    ...opts,
    monitor(m) {
      m.addEventListener('downloadprogress', e => {
        const pct = Math.round((e.loaded || 0) * 100);
        setStatus?.(`Downloading on-device model… ${pct}%`);
      });
    }
  });
}

function summarizeEnabled() {
  return !!(sumEnabled || cbSum?.checked);
}


async function ensureSummarizer() {
  if (summarizer) return summarizer;
  if (!('Summarizer' in self)) {
    throw new Error("Summarizer API not supported in this environment.");
  }
  const availability = await Summarizer.availability();
  if (availability === 'unavailable') {
    throw new Error("Device/policy does not meet requirements.");
  }
  if (!navigator.userActivation.isActive) {
    console.warn("Summarizer.create() should be called under user activation.");
  }
  summarizer = await Summarizer.create({
    type: "tldr",
    length: "short",
    format: "plain-text",
    sharedContext: (fullPlainText || "").slice(0, 30000),
    monitor(m) {
      m.addEventListener("downloadprogress", (e) => {
        setStatus(`Preparing summarization model… ${Math.round((e.loaded || 0) * 100)}%`);
      });
    }
  });
  return summarizer;
}

async function prewarmSummarizerOnClick() {
  try {
    if (!summarizer) await ensureSummarizer();
  } catch (e) {
    console.warn("Summarizer prewarm failed:", e);
  }
}


function scheduleSummarize() {
  if (!summarizeEnabled()) return;
  if (sumDebounceTimer) clearTimeout(sumDebounceTimer);
  sumDebounceTimer = setTimeout(runSummarize, 1000);
}


async function runSummarize() {
  if (!summarizeEnabled()) return;
  if (sumBusy) return;
  if (!window.selectedIds || window.selectedIds.size === 0) return;

  try {
    sumBusy = true;
    await ensureSummarizer();
    const focusText = buildFocusContext(Array.from(selectedIds));
    const summary = await summarizer.summarize(focusText, {
      context: "Output a one-sentence TL;DR in the document’s original language. Keep it information-dense and avoid flowery wording."
    });
    const idsSnapshot = Array.from(selectedIds);
    const label = targetLabel(idsSnapshot);
    appendMsg("ai", `Summary for ${label}: ${summary}`);
  } catch (err) {
    console.error(err);
    setStatus("TL;DR failed: " + err.message);
  } finally {
    sumBusy = false;
  }
}

function targetLabel(ids, max = 3) {
  const titles = ids.map(id => treeMap.get(id)?.title).filter(Boolean);
  if (titles.length === 0) return "current selection";
  if (titles.length <= max) return `【${titles.join(" / ")}】`;
  return `【${titles.slice(0, max).join(" / ")}】 and ${titles.length - max} more`;
}

// (… keep the rest of helper functions: parseMarkdownBlocks, blocksToRequests (if still in your file), normKey/lcsLen/titleSimilar,
// clusterHeadingsAcrossPieces, rebuildUnifiedTree, chunksAuto, globalRootTitle helpers, normalizeMdPiece …)
// NOTE: If you already removed Markdown→Docs overwrite/undo utilities earlier, you can keep them removed.


// Translated comment omitted (English only).
// Translated comment omitted (English only).
function parseMarkdownBlocks(md) {
  const lines = (md || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Code fences (```) are pasted as plain paragraphs
    if (/^\s*```/.test(line)) {
      i++;
      const buf = [];
      while (i < lines.length && !/^\s*```/.test(lines[i])) { buf.push(lines[i++]); }
      i++; // skip closing ```
      blocks.push(makePara(buf.join("\n")));
      continue;
    }

    // Translated comment omitted (English only).
    const h = line.match(/^\s*(#{1,6})\s+(.*)$/);
    if (h) { blocks.push({ type: "heading", level: h[1].length, ...inlineText(h[2]) }); i++; continue; }

    // Ordered list items
    const o = line.match(/^\s*\d+\.\s+(.*)$/);
    if (o) {
      const items = [];
      do {
        items.push(inlineText(line.replace(/^\s*\d+\.\s+/, "")));
        i++;
      } while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i]));
      blocks.push({ type: "ol", items });
      continue;
    }

    // Unordered list items
    if (/^\s*[-*+]\s+/.test(line)) {
      const items = [];
      do {
        items.push(inlineText(line.replace(/^\s*[-*+]\s+/, "")));
        i++;
      } while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i]));
      blocks.push({ type: "ul", items });
      continue;
    }

    // Blank line -> paragraph break
    if (/^\s*$/.test(line)) { blocks.push(makePara("")); i++; continue; }

    // Normal paragraph (merge lines until blank or another block)
    const buf = [line]; i++;
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^\s*(#{1,6})\s+/.test(lines[i]) && !/^\s*[-*+]\s+/.test(lines[i]) && !/^\s*\d+\.\s+/.test(lines[i])) {
      buf.push(lines[i++]);
    }
    blocks.push(makePara(buf.join("\n")));
  }
  return blocks;

  function makePara(text) { return { type: "p", ...inlineText(text) }; }

  // Parse **bold** and *italic* spans; return {text, spans:[{offset,len,bold,italic}]}
  function inlineText(s) {
    let out = "", spans = [];
    let i = 0;
    while (i < s.length) {
      // **bold**
      if (s.slice(i).startsWith("**")) {
        const j = s.indexOf("**", i + 2);
        if (j > i + 2) {
          const start = out.length; const inner = s.slice(i + 2, j);
          out += inner; spans.push({ offset: start, len: inner.length, bold: true });
          i = j + 2; continue;
        }
      }
      // *italic*
      if (s[i] === "*") {
        const j = s.indexOf("*", i + 1);
        if (j > i + 1) {
          const start = out.length; const inner = s.slice(i + 1, j);
          out += inner; spans.push({ offset: start, len: inner.length, italic: true });
          i = j + 1; continue;
        }
      }
      out += s[i++]; // Translated comment omitted (English only).
    }
    return { text: out, spans };
  }
}

// —— Convert blocks into Google Docs batchUpdate requests (insert at startIndex)——
function blocksToRequests(blocks, startIndex) {
  const req = [];
  let cursor = startIndex;
  const styleOps = [];     // Inline text styles (bold/italic)
  const bulletRanges = []; // Paragraph ranges that need createParagraphBullets
  const headingRanges = []; // Paragraph ranges for updateParagraphStyle

  const pushText = (t) => {
    if (!t) t = "";
    req.push({ insertText: { location: { index: cursor }, text: t } });
    cursor += t.length;
  };

  // Apply inline spans to absolute paragraph ranges
  function styleFromSpans(parStart, spans) {
    for (const sp of spans || []) {
      const absStart = parStart + sp.offset;
      const absEnd = absStart + sp.len;
      const textStyle = {};
      if (sp.bold) textStyle.bold = true;
      if (sp.italic) textStyle.italic = true;
      if (Object.keys(textStyle).length) {
        styleOps.push({ range: { startIndex: absStart, endIndex: absEnd }, textStyle, fields: Object.keys(textStyle).join(",") });
      }
    }
  }

  for (const b of blocks) {
    if (b.type === "heading") {
      const parStart = cursor;
      pushText(b.text + "\n");
      headingRanges.push({ startIndex: parStart, endIndex: cursor, level: b.level });
      styleFromSpans(parStart, b.spans);
      continue;
    }
    if (b.type === "p") {
      const parStart = cursor;
      pushText(b.text + "\n");
      styleFromSpans(parStart, b.spans);
      continue;
    }
    if (b.type === "ul" || b.type === "ol") {
      const listStart = cursor;
      for (const it of b.items) {
        const parStart = cursor;
        pushText(it.text + "\n");
        styleFromSpans(parStart, it.spans);
      }
      const preset = (b.type === "ul") ? "BULLET_DISC_CIRCLE_SQUARE" : "NUMBERED_DECIMAL_ALPHA_ROMAN";
      bulletRanges.push({ startIndex: listStart, endIndex: cursor, preset });
      continue;
    }
  }

  // Apply paragraph styles (headings)
  for (const r of headingRanges) {
    const named = `HEADING_${Math.min(6, Math.max(1, r.level))}`;
    req.push({
      updateParagraphStyle: {
        range: { startIndex: r.startIndex, endIndex: r.endIndex },
        paragraphStyle: { namedStyleType: named },
        fields: "namedStyleType"
      }
    });
  }

  // Apply list bullets
  for (const r of bulletRanges) {
    req.push({
      createParagraphBullets: {
        range: { startIndex: r.startIndex, endIndex: r.endIndex },
        bulletPreset: r.preset
      }
    });
  }

  // Apply bold/italic text styles
  for (const s of styleOps) {
    req.push({ updateTextStyle: { range: s.range, textStyle: s.textStyle, fields: s.fields } });
  }

  const newLen = cursor - startIndex;
  return { requests: req, newLen };
}

// Normalize: remove spaces/punct/symbols, lowercase (language-agnostic)
function normKey(s) { return (s || "").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, ""); }

// Translated comment omitted (English only).
function lcsLen(a, b) {
  const m = a.length, n = b.length; const dp = Array(m + 1).fill().map(() => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  return dp[m][n];
}

function titleSimilar(a, b, thresh = 0.62) {
  const A = normKey(a), B = normKey(b);
  if (!A || !B) return false;
  const s = lcsLen(A, B) / Math.max(A.length, B.length);
  return s >= thresh;
}

// Pass 1: cluster similar headings to get canonical level per cluster (min level)
function clusterHeadingsAcrossPieces(mdPieces) {
  const clusters = []; // [{id, repTitle, levelMin, members:[{pieceIdx, idxInPiece, level, title, summary}]}]
  let cid = 0;
  mdPieces.forEach((md, pieceIdx) => {
    const hs = extractHeadingsLinear(md);
    hs.forEach((h, idxInPiece) => {
      let best = null, bestScore = 0;
      const key = normKey(h.title);
      // Translated comment omitted (English only).
      for (const c of clusters) {
        const ck = normKey(c.repTitle);
        const score = lcsLen(key, ck) / Math.max(key.length, ck.length);
        if (score > bestScore) { best = c; bestScore = score; }
      }
      if (!best || bestScore < 0.62) {
        clusters.push({ id: cid++, repTitle: h.title, levelMin: h.level, members: [{ pieceIdx, idxInPiece, ...h }] });
      } else {
        best.members.push({ pieceIdx, idxInPiece, ...h });
        best.levelMin = Math.min(best.levelMin, h.level);
      }
    });
  });
  // Sort members by original order (pieceIdx, idxInPiece)
  clusters.forEach(c => c.members.sort((a, b) => a.pieceIdx === b.pieceIdx ? a.idxInPiece - b.idxInPiece : a.pieceIdx - b.pieceIdx));
  return clusters;
}


// Pass 2: traverse in order, map to cluster canonical levels, rebuild unified tree
function rebuildUnifiedTree(mdPieces, clusters) {
  // Translated comment omitted (English only).
  const index = new Map();
  for (const c of clusters) {
    for (const m of c.members) index.set(`${m.pieceIdx}:${m.idxInPiece}`, c);
  }

  // Flatten all headings linearly (keep order)
  const seq = [];
  mdPieces.forEach((md, pieceIdx) => {
    const hs = extractHeadingsLinear(md);
    hs.forEach((h, idxInPiece) => {
      const c = index.get(`${pieceIdx}:${idxInPiece}`);
      seq.push({
        pieceIdx, idxInPiece,
        title: h.title,
        summary: h.summary,
        bullets: h.bullets,          // add this line
        canonLevel: c.levelMin,
        clusterId: c.id,
        repTitle: c.repTitle
      });
    });
  });


  // Build tree using canonical level; reuse node for the same cluster
  const root = { title: "ROOT", paras: [], children: [] };
  const stack = [root]; // Translated comment omitted (English only).
  const clusterToNode = new Map();

  for (const item of seq) {
    const L = Math.max(1, Math.min(6, item.canonLevel));
    while (stack.length > L) stack.pop();
    const parent = stack[stack.length - 1];

    let node = clusterToNode.get(item.clusterId);
    if (!node) {
      node = { title: item.repTitle, paras: [], children: [], sources: [] };
      parent.children.push(node);
      clusterToNode.set(item.clusterId, node);
    }

    // Insert full bullets; fallback to summary with normalization/dedupe
    const norm = s => (s || "").toLowerCase().replace(/\s+/g, " ").trim();
    const seen = new Set((node.paras || []).map(norm));

    if (Array.isArray(item.bullets) && item.bullets.length) {
      for (const b of item.bullets) {
        const nb = norm(b);
        if (!seen.has(nb)) { node.paras.push(b); seen.add(nb); }
      }
    } else if (item.summary) {
      const nb = norm(item.summary);
      if (!seen.has(nb)) node.paras.push(item.summary);
    }

    // Translated comment omitted (English only).
    stack[L] = node;
    stack.length = L + 1;
  }

  return root;
}

// Auto chunking (no headings required): accumulate by paragraphs with rolling context
// Translated comment omitted (English only).
function chunksAuto(fullText, maxChars = 3000, overlap = 400) {
  // Translated comment omitted (English only).
  const paras = fullText.replace(/\r\n?/g, "\n").split(/\n{2,}/);
  const chunks = [];
  let buf = [], size = 0;

  function push() {
    if (!buf.length) return;
    const text = buf.join("\n\n");
    chunks.push(text);
    buf = []; size = 0;
  }

  for (const p of paras) {
    const t = p.trim();
    if (!t) continue;
    const addLen = (buf.length ? 2 : 0) + t.length; // Translated comment omitted (English only).
    if (size + addLen > maxChars) push();
    buf.push(t); size += addLen;
  }
  push();

  // Prepare rolling context snippets for writer.write
  const withCtx = chunks.map((text, i) => {
    const prev = i > 0 ? chunks[i - 1] : "";
    const tail = prev ? prev.slice(Math.max(0, prev.length - overlap)) : "";
    return { text, context: tail };
  });

  return withCtx;
}



async function getGlobalRootTitle() {
  // 1) Try on-device Summarizer (lightweight & fast)
  try {
    if ("Summarizer" in self) {
      const availability = await Summarizer.availability();
      if (availability !== "unavailable") {
        const s = (typeof summarizer === "object" && summarizer)
          ? summarizer
          : await Summarizer.create({ type: "tldr", length: "short", format: "plain-text" });

        const title = await s.summarize(
          (fullPlainText || "").slice(0, 20000),
          { context: "Output a concise article title only (3–10 words). No periods, quotes, brackets, prefixes, or suffixes." }
        );
        const t = cleanTitle(title);
        if (t) return t;
      }
    }
  } catch (e) { console.warn("[headline] summarizer:", e); }

  // 2) Fallback to Writer
  try {
    ensureWriterSupported();
    const w = await createWriterSafe({ format: "plain-text", length: "short", tone: "neutral" });
    const prompt = [
      "Generate a neutral, academic, and concise title (3–10 words) for the following article.",
      "Return only the title, with no explanations and no trailing punctuation."
    ].join("\n");
    const t = await w.write(prompt, { context: (fullPlainText || "").slice(0, 20000) });
    w.destroy?.();
    return cleanTitle(t);
  } catch (e) { console.warn("[headline] writer:", e); }

  return "Untitled Document";
}


function cleanTitle(s) {
  return (s || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/^[“"'\(（《【\[]+|[”"'\)）》】\]]+$/g, "")
    .trim()
    .slice(0, 80) || "Untitled Document";
}

function normalizeMdPiece(md, rootTitle, isFirstPiece) {
  const lines = (md || "").split(/\r?\n/);
  const out = [];
  let h1Placed = false;

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*(#{1,6})\s+(.*)$/);
    if (!m) { out.push(lines[i]); continue; }

    let level = m[1].length;
    let text = m[2].trim();

    if (level === 1) {
      // Translated comment omitted (English only).
      if (H1_BLACKLIST.test(text)) continue;

      if (isFirstPiece && !h1Placed) {
        // Translated comment omitted (English only).
        out.push(`# ${rootTitle}`);
        h1Placed = true;
        continue;
      }
      // Translated comment omitted (English only).
      if (text.toLowerCase() === rootTitle.toLowerCase()) continue;
      level = 2;
    }
    out.push(`${"#".repeat(level)} ${text}`);
  }

  // Translated comment omitted (English only).
  if (isFirstPiece && !h1Placed) out.unshift(`# ${rootTitle}`);

  return out.join("\n");
}

// A) Split entire doc into highlightable paragraph sections (startIndex/endIndex + text)
function buildParagraphSections(docJson) {
  const root = { id: 0, title: "ROOT", level: 0, start: 1, end: null, children: [] };
  let nextId = 1;
  const content = docJson.body?.content || [];
  for (const el of content) {
    const p = el.paragraph;
    if (!p) continue;
    const s = el.startIndex, e = el.endIndex;
    if (s == null || e == null || e <= s) continue;
    const text = (p.elements || []).map(it => it.textRun?.content || "").join("").trim();
    if (!text) continue;
    root.children.push({
      id: nextId++,
      title: `Paragraph ${nextId - 1}`,
      level: 1,
      start: s,
      end: e,
      _plain: text,   // Translated comment omitted (English only).
      children: []
    });
  }
  return { root };
}

// B) Normalization and simple similarity (LCS ratio)
function _norm(s) { return (s || "").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, ""); }
function _lcsLen(a, b) {
  const m = a.length, n = b.length; const dp = Array(m + 1).fill().map(() => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  return dp[m][n];
}

// C) Generic mapping: prefer original header tree; otherwise match by paragraph content
function mapAiTreeToBestSections(aiRoot, docJson, originalSectionsMaybe) {
  // With headings: use title-similarity logic
  if (originalSectionsMaybe?.root?.children?.length) {
    return mapAiTreeToOriginal(aiRoot, originalSectionsMaybe.root);
  }

  // Without headings: match by paragraph
  const parSecs = buildParagraphSections(docJson).root.children;
  const parNorm = parSecs.map(s => ({ s, key: _norm(s._plain).slice(0, 2000) })); // truncate for speed
  const map = new Map();

  (function walk(node) {
    if (!node) return;
    const sample = [
      node.title || "",
      ...(node.paras || []).slice(0, 3)
    ].join(" ");
    const key = _norm(sample).slice(0, 800);
    if (key) {
      let best = null, bestScore = 0;
      for (const { s, key: ok } of parNorm) {
        if (!ok) continue;
        const L = _lcsLen(key, ok);
        const score = L / Math.max(16, Math.max(key.length, ok.length));
        if (score > bestScore) { best = s; bestScore = score; }
      }
      // Threshold tunable: 0.18 is lenient for short docs; too low risks mismatches
      if (best && bestScore >= 0.18) {
        map.set(node._id, { start: best.start, end: best.end, sectionId: best.id, score: bestScore });
      }
    }
    for (const c of (node.children || [])) walk(c);
  })(aiRoot);

  return map;
}

async function onAuthorizeClick() {
  // Only open/close the input panel
  connectPanel.classList.toggle("show");
  if (connectPanel.classList.contains("show")) {
    // Prefill current tab's docId
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const m = tab?.url?.match(/docs\.google\.com\/document\/d\/([^/]+)/);
      if (m) docInput.value = m[1];
    } catch { }
    setStatus("Enter docId/URL and click Connect.");
  } else {
    setStatus("Ready");
  }
}

async function connectDoc() {
  const raw = docInput.value.trim();
  const docId = extractDocId(raw);
  if (!docId) return setStatus("Invalid docId/URL.");
  try {
    setStatus("Authorizing…");
    // Actually trigger OAuth
    accessToken = await getAccessTokenInteractive();
    setStatus("Connecting…");
    await fetchDoc(docId);              // Lightweight access check
    setStatus("Connected ✓");
    connectPanel.classList.remove("show");
  } catch (e) {
    console.error(e);
    setStatus("Connect failed: " + e.message);
  }
}

/* ===== Selection API (single source of truth) ===== */

function updateSelInfo() {
  if (!window.graphHint) return;
  const base = "Click: select · Ctrl/⌘+Click: multi-select · Double-click: focus · Drag anywhere to pan · Ctrl/⌘+Wheel to zoom";
  const n = window.selectedIds?.size || 0;
  window.graphHint.textContent = n ? `${n} selected · ${base}` : base;
}

function getAncestors(id) {
  const out = [];
  let cur = window.parentMap?.get(id);
  while (cur != null) { out.push(cur); cur = window.parentMap?.get(cur); }
  return out;
}
function getDescendants(id) {
  const out = [];
  (function walk(x) {
    const node = window.treeMap?.get(x);
    if (!node) return;
    for (const c of (node.children || [])) { out.push(c._id); walk(c._id); }
  })(id);
  return out;
}

function selectSingle(id, el) {
  try {
    document.querySelectorAll(".node.sel").forEach(d => d.classList.remove("sel"));
    window.selectedIds.clear();
    window.selectedIds.add(id);
    el?.classList.add("sel");
    updateSelInfo();
    window.refreshHighlights?.().catch(err => window.setStatus?.("Highlight failed: " + err.message));
    window.prewarmSummarizerOnClick?.();
    window.scheduleSummarize?.();
  } catch (e) {
    console.error("[selectSingle]", e);
    window.setStatus?.("selectSingle error: " + e.message);
  }
}

function toggleSelectMutuallyExclusive(id, el) {
  try {
    const sel = window.selectedIds;
    if (sel.has(id)) {
      sel.delete(id);
      el?.classList.remove("sel");
    } else {
      const toRemove = new Set([...getAncestors(id), ...getDescendants(id)]);
      for (const rid of toRemove) {
        if (sel.delete(rid)) document.querySelector(`.node[data-id="${rid}"]`)?.classList.remove("sel");
      }
      sel.add(id);
      el?.classList.add("sel");
    }
    updateSelInfo();
    window.refreshHighlights?.().catch(err => window.setStatus?.("Highlight failed: " + err.message));
    window.prewarmSummarizerOnClick?.();
    window.scheduleSummarize?.();
  } catch (e) {
    console.error("[toggleSelectMutuallyExclusive]", e);
    window.setStatus?.("toggleSelect error: " + e.message);
  }
}