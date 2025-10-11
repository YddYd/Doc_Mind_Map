// auth.js — 使用 chrome.identity.launchWebAuthFlow（隐式流，无 secret）
(function () {
  const manifest = chrome.runtime.getManifest();
  const CLIENT_ID = manifest.oauth2.client_id;
  const SCOPES = manifest.oauth2.scopes.join(" ");
  const REDIRECT_URI = `https://${chrome.runtime.id}.chromiumapp.org/`;

  function buildAuthUrl({ prompt = "select_account consent" } = {}) {
    const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    u.searchParams.set("client_id", CLIENT_ID);
    u.searchParams.set("response_type", "token");
    u.searchParams.set("redirect_uri", REDIRECT_URI);
    u.searchParams.set("scope", SCOPES);
    u.searchParams.set("include_granted_scopes", "true");
    u.searchParams.set("prompt", prompt);
    // 可按需追加 login_hint / state 等
    return u.toString();
  }

  function logUrl(tag, urlStr) {
    try {
      const u = new URL(urlStr);
      const redacted = new URL(u.origin + u.pathname);
      console.info(`[OAuth] ${tag}:`, redacted.toString(), u.hash ? "(#...)" : "");
    } catch {
      console.info(`[OAuth] ${tag}:`, urlStr);
    }
  }

  async function getAccessTokenInteractive() {
    const authUrl = buildAuthUrl({ prompt: "select_account consent" });
    logUrl("Auth URL", authUrl);

    try {
      const redirect = await chrome.identity.launchWebAuthFlow({
        url: authUrl,
        interactive: true
      });

      if (redirect) logUrl("Redirect (response)", redirect);

      const m = redirect && redirect.match(/[#&]access_token=([^&]+)/);
      if (!m) {
        const errMatch = redirect && redirect.match(/[?#&]error=([^&]+)/);
        const descMatch = redirect && redirect.match(/[?#&]error_description=([^&]+)/);
        const e = decodeURIComponent(errMatch ? errMatch[1] : "access_denied");
        const d = decodeURIComponent(descMatch ? descMatch[1] : "");
        throw new Error(`OAuth 未获得 access_token（${e}${d ? ": " + d : ""}）`);
      }
      const token = decodeURIComponent(m[1]);
      console.info("[OAuth] ACCESS TOKEN (masked):", token.slice(0,8) + "... (" + token.length + " chars)");
      return token;
    } catch (err) {
      console.error("[OAuth] launchWebAuthFlow error:", err);
      chrome.identity.clearAllCachedAuthTokens?.();
      throw err;
    }
  }

  // 暴露一个全局函数给 sidepanel.js 调用
  self.getAccessTokenInteractive = getAccessTokenInteractive;
})();
