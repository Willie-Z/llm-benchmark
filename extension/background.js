/* background.js —— MV3 service worker
 * 职责：
 * 1. type:"proxy"     任意 URL 直连转发（host_permissions 绕 CORS，替代 serve.py /proxy 的网络部分）
 * 2. type:"consoleFetch"  console-v2 模型列表：Origin/Referer/Cookie 属浏览器禁止头，
 *    由 declarativeNetRequest 注入（Cookie 优先 chrome.cookies 自动读控制台域，可被页面传入值覆盖）
 * 本地执行端点（/tool /tooltest /cfg /dljob）不经此处，页面直连本地二进制（api.js 已处理）。
 */
const CONSOLE_ORIGIN = "https://starflow.console.ksyun.com";
const CONSOLE_API_HOST = "||overlord-api.ksyun.com^";
const DNR_RULE_ID = 1;

async function directFetch(payload) {
  const url = payload && payload.url;
  if (!url) return { ok: false, status: 0, text: "no url", headers: {} };
  const opt = {
    method: (payload.method || "GET").toUpperCase(),
    headers: payload.headers || {},
    redirect: "follow"
  };
  if (opt.method !== "GET" && opt.method !== "HEAD" && payload.body != null) {
    opt.body = typeof payload.body === "string" ? payload.body : JSON.stringify(payload.body);
  }
  try {
    const r = await fetch(url, opt);
    const text = await r.text();
    return { ok: r.ok, status: r.status, text: text, headers: Object.fromEntries(r.headers.entries()) };
  } catch (e) {
    return { ok: false, status: 0, text: "直连失败:" + (e && e.message || e), headers: {} };
  }
}

/* 从浏览器 Cookie 罐拼出控制台 Cookie 头（免 F12 粘贴） */
async function readConsoleCookie() {
  if (!chrome.cookies) return "";
  try {
    const list = await chrome.cookies.getAll({ url: CONSOLE_ORIGIN });
    return list.map(c => c.name + "=" + c.value).join("; ");
  } catch (e) { return ""; }
}

/* declarativeNetRequest 把禁止头写进请求（fetch 本身设不了 Cookie/Origin/Referer） */
async function applyConsoleHeaders(cookieHeader) {
  const requestHeaders = [
    { header: "Origin", operation: "set", value: CONSOLE_ORIGIN },
    { header: "Referer", operation: "set", value: CONSOLE_ORIGIN + "/" }
  ];
  if (cookieHeader) requestHeaders.push({ header: "Cookie", operation: "set", value: cookieHeader });
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [DNR_RULE_ID],
      addRules: [{
        id: DNR_RULE_ID, priority: 1,
        action: { type: "modifyHeaders", requestHeaders: requestHeaders },
        condition: { urlFilter: CONSOLE_API_HOST, resourceTypes: ["xmlhttprequest"] }
      }]
    });
    return true;
  } catch (e) { return false; }
}

async function consoleFetch(payload) {
  let cookieHeader = (payload && payload.cookie) || "";
  if (!cookieHeader) cookieHeader = await readConsoleCookie();
  await applyConsoleHeaders(cookieHeader);
  // 此处不带禁止头（会设不进去），改写交给 DNR 规则
  const r = await directFetch({
    url: payload.url, method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apollographql-client-name": "ksc-aicp"
    },
    body: payload.body
  });
  return r;
}

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || !msg.type) return false;
  if (msg.type === "proxy") { directFetch(msg.payload || {}).then(sendResponse); return true; }
  if (msg.type === "consoleFetch") { consoleFetch(msg.payload || {}).then(sendResponse); return true; }
  return false;
});
