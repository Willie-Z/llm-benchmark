// ============ 主题 ============
(function () {
    const saved = localStorage.getItem('mt_theme') || 'light';
    document.documentElement.setAttribute('data-theme', saved);

    function sync() {
        const d = document.documentElement.getAttribute('data-theme') === 'dark';
        document.getElementById('iconSun').style.display = d ? 'none' : 'block';
        document.getElementById('iconMoon').style.display = d ? 'block' : 'none';
    }

    sync();
    document.getElementById('themeBtn').onclick = () => {
        const c = document.documentElement.getAttribute('data-theme');
        const n = c === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', n);
        localStorage.setItem('mt_theme', n);
        sync();
    };
})();

const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;'
}[c]));

// ============ 工具与模型数据 ============
// 工具清单：后续新增工具（gemini-cli …）在此追加即可
const TOOLS = [
    {
        id: 'codex',
        name: 'Codex (OpenAI)',
        repo: 'openai/codex',
        cfgTitle: '~/.codex/config.toml',
        wire: 'responses',
        bin: 'codex',
        cfgDesc: 'OpenAI Codex CLI · 默认走 Responses API'
    },
    {
        id: 'claude-code',
        name: 'Claude Code (Anthropic)',
        repo: 'anthropics/claude-code',
        cfgTitle: '~/.claude/settings.json',
        wire: 'anthropic',
        bin: 'claude',
        cfgDesc: 'Anthropic Claude Code CLI · 默认走 Messages API（ANTHROPIC_BASE_URL）'
    },
];

// tag → 展示版本号：codex 的 rust-v0.x → 0.x；claude 的 v2.x → 2.x
function tagToVer(tag) {
    return String(tag || '').replace(/^rust-v?/i, '').replace(/^v(?=[0-9])/i, '');
}

// 工具默认协议：codex→responses，claude→anthropic，其余按模型标记
function autoWire(m) {
    if (state.tool === 'codex') return 'responses';
    if (state.tool === 'claude-code') return 'anthropic';
    return (m && m.wire) || 'chat';
}

// 国外模型清单：用国外 Key 从 global-kspmas.ksyun.com/v1/models 拉取
let FOREIGN_MODELS = [];
// 国内模型清单：用国内 Key 从 kspmas.ksyun.com/v1/models 拉取
let DOMESTIC_MODELS = [];

// ============ 状态与持久化 ============
// 网关 Base URL 按区域默认（含 /v1），切换「模型来源」时自动跟随
const DOM_BASE = 'https://kspmas.ksyun.com/v1', GLB_BASE = 'https://global-kspmas.ksyun.com/v1';
const STORE_KEY = 'mt_cfg';
const state = Object.assign({
    tool: 'codex', region: 'domestic', domesticIdx: 0, foreignIdx: 0, proto: 'auto',
    ghProxyOn: false, proxyType: 'l4', proxyAddr: '',
    gwKeyDom: '', gwKeyGlb: '', testPrompt: '请只回复一个词：SPEC_TEXT_OK', params: {},
    customHeaders: '', extraParams: '', modelSort: 'vendor', domesticModelId: '', foreignModelId: ''
}, (function () {
    try {
        return JSON.parse(localStorage.getItem(STORE_KEY)) || {};
    } catch (e) {
        return {};
    }
})());
// 旧版单一 gwKey 迁移：两把新 Key 均为空时原样带过去（行为不变，用户可再按区域分别替换）
if (state.gwKey) {
    if (!state.gwKeyDom) state.gwKeyDom = state.gwKey;
    if (!state.gwKeyGlb) state.gwKeyGlb = state.gwKey;
    delete state.gwKey;
}
// 旧版单选 verTag → 多选 verTags 迁移（存 ver 字符串数组，与列表渲染顺序无关）
if (state.verTag && !(Array.isArray(state.verTags) && state.verTags.length)) state.verTags = [state.verTag];
delete state.verTag;
// 网关 Base URL 改为按区域固定（DOM_BASE / GLB_BASE），不再提供输入框；控制台 Cookie 已下线，清掉残留
delete state.gwBase;
delete state.consoleCookie;

// 当前区域生效的网关 Key：国内 kspmas ↔ 国外 global-kspmas
function activeKey() {
    return (state.region === 'foreign' ? state.gwKeyGlb : state.gwKeyDom) || '';
}

// 网关 API KEY 单输入框：标签/占位/提示随「模型来源」切换，值 = 当前区域那把 Key
function renderKeyUI() {
    const isF = state.region === 'foreign';
    $("#gwKeyLabel").textContent = '网关 API KEY（' + (isF ? '国外' : '国内') + '）';
    $("#gwKeyTip").textContent = '随「模型来源」切换：当前填 ' +
        (isF ? 'global-kspmas.ksyun.com（国外）' : 'kspmas.ksyun.com（国内）') +
        ' 的鉴权 Key，用于拉取模型列表 / 模型详情 / 连通性测试 / 工具测试。国内/国外两把 Key 分开存本机 localStorage，切换区域自动带出对应 Key';
    const i = $("#gwKey");
    i.placeholder = isF ? 'sk-...（global-kspmas）' : 'kspmas.ksyun.com 的 Key';
    i.value = activeKey();
}

function saveState() {
    try {
        localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) {
    }
}

function parseJsonObject(raw, label) {
    const text = String(raw || '').trim();
    if (!text) return {};
    let value;
    try {
        value = JSON.parse(text);
    } catch (e) {
        throw new Error(label + ' 必须是有效 JSON 对象：' + e.message);
    }
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error(label + ' 必须是 JSON 对象，例如 {"key":"value"}');
    return value;
}

// ============ 请求层（api.js 双模：扩展 background 直连 / serve.py 转发） ============
// PROXY_OK：直连能力（LLM 真发 / GitHub / 模型列表）。扩展恒可用；服务模式取决于 serve.py。
// LOCAL_OK：本地执行端点（/tool /tooltest /cfg /dljob）与 4 层上游代理，需要本地二进制（或 serve.py）。
let PROXY_OK = API.IS_EXT;
let LOCAL_OK = false;

async function proxyFetch(url, opt) {
    opt = opt || {};
    const payload = {url: url, method: opt.method || "POST", headers: opt.headers || {}, body: opt.body || null};
    if (opt.proxy) payload.proxy = opt.proxy;  // 4 层上游代理：必须经本地二进制转发
    return API.proxy(payload);
}

// 存活探测：本地后端（二进制 / serve.py）在则 LOCAL_OK；服务模式下真发也依赖它
(async function () {
    LOCAL_OK = await API.health();
    if (!API.IS_EXT) PROXY_OK = LOCAL_OK;
})();

// ============ GitHub 版本获取 ============
let RELEASES = []; // [{tag, date, pre}]，按发布时间倒序
function curTool() {
    return TOOLS.find(t => t.id === state.tool) || TOOLS[0];
}

// 构造 GitHub 访问地址：7 层代理把完整地址拼在代理后面；4 层/直连保持原 URL
function buildGithubUrl(url) {
    if (!state.ghProxyOn) return url;
    if (state.proxyType === 'l7') return state.proxyAddr.replace(/\/+$/, '') + '/' + url;
    return url;
}

function githubFetch(url) {
    const api = 'https://api.github.com' + url;
    const headers = {Accept: 'application/vnd.github+json'};
    if (state.ghProxyOn && state.proxyType === 'l4') {
        // 4 层代理：URL 不变，经本地二进制走上游 HTTP 代理（扩展 fetch 不能按请求指定代理）
        if (!LOCAL_OK) return Promise.resolve({
            ok: false,
            status: 0,
            text: '4 层代理需要本地后端（二进制/serve.py）支持（未检测到）',
            headers: {}
        });
        if (!state.proxyAddr) return Promise.resolve({ok: false, status: 0, text: '未填写 4 层代理地址', headers: {}});
        return proxyFetch(api, {method: 'GET', headers: headers, proxy: state.proxyAddr});
    }
    const target = buildGithubUrl(api);
    if (!PROXY_OK && state.ghProxyOn && state.proxyType === 'l7') {
        // 无本地后端（file:// 等）：7 层代理通常开放 CORS，尝试浏览器直连
        return fetch(target, {headers: headers}).then(r => r.text().then(t => ({
            ok: r.ok,
            status: r.status,
            text: t,
            headers: {}
        })))
            .catch(e => ({ok: false, status: 0, text: '直连失败:' + (e.message || e), headers: {}}));
    }
    return proxyFetch(target, {method: 'GET', headers: headers});
}

// 拉取全部 Release（每页 100 条）填充版本下拉，默认选最新正式版；
// 失败自动重试 2 次（限流/网络抖动时免手动开关代理），初始加载与手动刷新共用
// 备用源：GitHub 官方 releases.atom 订阅（公开、无 API 配额限制，含最近约 10 个版本）
async function fetchAtomReleases(repo) {
    const r = await proxyFetch('https://github.com/' + repo + '/releases.atom', {
        method: 'GET',
        headers: {'Accept': 'application/atom+xml'}
    });
    if (!r.ok || !r.text) throw new Error('HTTP ' + r.status);
    const doc = new DOMParser().parseFromString(r.text, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('atom 解析失败');
    const out = [];
    doc.querySelectorAll('feed > entry').forEach(e => {
        const id = (e.querySelector('id') || {}).textContent || '';
        const tag = decodeURIComponent((id.split('/').pop() || '').trim());
        const updated = ((e.querySelector('updated') || {}).textContent || '').slice(0, 10);
        if (tag) out.push({tag: tag, ver: tagToVer(tag), date: updated, pre: !/^[0-9.]+$/.test(tagToVer(tag))});
    });
    if (!out.length) throw new Error('atom 无版本');
    return out;
}

function verListMsg(msg) {
    $("#verList").innerHTML = '<div class="ver-item">' + esc(msg) + '</div>';
    const t = $("#verSelText");
    t.textContent = msg;
    t.className = 'ver-sel-text empty';
}

// 下拉框摘要：显示已选版本（与「模型」下拉同款视觉）
function renderVerSummary() {
    const tags = state.verTags || [], t = $("#verSelText");
    if (!tags.length) {
        t.textContent = '请选择版本';
        t.className = 'ver-sel-text empty';
    } else {
        t.textContent = tags.length <= 2 ? tags.join('、') : tags[0] + '、' + tags[1] + ' 等 ' + tags.length + ' 项';
        t.className = 'ver-sel-text';
    }
}

// 从勾选框 DOM 重建 state.verTags（顺序 = RELEASES 新→旧，故 verTags[0] 恒为最新勾选项）
function syncVerTags() {
    state.verTags = [...$("#verList").querySelectorAll('input:checked')].map(x => RELEASES[+x.value].ver);
    saveState();
    renderVerSummary();
    renderCfg();
}

function renderVerList() {
    const box = $("#verList");
    box.innerHTML = '';
    RELEASES.forEach((v, i) => {
        const row = document.createElement('label');
        row.className = 'ver-item';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = i;
        cb.checked = state.verTags.some(t => t === v.ver || t === v.tag);
        row.appendChild(cb);
        const tx = document.createElement('span');
        tx.innerHTML = esc(v.ver) + (v.pre ? '<span class="vr-pre">（预发布）</span>' : '') + (v.date ? ' · ' + esc(v.date) : '');
        row.appendChild(tx);
        box.appendChild(row);
    });
    box.onchange = syncVerTags;  // 事件委托：innerHTML 重建后仍生效
    renderVerSummary();
}

function applyReleases(list) {
    // 过滤 alpha 版本 + 非版本 tag（openai/codex 仓库混有 libcap-v2.75、artifact-runtime-v*、
    // codex-rs-<hash>-* 等 vendored 组件/内部构建 tag）；版本格式白名单：codex → rust-v<数字>，claude → v<数字>
    const isVer = t => state.tool === 'codex' ? /^rust-v\d/i.test(t) : /^v\d/i.test(t);
    RELEASES = list.filter(x => x && x.tag && isVer(x.tag) && !/alpha/i.test(x.tag));
    // 剪掉列表中已不存在的勾选（归一为 v.ver）；空则默认勾选最新正式版（保持旧单选行为）
    state.verTags = (state.verTags || []).map(t => {
        const hit = RELEASES.find(v => v.ver === t || v.tag === t);
        return hit ? hit.ver : null;
    }).filter(Boolean);
    if (!state.verTags.length && RELEASES.length) {
        const idx = RELEASES.findIndex(v => !v.pre);
        state.verTags = [RELEASES[Math.max(0, idx)].ver];
        saveState();
    }
    renderVerList();
    renderCfg();
}

async function fetchReleases(retry) {
    retry = retry || 0;
    const t = curTool();
    if (!retry) { // 首次尝试：重置列表并显示获取中
        verListMsg('获取中…');
    } else { // 重试：提示但不打断
        verListMsg('获取失败，重试中（' + retry + '/2）…');
    }
    try {
        const r = await githubFetch('/repos/' + t.repo + '/releases?per_page=60');
        let j = null;
        try {
            j = JSON.parse(r.text);
        } catch (e) {
        }
        if (r.ok && Array.isArray(j) && j.length) {
            applyReleases(j.map(x => ({
                tag: x.tag_name,
                ver: tagToVer(x.tag_name),
                date: (x.published_at || '').slice(0, 10),
                pre: !!x.prerelease
            })));
            saveState();
            return;
        }
        // API 失败（常见：未认证 60 次/小时/IP 限流）→ 切换 releases.atom 备用源（无配额限制）
        try {
            applyReleases(await fetchAtomReleases(t.repo));
            saveState();
            // 降级提示：atom 仅最近 10 条，若多为 alpha 正式版会很少（限流约 1 小时自动恢复）
            const tip = document.createElement('div');
            tip.className = 'ver-item';
            tip.style.cssText = 'color:var(--stone-400);cursor:default';
            tip.textContent = '⚠ GitHub API 限流，暂仅显示最近 10 个发布中的正式版（约 1 小时后点「刷新版本」恢复完整列表）';
            $("#verList").prepend(tip);
            return;
        } catch (e2) {/* 备用源也失败，走重试 */
        }
        throw new Error((j && j.message) || ('HTTP ' + r.status));
    } catch (e) {
        if (retry < 2) { // 自动重试（间隔 2s / 4s）
            setTimeout(() => fetchReleases(retry + 1), 2000 * (retry + 1));
            return;
        }
        verListMsg('获取失败（可启用代理或点刷新）');
    }
    saveState();
}

// ============ 模型下拉 ============
function rawModelList() {
    return state.region === 'foreign' ? FOREIGN_MODELS : DOMESTIC_MODELS;
}

function sortedModels() {
    const list = rawModelList().slice();
    const byText = (a, b, k) => String(a[k] || '').localeCompare(String(b[k] || ''), 'zh-Hans-CN', {
        numeric: true,
        sensitivity: 'base'
    });
    if (state.modelSort === 'vendor') {
        list.sort((a, b) => {
            const av = String(a.vendor || ''), bv = String(b.vendor || '');
            const alatin = /^[\x20-\x7E]/.test(av), blatin = /^[\x20-\x7E]/.test(bv);
            if (alatin !== blatin) return alatin ? -1 : 1;
            return av.localeCompare(bv, alatin ? 'en' : 'zh-Hans-CN', {
                numeric: true,
                sensitivity: 'base'
            }) || byText(a, b, 'name');
        });
    } else {
        list.sort((a, b) => (b.ts || 0) - (a.ts || 0) || byText(a, b, 'name'));
    }
    return list;
}

function currentModelId() {
    return state.region === 'foreign' ? state.foreignModelId : state.domesticModelId;
}

function curModel() {
    const list = sortedModels();
    const saved = currentModelId();
    const byId = list.find(m => m.id === saved);
    if (byId) return byId;
    const idx = state.region === 'foreign' ? state.foreignIdx : state.domesticIdx;
    return list[idx] || list[0];
}

function renderModels() {
    const ms = $("#modelSelect");
    ms.innerHTML = '';
    const list = sortedModels();
    if (!list.length) { // 列表为空：在线拉取前显示占位提示
        const o = document.createElement('option');
        o.textContent = PROXY_OK ? '（填好对应网关 API KEY 后自动拉取模型列表）' : '（无本地后端，无法拉取模型列表）';
        ms.appendChild(o);
        renderCfg();
        return;
    }
    list.forEach((m, i) => {
        const o = document.createElement('option');
        o.value = i;
        o.textContent = m.vendor + ' · ' + m.name;
        ms.appendChild(o);
    });
    const current = curModel(), idx = list.indexOf(current);
    ms.value = String(idx < 0 ? 0 : idx);
    const idxKey = state.region === 'foreign' ? 'foreignIdx' : 'domesticIdx';
    const idKey = state.region === 'foreign' ? 'foreignModelId' : 'domesticModelId';
    if (current && (state[idKey] !== current.id || state[idxKey] !== idx)) {
        state[idKey] = current.id;
        state[idxKey] = idx < 0 ? 0 : idx;
        saveState();
    }
    renderCfg();
}

// ============ 从网关 /v1/models 拉取模型列表（国内/国外各用自己的 Key） ============
// 只保留文本对话模型（output_modalities 含「文字」）：嵌入/重排/图片/视频/语音排除
function vendorOf(id) {
    const map = [[/^kimi-/i, 'Kimi / 月之暗面'], [/^qwen/i, 'Qwen / 阿里'], [/^mimo-/i, '小米 MiMo'],
        [/^deepseek-/i, 'DeepSeek'], [/^glm-/i, '智谱'], [/^minimax-/i, 'MiniMax'], [/^seed-/i, '豆包 / 火山引擎'],
        [/^hunyuan-/i, '腾讯混元'], [/^gpt-oss-/i, 'OpenAI (开源)']];
    for (let i = 0; i < map.length; i++) if (map[i][0].test(id)) return map[i][1];
    return '星流中转';
}

function extractModels(list) {
    const out = [];
    (list || []).forEach(x => {
        const outMod = (x.architecture || {}).output_modalities || [];
        if (outMod.indexOf('文字') < 0) return;
        if (/embed|rerank/i.test(x.id)) return;  // 嵌入/重排序（输出模态也标「文字」，按 ID 再排一次）
        out.push({id: x.id, name: x.id, vendor: vendorOf(x.id), wire: 'chat', ts: x.created || 0});
    });
    out.sort((a, b) => b.ts - a.ts);
    return out.map(x => ({id: x.id, name: x.name, vendor: x.vendor, wire: x.wire, ts: x.ts || 0}));
}

async function fetchRegionModels(region) {
    // 列表固定取该区域默认网关（DOM_BASE / GLB_BASE），随「模型来源」切换
    const key = region === 'foreign' ? state.gwKeyGlb : state.gwKeyDom;
    const base = region === 'foreign' ? GLB_BASE : DOM_BASE;
    const r = await proxyFetch(base + '/models', {method: 'GET', headers: {'Authorization': 'Bearer ' + key}});
    let j = null;
    try {
        j = JSON.parse(r.text);
    } catch (e) {
    }
    if (!r.ok || !j || !Array.isArray(j.data)) throw new Error((j && j.error && (j.error.message || j.error)) || ('HTTP ' + r.status));
    return extractModels(j.data);
}

async function fetchAllModels(silent) {
    const btn = $("#fetchModelsBtn");
    if (!PROXY_OK) return;
    const regions = [];
    if (state.gwKeyDom) regions.push('domestic');
    if (state.gwKeyGlb) regions.push('foreign');
    if (!regions.length) return;
    if (!silent) btn.disabled = true;
    let failed = false;
    for (const region of regions) {
        try {
            const list = await fetchRegionModels(region);
            if (region === 'foreign') FOREIGN_MODELS = list; else DOMESTIC_MODELS = list;
        } catch (e) {
            failed = true;
        }  // 失败静默：下拉留空占位提示，重试走「刷新模型列表」
    }
    renderModels();
    if (!failed) fetchModelDetail();
    if (!silent) {
        btn.textContent = failed ? '拉取失败' : '已刷新';
        setTimeout(() => {
            btn.textContent = '刷新模型列表';
            btn.disabled = false;
        }, 1500);
    }
}

// ============ 模型详情（用 Key 拉网关 /v1/models，定位当前选中模型） ============
async function fetchModelDetail() {
    const m = curModel(), card = $("#mdCard"), meta = $("#mdMeta");
    if (!PROXY_OK || !m || !activeKey()) {
        card.classList.remove('show');
        return;
    }
    card.classList.add('show');
    meta.textContent = '获取详情中…';
    try {
        const r = await proxyFetch(gwBaseClean() + '/v1/models', {
            method: 'GET',
            headers: {'Authorization': 'Bearer ' + activeKey()}
        });
        let j = null;
        try {
            j = JSON.parse(r.text);
        } catch (e) {
        }
        const list = (j && j.data) || [];
        const info = list.find(x => x.id === m.id);
        if (info) {
            meta.textContent = info.id
                + (' · owned_by ' + (info.owned_by || '-'))
                + (info.created ? ' · ' + new Date(info.created * 1000).toISOString().slice(0, 10) : '')
                + (info.context_length ? ' · 上下文 ' + info.context_length : '')
                + (info.max_completion_tokens ? ' · 输出 ' + info.max_completion_tokens : '')
                + (info.pricing ? ' · 定价 ' + [info.pricing.prompt, info.pricing.completion].filter(Boolean).join(' / ') : '');
        } else {
            meta.textContent = '未找到该模型详情' + (r.status ? ('（HTTP ' + r.status + '）') : '')
                + ((j && j.error && (j.error.message || j.error)) ? ('：' + (j.error.message || j.error)) : '');
        }
    } catch (e) {
        meta.textContent = '获取失败：' + (e.message || e);
    }
}

// ============ 模型连通性测试 ============
function gwBaseClean() {
    // 网关地址按「模型来源」固定：国内 kspmas ↔ 国外 global-kspmas；去掉结尾 /v1，便于拼接 /v1/xxx
    return (state.region === 'foreign' ? GLB_BASE : DOM_BASE).replace(/\/+$/, '').replace(/\/v1$/i, '');
}

// ============ 协议参数（按「模型协议」动态显示；Auto 不显示、不发送） ============
// 灰色占位=默认值：输入留空时发送默认值；stop/stop_sequences/top_k 默认不传（def 为空）
const PROTO_PARAMS = {
    chat: [
        {k: 'temperature', def: '1', tip: '采样温度，范围 0~2（默认 1）。越高输出越发散'},
        {k: 'top_p', def: '1', tip: '核采样，范围 0~1（默认 1）。与 temperature 择一调节即可'},
        {k: 'max_tokens', def: '1024', tip: '最大输出 token 数（默认 1024）'},
        {k: 'stop', def: '', tip: '停止词，多个用英文逗号分隔；留空不传'},
        {k: 'presence_penalty', def: '0', tip: '存在惩罚，范围 -2~2（默认 0）。正值抑制重复已出现内容'},
        {k: 'frequency_penalty', def: '0', tip: '频率惩罚，范围 -2~2（默认 0）。正值抑制高频词'}
    ],
    anthropic: [
        {k: 'temperature', def: '1', tip: '采样温度，范围 0~1（默认 1）。⚠️ 与 OpenAI 协议的 0~2 不同'},
        {k: 'top_p', def: '1', tip: '核采样，范围 0~1（默认 1）'},
        {k: 'top_k', def: '', tip: '仅 Anthropic 协议支持：只从概率前 K 的 token 中采样；留空不传'},
        {k: 'max_tokens', def: '1024', tip: '最大输出 token 数。⚠️ Anthropic 协议必填（默认 1024）'},
        {k: 'stop_sequences', def: '', tip: '停止序列，多个用英文逗号分隔；留空不传'}
    ],
    responses: [
        {k: 'temperature', def: '1', tip: '采样温度，范围 0~2（默认 1）。越高输出越发散'},
        {k: 'top_p', def: '1', tip: '核采样，范围 0~1（默认 1）'},
        {k: 'max_output_tokens', def: '1024', tip: '最大输出 token 数（默认 1024）。⚠️ 该协议字段名与 max_tokens 不同'}
    ]
};

function renderProtoParams() {
    const bar = $("#protoParams"), hint = $("#protoParamsHint"), defs = PROTO_PARAMS[state.proto];
    if (!defs) {
        bar.style.display = 'none';
        hint.style.display = 'none';
        bar.innerHTML = '';
        return;
    }
    hint.style.display = '';
    bar.style.display = '';
    state.params = state.params || {};
    const user = state.params[state.proto] = state.params[state.proto] || {};
    bar.innerHTML = defs.map(p => {
        const isText = (p.k === 'stop' || p.k === 'stop_sequences');
        return '<div class="field" style="width:190px;flex:none">'
            + '<label>' + p.k + '<span class="help">?<span class="tip">' + esc(p.tip) + '</span></span></label>'
            + '<input data-k="' + p.k + '"' + (isText ? ' type="text"' : ' type="number" step="any"')
            + ' placeholder="默认 ' + (p.def || '不传') + '" value="' + esc(user[p.k] || '') + '">'
            + '</div>';
    }).join('');
}

// 把当前协议参数写入请求体：留空→发送默认值（def 为空的参数不传）；仅 state.proto 非 auto 时调用
function applyProtoParams(body, wire) {
    const defs = PROTO_PARAMS[wire];
    if (!defs) return body;
    const user = (state.params || {})[wire] || {};
    for (const p of defs) {
        const raw = (user[p.k] || '').trim();
        if (raw === '') {
            if (p.def !== '') body[p.k] = Number(p.def);
            continue;
        }
        if (p.k === 'stop' || p.k === 'stop_sequences') {
            body[p.k] = raw.split(',').map(s => s.trim()).filter(Boolean);
            continue;
        }
        const n = Number(raw);
        if (!isNaN(n)) body[p.k] = n;
    }
    return body;
}

function buildSmokeReq(m, forceWire, extraParams) {
    // 协议：Auto = 按工具/模型自动（codex→responses，claude→anthropic）；forceWire 由 Auto 检测逐个尝试时显式指定
    const auto = autoWire(m);
    const wire = forceWire || (state.proto === 'auto' ? auto : state.proto);
    if (wire === 'responses') {
        // max_output_tokens 需容纳推理 token（如 kimi-k3.1 推理即耗 58+），太小会导致 incomplete 无正文
        const body = {
            model: m.id,
            input: [{
                role: 'user',
                content: [{type: 'input_text', text: (state.testPrompt || '请只回复一个词：SPEC_TEXT_OK')}]
            }],
            max_output_tokens: 1024
        };
        if (state.proto !== 'auto') applyProtoParams(body, 'responses');
        Object.assign(body, extraParams || {});
        return {url: gwBaseClean() + '/v1/responses', body: body, wire: wire};
    }
    if (wire === 'anthropic') {
        const body = {
            model: m.id,
            max_tokens: 64,
            messages: [{role: 'user', content: (state.testPrompt || '请只回复一个词：SPEC_TEXT_OK')}]
        };
        if (state.proto !== 'auto') applyProtoParams(body, 'anthropic');
        Object.assign(body, extraParams || {});
        return {url: gwBaseClean() + '/v1/messages', body: body, wire: wire};
    }
    const body = {
        model: m.id,
        messages: [{role: 'user', content: (state.testPrompt || '请只回复一个词：SPEC_TEXT_OK')}],
        max_tokens: 64
    };
    if (state.proto !== 'auto') applyProtoParams(body, 'chat');
    Object.assign(body, extraParams || {});
    return {url: gwBaseClean() + '/v1/chat/completions', body: body, wire: wire};
}

function extractText(j, wire) {
    try {
        if (wire === 'responses') {
            if (j.output_text) return j.output_text;
            const items = (j.output || []).filter(o => o.type === 'message').flatMap(o => o.content || []);
            return items.map(c => c.text || '').join('');
        }
        if (wire === 'anthropic') {
            return (j.content || []).map(c => c.text || '').join('');
        }
        return (j.choices && j.choices[0] && (j.choices[0].message || {}).content) || '';
    } catch (e) {
        return '';
    }
}

// 按 wire 发一次连通性测试请求并判定，返回 {req,r,ms,j,text,pass}
async function judgeOne(m, wire, customHeaders, extraParams) {
    const req = buildSmokeReq(m, wire, extraParams);
    const headers = wire === 'anthropic'
        ? {'Content-Type': 'application/json', 'x-api-key': activeKey(), 'anthropic-version': '2023-06-01'}
        : {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + activeKey()};
    for (const [k, v] of Object.entries(customHeaders || {})) {
        headers[k] = typeof v === 'string' ? v : JSON.stringify(v);
    }
    const bodyStr = JSON.stringify(req.body);
    const t0 = Date.now();
    const r = await proxyFetch(req.url, {method: 'POST', headers: headers, body: bodyStr});
    const ms = Date.now() - t0;
    let j = null;
    try {
        j = JSON.parse(r.text);
    } catch (e) {
    }
    const text = j ? extractText(j, wire) : '';
    return {req: req, r: r, ms: ms, j: j, text: text, pass: !!(r.ok && text && text.trim())};
}

async function runSmoke() {
    const m = curModel(), btn = $("#runBtn");
    const fail = (msg) => {
        $("#resultCard").classList.add('show');
        $("#resTag").textContent = 'FAIL';
        $("#resTag").className = 'res-tag res-fail';
        $("#resMeta").textContent = msg;
        $("#reqPre").textContent = '';
        $("#respPre").textContent = '';
        btn.disabled = false;
    };
    if (!m) {
        fail('无可用模型（请先拉取模型列表）');
        return;
    }
    if (!PROXY_OK) {
        fail('无本地代理(serve.py)，真发禁用：请先 python serve.py 后刷新本页');
        return;
    }
    if (!activeKey()) {
        fail('请先填写网关 API Key（' + (state.region === 'foreign' ? '国外' : '国内') + '）');
        return;
    }
    let customHeaders = {}, extraParams = {};
    try {
        customHeaders = parseJsonObject(state.customHeaders, '自定义 Headers');
        extraParams = parseJsonObject(state.extraParams, '其他参数');
    } catch (e) {
        fail(e.message);
        return;
    }
    btn.disabled = true;
    const WL = {chat: 'Completion', anthropic: 'Anthropic', responses: 'Responses'};
    // Auto 档：三种协议全部按协议默认参数测一遍（自定义 Headers / 其他参数仍生效），指定协议只测该协议
    const first = autoWire(m);
    const isAuto = state.proto === 'auto';
    const attempts = isAuto
        ? [first, 'chat', 'responses', 'anthropic'].filter((w, i, a) => a.indexOf(w) === i)
        : [state.proto];
    $("#resultCard").classList.add('show');
    const results = [];
    for (const w of attempts) {
        const out = await judgeOne(m, w, customHeaders, extraParams);
        out.w = w;
        results.push(out);
        if (!isAuto) { // 指定协议：边测边显示
            $("#reqPre").textContent = out.req.url + '\n' + JSON.stringify(out.req.body);
            $("#respPre").textContent = out.r.text || '(空)';
        }
    }
    const winner = results.find(r => r.pass) || null;
    const fin = winner || results[results.length - 1];
    // 协议支持标注（输出框顶部）
    const support = '【协议支持】' + results.map(r =>
        (WL[r.w] || r.w) + '：' + (r.pass ? '✓ 支持' : '✗ 不支持（HTTP ' + (r.r.status || 'err') + '）')).join('　｜　');
    if (isAuto) {
        $("#reqPre").textContent = results.map(r => '=== ' + (WL[r.w] || r.w) + ' ===\n' + r.req.url + '\n' + JSON.stringify(r.req.body)).join('\n\n');
        $("#respPre").textContent = support + '\n\n'
            + results.map(r => '--- ' + (WL[r.w] || r.w) + ' ' + (r.pass ? '✔' : '❌') + '（' + r.ms + 'ms）---\n' + String(r.text || r.r.text || '(空)').slice(0, 400)).join('\n\n')
            + (winner ? '\n\n=== 首个通过协议 ' + (WL[winner.w] || winner.w) + ' 完整响应 ===\n' + winner.text : '');
    } else {
        $("#respPre").textContent = support + '\n\n' + (fin.r.text || '(空)');
    }
    $("#resTag").textContent = winner ? 'PASS' : 'FAIL';
    $("#resTag").className = 'res-tag ' + (winner ? 'res-pass' : 'res-fail');
    $("#resMeta").textContent = (isAuto ? 'Auto 全协议检测 ' + results.map(r => (WL[r.w] || r.w) + (r.pass ? ' ✅' : ' ❌')).join(' · ') + ' · ' : '')
        + (fin ? ('HTTP ' + fin.r.status + ' · ' + fin.ms + 'ms · ') : '') + m.vendor + ' · ' + m.id
        + (winner ? (' · ' + (WL[winner.w] || winner.w) + ' 协议可用') : '');
    btn.disabled = false;
    renderCfg();
}

// ============ 接入配置生成 ============
function renderCfg() {
    const t = curTool(), m = curModel();
    if (!t || !m) return;
    // 协议与连通性测试一致：Auto 按工具/模型自动（codex→Responses，claude→Anthropic）；codex 配置里 anthropic 映射为 chat（wire_api 仅支持 chat/responses）
    const auto = autoWire(m);
    const wire = (state.proto === 'auto' ? auto : state.proto) === 'anthropic' ? 'chat' : (state.proto === 'auto' ? auto : state.proto);
    const base = gwBaseClean() + '/v1';
    $("#cfgFileTitle").textContent = t.cfgTitle;
    $("#cfgSub").textContent = t.cfgDesc + ' · ' + m.id;
    if (t.id === 'claude-code') {
        // Claude Code：settings.json 的 env 块自包含（BASE_URL 不带 /v1，工具自行拼 /v1/messages；Key 一并写入本地配置）
        // 必须是严格 JSON（不能带注释），「覆盖配置文件」按原文写入
        $("#cfgPre").textContent =
            '{\n' +
            '  "env": {\n' +
            '    "ANTHROPIC_BASE_URL": "' + gwBaseClean() + '",\n' +
            '    "ANTHROPIC_AUTH_TOKEN": "' + (activeKey() || 'sk-...') + '"\n' +
            '  }\n' +
            '}\n';
        $("#cmdPre").textContent =
            '# 点「覆盖配置文件」将上方配置写入 ' + t.cfgTitle + '（含 BASE_URL 与 Key）后直接运行\n' +
            'claude -p "请只回复一个词：SPEC_TEXT_OK" --model ' + m.id + '   # 非交互一次性测试\n' +
            'claude --model ' + m.id + '                                      # 进入交互模式\n\n' +
            '# 等效环境变量方式（不写 settings.json 时使用）\n' +
            'export ANTHROPIC_BASE_URL="' + gwBaseClean() + '"\n' +
            'export ANTHROPIC_AUTH_TOKEN="' + (activeKey() || 'sk-...') + '"\n';
        return;
    }
    $("#cfgPre").textContent =
        '# 工具版本：' + ((state.verTags || [])[0] || '未知') + '（' + t.repo + ' Releases）\n' +
        'model = "' + m.id + '"\n' +
        'model_provider = "starflow"\n' +
        '\n' +
        '[model_providers.starflow]\n' +
        'name = "星流聚合网关"\n' +
        'base_url = "' + base + '"\n' +
        'wire_api = "' + (wire === 'responses' ? 'responses' : 'chat') + '"\n' +
        'env_key = "STARFLOW_API_KEY"\n';
    $("#cmdPre").textContent =
        '# 环境变量（当前会话，Key 仅存本机）\n' +
        'export STARFLOW_API_KEY="' + (activeKey() || 'sk-...') + '"\n\n' +
        '# 点「覆盖配置文件」将上方配置写入 ' + t.cfgTitle + ' 后直接运行\n' +
        'codex exec "请只回复一个词：SPEC_TEXT_OK"   # 非交互一次性测试\n' +
        'codex --model ' + m.id + '                      # 进入交互模式\n';
}

// ============ 下载并验证（多版本并行） ============
// 轮询 /dljob 后台任务至 done；onProgress(pct,received,total) 每 400ms 回调；连续 5 次查询失败才判该行失败
async function pollDljob(jid, onProgress) {
    let fails = 0;
    for (; ;) {
        const st = await API.localGet('/dljob?id=' + encodeURIComponent(jid));
        if (st && st.ok) {
            fails = 0;
            if (st.status === 'done') return st;
            if (st.status === 'error') throw new Error(st.error || '下载失败');
            const pct = st.total ? Math.min(100, Math.round(st.received / st.total * 100)) : 0;
            if (onProgress) onProgress(pct, st.received || 0, st.total || 0);
        } else if (++fails >= 5) throw new Error((st && st.error) || '进度查询失败');
        await new Promise(r => setTimeout(r, 400));
    }
}

// 单版本：POST /dljob → pollDljob → done 后立即 POST /tool（缓存命中即时 --version）→ 更新该行 + 追加汇总；任何失败只终结本行
async function dlVerifyOne(t, ver, proxy) {
    const row = document.createElement('div');
    row.className = 'prog-wrap';
    row.innerHTML = '<div class="prog-txt"></div><div class="prog"><div class="bar" style="width:0%"></div></div>';
    $("#dlRows").appendChild(row);
    const pt = row.querySelector(".prog-txt"), pb = row.querySelector(".bar");
    const mb = v => (v / 1048576).toFixed(1);
    const fin = (pass, txt) => {
        pt.innerHTML = '<span class="res-tag ' + (pass ? 'res-pass' : 'res-fail') + '">' + (pass ? 'PASS' : 'FAIL') + '</span> ' + esc(txt);
        pb.style.width = '100%';
        if (!pass) pb.style.background = 'var(--rd-solid)';
    };
    const append = out => {
        const pre = $("#dlPre");
        pre.textContent += (pre.textContent ? '\n\n' : '') + '=== ' + (t.bin || t.id) + ' ' + ver + ' ===\n' + out;
    };
    try {
        pt.textContent = '启动下载 ' + (t.bin || t.id) + ' ' + ver + '…';
        const sj = await API.local("/dljob", {kind: t.id, repo: t.repo, tag: ver, ver: ver, proxy: proxy});
        if (!sj.ok) throw new Error(sj.error || '启动下载失败');  // sj.already 同样 ok：共用 jid 轮询即可
        await pollDljob(sj.id, (pct, recv, total) => {
            pt.textContent = '下载 ' + (t.bin || t.id) + ' ' + ver + '… ' + pct + '%' + (total ? ('（' + mb(recv) + ' / ' + mb(total) + ' MB）') : '（' + mb(recv) + ' MB）');
            pb.style.width = pct + '%';
        });
        pt.textContent = '验证 ' + (t.bin || t.id) + ' ' + ver + '…';
        const j = await API.local("/tool", {kind: t.id, repo: t.repo, tag: ver, ver: ver, proxy: proxy});
        const pass = !!j.ok, out = j.output || j.error || '(无输出)';
        fin(pass, ver + ' · ' + out.trim().split('\n')[0].slice(0, 120) + (j.code != null ? (' · exit ' + j.code) : ''));
        append(out);
        return {pass: pass, platform: j.platform || ''};
    } catch (e) {
        fin(false, ver + ' · ' + (e.message || e));
        append('下载/验证失败：' + (e.message || e));
        return {pass: false};
    }
}

let dlRunning = false;  // 防重复触发兜底（按钮 disabled 之外）
async function runDlVerify() {
    const t = curTool(), btn = $("#dlBtn");
    if (!LOCAL_OK) {
        $("#dlCard").classList.add('show');
        $("#dlTag").textContent = 'FAIL';
        $("#dlTag").className = 'res-tag res-fail';
        $("#dlPre").textContent = '本地后端未启动（二进制/serve.py），下载验证不可用';
        return;
    }
    const vers = (state.verTags || []).slice();  // 快照：下载中改勾选不影响本轮
    if (!vers.length) {
        $("#dlCard").classList.add('show');
        $("#dlTag").textContent = 'FAIL';
        $("#dlTag").className = 'res-tag res-fail';
        $("#dlMeta").textContent = '';
        $("#dlPre").textContent = '请先勾选至少一个版本';
        return;
    }
    if (dlRunning) return;
    dlRunning = true;
    btn.disabled = true;
    $("#dlCard").classList.add('show');
    $("#dlTag").textContent = '下载中';
    $("#dlTag").className = 'res-tag res-skip';
    $("#dlMeta").textContent = vers.length + ' 个版本并行下载验证中…';
    $("#dlPre").textContent = '';
    $("#dlRows").innerHTML = '';
    const proxy = (state.ghProxyOn && state.proxyType === 'l4') ? state.proxyAddr : undefined;
    const t0 = Date.now();
    const results = await Promise.all(vers.map(ver => dlVerifyOne(t, ver, proxy)));  // dlVerifyOne 永不 throw
    const pass = results.filter(r => r.pass).length;
    $("#dlTag").textContent = pass + '/' + vers.length + ' PASS';
    $("#dlTag").className = 'res-tag ' + (pass === vers.length ? 'res-pass' : (pass ? 'res-skip' : 'res-fail'));
    $("#dlMeta").textContent = [results.find(r => r.platform) && results.find(r => r.platform).platform, ((Date.now() - t0) / 1000).toFixed(1) + 's'].filter(Boolean).join(' · ');
    dlRunning = false;
    btn.disabled = false;
}

// ============ 数据集压测（快照解析 → serve.py /datasetrun 并发拉起工具） ============
let dsCases = [];   // [{id,rounds:[prompt,...],sentinel}]
let dsFileName = '';     // 上传的数据集文件名（报告导出用）
let dsReportMeta = null; // 本次压测的报告元信息（工具版本/数据集/参数），供「下载结果」
// 拼接 JSON / JSONL 混合文本 → 逐个 JSON 对象（容忍报错段/非 JSON 夹杂）
function extractJsonObjects(s) {
    const out = [];
    let i = 0;
    while (i < s.length) {
        while (i < s.length && /\s/.test(s[i])) i++;
        if (s[i] !== '{') {
            i++;
            continue;
        }
        let depth = 0, inStr = false, esc = false, start = i;
        for (; i < s.length; i++) {
            const c = s[i];
            if (inStr) {
                if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false;
                continue;
            }
            if (c === '"') {
                inStr = true;
                continue;
            }
            if (c === '{') depth++;
            else if (c === '}') {
                depth--;
                if (!depth) {
                    i++;
                    break;
                }
            }
        }
        try {
            out.push(JSON.parse(s.slice(start, i)));
        } catch (e) {
        }
    }
    return out;
}

// 快照导出常带 HTML 转义（&lt;app-context&gt; 等），反转义回原文（&amp; 最后处理）
function htmlUnescape(s) {
    return String(s == null ? '' : s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

// 请求快照 → 用例：input 里按序 user 文本为多轮脚本，instructions 并入首轮；
// reasoning / function_call / function_call_output 不注入（工具自管理会话与工具循环）
function snapshotsToCases(objs) {
    const cases = [];
    objs.forEach((o, oi) => {
        if (!o || !Array.isArray(o.input)) return;
        const rounds = [];
        o.input.forEach(it => {
            if (!it || it.role !== 'user') return;
            const c = it.content;
            let txt = '';
            if (typeof c === 'string') txt = c;
            else if (Array.isArray(c)) txt = c.filter(p => p && (p.type === 'input_text' || p.type === 'text')).map(p => p.text || '').join('\n');
            txt = htmlUnescape(txt).trim();
            if (txt) rounds.push(txt);
        });
        if (!rounds.length) return;
        if (typeof o.instructions === 'string' && o.instructions.trim()) rounds[0] = htmlUnescape(o.instructions).trim() + '\n\n' + rounds[0];
        cases.push({id: '快照' + (oi + 1), rounds: rounds, sentinel: ''});
    });
    return cases;
}

async function pollDsjob(jid, onProgress) {
    let fails = 0;
    for (; ;) {
        const st = await API.localGet('/datasetrun?id=' + encodeURIComponent(jid));
        if (st && st.ok) {
            fails = 0;
            if (st.status === 'done') return st;
            if (st.status === 'error') throw new Error(st.error || '压测失败');
            if (onProgress) onProgress(st.done || 0, st.total || 0, st.stage || '');
        } else if (++fails >= 5) throw new Error((st && st.error) || '进度查询失败');
        await new Promise(r => setTimeout(r, 800));
    }
}

async function runDataset() {
    const btn = $("#dsRunBtn"), card = $("#dsCard");
    const fail = (msg) => {
        card.classList.add('show');
        $("#dsTag").textContent = 'FAIL';
        $("#dsTag").className = 'res-tag res-fail';
        $("#dsMeta").textContent = msg;
        $("#dsPre").textContent = '';
        btn.disabled = false;
    };
    if (!LOCAL_OK) {
        fail('本地后端未启动（二进制/serve.py）');
        return;
    }
    if (!dsCases.length) {
        fail('请先上传数据集（需含 input 数组的请求快照）');
        return;
    }
    const m = curModel();
    if (!m) {
        fail('无可用模型（请先拉取模型列表）');
        return;
    }
    if (!activeKey()) {
        fail('请先填写网关 API KEY（' + (state.region === 'foreign' ? '国外' : '国内') + '）');
        return;
    }
    const t = curTool(), tvs = (state.verTags || []).slice();  // 勾选的每个版本各跑一遍（空 = 本机工具）
    const sIn = $("#dsSentinel").value.trim();
    const cases = dsCases.map(c => ({id: c.id, rounds: c.rounds, sentinel: sIn || c.sentinel || ''}));
    const conc = +$("#dsConc").value || 2, rep = +$("#dsRepeat").value || 1;
    btn.disabled = true;
    card.classList.add('show');
    $("#dsTag").textContent = '压测中';
    $("#dsTag").className = 'res-tag res-skip';
    $("#dsMeta").textContent = t.name + ' · ' + (tvs.length ? ('版本 ' + tvs.join('、')) : '(本机)') + ' · ' + cases.length + ' 用例 × ' + rep + ' 重复 · 并发 ' + conc;
    $("#dsProgWrap").style.display = 'block';
    $("#dsProgBar").style.width = '0%';
    $("#dsProgTxt").textContent = '准备中…';
    $("#dsPre").textContent = '';
    try {
        const sj = await API.local("/datasetrun", {
            kind: t.id, repo: t.repo, tags: tvs,
            base_url: gwBaseClean() + (t.id === 'claude-code' ? '' : '/v1'), model: m.id, api_key: activeKey(),
            cases: cases, conc: conc, repeat: rep, timeout: +$("#dsTimeout").value || 180,
            proxy: (state.ghProxyOn && state.proxyType === 'l4') ? state.proxyAddr : undefined
        });
        if (!sj.ok) throw new Error(sj.error || '启动失败');
        const st = await pollDsjob(sj.id, (done, total, stage) => {
            // 下载工具二进制阶段 done 不动，单独提示避免"进度卡 0"的困惑
            if (stage === 'download') {
                $("#dsProgTxt").textContent = '准备工具中（下载 ' + tvs.length + ' 个版本，缓存命中则秒过）…';
                return;
            }
            $("#dsProgTxt").textContent = '进度 ' + done + '/' + total + '（按轮）';
            $("#dsProgBar").style.width = (total ? Math.round(done / total * 100) : 0) + '%';
        });
        $("#dsProgWrap").style.display = 'none';
        const s = st.summary || {}, okN = s.ok || 0, totalN = s.total || (st.results || []).length;
        $("#dsTag").textContent = okN >= totalN ? 'PASS' : (okN ? 'PARTIAL' : 'FAIL');
        $("#dsTag").className = 'res-tag ' + (okN >= totalN ? 'res-pass' : (okN ? 'res-skip' : 'res-fail'));
        $("#dsMeta").textContent = '成功 ' + okN + '/' + totalN + ' · P50 ' + (s.p50 || 0) + 's · P95 ' + (s.p95 || 0) + 's'
            + (s.errors && Object.keys(s.errors).length ? (' · 失败 ' + JSON.stringify(s.errors)) : '');
        // 按版本分组输出：每组标题行带该版本摘要（多版本对比一目了然）
        const flat = s => String(s || '').replace(/\n/g, ' ');
        const one = r => {
            const head = '=== ' + r.case + ' rep' + (r.rep + 1) + ' ' + (r.ok ? 'OK' : 'FAIL') + ' ' + r.elapsed + 's' + (r.error ? (' · ' + flat(r.error).slice(0, 240)) : '') + ' ===';
            return [head].concat((r.rounds || []).map((x, i) => '轮' + (i + 1) + ' ' + (x.ok ? '✓' : '✗') + ' ' + x.elapsed + 's' + (x.error ? (' · ' + flat(x.error).slice(0, 240)) : '') + ' · ' + flat(x.output).slice(0, 120))).join('\n');
        };
        const byVer = {};
        (st.results || []).forEach(r => {
            const k = r.ver || '本机';
            (byVer[k] = byVer[k] || []).push(r);
        });
        const sums = st.summaries || {};
        $("#dsPre").textContent = Object.keys(byVer).map(k => {
            const sv = sums[k] || {};
            const line = '【' + t.name + ' ' + k + '】成功 ' + (sv.ok || 0) + '/' + (sv.total || 0) + ' · P50 ' + (sv.p50 || 0) + 's · P95 ' + (sv.p95 || 0) + 's'
                + (sv.errors && Object.keys(sv.errors).length ? (' · 失败 ' + JSON.stringify(sv.errors)) : '');
            return line + '\n' + byVer[k].map(one).join('\n\n');
        }).join('\n\n');
    } catch (e) {
        $("#dsProgWrap").style.display = 'none';
        fail('压测失败：' + (e.message || e));
    }
    // 压测结束（含失败）：记录报告元信息，开放「下载结果」导出 txt
    const now = new Date(), pad = n => String(n).padStart(2, '0');
    dsReportMeta = {
        tool: t.name, ver: tvs.length ? tvs.join('、') : '（本机）', file: dsFileName || '（未命名）',
        model: m.id, base: gwBaseClean() + (t.id === 'claude-code' ? '' : '/v1'),
        params: '并发 ' + conc + ' · 重复 ' + rep + ' · 每轮超时 ' + (+$("#dsTimeout").value || 180) + 's' + (sIn ? (' · 哨兵 "' + sIn + '"') : ''),
        time: now.toLocaleString('zh-CN', {hour12: false}),
        ts: '' + now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) + '-' + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds())
    };
    $("#dsDlBtn").style.display = '';
    btn.disabled = false;
}

// 导出压测报告 txt：元信息（工具版本/数据集文件/模型网关/参数）+ 结果摘要 + 明细（当前 dsPre 内容）
function dsDownload() {
    if (!dsReportMeta) return;
    const m = dsReportMeta;
    const head = ['星流数据集压测报告',
        '生成时间: ' + m.time,
        '工具: ' + m.tool + ' · 版本 ' + m.ver,
        '数据集: ' + m.file,
        '模型: ' + m.model + ' · 网关: ' + m.base,
        '执行参数: ' + m.params,
        '================================'].join('\n');
    const body = [$('#dsTag').textContent + ' · ' + $('#dsMeta').textContent, '', $('#dsPre').textContent].join('\n');
    const blob = new Blob(['\ufeff' + head + '\n' + body], {type: 'text/plain;charset=utf-8'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '压测结果_' + m.file.replace(/[^\w.\-\u4e00-\u9fa5]+/g, '_') + '_' + m.ts + '.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

// ============ 绑定 ============
// 同步 seg 高亮到 state[key]（程序化改值后调用，如切工具联动协议）
function syncSeg(segId, key) {
    $("#" + segId).querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.v === state[key]));
}

function bindSeg(segId, key, after) {
    const seg = $("#" + segId);
    seg.querySelectorAll('.seg-btn').forEach(b => {
        b.onclick = () => {
            seg.querySelectorAll('.seg-btn').forEach(x => x.classList.remove('active'));
            b.classList.add('active');
            state[key] = b.dataset.v;
            saveState();
            if (after) after();
        };
    });
    syncSeg(segId, key);
}

function renderProxyUI() {
    $("#ghProxyOn").checked = !!state.ghProxyOn;
    $("#proxyAddr").value = state.proxyAddr || '';
    const l4 = state.proxyType !== 'l7';
    $("#proxyAddr").placeholder = l4 ? 'http://10.0.0.1:8080' : 'https://gh-proxy.com';
    $("#proxyTip").textContent = l4
        ? '4 层代理（传输层）：gost / shadowsocks 等自建 HTTP 代理，填 http://IP:端口，经本地 serve.py 转发访问 GitHub'
        : '7 层代理（应用层）：互联网公开的镜像代理（如 gh-proxy.com），填 https://gh-proxy.com，会自动将完整 GitHub 地址拼接在代理地址后面';
}

// 7 层代理地址默认 gh-proxy.com（仅在地址为空时填入，不覆盖用户已填值）
function applyProxyDefault() {
    if (state.proxyType === 'l7' && !state.proxyAddr) {
        state.proxyAddr = 'https://gh-proxy.com';
        saveState();
    }
}

function init() {
    // 工具下拉
    const ts = $("#toolSelect");
    TOOLS.forEach(t => {
        const o = document.createElement('option');
        o.value = t.id;
        o.textContent = t.name;
        ts.appendChild(o);
    });
    ts.value = state.tool;
    ts.onchange = () => {
        state.tool = ts.value;
        // 协议随工具自动切换：codex→Responses，claude-code→Anthropic（切工具即重置，仍可手动改）
        state.proto = state.tool === 'codex' ? 'responses' : (state.tool === 'claude-code' ? 'anthropic' : 'auto');
        saveState();
        syncSeg('protoSeg', 'proto');
        renderProtoParams();
        renderCfg();
        fetchReleases();
    };

    // 单输入框编辑「当前区域」的 Key，标签随「模型来源」切换（两把 Key 分开存）
    renderKeyUI();
    $("#gwKey").oninput = e => {
        if (state.region === 'foreign') state.gwKeyGlb = e.target.value.trim(); else state.gwKeyDom = e.target.value.trim();
        saveState();
        renderCfg();
    };
    // 填好 Key 自动拉对应区域模型列表（onchange 触发，不逐键请求）
    $("#gwKey").onchange = () => {
        fetchAllModels(true);
        fetchModelDetail();
    };

    $("#testPrompt").value = state.testPrompt || '请只回复一个词：SPEC_TEXT_OK';
    $("#testPrompt").oninput = e => {
        state.testPrompt = e.target.value;
        saveState();
    };
    $("#customHeadersInput").value = state.customHeaders || '';
    $("#customHeadersInput").oninput = e => {
        state.customHeaders = e.target.value;
        saveState();
    };
    $("#extraParamsInput").value = state.extraParams || '';
    $("#extraParamsInput").oninput = e => {
        state.extraParams = e.target.value;
        saveState();
    };

    // 控制台 Cookie：粘贴后自动拉全量模型列表；启动时已有 Cookie 则静默自动加载
    $("#fetchModelsBtn").onclick = () => fetchAllModels(false);

    $("#regionSeg").querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.v === state.region));
    $("#regionSeg").querySelectorAll('.seg-btn').forEach(b => b.onclick = () => {
        $("#regionSeg").querySelectorAll('.seg-btn').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        const prev = state.region;
        state.region = b.dataset.v;
        saveState();
        renderKeyUI(); // 标签（国内）/（国外）与输入框内的 Key 跟随区域切换
        renderModels();
        fetchModelDetail();
        // 该区域还没有列表且已填 Key：切过去顺手拉一次
        const empty = state.region === 'foreign' ? !FOREIGN_MODELS.length : !DOMESTIC_MODELS.length;
        if (empty && activeKey()) fetchAllModels(true);
    });
    $("#modelSelect").onchange = e => {
        const idx = +e.target.value, m = sortedModels()[idx];
        if (state.region === 'foreign') state.foreignIdx = idx; else state.domesticIdx = idx;
        if (m) {
            if (state.region === 'foreign') state.foreignModelId = m.id; else state.domesticModelId = m.id;
        }
        saveState();
        renderCfg();
        fetchModelDetail();
    };
    $("#modelSortSelect").value = state.modelSort === 'newest' ? 'newest' : 'vendor';
    $("#modelSortSelect").onchange = e => {
        state.modelSort = e.target.value === 'newest' ? 'newest' : 'vendor';
        saveState();
        renderModels();
        fetchModelDetail();
    };

    $("#ghProxyOn").onchange = e => {
        state.ghProxyOn = e.target.checked;
        saveState();
        applyProxyDefault();
        renderProxyUI();
        fetchReleases();
    };
    bindSeg('proxyTypeSeg', 'proxyType', () => {
        applyProxyDefault();
        renderProxyUI();
    });
    bindSeg('protoSeg', 'proto', () => {
        renderProtoParams();
        renderCfg();
    });
    // 协议参数输入持久化（key 按协议分开存）
    $("#protoParams").addEventListener('input', e => {
        const k = e.target.dataset.k;
        if (!k) return;
        state.params = state.params || {};
        (state.params[state.proto] = state.params[state.proto] || {})[k] = e.target.value;
        saveState();
    });
    $("#mdRefresh").onclick = fetchModelDetail;
    $("#proxyAddr").oninput = e => {
        state.proxyAddr = e.target.value.trim();
        saveState();
    };
    // 版本下拉面板：点框开关，点外部/Esc 关闭
    const verSelectBox = $("#verSelectBox"), verPop = $("#verPop");
    const closeVerPop = () => {
        verPop.classList.remove('show');
        verSelectBox.classList.remove('open');
    };
    verSelectBox.onclick = e => {
        e.stopPropagation();
        const open = !verPop.classList.contains('show');
        verPop.classList.toggle('show', open);
        verSelectBox.classList.toggle('open', open);
    };
    verPop.onclick = e => e.stopPropagation();  // 面板内点击不关闭（勾选后可连续操作）
    document.addEventListener('click', closeVerPop);
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') closeVerPop();
    });
    $("#verRefresh").onclick = fetchReleases;
    $("#popAll").onclick = () => {
        $("#verList").querySelectorAll('input').forEach(cb => cb.checked = true);
        syncVerTags();
    };
    $("#popNone").onclick = () => {
        $("#verList").querySelectorAll('input').forEach(cb => cb.checked = false);
        syncVerTags();
    };

    // 下载并验证工具二进制（多版本并行）：平台自动识别 → 逐版本 /dljob 后台下载 → 完成后 --version 验证
    $("#dlBtn").onclick = runDlVerify;
    // 清理缓存：后端删已下载的 codex/claude 二进制 + 任务记录 + 测试临时目录；前端清数据集与测试输出
    $("#clearBtn").onclick = async () => {
        const btn = $("#clearBtn");
        const done = (txt) => {
            btn.textContent = txt;
            setTimeout(() => {
                btn.textContent = '清理缓存';
                btn.disabled = false;
            }, 2500);
        };
        if (dlRunning) {
            done('下载进行中');
            return;
        }
        btn.disabled = true;
        // 前端状态先清（数据集在内存里，不依赖后端）
        dsCases = [];
        dsFileName = '';
        dsReportMeta = null;
        $("#dsFile").value = '';
        $("#dlCard").classList.remove('show');
        $("#dlRows").innerHTML = '';
        $("#dlPre").textContent = '';
        $("#dlMeta").textContent = '';
        $("#dsCard").classList.remove('show');
        $("#dsPre").textContent = '';
        $("#dsMeta").textContent = '';
        $("#dsProgWrap").style.display = 'none';
        $("#dsDlBtn").style.display = 'none';
        $("#ttCard").classList.remove('show');
        $("#ttPre").textContent = '';
        $("#ttMeta").textContent = '';
        try {
            const j = await API.local("/clearcache", {});
            if (j && j.ok) done('已清理' + (j.freed ? (' ' + (j.freed / 1048576).toFixed(1) + ' MB') : ''));
            else done('前端已清；后端：' + ((j && j.error) || '不可达'));
        } catch (e) {
            done('前端已清；后端：' + (e.message || e));
        }
    };
    // 数据集压测：上传快照 → 本机解析为多轮用例 → /datasetrun 并发执行
    $("#dsFile").onchange = e => {
        const f = e.target.files && e.target.files[0];
        dsCases = [];
        dsFileName = '';
        if (!f) return;
        dsFileName = f.name;
        const rd = new FileReader();
        rd.onload = () => {
            try {
                dsCases = snapshotsToCases(extractJsonObjects(String(rd.result || '')));
            } catch (err) {
                dsCases = [];
            }
        };
        rd.readAsText(f);
    };
    $("#dsRunBtn").onclick = runDataset;
    // 下载压测结果报告 txt（工具版本/数据集文件/结果明细）
    $("#dsDlBtn").onclick = () => {
        dsDownload();
        const b = $("#dsDlBtn");
        b.textContent = '已下载';
        setTimeout(() => {
            b.textContent = '下载结果';
        }, 1500);
    };
    // 工具测试：拉起所选工具（优先页面勾选的第一个版本），用完整网关路径 + 所选模型端到端执行一次（serve.py /tooltest）
    $("#toolTestBtn").onclick = async () => {
        const m = curModel(), btn = $("#toolTestBtn"), tv = (state.verTags || [])[0] || '', t = curTool(),
            tn = t.bin || t.id;
        const fail = (msg) => {
            $("#ttCard").classList.add('show');
            $("#ttTag").textContent = 'FAIL';
            $("#ttTag").className = 'res-tag res-fail';
            $("#ttMeta").textContent = msg;
            $("#ttPre").textContent = '';
            btn.disabled = false;
        };
        if (!m) {
            fail('无可用模型（请先拉取模型列表）');
            return;
        }
        if (!LOCAL_OK) {
            fail('本地后端未启动（二进制/serve.py），工具测试不可用');
            return;
        }
        if (!activeKey()) {
            fail('请先填写网关 API Key（' + (state.region === 'foreign' ? '国外' : '国内') + '）');
            return;
        }
        // codex 走 /v1（wire_api=responses）；claude 的 ANTHROPIC_BASE_URL 不带 /v1
        const toolBase = gwBaseClean() + (t.id === 'claude-code' ? '' : '/v1');
        btn.disabled = true;
        $("#ttCard").classList.add('show');
        $("#ttTag").textContent = '执行中';
        $("#ttTag").className = 'res-tag res-skip';
        $("#ttMeta").textContent = m.id + ' · ' + toolBase + ' · ' + tn + ' ' + (tv || '(本机)') + (t.id === 'claude-code' ? ' -p' : ' exec');
        // 1. 指定版本：先经 /dljob 后台下载并轮询进度条（缓存命中则直接完成）
        if (tv) {
            const pw = $("#ttProgWrap"), pt = $("#ttProgTxt"), pb = $("#ttProgBar");
            pw.style.display = 'block';
            pb.style.width = '0%';
            try {
                const sj = await API.local("/dljob", {
                    kind: t.id, repo: t.repo, tag: tv, ver: tv,
                    proxy: (state.ghProxyOn && state.proxyType === 'l4') ? state.proxyAddr : undefined
                });
                if (!sj.ok) throw new Error(sj.error || '启动下载失败');
                const mb = v => (v / 1048576).toFixed(1);
                const st = await pollDljob(sj.id, (pct, recv, total) => {
                    pt.textContent = '下载 ' + tn + ' ' + tv + '… ' + pct + '%' + (total ? ('（' + mb(recv) + ' / ' + mb(total) + ' MB）') : '（' + mb(recv) + ' MB）');
                    pb.style.width = pct + '%';
                });
                pt.textContent = '下载完成（' + (st.bin || tv) + '）';
                pb.style.width = '100%';
            } catch (e) {
                pw.style.display = 'none';
                $("#ttTag").textContent = 'FAIL';
                $("#ttTag").className = 'res-tag res-fail';
                $("#ttMeta").textContent = '下载 ' + tn + ' 失败：' + (e.message || e);
                $("#ttPre").textContent = '';
                btn.disabled = false;
                return;
            }
            pw.style.display = 'none';
        }
        $("#ttPre").textContent = '…';
        try {
            const j = await API.local("/tooltest", {
                kind: t.id, base_url: toolBase, model: m.id, api_key: activeKey(),
                prompt: state.testPrompt || '请只回复一个词：SPEC_TEXT_OK',
                repo: t.repo, tag: tv, ver: tv,
                proxy: (state.ghProxyOn && state.proxyType === 'l4') ? state.proxyAddr : undefined
            });
            const pass = !!j.ok;
            $("#ttTag").textContent = pass ? 'PASS' : 'FAIL';
            $("#ttTag").className = 'res-tag ' + (pass ? 'res-pass' : 'res-fail');
            $("#ttMeta").textContent = [j.tool || j.codex, j.model, j.base_url, j.code != null ? ('exit ' + j.code) : null].filter(Boolean).join(' · ');
            $("#ttPre").textContent = j.output || j.error || '(无输出)';
        } catch (e) {
            $("#ttTag").textContent = 'FAIL';
            $("#ttTag").className = 'res-tag res-fail';
            $("#ttPre").textContent = String(e);
        }
        btn.disabled = false;
    };
    // 覆盖真实配置文件（codex: ~/.codex/config.toml / claude: ~/.claude/settings.json），结果闪现在按钮上
    $("#overwriteCfgBtn").onclick = async () => {
        const btn = $("#overwriteCfgBtn");
        const done = (txt) => {
            btn.textContent = txt;
            setTimeout(() => {
                btn.textContent = '覆盖配置文件';
                btn.disabled = false;
            }, 2500);
        };
        if (!LOCAL_OK) {
            done('本地后端未启动');
            return;
        }
        btn.disabled = true;
        try {
            const j = await API.local("/cfg", {content: $("#cfgPre").textContent, overwrite: curTool().cfgTitle});
            done(j.ok ? ('已覆盖 ' + (j.file || curTool().cfgTitle)) : ('失败：' + (j.error || '未知错误')));
        } catch (e) {
            done('失败：' + (e.message || e));
        }
    };
    $("#copyBtn").onclick = () => {
        const txt = $('#cfgPre').textContent + '\n\n' + $('#cmdPre').textContent;
        (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(
            () => {
                $("#copyBtn").textContent = '已复制';
                setTimeout(() => $("#copyBtn").textContent = '复制全部', 1500);
            },
            () => {
                $("#copyBtn").textContent = '复制失败,请手动选择';
                setTimeout(() => $("#copyBtn").textContent = '复制全部', 1500);
            });
    };

    applyProxyDefault();
    renderProxyUI();
    renderModels();
    renderProtoParams();
    renderCfg();
    fetchReleases();
    fetchAllModels(true); // 启动静默自动拉模型列表（哪把 Key 已填就拉哪个区域，失败静默）
}

init();
