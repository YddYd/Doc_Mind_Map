// 使用 chrome.identity.launchWebAuthFlow 的隐式授权（前端，无 secret）
(function () {
  const manifest = chrome.runtime.getManifest();
  const CLIENT_ID = manifest.oauth2.client_id;
  const SCOPES = manifest.oauth2.scopes.join(" ");
  const REDIRECT = `https://${chrome.runtime.id}.chromiumapp.org/`;

  function buildAuthUrl({ prompt = "select_account consent" } = {}) {
    const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    u.searchParams.set("client_id", CLIENT_ID);
    u.searchParams.set("response_type", "token");
    u.searchParams.set("redirect_uri", REDIRECT);
    u.searchParams.set("scope", SCOPES);
    u.searchParams.set("include_granted_scopes", "true");
    u.searchParams.set("prompt", prompt);
    return u.toString();
  }

  async function getAccessTokenInteractive() {
    const url = buildAuthUrl();
    try {
      const redirect = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
      const m = redirect && redirect.match(/[#&]access_token=([^&]+)/);
      if (!m) {
        const e = redirect && redirect.match(/[?#&]error=([^&]+)/);
        const d = redirect && redirect.match(/[?#&]error_description=([^&]+)/);
        throw new Error(`OAuth 未获得 access_token（${decodeURIComponent(e?.[1] || "access_denied")}${d ? ": " + decodeURIComponent(d[1]) : ""}）`);
      }
      return decodeURIComponent(m[1]);
    } catch (err) {
      chrome.identity.clearAllCachedAuthTokens?.();
      throw err;
    }
  }

  // 暴露给 sidepanel.js
  self.getAccessTokenInteractive = getAccessTokenInteractive;
})();
