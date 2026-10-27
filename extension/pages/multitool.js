// ============ 主题 ============
(function(){
  const saved=localStorage.getItem('mt_theme')||'light';
  document.documentElement.setAttribute('data-theme',saved);
  function sync(){const d=document.documentElement.getAttribute('data-theme')==='dark';
    document.getElementById('iconSun').style.display=d?'none':'block';
    document.getElementById('iconMoon').style.display=d?'block':'none';}
  sync();
  document.getElementById('themeBtn').onclick=()=>{const c=document.documentElement.getAttribute('data-theme');const n=c==='dark'?'light':'dark';document.documentElement.setAttribute('data-theme',n);localStorage.setItem('mt_theme',n);sync();};
})();

const $=s=>document.querySelector(s);
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

// ============ 工具与模型数据 ============
// 工具清单：后续新增工具（claude-code / gemini-cli …）在此追加即可
const TOOLS=[
  {id:'codex',name:'Codex (OpenAI)',repo:'openai/codex',cfgTitle:'~/.codex/config.toml',wire:'responses',
   cfgDesc:'OpenAI Codex CLI · 默认走 Responses API'},
];
// 国外模型清单：启动时凭控制台 Cookie 在线拉取（IsGlobalServer=true，global-kspmas.ksyun.com）
let FOREIGN_MODELS=[];
// 国内模型清单：启动时凭控制台 Cookie 在线拉取（Region=Default-CN），无快照
let DOMESTIC_MODELS=[];

// ============ 状态与持久化 ============
const STORE_KEY='mt_cfg';
const state=Object.assign({
  tool:'codex',region:'domestic',domesticIdx:0,foreignIdx:0,proto:'auto',
  ghProxyOn:false,proxyType:'l4',proxyAddr:'',
  gwBase:'https://kspmas.ksyun.com',gwKey:'',testPrompt:'请只回复一个词：SPEC_TEXT_OK'
},(function(){try{return JSON.parse(localStorage.getItem(STORE_KEY))||{};}catch(e){return{};}})());
function saveState(){try{localStorage.setItem(STORE_KEY,JSON.stringify(state));}catch(e){}}

// ============ 请求层（api.js 双模：扩展 background 直连 / serve.py 转发） ============
// PROXY_OK：直连能力（LLM 真发 / GitHub / 模型列表）。扩展恒可用；服务模式取决于 serve.py。
// LOCAL_OK：本地执行端点（/tool /tooltest /cfg /dljob）与 4 层上游代理，需要本地二进制（或 serve.py）。
let PROXY_OK=API.IS_EXT;
let LOCAL_OK=false;
async function proxyFetch(url,opt){
  opt=opt||{};
  const payload={url:url,method:opt.method||"POST",headers:opt.headers||{},body:opt.body||null};
  if(opt.proxy)payload.proxy=opt.proxy;  // 4 层上游代理：必须经本地二进制转发
  return API.proxy(payload);
}
// 存活探测：本地后端（二进制 / serve.py）在则 LOCAL_OK；服务模式下真发也依赖它
(async function(){
  LOCAL_OK=await API.health();
  if(!API.IS_EXT)PROXY_OK=LOCAL_OK;
})();

// ============ GitHub 版本获取 ============
let RELEASES=[]; // [{tag, date, pre}]，按发布时间倒序
function curTool(){return TOOLS.find(t=>t.id===state.tool)||TOOLS[0];}
// 构造 GitHub 访问地址：7 层代理把完整地址拼在代理后面；4 层/直连保持原 URL
function buildGithubUrl(url){
  if(!state.ghProxyOn)return url;
  if(state.proxyType==='l7')return state.proxyAddr.replace(/\/+$/,'')+'/'+url;
  return url;
}
function githubFetch(url){
  const api='https://api.github.com'+url;
  const headers={Accept:'application/vnd.github+json'};
  if(state.ghProxyOn&&state.proxyType==='l4'){
    // 4 层代理：URL 不变，经本地二进制走上游 HTTP 代理（扩展 fetch 不能按请求指定代理）
    if(!LOCAL_OK)return Promise.resolve({ok:false,status:0,text:'4 层代理需要本地后端（二进制/serve.py）支持（未检测到）',headers:{}});
    if(!state.proxyAddr)return Promise.resolve({ok:false,status:0,text:'未填写 4 层代理地址',headers:{}});
    return proxyFetch(api,{method:'GET',headers:headers,proxy:state.proxyAddr});
  }
  const target=buildGithubUrl(api);
  if(!PROXY_OK&&state.ghProxyOn&&state.proxyType==='l7'){
    // 无本地后端（file:// 等）：7 层代理通常开放 CORS，尝试浏览器直连
    return fetch(target,{headers:headers}).then(r=>r.text().then(t=>({ok:r.ok,status:r.status,text:t,headers:{}})))
      .catch(e=>({ok:false,status:0,text:'直连失败:'+(e.message||e),headers:{}}));
  }
  return proxyFetch(target,{method:'GET',headers:headers});
}
// 拉取全部 Release（每页 100 条）填充版本下拉，默认选最新正式版；
// 失败自动重试 2 次（限流/网络抖动时免手动开关代理），初始加载与手动刷新共用
// 备用源：GitHub 官方 releases.atom 订阅（公开、无 API 配额限制，含最近约 10 个版本）
async function fetchAtomReleases(repo){
  const r=await proxyFetch('https://github.com/'+repo+'/releases.atom',{method:'GET',headers:{'Accept':'application/atom+xml'}});
  if(!r.ok||!r.text)throw new Error('HTTP '+r.status);
  const doc=new DOMParser().parseFromString(r.text,'application/xml');
  if(doc.querySelector('parsererror'))throw new Error('atom 解析失败');
  const out=[];
  doc.querySelectorAll('feed > entry').forEach(e=>{
    const id=(e.querySelector('id')||{}).textContent||'';
    const tag=decodeURIComponent((id.split('/').pop()||'').trim());
    const updated=((e.querySelector('updated')||{}).textContent||'').slice(0,10);
    if(tag)out.push({tag:tag,ver:tag.replace(/^rust-v?/i,''),date:updated,pre:!/^[0-9.]+$/.test(tag.replace(/^rust-v?/i,''))});
  });
  if(!out.length)throw new Error('atom 无版本');
  return out;
}
function applyReleases(list){
  const vs=$('#verSelect');
  // 过滤 alpha 版本；去掉 tag 的 rust-v 前缀，仅展示纯版本号
  RELEASES=list.filter(x=>x&&x.tag&&!/alpha/i.test(x.tag));
  vs.innerHTML='';vs.disabled=false;
  RELEASES.forEach((v,i)=>{const o=document.createElement('option');o.value=i;o.textContent=v.ver+(v.pre?'（预发布）':'')+(v.date?' · '+v.date:'');vs.appendChild(o);});
  // 默认最新正式版；有记忆的版本且仍存在则恢复
  let idx=RELEASES.findIndex(v=>!v.pre);
  if(state.verTag){const hit=RELEASES.findIndex(v=>v.ver===state.verTag||v.tag===state.verTag);if(hit>=0)idx=hit;}
  vs.value=Math.max(0,idx);
  state.verTag=RELEASES[+vs.value].ver;saveState();
  vs.onchange=()=>{state.verTag=RELEASES[+vs.value].ver;saveState();renderCfg();};
  renderCfg();
}
async function fetchReleases(retry){
  retry=retry||0;
  const t=curTool(),vs=$('#verSelect');
  if(!retry){ // 首次尝试：重置下拉并显示获取中
    vs.disabled=true;vs.innerHTML='';const w=document.createElement('option');w.textContent='获取中…';vs.appendChild(w);
  }else{ // 重试：提示但不打断
    vs.disabled=true;vs.innerHTML='';const w=document.createElement('option');w.textContent='获取失败，重试中（'+retry+'/2）…';vs.appendChild(w);
  }
  try{
    const r=await githubFetch('/repos/'+t.repo+'/releases?per_page=40');
    let j=null;try{j=JSON.parse(r.text);}catch(e){}
    if(r.ok&&Array.isArray(j)&&j.length){
      applyReleases(j.map(x=>({tag:x.tag_name,ver:x.tag_name.replace(/^rust-v?/i,''),date:(x.published_at||'').slice(0,10),pre:!!x.prerelease})));
      saveState();return;
    }
    // API 失败（常见：未认证 60 次/小时/IP 限流）→ 切换 releases.atom 备用源（无配额限制）
    try{
      applyReleases(await fetchAtomReleases(t.repo));
      saveState();return;
    }catch(e2){/* 备用源也失败，走重试 */}
    throw new Error((j&&j.message)||('HTTP '+r.status));
  }catch(e){
    if(retry<2){ // 自动重试（间隔 2s / 4s）
      setTimeout(()=>fetchReleases(retry+1),2000*(retry+1));return;
    }
    vs.innerHTML='';const o=document.createElement('option');o.textContent='获取失败（可启用代理或点刷新）';vs.appendChild(o);
  }
  saveState();
}

// ============ 模型下拉 ============
function curModel(){
  if(state.region==='foreign')return FOREIGN_MODELS[state.foreignIdx]||FOREIGN_MODELS[0];
  return DOMESTIC_MODELS[state.domesticIdx]||DOMESTIC_MODELS[0];
}
function renderModels(){
  const ms=$("#modelSelect");ms.innerHTML='';
  const list=state.region==='foreign'?FOREIGN_MODELS:DOMESTIC_MODELS;
  if(!list.length){ // 列表为空：在线拉取前显示占位提示
    const o=document.createElement('option');
    o.textContent=PROXY_OK?(API.IS_EXT?'（自动读取控制台 Cookie，可粘贴覆盖后拉取）':'（请粘贴控制台 Cookie 拉取模型列表）'):'（无本地后端，无法拉取模型列表）';
    ms.appendChild(o);
    renderCfg();return;
  }
  list.forEach((m,i)=>{const o=document.createElement('option');o.value=i;o.textContent=m.vendor+' · '+m.name;ms.appendChild(o);});
  ms.value=state.region==='foreign'?(state.foreignIdx||0):(state.domesticIdx||0);
  if(ms.value!==String(ms.selectedIndex)){ // 保存的索引越界时回退到第一项
    if(state.region==='foreign')state.foreignIdx=0;else state.domesticIdx=0;saveState();ms.value=0;
  }
  renderCfg();
}

// ============ 从控制台拉取全量模型列表（Cookie 鉴权，经 serve.py 转发） ============
const GQL_QUERY="query AicpDescribeModels($Region: String!, $Marker: Float!, $MaxResults: Float, $ActiveStatus: Float, $ModelCategory: [String!], $Provider: [String!], $ModelIds: [String!], $ModelName: String, $IsGlobalServer: Boolean, $Capabilities: [String!], $ContextLengthRanges: [String!]) {\n  AicpDescribeModels(\n    Region: $Region\n    Marker: $Marker\n    MaxResults: $MaxResults\n    ActiveStatus: $ActiveStatus\n    ModelCategory: $ModelCategory\n    Provider: $Provider\n    ModelIds: $ModelIds\n    ModelName: $ModelName\n    ContextLengthRanges: $ContextLengthRanges\n    Capabilities: $Capabilities\n    IsGlobalServer: $IsGlobalServer\n  ) {\n    RequestId\n    TotalCount\n    Marker\n    MaxResults\n    Data {\n      ...ModelsData\n      __typename\n    }\n    __typename\n  }\n}\n\nfragment ModelsData on ModelsData {\n  ModelId\n  ModelName\n  Provider\n  ModelType\n  Description\n  IconUrl\n  Tags\n  UpdateTime\n  FreeTotalQuota\n  FreeUsedQuota\n  IsOverFreeDisable\n  ActiveStatus\n  Tpm\n  Rpm\n  Ipm\n  Status\n  CodeCase {\n    VideoModel\n    ModelKind\n    SupportTryout\n    RpmLimit\n    TpmLimit\n    MeteringMode\n    InCurrency\n    StepPrice\n    OnlineCalculateInput\n    OnlineCalculateOutput\n    OnlineCalculateRight\n    Batch\n    OnlineTime\n    DeprecationTime\n    SuggestModel\n    OfflineTime\n    OutputType\n    VideoModelModeSet {\n      Concurrency\n      __typename\n    }\n    ImageModelModeMap {\n      IPM\n      __typename\n    }\n    PricingRules {\n      ...PricingRules\n      __typename\n    }\n    __typename\n  }\n  ModelLimitConfig {\n    Status\n    QuotaType\n    QuotaDuration\n    QuotaLimit\n    UsedQuota\n    RemainingQuota\n    UpdateTime\n    AlertEnabled\n    AlertThreshold\n    __typename\n  }\n  LogPoolConfig {\n    Region\n    ProjectName\n    LogPoolName\n    __typename\n  }\n  FirewallEnabled\n  ExtraFields {\n    apiConfig {\n      code\n      externalBaseUrl\n      internalbaseUrl\n      label\n      __typename\n    }\n    baseConfig {\n      label\n      value\n      __typename\n    }\n    priceConfig {\n      priceItem {\n        label\n        price\n        unit\n        __typename\n      }\n      pricingRules {\n        label\n        price\n        __typename\n      }\n      stepPrice\n      __typename\n    }\n    restrictionConfig {\n      label\n      value\n      __typename\n    }\n    versionConfig {\n      comtent\n      content\n      __typename\n    }\n    __typename\n  }\n  __typename\n}\n\nfragment PricingRules on PricingRules {\n  BatchCalculateInput {\n    ...PricingRulesItem\n    __typename\n  }\n  BatchCalculateOutput {\n    ...PricingRulesItem\n    __typename\n  }\n  OnlineCalculateInput {\n    ...PricingRulesItem\n    __typename\n  }\n  OnlineCalculateOutput {\n    ...PricingRulesItem\n    __typename\n  }\n  BatchCalculateCacheRight {\n    ...PricingRulesItem\n    __typename\n  }\n  OnlineCalculateRight {\n    ...PricingRulesItem\n    __typename\n  }\n  OnlineCalculateDisplayCache {\n    ...PricingRulesItem\n    __typename\n  }\n  FiveMinuteInputCachePrice {\n    ...PricingRulesItem\n    __typename\n  }\n  OneHourInputCachePrice {\n    ...PricingRulesItem\n    __typename\n  }\n  __typename\n}\n\nfragment PricingRulesItem on PricingRulesItem {\n  InputMin\n  InputMax\n  OutputMin\n  OutputMax\n  Price\n  __typename\n}\n";
// 提取规则与固件一致：chat/completions → chat；仅 /v1/responses → responses；嵌入/重排序/图片/视频/语音排除
const EXC_TAGS=['文本嵌入','重排序','语音生成','视频生成','文生图','图片生成'];
const VMAP={'月之暗面':'Kimi / 月之暗面','Qwen':'Qwen / 阿里','Xiaomi':'小米 MiMo','DeepSeek':'DeepSeek',
  '智谱AI':'智谱','智谱':'智谱','MiniMax':'MiniMax','Minimax':'MiniMax','豆包':'豆包 / 火山引擎',
  '火山引擎':'火山引擎','腾讯':'腾讯混元','可灵AI':'可灵AI','Vidu':'Vidu','ElevenLabs':'ElevenLabs','OpenAI':'OpenAI (开源)'};
function extractModels(data){
  const out=[];
  (data||[]).forEach(x=>{
    const mid=x.ModelName,prov=x.Provider,tags=x.Tags||[];
    if(EXC_TAGS.some(t=>tags.some(g=>String(g).indexOf(t)>=0)))return;
    if(['图片生成','视频生成','语音模型'].some(k=>String(x.ModelType||'').indexOf(k)>=0))return;
    const cfg=((x.ExtraFields||{}).apiConfig)||[];
    const urls=cfg.map(c=>c.externalBaseUrl||'');
    let wire;
    if(urls.some(u=>u.indexOf('/chat/completions')>=0))wire='chat';
    else if(urls.some(u=>u.indexOf('/v1/responses')>=0))wire='responses';
    else if(cfg.length)return;   // 有示例但仅非对话端点（embeddings/rerank/t2a/images）
    else wire='chat';            // 无示例的网关模型，默认 OpenAI 兼容
    const vendor=(prov&&prov!=='-'&&VMAP[prov])?VMAP[prov]:'星流中转';
    out.push({id:mid,name:mid,vendor:vendor,wire:wire,ts:x.UpdateTime||0});
  });
  out.sort((a,b)=>b.ts-a.ts);
  return out.map(function(x){var r={id:x.id,name:x.name,vendor:x.vendor,wire:x.wire};return r;});
}
async function fetchConsoleModels(isGlobal){
  const body={operationName:'AicpDescribeModels',
    variables:{Region:'Default-CN',Marker:1,MaxResults:500,IsGlobalServer:!!isGlobal,ModelIds:[]},
    query:GQL_QUERY};
  // Origin/Referer/Cookie 是浏览器禁止头：扩展下由 background 用 declarativeNetRequest 注入
  //（Cookie 留空则 chrome.cookies 自动读控制台域），服务模式由 serve.py 转发时伪造
  const r=await API.consoleFetch({
    url:'https://overlord-api.ksyun.com/console-v2?action=AicpDescribeModels',
    body:JSON.stringify(body),
    cookie:state.consoleCookie||''});
  let j=null;try{j=JSON.parse(r.text);}catch(e){}
  const res=j&&j.data&&j.data.AicpDescribeModels;
  if(!res)throw new Error((j&&j.errors&&j.errors[0]&&j.errors[0].message)||('HTTP '+r.status));
  return res;
}
async function fetchAllModels(silent){
  const note=$("#consoleHint"),btn=$("#fetchModelsBtn");
  if(!PROXY_OK){if(!silent)note.textContent='无本地后端(serve.py)，拉取功能不可用';return;}
  // 扩展模式下 background 可用 chrome.cookies 自动读控制台 Cookie；服务模式需粘贴
  if(!state.consoleCookie&&!API.IS_EXT){if(!silent)note.textContent='请先粘贴控制台 Cookie';return;}
  if(!silent){btn.disabled=true;note.textContent='拉取中…';}
  try{
    const cn=await fetchConsoleModels(false);
    const gl=await fetchConsoleModels(true);
    const domList=extractModels(cn.Data),glList=extractModels(gl.Data);
    if(!domList.length&&!glList.length)throw new Error('未提取到对话模型（Cookie 过期？）');
    DOMESTIC_MODELS=domList.length?domList:DOMESTIC_MODELS;
    FOREIGN_MODELS=glList.length?glList:FOREIGN_MODELS;
    note.textContent='已更新：国内 '+domList.length+'/'+cn.TotalCount+'，国际 '+glList.length+'/'+gl.TotalCount+'（实时列表，刷新页面后如未拉取则回退内置清单）';
    renderModels();
  }catch(e){
    if(!silent)note.textContent='拉取失败：'+(e.message||e);
  }
  if(!silent)btn.disabled=false;
}

// ============ 模型详情（用 Key 拉网关 /v1/models，定位当前选中模型） ============
async function fetchModelDetail(){
  const m=curModel(),card=$("#mdCard"),meta=$("#mdMeta"),pre=$("#mdPre");
  if(!PROXY_OK||!m||!state.gwKey){card.classList.remove('show');return;}
  card.classList.add('show');
  meta.textContent='获取详情中…';pre.textContent='…';
  try{
    const r=await proxyFetch(gwBaseClean()+'/v1/models',{method:'GET',headers:{'Authorization':'Bearer '+state.gwKey}});
    let j=null;try{j=JSON.parse(r.text);}catch(e){}
    const list=(j&&j.data)||[];
    const info=list.find(x=>x.id===m.id);
    if(info){
      meta.textContent=info.id
        +(' · owned_by '+(info.owned_by||'-'))
        +(info.created?' · '+new Date(info.created*1000).toISOString().slice(0,10):'')
        +(info.context_length?' · 上下文 '+info.context_length:'')
        +(info.max_completion_tokens?' · 输出 '+info.max_completion_tokens:'')
        +(info.pricing?' · 定价 '+[info.pricing.prompt,info.pricing.completion].filter(Boolean).join(' / '):'');
      pre.textContent=JSON.stringify(info,null,2);
    }else{
      meta.textContent='未找到该模型详情'+(r.status?('（HTTP '+r.status+'）'):'');
      pre.textContent=(r.text||'').slice(0,600);
    }
  }catch(e){meta.textContent='获取失败：'+(e.message||e);pre.textContent='';}
}

// ============ 模型连通性测试 ============
function gwBaseClean(){
  // 规范化：去掉结尾 / 和已带的 /v1，避免拼接出 /v1/v1/chat/completions
  return (state.gwBase||'').replace(/\/+$/,'').replace(/\/v1$/i,'');
}
function buildSmokeReq(m,forceWire){
  // 协议：Auto = 按模型自动（codex 工具测试固定 Responses）；forceWire 由 Auto 检测逐个尝试时显式指定
  const auto=state.tool==='codex'?'responses':m.wire;
  const wire=forceWire||(state.proto==='auto'?auto:state.proto);
  if(wire==='responses'){
    // max_output_tokens 需容纳推理 token（如 kimi-k3.1 推理即耗 58+），太小会导致 incomplete 无正文
    return{url:gwBaseClean()+'/v1/responses',
      body:{model:m.id,input:[{role:'user',content:[{type:'input_text',text:(state.testPrompt||'请只回复一个词：SPEC_TEXT_OK')}]}],max_output_tokens:1024},
      wire:wire};
  }
  if(wire==='anthropic'){
    return{url:gwBaseClean()+'/v1/messages',
      body:{model:m.id,max_tokens:64,messages:[{role:'user',content:(state.testPrompt||'请只回复一个词：SPEC_TEXT_OK')}]},
      wire:wire};
  }
  return{url:gwBaseClean()+'/v1/chat/completions',
    body:{model:m.id,messages:[{role:'user',content:(state.testPrompt||'请只回复一个词：SPEC_TEXT_OK')}],max_tokens:64},
    wire:wire};
}
function extractText(j,wire){
  try{
    if(wire==='responses'){
      if(j.output_text)return j.output_text;
      const items=(j.output||[]).filter(o=>o.type==='message').flatMap(o=>o.content||[]);
      return items.map(c=>c.text||'').join('');
    }
    if(wire==='anthropic'){
      return (j.content||[]).map(c=>c.text||'').join('');
    }
    return (j.choices&&j.choices[0]&&(j.choices[0].message||{}).content)||'';
  }catch(e){return '';}
}
// 按 wire 发一次连通性测试请求并判定，返回 {req,r,ms,j,text,pass}
async function judgeOne(m,wire){
  const req=buildSmokeReq(m,wire);
  const headers=wire==='anthropic'
    ?{'Content-Type':'application/json','x-api-key':state.gwKey,'anthropic-version':'2023-06-01'}
    :{'Content-Type':'application/json','Authorization':'Bearer '+state.gwKey};
  const bodyStr=JSON.stringify(req.body);
  const t0=Date.now();
  const r=await proxyFetch(req.url,{method:'POST',headers:headers,body:bodyStr});
  const ms=Date.now()-t0;
  let j=null;try{j=JSON.parse(r.text);}catch(e){}
  const text=j?extractText(j,wire):'';
  return{req:req,r:r,ms:ms,j:j,text:text,pass:!!(r.ok&&text&&text.trim())};
}
async function runSmoke(){
  const m=curModel(),btn=$("#runBtn");
  const fail=(msg)=>{$("#resultCard").classList.add('show');$("#resTag").textContent='FAIL';$("#resTag").className='res-tag res-fail';$("#resMeta").textContent=msg;$("#reqPre").textContent='';$("#respPre").textContent='';btn.disabled=false;};
  if(!m){fail('无可用模型（请先拉取模型列表）');return;}
  if(!PROXY_OK){fail('无本地代理(serve.py)，真发禁用：请先 python serve.py 后刷新本页');return;}
  if(!state.gwKey){fail('请先填写网关 API Key');return;}
  btn.disabled=true;
  // Auto 档真正自动检测：从模型标记的协议起依次尝试 chat → responses → anthropic，首个通过即用
  const first=state.tool==='codex'?'responses':(m.wire||'chat');
  const attempts=state.proto==='auto'
    ?[first,'chat','responses','anthropic'].filter((w,i,a)=>a.indexOf(w)===i)
    :[state.proto];
  $("#resultCard").classList.add('show');
  let winner=null,last=null;
  const trail=[];
  for(const w of attempts){
    const out=await judgeOne(m,w);
    trail.push(w.toUpperCase()+(out.pass?' ✓':' ✗('+(out.r.status||'err')+')'));
    $("#reqPre").textContent=out.req.url+'\n'+JSON.stringify(out.req.body);
    $("#respPre").textContent=out.r.text||'(空)';
    if(out.pass){winner=out;winner.wire=w;break;}
    last=out;
  }
  const fin=winner||last;
  $("#resTag").textContent=winner?'PASS':'FAIL';
  $("#resTag").className='res-tag '+(winner?'res-pass':'res-fail');
  $("#resMeta").textContent=(state.proto==='auto'?'Auto 检测 '+trail.join(' → ')+' · ':'')
    +(fin?('HTTP '+fin.r.status+' · '+fin.ms+'ms · '):'')+m.vendor+' · '+m.id
    +(winner?(' · '+winner.wire.toUpperCase()+' 协议'):'');
  btn.disabled=false;
  renderCfg();
}

// ============ 接入配置生成 ============
function renderCfg(){
  const t=curTool(),m=curModel();
  if(!t||!m)return;
  // 协议与连通性测试一致：Auto 按模型自动（codex 固定 Responses）；配置里 anthropic 映射为 chat（codex wire_api 仅支持 chat/responses）
  const auto=state.tool==='codex'?'responses':m.wire;
  const wire=(state.proto==='auto'?auto:state.proto)==='anthropic'?'chat':(state.proto==='auto'?auto:state.proto);
  const base=gwBaseClean()+'/v1';
  $("#cfgFileTitle").textContent=t.cfgTitle;
  $("#cfgSub").textContent=t.cfgDesc+' · '+m.id;
  $("#cfgPre").textContent=
'# 工具版本：'+(state.verTag||'未知')+'（'+t.repo+' Releases）\n'+
'model = "'+m.id+'"\n'+
'model_provider = "starflow"\n'+
'\n'+
'[model_providers.starflow]\n'+
'name = "星流聚合网关"\n'+
'base_url = "'+base+'"\n'+
'wire_api = "'+(wire==='responses'?'responses':'chat')+'"\n'+
'env_key = "STARFLOW_API_KEY"\n';
  $("#cmdPre").textContent=
'# 环境变量（当前会话）\n'+
'export STARFLOW_API_KEY="'+(state.gwKey||'sk-...')+'"\n\n'+
'# 用页面写入的配置目录启动（<配置目录> 替换为「写入配置文件」提示里显示的路径）\n'+
'CODEX_HOME=<配置目录> codex exec "请只回复一个词：SPEC_TEXT_OK"   # 非交互一次性测试\n'+
'CODEX_HOME=<配置目录> codex                                      # 进入交互模式\n\n'+
'# 或写入默认位置后直接启动（cp 配置目录/config.toml ~/.codex/ 后）\n'+
'codex --model '+m.id+'\n';
}

// ============ 绑定 ============
function bindSeg(segId,key,after){
  const seg=$("#"+segId);
  seg.querySelectorAll('.seg-btn').forEach(b=>{
    if(b.dataset.v===state[key])seg.querySelectorAll('.seg-btn').forEach(x=>x.classList.remove('active')),b.classList.add('active');
    b.onclick=()=>{
      seg.querySelectorAll('.seg-btn').forEach(x=>x.classList.remove('active'));
      b.classList.add('active');state[key]=b.dataset.v;saveState();if(after)after();
    };
  });
}
function renderProxyUI(){
  $("#ghProxyOn").checked=!!state.ghProxyOn;
  $("#proxyAddr").value=state.proxyAddr||'';
  const l4=state.proxyType!=='l7';
  $("#proxyAddr").placeholder=l4?'http://10.0.0.1:8080':'https://gh-proxy.com';
  $("#proxyTip").textContent=l4
    ?'4 层代理（传输层）：gost / shadowsocks 等自建 HTTP 代理，填 http://IP:端口，经本地 serve.py 转发访问 GitHub'
    :'7 层代理（应用层）：互联网公开的镜像代理（如 gh-proxy.com），填 https://gh-proxy.com，会自动将完整 GitHub 地址拼接在代理地址后面';
}
function init(){
  // 工具下拉
  const ts=$("#toolSelect");
  TOOLS.forEach(t=>{const o=document.createElement('option');o.value=t.id;o.textContent=t.name;ts.appendChild(o);});
  ts.value=state.tool;
  ts.onchange=()=>{state.tool=ts.value;saveState();fetchReleases();renderCfg();};

  $("#gwBase").value=state.gwBase||'';
  $("#gwKey").value=state.gwKey||'';
  $("#gwBase").oninput=e=>{state.gwBase=e.target.value.trim();saveState();renderCfg();};
  $("#gwKey").oninput=e=>{state.gwKey=e.target.value.trim();saveState();renderCfg();};
  $("#gwBase").onchange=fetchModelDetail;
  $("#gwKey").onchange=fetchModelDetail;

  $("#testPrompt").value=state.testPrompt||'请只回复一个词：SPEC_TEXT_OK';
  $("#testPrompt").oninput=e=>{state.testPrompt=e.target.value;saveState();};

  // 控制台 Cookie：粘贴后自动拉全量模型列表；启动时已有 Cookie 则静默自动加载
  $("#consoleCookie").value=state.consoleCookie||'';
  $("#consoleCookie").oninput=e=>{state.consoleCookie=e.target.value.trim();saveState();};
  $("#consoleCookie").onchange=()=>fetchAllModels(false);
  $("#fetchModelsBtn").onclick=()=>fetchAllModels(false);

  $("#regionSeg").querySelectorAll('.seg-btn').forEach(b=>b.classList.toggle('active',b.dataset.v===state.region));
  $("#regionSeg").querySelectorAll('.seg-btn').forEach(b=>b.onclick=()=>{
    $("#regionSeg").querySelectorAll('.seg-btn').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    const prev=state.region;state.region=b.dataset.v;saveState();
    // 网关 Base URL 自动跟随区域：国内 kspmas.ksyun.com ↔ 国外 global-kspmas.ksyun.com（仅当当前值是另一区域的默认时才切换）
    const DOM_BASE='https://kspmas.ksyun.com',GLB_BASE='https://global-kspmas.ksyun.com';
    if(state.gwBase===(state.region==='foreign'?DOM_BASE:GLB_BASE)){
      state.gwBase=(state.region==='foreign'?GLB_BASE:DOM_BASE);saveState();$("#gwBase").value=state.gwBase;
    }
    renderModels();fetchModelDetail();
  });
  $("#modelSelect").onchange=e=>{
    if(state.region==='foreign')state.foreignIdx=+e.target.value;else state.domesticIdx=+e.target.value;
    saveState();renderCfg();fetchModelDetail();
  };

  $("#ghProxyOn").onchange=e=>{state.ghProxyOn=e.target.checked;saveState();renderProxyUI();fetchReleases();};
  bindSeg('proxyTypeSeg','proxyType',()=>{renderProxyUI();});
  bindSeg('protoSeg','proto',()=>{renderCfg();});
  $("#mdRefresh").onclick=fetchModelDetail;
  $("#proxyAddr").oninput=e=>{state.proxyAddr=e.target.value.trim();saveState();};
  $("#verRefresh").onclick=fetchReleases;

  $("#runBtn").onclick=runSmoke;
  // 下载并验证工具二进制：平台自动识别 → GitHub Release 下载 → 解压临时目录 → codex-版本号 执行 --version → 自动删除
  $("#dlBtn").onclick=async()=>{
    const t=curTool(),btn=$("#dlBtn");
    if(!LOCAL_OK){$("#dlCard").classList.add('show');$("#dlTag").textContent='FAIL';$("#dlTag").className='res-tag res-fail';$("#dlPre").textContent='本地后端未启动（二进制/serve.py），下载验证不可用';return;}
    if(!state.verTag){return;}
    const proxy=(state.ghProxyOn&&state.proxyType==='l4')?state.proxyAddr:undefined;
    btn.disabled=true;
    $("#dlCard").classList.add('show');
    $("#dlTag").textContent='下载中';$("#dlTag").className='res-tag res-skip';
    $("#dlPre").textContent='…';$("#dlMeta").textContent='';
    try{
      const j=await API.local("/tool",{repo:t.repo,tag:state.verTag,ver:state.verTag,proxy:proxy});
      const pass=!!j.ok;
      $("#dlTag").textContent=pass?'PASS':'FAIL';
      $("#dlTag").className='res-tag '+(pass?'res-pass':'res-fail');
      $("#dlMeta").textContent=[j.platform,j.asset,j.bin,j.code!=null?('exit '+j.code):null].filter(Boolean).join(' · ');
      $("#dlPre").textContent=j.output||j.error||'(无输出)';
    }catch(e){$("#dlTag").textContent='FAIL';$("#dlTag").className='res-tag res-fail';$("#dlPre").textContent=String(e);}
    btn.disabled=false;
  };
  // 工具测试：拉起 codex（优先页面所选版本），用完整网关路径 + 所选模型端到端执行一次（serve.py /tooltest）
  $("#toolTestBtn").onclick=async()=>{
    const m=curModel(),btn=$("#toolTestBtn");
    const fail=(msg)=>{$("#ttCard").classList.add('show');$("#ttTag").textContent='FAIL';$("#ttTag").className='res-tag res-fail';$("#ttMeta").textContent=msg;$("#ttPre").textContent='';btn.disabled=false;};
    if(!m){fail('无可用模型（请先拉取模型列表）');return;}
    if(!LOCAL_OK){fail('本地后端未启动（二进制/serve.py），工具测试不可用');return;}
    if(!state.gwKey){fail('请先填写网关 API Key');return;}
    btn.disabled=true;
    $("#ttCard").classList.add('show');
    $("#ttTag").textContent='执行中';$("#ttTag").className='res-tag res-skip';
    $("#ttMeta").textContent=m.id+' · '+gwBaseClean()+'/v1 · codex '+(state.verTag||'(本机)')+' exec';
    // 1. 指定版本：先经 /dljob 后台下载并轮询进度条（缓存命中则直接完成）
    if(state.verTag){
      const pw=$("#ttProgWrap"),pt=$("#ttProgTxt"),pb=$("#ttProgBar");
      pw.style.display='block';pb.style.width='0%';
      try{
        const sj=await API.local("/dljob",{repo:curTool().repo,tag:state.verTag,ver:state.verTag,
          proxy:(state.ghProxyOn&&state.proxyType==='l4')?state.proxyAddr:undefined});
        if(!sj.ok)throw new Error(sj.error||'启动下载失败');
        const mb=v=>(v/1048576).toFixed(1);
        for(;;){
          const st=await API.localGet('/dljob?id='+encodeURIComponent(sj.id));
          if(st.status==='done'){pt.textContent='下载完成（'+(st.bin||state.verTag)+'）';pb.style.width='100%';break;}
          if(st.status==='error')throw new Error(st.error||'下载失败');
          const pct=st.total?Math.min(100,Math.round(st.received/st.total*100)):0;
          pt.textContent='下载 codex '+state.verTag+'… '+pct+'%'+(st.total?('（'+mb(st.received)+' / '+mb(st.total)+' MB）'):'（'+mb(st.received)+' MB）');
          pb.style.width=pct+'%';
          await new Promise(r=>setTimeout(r,400));
        }
      }catch(e){
        pw.style.display='none';
        $("#ttTag").textContent='FAIL';$("#ttTag").className='res-tag res-fail';
        $("#ttMeta").textContent='下载 codex 失败：'+(e.message||e);$("#ttPre").textContent='';
        btn.disabled=false;return;
      }
      pw.style.display='none';
    }
    $("#ttPre").textContent='…';
    try{
      const j=await API.local("/tooltest",{base_url:gwBaseClean()+'/v1',model:m.id,api_key:state.gwKey,
        prompt:state.testPrompt||'请只回复一个词：SPEC_TEXT_OK',
        repo:curTool().repo,tag:state.verTag||'',ver:state.verTag||'',
        proxy:(state.ghProxyOn&&state.proxyType==='l4')?state.proxyAddr:undefined});
      const pass=!!j.ok;
      $("#ttTag").textContent=pass?'PASS':'FAIL';
      $("#ttTag").className='res-tag '+(pass?'res-pass':'res-fail');
      $("#ttMeta").textContent=[j.codex,j.model,j.base_url,j.code!=null?('exit '+j.code):null].filter(Boolean).join(' · ');
      $("#ttPre").textContent=j.output||j.error||'(无输出)';
    }catch(e){$("#ttTag").textContent='FAIL';$("#ttTag").className='res-tag res-fail';$("#ttPre").textContent=String(e);}
    btn.disabled=false;
  };
  // 写入接入配置到本机目录（经 serve.py /cfg；留空 = 系统临时目录，ttl 秒后自动删除）
  $("#writeCfgBtn").onclick=async()=>{
    const note=$("#cfgNote"),btn=$("#writeCfgBtn");
    if(!LOCAL_OK){note.textContent='本地后端未启动（二进制/serve.py），写入功能不可用';return;}
    const envTxt='export STARFLOW_API_KEY="'+(state.gwKey||'sk-...')+'"\n';
    btn.disabled=true;note.textContent='写入中…';
    try{
      const j=await API.local("/cfg",{content:$("#cfgPre").textContent,env:envTxt,
        path:$("#cfgPath").value.trim(),ttl:+$("#cfgTtl").value||600});
      if(j.ok){
        note.textContent=(j.temp
          ?'已写入临时目录 '+j.dir+'（config.toml + env.sh），'+j.ttl+' 秒后自动删除'
          :'已写入 '+j.dir+'（config.toml + env.sh，不自动删除）');
      }else{note.textContent='写入失败：'+(j.error||'未知错误');}
    }catch(e){note.textContent='写入失败：'+(e.message||e);}
    btn.disabled=false;
  };
  $("#copyBtn").onclick=()=>{
    const txt=$('#cfgPre').textContent+'\n\n'+$('#cmdPre').textContent;
    (navigator.clipboard?navigator.clipboard.writeText(txt):Promise.reject()).then(
      ()=>{$("#copyBtn").textContent='已复制';setTimeout(()=>$("#copyBtn").textContent='复制全部',1500);},
      ()=>{$("#copyBtn").textContent='复制失败,请手动选择';setTimeout(()=>$("#copyBtn").textContent='复制全部',1500);});
  };

  renderProxyUI();
  renderModels();
  renderCfg();
  fetchReleases();
  fetchAllModels(true); // 启动静默自动拉全量列表（扩展下 Cookie 自动读取，失败静默）
}
init();
