// ===== 修复：先定义 setStatus，且挂到 window =====
const statusEl = document.getElementById("status");
function setStatus(s){ if(statusEl) statusEl.textContent = s; console.log("[StructDoc]", s); }
window.setStatus = setStatus;

// ===== 绑定 UI =====
const docInput  = document.getElementById("docIdInput");
document.getElementById("btn-auth").onclick    = auth;
document.getElementById("btn-outline").onclick = aiOutline;
document.getElementById("btn-export").onclick  = exportToDoc;

// ===== 状态 =====
let accessToken = null;
let lastMarkdown = "";
let lastTree = null;

init();

// ===== 初始化：尝试自动抓 docId =====
async function init() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const m = tab?.url?.match(/docs\.google\.com\/document\/d\/([^/]+)/);
    if (m) docInput.value = m[1];
  } catch {}
  setStatus("就绪");
}

// ===== 授权（auth.js 提供 getAccessTokenInteractive）=====
async function auth() {
  setStatus("请求授权…");
  accessToken = await getAccessTokenInteractive();
  setStatus("授权成功");
}

// ===== 用内置 AI（Writer）重排大纲 -> 渲染思维导图 =====
async function aiOutline() {
  try {
    if (!accessToken) return setStatus("未授权，先点“授权”");
    const raw = docInput.value.trim();
    const docId = extractDocId(raw);
    if (!docId) return setStatus("无效的 docId/URL");

    setStatus("拉取文档…");
    const doc = await fetchDoc(docId);
    const plain = extractPlainText(doc);

    setStatus("AI 生成结构化大纲…");
    lastMarkdown = await buildAIOutline(plain);
    lastTree = parseMarkdownOutline(lastMarkdown);
    const graph = treeToGraph(lastTree);
    renderGraph(graph);
    setStatus("完成");
  } catch (e) {
    console.error(e);
    setStatus("出错：" + e.message);
  }
}

// ===== 工具函数（保持你现有版本）=====
function extractDocId(s) {
  const m = s.match(/docs\.google\.com\/document\/d\/([^/]+)/);
  if (m) return m[1];
  return /^[a-zA-Z0-9_-]+$/.test(s) ? s : null;
}
async function fetchDoc(docId) {
  const res = await fetch(`https://docs.googleapis.com/v1/documents/${docId}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) throw new Error(`Docs API ${res.status}: ${(await res.text().catch(()=>res.statusText))}`);
  return res.json();
}
function extractPlainText(docJson) {
  const out = [];
  for (const el of docJson.body?.content || []) {
    const p = el.paragraph;
    if (!p) continue;
    const style = p.paragraphStyle?.namedStyleType || "NORMAL_TEXT";
    const text = (p.elements || []).map(e => e.textRun?.content || "").join("").replace(/\s+$/g,"");
    if (!text) continue;
    const m = style.match(/^HEADING_([1-6])$/);
    out.push(m ? `${"#".repeat(Number(m[1]))} ${text}` : text);
  }
  return out.join("\n");
}

// —— Writer API ——（保持你集成的版本）
async function buildAIOutline(plainText) {
  if (!('Writer' in self)) throw new Error("此浏览器不支持 Writer API（请启用 Origin Trial / flags）");
  const writer = await Writer.create({
    format: "markdown",
    length: "medium",
    tone: "neutral",
    sharedContext:
      "你是资深技术写作/结构化编辑助手。目标是把杂乱文稿重排为层次清晰的大纲与简明要点。"
  });
  const prompt = [
    "将以下文章按逻辑关系重新分块与分层，输出为 Markdown 大纲：",
    "1) 使用 #~###### 明确 level；",
    "2) 每个标题下给出简短要点（- 列表）；",
    "3) 可合并/拆分段落；",
    "4) 若结构不清晰，按“主题→论据/细节→结论”的通用范式重排；",
    "5) 仅输出 Markdown。",
  ].join("\n");
  const md = await writer.write(prompt, { context: plainText });
  writer.destroy?.();
  return md;
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
      const level = h[1].length; const title = h[2].trim();
      while (stack.length && stack[stack.length-1].level >= level) stack.pop();
      const parent = stack[stack.length-1].node;
      const node = { title, children: [], paras: [] };
      parent.children.push(node);
      stack.push({ level, node });
      lastNode = node; continue;
    }
    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    (lastNode.paras ||= []).push((bullet ? bullet[1] : line.trim()));
  }
  return root;
}
function treeToGraph(tree) {
  const nodes=[], links=[]; let id=0;
  (function walk(n,p=null){const me=id++;nodes.push({id:me,title:n.title,paras:n.paras||[]});
    if(p!==null) links.push({source:p,target:me}); for(const c of n.children||[]) walk(c,me);
  })(tree,null);
  return { nodes, links };
}
function renderGraph(graph) {
  const container = document.getElementById('graph'); container.innerHTML = "";
  const level=new Map(), children=new Map();
  for(const n of graph.nodes) children.set(n.id, []);
  for(const e of graph.links) children.get(e.source).push(e.target);
  const pointed=new Set(graph.links.map(e=>e.target));
  const roots=graph.nodes.filter(n=>!pointed.has(n.id));
  const root=roots[0]||graph.nodes[0];
  const q=[{id:root.id,d:0}]; level.set(root.id,0);
  while(q.length){const {id,d}=q.shift();for(const t of children.get(id)) if(!level.has(t)){level.set(t,d+1);q.push({id:t,d:d+1});}}
  const colY=new Map(), pos=new Map(); function nextY(l){const y=colY.get(l)||12;colY.set(l,y+90);return y;}
  for(const n of graph.nodes){const lv=level.get(n.id)??0;const x=16+lv*240;const y=nextY(lv);
    pos.set(n.id,{x,y}); const el=document.createElement("div"); el.className="node"; el.style.left=x+"px"; el.style.top=y+"px";
    el.innerHTML=`<div><strong>${esc(n.title)}</strong></div>`+(n.paras?.length?`<div class="small">${esc(n.paras[0]).slice(0,80)}</div>`:"");
    container.appendChild(el);}
  for(const e of graph.links){const a=pos.get(e.source), b=pos.get(e.target); drawLink(a.x+110,a.y+28,b.x,b.y+28);}
  function drawLink(x1,y1,x2,y2){const midX=x1+Math.max(16,(x2-x1)/2); seg(x1,y1,midX,y1); seg(midX,y1,midX,y2); seg(midX,y2,x2,y2);}
  function seg(x1,y1,x2,y2){const l=document.createElement("div"); l.className="link";
    if(y1===y2){const left=Math.min(x1,x2); l.style.left=left+"px"; l.style.top=y1+"px"; l.style.width=Math.abs(x2-x1)+"px"; l.style.height="1px";}
    else{const top=Math.min(y1,y2); l.style.left=x1+"px"; l.style.top=top+"px"; l.style.width="1px"; l.style.height=Math.abs(y2-y1)+"px";}
    container.appendChild(l);}
  function esc(s){return s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
}

// ===== 可选：导出到同一文档的新分页（需要写权限 scope）=====
async function exportToDoc() {
  try {
    if (!accessToken) return setStatus("未授权");
    const raw = docInput.value.trim();
    const docId = extractDocId(raw); if (!docId) return setStatus("无效的 docId/URL");
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
    if (!res.ok) throw new Error(`batchUpdate ${res.status}: ${(await res.text().catch(()=>res.statusText))}`);
    setStatus("导出完成（已添加到文末分页）");
  } catch (e) {
    console.error(e);
    setStatus("导出失败：" + e.message);
  }
}
