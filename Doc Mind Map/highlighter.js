/*
  DocsHighlighter — minimal, robust Google Docs highlighter
  - No side effects beyond backgroundColor styling
  - Merges overlapping ranges; chunks batchUpdate calls
  - Keeps last-applied ranges so you can clear() without recomputing
  - Pluggable token provider: new DocsHighlighter({ getAccessToken: () => accessToken })

  Usage in sidepanel.js:

    const highlighter = new DocsHighlighter({ getAccessToken: () => accessToken });

    async function refreshHighlights() {
      const raw = docInput.value.trim();
      const docId = extractDocId(raw);
      if (!docId) return;
      const ranges = [];
      for (const id of selectedIds) {
        const m = aiToOrigMap.get(id);
        if (m?.start != null && m?.end != null && m.end > m.start) {
          ranges.push({ start: m.start, end: m.end });
        }
      }
      await highlighter.apply(docId, ranges, { color: { r: 1, g: 1, b: 0.6 } });
    }

  Optional Named Range helpers (A→C):
   - createNamedRanges(docId, ranges, { namePrefix })
   - listNamedRangesByPrefix(docId, namePrefix)
   - deleteNamedRangesByPrefix(docId, namePrefix)
*/

(function (global) {
  class DocsHighlighter {
    constructor(opts = {}) {
      this.getAccessToken = opts.getAccessToken || (() => opts.accessToken);
      // 绑定到 window/globalThis，避免非法调用；也允许外部自定义 fetch
      this._fetch = (input, init) =>
      (opts.fetch ? opts.fetch(input, init)
        : (globalThis.fetch ? globalThis.fetch(input, init)
          : window.fetch(input, init)));
      this.chunkSize = opts.chunkSize || 90; // safe chunking for batchUpdate
      this.lastApplied = { docId: null, ranges: [] };
    }

    /**
     * Apply highlight to given intervals.
     * @param {string} docId
     * @param {{start:number,end:number}[]} intervals
     * @param {{color?:{r?:number,g?:number,b?:number}, replace?:boolean}} options
     */
    async apply(docId, intervals, options = {}) {
      const merged = this.#normalize(intervals);
      const replace = options.replace !== false;
      if (replace && this.lastApplied.docId === docId && this.lastApplied.ranges.length) {
        await this.clear(docId).catch(() => { });
      }
      if (!merged.length) return; // nothing to do
      const rgb = this.#rgb(options.color || { r: 1, g: 1, b: 0.6 });
      const requests = merged.map((r) => ({
        updateTextStyle: {
          range: { startIndex: r.start, endIndex: r.end },
          textStyle: { backgroundColor: { color: { rgbColor: rgb } } },
          fields: "backgroundColor",
        },
      }));
      await this.#batchUpdate(docId, requests);
      this.lastApplied = { docId, ranges: merged };
    }

    /**
     * Clear highlights for previously applied ranges, or for given intervals.
     */
    async clear(docId, intervals = null) {
      const toClear = intervals ? this.#normalize(intervals) : this.lastApplied.docId === docId ? this.lastApplied.ranges : [];
      if (!toClear || !toClear.length) return;
      const requests = toClear.map((r) => ({
        updateTextStyle: {
          range: { startIndex: r.start, endIndex: r.end },
          textStyle: { backgroundColor: {} },
          fields: "backgroundColor",
        },
      }));
      await this.#batchUpdate(docId, requests);
      if (!intervals) this.lastApplied = { docId: null, ranges: [] };
    }

    // ---------- NamedRange helpers (optional) ----------

    /**
     * Create named ranges for intervals. Names will be `${namePrefix}:${i}:${Date.now()}`
     * Return array of { name, namedRangeId }
     */
    async createNamedRanges(docId, intervals, { namePrefix = "SD-HI" } = {}) {
      const merged = this.#normalize(intervals);
      if (!merged.length) return [];
      const now = Date.now();
      const requests = merged.map((r, i) => ({
        createNamedRange: {
          name: `${namePrefix}:${i}:${now}`,
          range: { startIndex: r.start, endIndex: r.end },
        },
      }));
      const res = await this.#rawBatchUpdate(docId, requests);
      const out = [];
      for (const r of res?.replies || []) {
        const nr = r?.createNamedRange?.namedRangeId;
        const name = r?.createNamedRange?.name; // echoed
        if (nr && name) out.push({ name, namedRangeId: nr });
      }
      return out;
    }

    async listNamedRangesByPrefix(docId, namePrefix = "SD-HI") {
      const token = await this.#token();
      const res = await this._fetch(`https://docs.googleapis.com/v1/documents/${docId}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Docs get ${res.status}: ${await res.text().catch(() => res.statusText)}`);
      const doc = await res.json();
      const all = Object.values(doc.namedRanges || {});
      const list = [];
      for (const arr of all) {
        for (const item of arr.namedRanges || arr) {
          if (!item.name || !item.name.startsWith(namePrefix + ":")) continue;
          list.push({ name: item.name, namedRangeId: item.nameRangeId || item.namedRangeId || item.namedRangeId, ranges: item.ranges });
        }
      }
      return list;
    }

    async deleteNamedRangesByPrefix(docId, namePrefix = "SD-HI") {
      const list = await this.listNamedRangesByPrefix(docId, namePrefix);
      if (!list.length) return 0;
      const requests = list.map((x) => ({ deleteNamedRange: { namedRangeId: x.namedRangeId || x.nameRangeId || x.name } }));
      await this.#batchUpdate(docId, requests);
      return list.length;
    }

    // ---------- internals ----------

    async #batchUpdate(docId, requests) {
      // chunk to avoid request size limits
      for (let i = 0; i < requests.length; i += this.chunkSize) {
        const chunk = requests.slice(i, i + this.chunkSize);
        const res = await this.#rawBatchUpdate(docId, chunk);
        if (!res) throw new Error("Unknown Docs API error");
      }
    }

    async #rawBatchUpdate(docId, requests) {
      const token = await this.#token();
      const res = await this._fetch(`https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ requests }),
      });
      if (!res.ok) throw new Error(`Docs batchUpdate ${res.status}: ${await res.text().catch(() => res.statusText)}`);
      return res.json().catch(() => ({}));
    }

    async #token() {
      const t = await (typeof this.getAccessToken === "function" ? this.getAccessToken() : this.getAccessToken);
      if (!t) throw new Error("No access token");
      return t;
    }

    #normalize(intervals) {
      const valid = [];
      for (const r of intervals || []) {
        if (!r) continue;
        const s = Math.max(1, Number(r.start));
        const e = Math.max(1, Number(r.end));
        if (Number.isFinite(s) && Number.isFinite(e) && e > s) valid.push({ start: s, end: e });
      }
      valid.sort((a, b) => a.start - b.start);
      const merged = [];
      for (const r of valid) {
        const last = merged[merged.length - 1];
        if (!last || r.start > last.end) merged.push({ ...r });
        else last.end = Math.max(last.end, r.end);
      }
      return merged;
    }

    #rgb(c) {
      const clamp = (v) => Math.max(0, Math.min(1, Number(v)));
      return {
        red: clamp(c.r ?? c.red ?? 1),
        green: clamp(c.g ?? c.green ?? 1),
        blue: clamp(c.b ?? c.blue ?? 0),
      };
    }
  }

  global.DocsHighlighter = DocsHighlighter;
})(window);
