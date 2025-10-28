# DocMind Map — Outline ↔ Text Highlighter for Google Docs

> Map your outline/mind map to source paragraphs **inside Google Docs** with live highlighting. Leaf nodes align one-to-one with text blocks; parents auto-aggregate children. Works with Chrome’s on-device Writer/Summarizer.  

---

## 1) Overview
DocMind Map is a Chrome Extension (MV3) sidepanel for Google Docs. It generates an **AI outline / mind map**, aligns **leaf nodes** to contiguous **text blocks**, and highlights the corresponding ranges in the original document. Parent nodes highlight the **union of their children**, enabling traceable, verifiable reading and review.

### Why it matters
- Extract structure from long texts quickly
- Verify claims by jumping back to the exact passage
- Review contracts/research with **privacy by default** (on-device models)

---

## 2) Features
| Category | What it does |
|---|---|
| **AI Outline** | Build a hierarchical outline / mind map from the open Google Doc using Chrome Built-in Writer/Summarizer. |
| **Leaf-only mapping** | Only leaves are aligned to text; **parents = union(children)** to avoid competing for the same text. |
| **Adaptive blockization** | Paragraphs are compressed into 60–180-word **blocks** based on document length and leaf count. |
| **Coverage repair** | After LLM alignment we enforce **disjoint + continuous coverage [0..B-1]** so there are **no gaps**. |
| **Highlight on selection** | Click a node to highlight its text range; **Ctrl/⌘+click** to toggle selection. |
| **Clear Highlight** | One click to clear the last paint; when selection becomes empty we auto-clear. |
| **Auto-map after build** | Automatically align text once the tree is built. |
| **Export outline** | Export the outline back into the Doc (new page) for comparison or editing. |
| **Privacy** | Inference can run **on device**; only minimal features (first12/kw/wc) are used when needed. |
| **No key / no backend** | Uses Chrome Built-in AI + Google Docs API only. |

---

## 3) How it works
```
Docs API -> Paragraph parsing (style, first12, kw, wc)
         -> Adaptive blocks (≈60–180 words)
         -> Leaf list
         -> Writer (CSV: id,start_bid,end_bid,confidence)
         -> Disjointing + coverage repair (union == [0..B-1])
         -> Convert to {startIndex,endIndex}
         -> DocsHighlighter (batchUpdate)
```
**Protocol example**
```csv
id,start_bid,end_bid,confidence
"7",3,5,0.92
```
**Coverage constraint (LaTeX)**
$$\bigcup_k [s_k, e_k] = [0,B-1],\quad s_k \le e_k \text{ and sorted by leaf order}$$

---

## 4) Prerequisites (detailed, required)
> These steps are **required**. Origin Trial **must** be registered; otherwise the Writer API will not initialize and the extension may error.

### 4.1 Chrome & Built‑in AI
1. Install the latest **Google Chrome** (Stable/Canary both work).
2. Enable **Built-in AI** flags and restart Chrome:
   - `chrome://flags/#writer-api-for-gemini-nano` → **Enabled**
   - `chrome://flags/#summarization-api-for-gemini-nano` → **Enabled**
3. Quick sanity check in DevTools Console:
   ```js
   // should not be "unavailable"
   (await Writer.availability?.()) || "unknown";
   (await Summarizer.availability?.()) || "unknown";
   ```

### 4.2 Origin Trial (Required)
> Needed so a Chrome extension origin can call the Built‑in AI APIs.

1. Open the **Chrome Origin Trials** dashboard and create tokens for your **extension origin** `chrome-extension://<EXTENSION_ID>`.
   - Features to enroll: **AIWriterAPI** and **AISummarizerAPI** (if available in your channel).
   - Use the same **EXTENSION_ID** as the one shown in `chrome://extensions`.
2. Copy the issued tokens and add them to your `manifest.json`:
   ```json
   {
     "manifest_version": 3,
     "name": "DocMind Map",
     "version": "1.0.0",
     "trial_tokens": [
       "<YOUR_AIWRITERAPI_TOKEN>",
       "<YOUR_AISUMMARIZERAPI_TOKEN>"
     ]
   }
   ```
3. Reload the extension. In Console, the following should **not** throw and should log availability:
   ```js
   await Writer.availability();       // "available" or similar
   await Summarizer.availability();   // "available" or similar
   ```
> Tokens are **bound to the extension ID**. Packaging under a new ID requires new tokens.

### 4.3 Google Cloud OAuth
1. Create a **Google Cloud project** → enable **Google Docs API** and **Google Drive API**.
2. Configure **OAuth consent screen** (External) and add your test accounts.
3. Create **OAuth client ID** of type **Web application**. Add this redirect URI:
   ```text
   https://<EXTENSION_ID>.chromiumapp.org/
   ```
4. Use scopes (minimum):
   - `https://www.googleapis.com/auth/documents`
   - `https://www.googleapis.com/auth/drive.readonly`
5. Put the **Client ID** into your extension’s config (e.g., `auth.js`). First run will prompt **Authorize**.

### 4.4 Extension permissions
- `manifest.json` should declare:
  ```json
  {
    "permissions": ["identity", "storage", "scripting"],
    "host_permissions": ["https://docs.googleapis.com/*"]
  }
  ```

---

## 5) Install & Run
1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select project folder
3. Open a Google Doc
4. Click the extension → sidepanel opens
5. Click **Authorize** (first run)
6. Click **AI Outline** → wait for the map
7. (Optional) **Auto-map after build** is on by default
8. Click a node → highlight; **Ctrl/⌘+click** to toggle; **Clear Highlight** to clear
9. (Optional) **Export Outline** to insert a new page with the outline

---

## 6) Dev Notes (snippets)
**Ensure Writer is available / register trial dynamically (still recommended)**
```js
async function ensureWriterSupported() {
  const avail = await Writer.availability();
  if (avail === "unavailable") throw new Error("Writer not available");
  return avail;
}
```
**Apply & clear highlights**
```js
await highlighter.apply(docId, [{start, end}], { color: { r:1, g:1, b:0.6 }, replace:true });
await highlighter.clear(docId); // or direct Docs API: backgroundColor=null
```

---

## 7) Limitations
- Docs API range math & rate limits → we batch requests and merge ranges.
- On-device models have shorter context → we use adaptive blocks + CSV protocol.
- LLM output can vary → we enforce disjointness & full coverage, with keyword fallbacks.

---

## 8) Roadmap
- Chapter-windowed mapping (by Heading 1 windows)
- Named-range navigation & reverse jump (text → node)
- Structured extraction (entities/slots) with provenance, export to CSV/JSON
- Collaboration: node = discussion card; comment write-back; review views

---

# （中文）DocMind Map — Google Docs 大纲↔文本高亮映射

> 在 Google Docs 侧栏生成 **AI 大纲/思维导图**，将 **叶子节点**与原文 **一一对齐并高亮**；**父节点**自动聚合子节点区间。支持本地 Writer/Summarizer，隐私友好。

---

## 1）项目简介
DocMind Map 是一个 Chrome MV3 扩展的侧栏工具。它生成大纲/思维导图，仅对**叶子节点**与正文做 **一对一** 对齐；父节点高亮为**子节点区间的并集**。用户点击即可定位高亮，支持自动映射与一键清除，适合合同评审、合规审核和研究阅读。

---

## 2）核心功能
- **AI 大纲**：使用 Chrome 内置 Writer/Summarizer 生成层级结构  
- **仅叶子对齐**：避免父子“抢段落”；**父=子并集**  
- **自适应分块**：将段落压成 **60–180 词/块**（随文长与叶子数动态调整）  
- **覆盖修复**：对齐后强制 **去重且连续覆盖 [0..B-1]**，无缺口  
- **选择即高亮 / Ctrl(⌘)+单击取消**；**Clear Highlight** 一键清除  
- **构树后自动映射**；**导出大纲** 回写到文档新分页  
- **隐私友好**：可在**本地推理**；即便联网也只上传最小特征（first12/kw/wc）  
- **免 Key / 无后端**：只用 Chrome 内置 AI 与 Docs API

---

## 3）工作原理
```
Docs API → 段落解析（style/first12/kw/wc）
        → 自适应分块（≈60–180 词）
        → 叶子列表
        → Writer（CSV: id,start_bid,end_bid,confidence）
        → 去重 + 覆盖修复（并集 = [0..B-1]）
        → 转为 {startIndex,endIndex}
        → DocsHighlighter（batchUpdate）
```
**协议示例**
```csv
id,start_bid,end_bid,confidence
"7",3,5,0.92
```

---

## 4）前置条件（必做，详细）
> 这些步骤**必做**。必须先注册 **Origin Trial**，否则 Writer API 无法初始化，扩展会报错。

### 4.1 Chrome 与内置 AI
1. 安装最新版 **Google Chrome**（稳定/金丝雀均可）。  
2. 打开以下 Flags 并重启浏览器：  
   - `chrome://flags/#writer-api-for-gemini-nano` → **Enabled/启用**  
   - `chrome://flags/#summarization-api-for-gemini-nano` → **Enabled/启用**  
3. 在开发者工具 Console 快速自检：
   ```js
   // 结果不应为 "unavailable"
   (await Writer.availability?.()) || "unknown";
   (await Summarizer.availability?.()) || "unknown";
   ```

### 4.2 Origin Trial（必需）
> 让 **Chrome 扩展的 origin** 可以调用 Built‑in AI API。

1. 进入 **Chrome Origin Trials** 后台，为你的 **扩展 ID** `chrome-extension://<EXTENSION_ID>` 申请令牌：  
   - 需要的 Feature：**AIWriterAPI**、（可选）**AISummarizerAPI**（取决于通道是否开放）  
   - EXTENSION_ID 与 `chrome://extensions` 中显示的一致  
2. 将签发的令牌写入 `manifest.json`：
   ```json
   {
     "manifest_version": 3,
     "name": "DocMind Map",
     "version": "1.0.0",
     "trial_tokens": [
       "<YOUR_AIWRITERAPI_TOKEN>",
       "<YOUR_AISUMMARIZERAPI_TOKEN>"
     ]
   }
   ```
3. 重新加载扩展；在 Console 检查：
   ```js
   await Writer.availability();       // 应返回 "available" 或类似
   await Summarizer.availability();   // 应返回 "available" 或类似
   ```
> 令牌与 **扩展 ID 绑定**。如重新打包导致 ID 改变，需要重新申请新令牌。

### 4.3 Google Cloud OAuth
1. 创建 **Google Cloud** 项目 → 启用 **Google Docs API**、**Google Drive API**。  
2. 配置 **OAuth 同意屏幕**（External），添加测试用户。  
3. 创建 **OAuth 客户端**（类型：**Web application**），添加回调：
   ```text
   https://<EXTENSION_ID>.chromiumapp.org/
   ```
4. 使用最小 Scope：  
   - `https://www.googleapis.com/auth/documents`  
   - `https://www.googleapis.com/auth/drive.readonly`  
5. 将 **Client ID** 写入扩展（如 `auth.js`）；首次使用点 **Authorize** 完成授权。

### 4.4 扩展权限
- `manifest.json` 需声明：
  ```json
  {
    "permissions": ["identity", "storage", "scripting"],
    "host_permissions": ["https://docs.googleapis.com/*"]
  }
  ```

---

## 5）安装与使用
1. 打开 `chrome://extensions` → 开启**开发者模式**  
2. **加载已解压** → 选择项目目录  
3. 打开任意 Google Doc  
4. 点击扩展图标 → 侧栏打开  
5. 点击 **Authorize** 首次授权  
6. 点击 **AI Outline** 生成大纲  
7. （可选）**Auto-map after build** 默认开启  
8. 点击节点 → 高亮；**Ctrl(⌘)+单击** 取消选择；点 **Clear Highlight** 清除  
9. （可选）**Export Outline** 将大纲写入文档新分页

---

## 6）开发要点（片段）
**动态检测 Writer 可用（仍建议保留）**
```js
async function ensureWriterSupported() {
  const avail = await Writer.availability();
  if (avail === "unavailable") throw new Error("Writer not available");
  return avail;
}
```
**应用/清除高亮**
```js
await highlighter.apply(docId, [{start, end}], { color: { r:1, g:1, b:0.6 }, replace:true });
await highlighter.clear(docId); // 或直接 Docs API: backgroundColor=null
```

---

## 7）已知限制
- Docs API 的区间与配额限制 → 通过批处理与合并范围规避  
- 本地模型上下文较短 → 使用自适应分块 + CSV 协议  
- LLM 结果有随机性 → 使用去重与**全覆盖**修复，另有关键词兜底

---

## 8）路线图
- 基于 **Heading 1** 的章节“窗口化”对齐  
- 命名范围导航 & 反向定位（文本 → 节点）  
- **结构化抽取**（实体/要素）+ 溯源 + CSV/JSON 导出  
- 协作：节点=讨论卡；评论回写；审阅视图

---
