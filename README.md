# 🧩 StructDoc — Google Docs 结构化 AI 助手

> 通过 Chrome 内置 AI，将 Google Docs 文档自动结构化为清晰的大纲与思维导图，帮助用户快速理解、重组与导出文章逻辑。

---

## 📘 项目简介

**StructDoc** 是一个基于 **Chrome Extension (Manifest V3)** 的侧边栏扩展。  
它可以读取当前打开的 **Google Docs** 文档，使用 **Chrome Builtin AI Writer API (Gemini Nano)** 对文本进行逻辑结构化分析，并生成一个清晰的层级大纲和思维导图。  

用户还可以将 AI 生成的结构化结果导出到原文档的新分页中，以便对比或编辑。

---

## ✨ 核心功能

| 功能 | 描述 |
|------|------|
| 🧠 **AI 结构化分析** | 使用内置 Gemini Nano 模型（Writer API），自动重排文档逻辑、识别层级、生成 Markdown 大纲 |
| 🗺️ **思维导图可视化** | 将 AI 生成的大纲结构以树状图展示，清晰查看层级关系 |
| 📄 **文档导出** | 一键将结构化后的内容导出到原 Google Doc 的新分页中 |
| 🔐 **本地执行、隐私安全** | 全部 AI 推理在本地完成，不上传文档到云端 |
| 🚀 **免 Key / 无后端** | 仅依赖 Chrome 内置 AI 与官方 Docs API，无需任何外部服务或密钥 |

---

## 🧰 使用前准备

### 1️⃣ 启用 Google Docs API

1. 前往 [Google Cloud Console](https://console.cloud.google.com/apis/dashboard)。
2. 创建或选择一个项目。  
3. 在 **“API 与服务 → 启用 API 与服务”** 中搜索并启用 **Google Docs API**。

---

### 2️⃣ 创建 OAuth 凭据（Web 应用类型）

1. 在 **“API 与服务 → 凭据”** 中创建 **OAuth 2.0 Client ID**，类型选择：**Web Application**。  
2. 在该客户端中添加以下 **Authorized redirect URI**（将 `<扩展ID>` 替换为你的扩展 ID，可在chrome://extensions/中查看）：  
   ```
   https://<扩展ID>.chromiumapp.org/
   ```
3. 将生成的 **Client ID** 填入 `manifest.json` 的：
   ```json
   "oauth2": {
     "client_id": "YOUR_CLIENT_ID.apps.googleusercontent.com",
     "scopes": [
       "https://www.googleapis.com/auth/documents",
       "https://www.googleapis.com/auth/drive.readonly"
     ]
   }
   ```

> 提示：开发阶段可先使用 `documents.readonly` 只读权限，写回文档时再切换为 `documents` 可写权限。

---

### 3️⃣ 启用 Chrome Built‑in AI（Writer API）

**本地测试**

1. 在地址栏打开：`chrome://flags/
2. 将 **“Writer API for Gemini Nano”** 与 **"Summarization API for Gemini Nano"** 设为 **Enabled**，重启浏览器。
3. 前往 **Chrome Origin Trials** 注册 **Writer API** 的试用令牌。
4. 在web origin中填入 "chrome-extension://<拓展ID>"
5. 将获得的 token 填入 `manifest.json`：  
   ```json
   "trial_tokens": [
     "YOUR_WRITER_API_ORIGIN_TRIAL_TOKEN"
   ]
   ```

---

## 🛠️ 安装与调试

1. 克隆或下载本仓库：  
   ```bash
   git clone https://github.com/yourname/structdoc-extension.git
   ```
2. 打开扩展管理页面：在地址栏输入 `chrome://extensions/`。  
3. 打开右上角 **开发者模式**。  
4. 点击 **“加载已解压的扩展程序”**，选择项目根目录。  
5. 打开任意 **Google Docs** 文档。  
6. 点击扩展图标，侧边栏将自动打开。  
7. 在侧边栏点击 **“授权”** → 选择账号（首次会弹出授权）。  
8. 点击 **“AI 结构化”** 生成思维导图。  
9. （可选）点击 **“导出到新分页”** 将 AI 结果写回文档末尾新分页。

---

## ▶️ 使用说明

- **授权**：使用 `chrome.identity.launchWebAuthFlow` 走 Web 应用 OAuth 流（无 secret）。  
- **读取文档**：调用 `https://docs.googleapis.com/v1/documents/{docId}` 拉取正文。  
- **AI 结构化**：用 `Writer.create({...})` + `writer.write(prompt, { context: plainText })` 生成 **Markdown 大纲**。  
- **可视化**：将 Markdown 解析为树结构，渲染为思维导图（纯 DOM/SVG）。  
- **导出**（可选）：使用 `documents:batchUpdate` 执行  
  - `insertPageBreak` 在文末添加分页；  
  - `insertText` 插入 AI 大纲文本。  
  如需将 Markdown 转换为 Docs 的 `Heading 1~6` 格式，可进一步使用 `updateParagraphStyle`、`createParagraphBullets` 等请求。

---

## ❓ 常见问题

- **看不到 Writer API？**  
  请检查是否启用 `chrome://flags/#writer-api-for-gemini-nano` 或正确配置了 Origin Trial。首次使用可能需要下载本地模型，等待一段时间。
- **授权失败 / 回调不触发？**  
  确认 OAuth 客户端的 **Authorized redirect URI** 已添加：  
  `https://<扩展ID>.chromiumapp.org/`，并与当前扩展 ID 一致。
- **导出失败 403/401？**  
  请确认已使用 `documents` 可写 scope，并在 OAuth 同意屏中授权。

---

## 🧭 路线图

1. 节点点击 → 文档定位 / 高亮段落  
2. 更精细的逻辑树布局与缩放  
3. 节点摘要与 AI 改写功能（局部重写）  
4. 将导出结果自动格式化为 Docs 标题（Heading 1~6）  
5. 协作视图：团队共享逻辑图

---
