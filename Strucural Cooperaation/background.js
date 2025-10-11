// ====== 配置 ======
const OAUTH = {
  CLIENT_ID: "REPLACE_WITH_YOUR_INSTALLED_APP_CLIENT_ID.apps.googleusercontent.com",
  AUTH_ENDPOINT: "https://accounts.google.com/o/oauth2/v2/auth",
  TOKEN_ENDPOINT: "https://oauth2.googleapis.com/token",
  SCOPES: [
    "https://www.googleapis.com/auth/documents.readonly"
  ]
};

// ====== PKCE 工具 ======
async function sha256base64url(str) {
  const enc = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  const bytes = new Uint8Array(buf);
  let s = "";
  bytes.forEach(b => s += String.fromCharCode(b));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function randomString(len = 64) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => ("0" + b.toString(16)).slice(-2)).join("");
}

// ====== OAuth 主流程（PKCE） ======
async function getAccessTokenInteractive() {
  // 1) 生成 PKCE
  const code_verifier = randomString(64);
  const code_challenge = await sha256base64url(code_verifier);

  // 2) 构造 auth URL
  const redirectUri = chrome.identity.getRedirectURL(); // https://<extid>.chromiumapp.org/
  const params = new URLSearchParams({
    client_id: OAUTH.CLIENT_ID,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: OAUTH.SCOPES.join(" "),
    code_challenge: code_challenge,
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true"
  });
  const authUrl = `${OAUTH.AUTH_ENDPOINT}?${params.toString()}`;

  // 3) 打开授权
  const redirectResponse = await new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(
      { url: authUrl, interactive: true },
      responseUrl => {
        if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
        resolve(responseUrl);
      }
    );
  });

  // 4) 从重定向 URL 取 code
  const url = new URL(redirectResponse);
  const code = url.searchParams.get("code");
  if (!code) throw new Error("Auth code missing");

  // 5) 交换 token（PKCE 不需要 client_secret）
  const body = new URLSearchParams({
    client_id: OAUTH.CLIENT_ID,
    code,
    code_verifier,
    redirect_uri: redirectUri,
    grant_type: "authorization_code"
  });

  const tokenRes = await fetch(OAUTH.TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const tokenJson = await tokenRes.json();
  if (!tokenRes.ok) {
    throw new Error(`Token error: ${tokenRes.status} ${JSON.stringify(tokenJson)}`);
  }
  // { access_token, expires_in, refresh_token? ... }
  // 注意：某些组合不会返回 refresh_token；后续可用 silent auth 刷新或重走一遍。
  return tokenJson.access_token;
}

// ====== Docs API ======
async function fetchDoc(docId, accessToken) {
  const res = await fetch(`https://docs.googleapis.com/v1/documents/${docId}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) {
    const t = await res.text().catch(()=>"");
    throw new Error(`Docs API ${res.status}: ${t || res.statusText}`);
  }
  return res.json();
}

// 将文档段落解析为标题树（HEADING_1..6）
function docToTree(docJson) {
  const blocks = [];
  for (const el of docJson.body?.content || []) {
    const p = el.paragraph;
    if (!p) continue;
    const style = p.paragraphStyle?.namedStyleType || "NORMAL_TEXT";
    const text = (p.elements || []).map(e => e.textRun?.content || "").join("").replace(/\s+$/g, "");
    if (!text) continue;
    const m = style.match(/^HEADING_([1-6])$/);
    blocks.push({ type: m ? "HEADING" : "PARA", level: m ? Number(m[1]) : null, text });
  }

  const root = { title: "ROOT", children: [] };
  const stack = [{ level: 0, node: root }];

  for (const b of blocks) {
    if (b.type === "HEADING") {
      while (stack.length && stack[stack.length - 1].level >= b.level) stack.pop();
      const parent = stack[stack.length - 1].node;
      const node = { title: b.text, children: [], paras: [] };
      parent.children.push(node);
      stack.push({ level: b.level, node });
    } else {
      const parent = stack[stack.length - 1]?.node || root;
      (parent.paras ||= []).push(b.text);
    }
  }
  return root;
}

function treeToGraph(tree) {
  const nodes = [];
  const links = [];
  let id = 0;
  (function walk(n, parentId = null) {
    const me = id++;
    nodes.push({ id: me, title: n.title, paras: n.paras || [] });
    if (parentId !== null) links.push({ source: parentId, target: me });
    for (const c of n.children || []) walk(c, me);
  })(tree, null);
  return { nodes, links };
}

// ====== 消息总线：side panel <-> background ======
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg.type === "GET_DOC_GRAPH") {
      const token = await getAccessTokenInteractive();
      const docJson = await fetchDoc(msg.docId, token);
      const tree = docToTree(docJson);
      const graph = treeToGraph(tree);
      sendResponse({ ok: true, graph });
      return;
    }
  })().catch(err => {
    console.error(err);
    sendResponse({ ok: false, error: String(err) });
  });
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  console.log("[StructDoc] side-panel version installed");
});
