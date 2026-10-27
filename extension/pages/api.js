/* api.js —— 统一请求层（浏览器扩展 / 本地服务 双模）
 * 扩展模式（chrome-extension:// 页面）：
 *   LLM 真发 / GitHub / console-v2 → background 直连（host_permissions 绕 CORS）；
 *   4 层上游代理（gost/shadowsocks）与本地执行端点（/tool /tooltest /cfg /dljob）→ 本地二进制 127.0.0.1:8000。
 * 服务模式（http://127.0.0.1:8000 打开同一页面）：全部回退 serve.py 相对路径，行为与旧版一致。
 * 页面侧只用 API.*，不感知当前处于哪种模式。
 */
const API = (function () {
  const LOCAL_BASE = "http://127.0.0.1:8000";
  const IS_EXT = typeof chrome !== "undefined" && !!chrome.runtime &&
    typeof chrome.runtime.sendMessage === "function";

  // 本地二进制 / serve.py 前缀：扩展下用绝对地址，服务下相对路径
  const base = IS_EXT ? LOCAL_BASE : "";

  function send(msg) {
    return new Promise(function (resolve, reject) {
      try {
        chrome.runtime.sendMessage(msg, function (res) {
          var err = chrome.runtime.lastError;
          if (err) reject(new Error(err.message));
          else resolve(res);
        });
      } catch (e) { reject(e); }
    });
  }

  function netErr(e) { return { ok: false, status: 0, text: "网络错误:" + (e && e.message || e), headers: {} }; }

  /* 通用转发：{url, method, headers, body, proxy?} → {ok, status, text, headers}
   * 带 proxy（4 层上游代理）时必须经本地二进制；否则扩展下 background 直连。 */
  async function proxy(payload) {
    if (IS_EXT && !(payload && payload.proxy)) {
      try {
        const r = await send({ type: "proxy", payload: payload });
        return r && r.ok !== undefined ? r : { ok: false, status: 0, text: (r && r.error) || "background 无响应", headers: {} };
      } catch (e) { return netErr(e); }
    }
    try {
      const r = await fetch(base + "/proxy", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const j = await r.json();
      return { ok: !!j.ok, status: j.status || 0, text: j.body || "", headers: j.headers || {} };
    } catch (e) { return netErr(e); }
  }

  /* console-v2 模型列表专用：Origin/Referer/Cookie 属浏览器禁止头，
   * 扩展下由 background 以 declarativeNetRequest 注入（Cookie 优先 chrome.cookies 自动读）；
   * 服务模式沿用 /proxy 服务端伪造头。→ {ok, status, text} */
  async function consoleFetch(payload) {
    if (IS_EXT) {
      try {
        const r = await send({ type: "consoleFetch", payload: payload });
        return r && r.ok !== undefined ? r : { ok: false, status: 0, text: (r && r.error) || "background 无响应" };
      } catch (e) { return { ok: false, status: 0, text: "扩展转发失败:" + (e && e.message || e) }; }
    }
    return proxy({
      url: payload.url, method: "POST",
      headers: {
        "Content-Type": "application/json", "apollographql-client-name": "ksc-aicp",
        "Origin": "https://starflow.console.ksyun.com", "Referer": "https://starflow.console.ksyun.com/",
        "Cookie": payload.cookie || ""
      },
      body: payload.body
    });
  }

  /* 本地二进制端点：POST JSON。返回解析后的 JSON（失败返回 {ok:false,error}） */
  async function local(path, body) {
    try {
      const r = await fetch(base + path, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {})
      });
      return await r.json();
    } catch (e) { return { ok: false, error: "本地后端不可达:" + (e && e.message || e) }; }
  }

  /* 本地二进制端点：GET（/dljob?id= 进度轮询等） */
  async function localGet(path) {
    try {
      const r = await fetch(base + path);
      return await r.json();
    } catch (e) { return { ok: false, error: "本地后端不可达:" + (e && e.message || e) }; }
  }

  /* 本地二进制 / serve.py 存活探测 → boolean */
  async function health() {
    try {
      const r = await fetch(base + "/healthz", { method: "GET" });
      const j = await r.json();
      return !!j.ok;
    } catch (e) { return false; }
  }

  return {
    IS_EXT: IS_EXT,
    LOCAL_BASE: LOCAL_BASE,
    proxy: proxy,
    consoleFetch: consoleFetch,
    local: local,
    localGet: localGet,
    health: health
  };
})();
