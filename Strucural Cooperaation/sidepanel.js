// 统一放在文件顶部，供全局复用
function escapeHTML(s) {
  return (s ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",   // ✅ 正确的键：">"
    '"': "&quot;",
    "'": "&#39;"
  })[ch]);
}

const esc = escapeHTML;

// ===== 状态显示 =====
const statusEl = document.getElementById("status");
function setStatus(s) { if (statusEl) statusEl.textContent = s; console.log("[StructDoc]", s); }
window.setStatus = setStatus;

// ===== UI 绑定 =====
const docInput = document.getElementById("docIdInput");
document.getElementById("btn-auth").onclick = auth;
document.getElementById("btn-outline").onclick = aiOutline;
document.getElementById("btn-export").onclick = exportToDoc;
document.getElementById("btn-root").onclick = focusRoot;   // 仅保留“根”

// 聊天 UI
const chatOut = document.getElementById("chatOut");
const chatInput = document.getElementById("chatInput");
const chatSend = document.getElementById("chatSend");
const chatClear = document.getElementById("chatClear");
const selInfo = document.getElementById("selInfo");
chatSend.onclick = onChatSend;
chatClear.onclick = () => { chatOut.innerHTML = ""; };
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onChatSend(); }
});

// ===== 全局状态 =====
let accessToken = null;
let lastMarkdown = "";
let lastTree = null;

// 树索引/聚焦
let treeMap = null;     // id -> node
let parentMap = null;   // id -> parentId
let rootId = null;
let focusId = null;

// 选择集（Ctrl/⌘ + 点击多选）
const selectedIds = new Set();

// 阈值：当“某子节点的孙子数”> 该值，就折叠为徽标
const GRANDCHILDREN_THRESHOLD = 8;

// Writer（大纲用一次性，聊天持久化）
let chatWriter = null;        // Writer 实例（sharedContext = 全文）
let fullPlainText = "";       // 整篇纯文本（供 sharedContext）

// ===== 初始化 =====
init();
async function init() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const m = tab?.url?.match(/docs\.google\.com\/document\/d\/([^/]+)/);
    if (m) docInput.value = m[1];
  } catch { }
  setStatus("就绪");
}

// ===== 授权（Web App 模式）=====
async function auth() {
  setStatus("请求授权…");
  accessToken = await getAccessTokenInteractive();
  setStatus("授权成功");
}

// ===== 主流程：拉文档 → Writer 结构化 → 解析 → 父分支视图 =====
async function aiOutline() {
  try {
    if (!accessToken) return setStatus("未授权，先点“授权”");
    const raw = docInput.value.trim();
    const docId = extractDocId(raw);
    if (!docId) return setStatus("无效的 docId/URL");

    setStatus("拉取文档…");
    const doc = await fetchDoc(docId);
    fullPlainText = extractPlainText(doc); // 给 chatWriter 的 sharedContext
    setStatus("AI 生成结构化大纲…(首次可能会下载模型)");

    // === 用 Writer 生成大纲（一次性实例）===
    {
      ensureWriterSupported();
      const writer = await Writer.create({
        format: "markdown",
        length: "medium",
        tone: "neutral",
        sharedContext:
          "你是资深结构化写作助手，请将杂乱文稿重排为层次分明的大纲，便于读者建立全局认知。"
      });
      const prompt = [
        "将以下文章按逻辑关系重新分块与分层，输出为 Markdown 大纲：",
        "要求：",
        "1) 使用 #..###### 明确层级（H1..H6）；",
        "2) 每个标题下给出简短要点（- 列表），可合并/拆分段落；",
        "3) 若原文结构混乱，按“主题→论据/细节→结论/TODO”的范式重排；",
        "4) 仅输出 Markdown，不要额外说明。"
      ].join("\n");
      lastMarkdown = await writer.write(prompt, { context: fullPlainText });
      writer.destroy?.();
    }

    // 解析树并建立索引
    lastTree = parseMarkdownOutline(lastMarkdown);
    ({ map: treeMap, parentMap, rootId } = indexTree(lastTree));
    focusId = rootId;
    selectedIds.clear();
    updateSelInfo();

    // === 准备聊天 Writer（持久用，sharedContext=全文）===
    chatWriter?.destroy?.();
    chatWriter = await Writer.create({
      format: "plain-text",
      length: "medium",
      tone: "neutral",
      // 整篇文档放在 sharedContext（你提的方案）
      sharedContext: fullPlainText
    });

    renderParentSubtree(focusId);
    setStatus("完成");
  } catch (e) {
    console.error(e);
    setStatus("出错：" + e.message);
  }
}

// ====== 工具：提取 docId ======
function extractDocId(s) {
  const m = s.match(/docs\.google\.com\/document\/d\/([^/]+)/);
  if (m) return m[1];
  return /^[a-zA-Z0-9_-]+$/.test(s) ? s : null;
}

// ====== Docs API ======
async function fetchDoc(docId) {
  const res = await fetch(`https://docs.googleapis.com/v1/documents/${docId}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) throw new Error(`Docs API ${res.status}: ${(await res.text().catch(() => res.statusText))}`);
  return res.json();
}

// 将 Docs JSON 拼成近似原文的纯文本（保留标题提示）
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

// ====== Writer API 支持性检查 ======
function ensureWriterSupported() {
  if (!('Writer' in self)) {
    throw new Error("此浏览器未启用 Writer API（请配置 Origin Trial 或启用对应 flag）");
  }
}

// ====== Markdown(#..###### + 列表) → 树 ======
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

// ====== 为树打 id & parent 索引 ======
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

// ====== 回到根层（root 分支；root 不显示） ======
function focusRoot() {
  if (rootId == null) return;
  focusId = rootId;
  renderParentSubtree(focusId);
}

// ====== 渲染“父分支视图”（点击任意节点 → 切到其父分支） ======
function renderParentSubtree(centerId) {
  const container = document.getElementById('graph');
  container.innerHTML = "";
  if (!treeMap || !treeMap.has(centerId)) return;

  const center = treeMap.get(centerId);
  const isRoot = (centerId === rootId);

  // 布局参数
  const COL_W = 240;
  const NODE_W = 220, NODE_H = 64, V_GAP = 18;
  const LEFT_PADDING = 16;

  // 收集要画的节点/连线
  const nodesToDraw = []; // {id,title,paras,depth,badge?,role?}
  const linksToDraw = []; // {from,to}

  // 深度遍历：把某节点及其全部后代加入（从给定 depth 开始），并连线到 parentDrawnId
  function traverseFull(node, depth, parentDrawnId) {
    nodesToDraw.push({ id: node._id, title: node.title, paras: node.paras || [], depth });
    if (parentDrawnId != null) linksToDraw.push({ from: parentDrawnId, to: node._id });
    for (const c of node.children || []) traverseFull(c, depth + 1, node._id);
  }

  if (isRoot) {
    // root 不显示自身；第一列为 root 的孩子（depth=0）
    for (const child of center.children || []) {
      const grandchildrenCount = (child.children || []).length;
      const willCollapse = grandchildrenCount > GRANDCHILDREN_THRESHOLD;
      nodesToDraw.push({ id: child._id, title: child.title, paras: child.paras || [], depth: 0, badge: willCollapse ? `${grandchildrenCount} 个孙节点 · 点击查看父分支` : null });
      // root->第一层不画连线
      if (!willCollapse) {
        for (const gc of (child.children || [])) {
          traverseFull(gc, 1, child._id);
        }
      }
    }
  } else {
    // 画 center 自身（父分支根）
    nodesToDraw.push({ id: center._id, title: center.title, paras: center.paras || [], depth: 0, role: "parent" });
    for (const child of center.children || []) {
      const grandchildrenCount = (child.children || []).length;
      const willCollapse = grandchildrenCount > GRANDCHILDREN_THRESHOLD;
      nodesToDraw.push({ id: child._id, title: child.title, paras: child.paras || [], depth: 1, badge: willCollapse ? `${grandchildrenCount} 个孙节点 · 点击查看父分支` : null });
      linksToDraw.push({ from: center._id, to: child._id });
      if (!willCollapse) {
        for (const gc of (child.children || [])) {
          traverseFull(gc, 2, child._id);
        }
      }
    }
  }

  // —— 布局：按 depth 分列堆叠 ——
  const colY = new Map(); // depth -> nextY
  const pos = new Map(); // id -> {x,y}
  nodesToDraw.sort((a, b) => a.depth - b.depth);

  for (const n of nodesToDraw) {
    const x = LEFT_PADDING + n.depth * COL_W;
    const y = (colY.get(n.depth) || 12);
    colY.set(n.depth, y + NODE_H + V_GAP);

    pos.set(n.id, { x, y });

    const el = document.createElement("div");
    el.className = "node";
    el.style.left = x + "px";
    el.style.top = y + "px";
    if (n.role === "parent") el.style.borderColor = "#888";
    if (selectedIds.has(n.id)) el.classList.add("sel");
    el.innerHTML = `<div><strong>${esc(n.title)}</strong></div>` +
      (n.paras?.length ? `<div class="small">${esc(n.paras[0]).slice(0, 80)}</div>` : "");

    // —— 点击交互：
    // 1) Ctrl/⌘ + 点击：切换“选中”状态（多选），不触发导航
    // 2) 普通点击：切到“该节点的父分支视图”
    el.style.cursor = "pointer";
    el.addEventListener("click", (ev) => {
      if (ev.ctrlKey || ev.metaKey) {
        ev.stopPropagation();
        toggleSelect(n.id, el);
        return;
      }
      ev.stopPropagation();
      const p = parentMap.get(n.id);
      focusId = (p != null ? p : rootId);
      renderParentSubtree(focusId);
    });

    // 徽标：孙子过多时提示（点击同样切到父分支视图）
    if (n.badge) {
      const badge = document.createElement("div");
      badge.className = "badge";
      badge.textContent = n.badge;
      badge.title = "点击查看该节点的父分支";
      badge.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const p = parentMap.get(n.id);
        focusId = (p != null ? p : rootId);
        renderParentSubtree(focusId);
      });
      el.appendChild(badge);
    }

    container.appendChild(el);
  }

  // —— 画连线（root->第一层不画；其余 parent->child 画） ——
  for (const e of linksToDraw) {
    const a = pos.get(e.from);
    const b = pos.get(e.to);
    if (!a || !b) continue;
    drawLink(container, a.x + NODE_W, a.y + 28, b.x, b.y + 28);
  }

  function drawLink(container, x1, y1, x2, y2) {
    const midX = x1 + Math.max(16, (x2 - x1) / 2);
    seg(x1, y1, midX, y1);
    seg(midX, y1, midX, y2);
    seg(midX, y2, x2, y2);
    function seg(x1, y1, x2, y2) {
      const l = document.createElement("div"); l.className = "link";
      if (y1 === y2) { const left = Math.min(x1, x2); l.style.left = left + "px"; l.style.top = y1 + "px"; l.style.width = Math.abs(x2 - x1) + "px"; l.style.height = "1px"; }
      else { const top = Math.min(y1, y2); l.style.left = x1 + "px"; l.style.top = top + "px"; l.style.width = "1px"; l.style.height = Math.abs(y2 - y1) + "px"; }
      container.appendChild(l);
    }
  }
}

// —— 选中节点切换 & 选择状态显示 —— 
function toggleSelect(id, el) {
  if (selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id);
  el.classList.toggle("sel");
  updateSelInfo();
}
function updateSelInfo() {
  if (selectedIds.size === 0) selInfo.textContent = "未选择节点（Ctrl/⌘ + 单击可多选）";
  else selInfo.textContent = `已选 ${selectedIds.size} 个节点`;
}

// ====== 聊天：构造 Prompt（优化版 for Gemini Nano）并调用 Writer ======
async function onChatSend() {
  try {
    const q = chatInput.value.trim();
    if (!q) return;
    ensureWriterSupported();
    if (!chatWriter) {
      setStatus("未初始化 AI 对话，请先点击“AI 结构化”");
      return;
    }

    // 采集目标（所选节点标题）与聚焦片段（所选节点子树文本）
    const targets = Array.from(selectedIds).map(id => treeMap.get(id)?.title).filter(Boolean);
    const focusText = buildFocusContext(Array.from(selectedIds));

    // 构造优化 Prompt（目标+指令），见 buildChatPrompt
    const prompt = buildChatPrompt(targets, q);

    // 展示用户消息
    appendMsg("user", q, targets);

    // 发送到 Writer：sharedContext=全文（已在 chatWriter.create 时注入），本次 context 传入精选片段
    setStatus("思考中…");
    const answer = await chatWriter.write(prompt, { context: focusText || undefined });
    setStatus("完成");
    appendMsg("ai", answer);
    chatInput.value = "";
  } catch (e) {
    console.error(e);
    setStatus("出错：" + e.message);
  }
}

// —— 针对 Gemini Nano 的 Prompt 模板（精简可控，降低幻觉）——
function buildChatPrompt(targets, userInput) {
  const goals = (targets && targets.length) ? targets.map(t => `【${t}】`).join("、") : "【整篇文档】";
  return [
    "你是严谨的技术编辑与审稿助手，回答必须以文档内容为依据。",
    `目标：${goals}`,
    `指令：${userInput}`,
    "",
    "要求：",
    "1) **仅基于文档**作答；不确定之处说明“不确定”并指出缺失信息；",
    "2) 优先围绕“目标”对应部分回答；涉及多处时给出标题路径，例如：A > B > C；",
    "3) 输出格式：",
    "   - **结论**：1–3 条要点；",
    "   - **依据**：对应文段/标题（简要概括，不要长引文）；",
    "   - **建议/后续**（可选）：可执行的下一步；",
    "4) 语言：简体中文，简洁、准确。",
  ].join("\n");
}

// —— 为选择的节点构建“本次上下文”文本（其子树标题+要点）——
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

// ====== 导出到同一文档的新分页（需要 documents 写权限） ======
async function exportToDoc() {
  try {
    if (!accessToken) return setStatus("未授权");
    const raw = docInput.value.trim();
    const docId = extractDocId(raw);
    if (!docId) return setStatus("无效的 docId/URL");
    if (!lastMarkdown) return setStatus("当前没有可导出的 AI 结果");
    setStatus("导出到新分页…");

    const requests = [
      { insertPageBreak: { endOfSegmentLocation: {} } },
      { insertText: { endOfSegmentLocation: {}, text: "\n## AI 重排大纲（Markdown）\n\n" + lastMarkdown + "\n" } }
    ];
    const res = await fetch(`https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ requests })
    });
    if (!res.ok) throw new Error(`batchUpdate ${res.status}: ${(await res.text().catch(() => res.statusText))}`);
    setStatus("导出完成（已添加到文末分页）");
  } catch (e) {
    console.error(e);
    setStatus("导出失败：" + e.message);
  }
}

// ====== 辅助：追加聊天消息到 UI ======
function appendMsg(role, text, targets = []) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  if (role === "user" && targets?.length) {
    div.innerHTML = `<strong>你</strong><small> 目标：${targets.join(" / ")}</small><br>${escapeHTML(text)}`;
  } else if (role === "user") {
    div.innerHTML = `<strong>你</strong><br>${escapeHTML(text)}`;
  } else {
    div.innerHTML = `<strong>AI</strong><br>${escapeHTML(text)}`;
  }
  chatOut.appendChild(div);
  chatOut.scrollTop = chatOut.scrollHeight;
}

