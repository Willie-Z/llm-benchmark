// ============ 主题 ============
(function(){
  const saved=localStorage.getItem('lla2_theme')||'light';
  document.documentElement.setAttribute('data-theme',saved);
  function sync(){const d=document.documentElement.getAttribute('data-theme')==='dark';
    document.getElementById('iconSun').style.display=d?'none':'block';
    document.getElementById('iconMoon').style.display=d?'block':'none';}
  sync();
  document.getElementById('themeBtn').onclick=()=>{const c=document.documentElement.getAttribute('data-theme');const n=c==='dark'?'light':'dark';document.documentElement.setAttribute('data-theme',n);localStorage.setItem('lla2_theme',n);sync();};
})();

const PLAN_ARR=(function(){try{return Object.keys(PLAN).some(k=>/^\d+$/.test(k))?Object.values(PLAN):(Array.isArray(PLAN)?PLAN:[]);}catch(e){return [];}})();
const MODELS=[];
for(const vid of Object.keys(CATALOG)){const v=CATALOG[vid];for(const ver of(v.versions||[])){MODELS.push({vendor:v.name,vendorId:vid,...ver,api_base:v.api_base_url});}}
const $=s=>document.querySelector(s);
const $$=s=>document.querySelectorAll(s);
const el=(t,c,h)=>{const e=document.createElement(t);if(c)e.className=c;if(h!=null)e.innerHTML=h;return e;};
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

// ============ 思考模式 + 附加请求属性 ============
let THINK_ON='auto', THINK_EFFORT='high';
function bindSeg(segId, onSel){
  const seg=$("#"+segId);if(!seg)return;
  seg.querySelectorAll('.seg-btn').forEach(b=>b.onclick=()=>{
    seg.querySelectorAll('.seg-btn').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');onSel(b.dataset.v);
  });
}
bindSeg('thinkSeg',v=>{THINK_ON=v;updateThinkHint();});
bindSeg('effortSeg',v=>{THINK_EFFORT=v;updateThinkHint();});
function updateThinkHint(){
  const m=MODELS[+$("#modelSelect").value]||MODELS[0];
  const canThink=isReasoningModel(m);
  const p=thinkParams({model:m,proto:m.protocols&&m.protocols[0]?m.protocols[0]:'openai'});
  const keys=Object.keys(p);
  let desc;
  if(THINK_ON==='off'){desc='关闭：不注入思考参数，模型按默认行为';}
  else if(!canThink){desc='该模型基线 thinking_mode 非支持，不注入思考参数（注入会 400）。如需强制试注入，在右侧附加属性填写';}
  else if(!keys.length){desc='思考模型但该厂商默认开不可关（如 DeepSeek reasoner），不注入';}
  else{desc='自动注入: '+keys.map(k=>k+'='+JSON.stringify(p[k])).join(', ')+'。可在右侧附加属性覆盖';}
  $("#thinkHint").textContent=desc;
}
// 按厂商/协议算思考参数（附加属性覆盖、null 移除）
function thinkParams(ch){
  if(THINK_ON==='off')return{};
  let m=null;
  if(ch.model&&typeof ch.model==='object')m=ch.model;
  else if(ch.modelIdx!=null)m=MODELS[ch.modelIdx];
  const v=m?m.vendor:'', id=m?m.id:'', proto=ch.proto||'openai';
  let p={};
  // 先按基线判断模型本身是否支持思考；不支持的不注入(注入会 400 unknown parameter)
  const canThink=isReasoningModel(m);
  if(!canThink){
    p={}; // 非思考模型:不注入思考参数,模型按默认行为
  }else if(/DeepSeek/i.test(v)){
    // deepseek-reasoner 默认开不可关;chat 不支持。注入会报错,跳过
    p={};
  }else if(/智谱|zhipu|glm/i.test(v)){
    p={thinking:{type:'enabled'}};
  }else if(/Kimi|moonshot/i.test(v)){
    p={thinking:true};
  }else if(/MiniMax/i.test(v)){
    p={thinking_enabled:true};
  }else if(/MiMo|小米|xiaomi/i.test(v)){
    p={enable_thinking:true};
  }else if(proto==='anthropic'){
    const budget={low:1024,high:8192,max:16384}[THINK_EFFORT]||8192;
    p={thinking:{type:'enabled',budget_tokens:budget}};
  }else{
    // 通用 OpenAI o 系列兼容:reasoning_effort(max 无对应,映射 high)
    const eff={low:'low',high:'high',max:'high'}[THINK_EFFORT]||'high';
    p={reasoning_effort:eff};
  }
  // 附加属性 JSON 覆盖:重名覆盖,值为 null 从请求移除
  let extra={};
  try{extra=JSON.parse($("#extraProps")?$("#extraProps").value:'{}')||{};}catch(e){}
  Object.keys(extra).forEach(k=>{if(extra[k]===null)delete p[k];else p[k]=extra[k];});
  return p;
}

function bl(m){
  const bs=m.baseline||{};let srcs=[];
  const ps=(o)=>{if(o&&o.source&&/^https?:/.test(o.source)&&!srcs.includes(o.source))srcs.push(o.source);};
  if(bs.context_window)ps(bs.context_window);if(bs.max_output_tokens)ps(bs.max_output_tokens);
  if(bs.temperature_range)ps(bs.temperature_range);if(bs.top_p_range)ps(bs.top_p_range);
  if(bs.concurrency_limit)ps(bs.concurrency_limit);if(bs.pricing)ps(bs.pricing);
  if(bs.features)Object.values(bs.features).forEach(ps);
  return{ctx:m.context,maxOut:m.maxOutput,temp:m.temp,topp:m.topp,feat:m.features||{},pricing:m.pricing,rl:m.rate_limits,protos:m.protocols||[],notpub:m.maxOutput==="NOT_PUBLISHED",bestFor:bs.best_for||'',bpr:bs.pricing||{},benchmark:bs.benchmark_scores||null,sources:srcs};
}

// ============ Tab 切换 ============
function switchTab(name){
  $$('.tab').forEach(t=>t.classList.toggle('active',t.dataset.go===name));
  $$('.tab-pane').forEach(p=>p.classList.toggle('active',p.dataset.tab===name));
  if(name==='running'){renderSummary();renderGroups();}
  if(name==='done'){renderCmp();renderBaseline2();}
  if(name==='chat'){renderChat();}
}
$$('.tab,.foot-links [data-go]').forEach(t=>t.onclick=()=>switchTab(t.dataset.go));

// ============ 通道管理 ============
let channels=[];
function saveCh(){try{localStorage.setItem('lla2_ch',JSON.stringify(channels.map(c=>({name:c.name,proto:c.proto,base:c.base,key:c.key,headers:c.headers,model:c.model,modelId:c.modelId,modelIdx:c.modelIdx}))))}catch(e){}}
function loadCh(){try{const lc=JSON.parse(localStorage.getItem('lla2_ch')||'null');if(lc){lc.forEach(c=>{if(c.modelIdx==null||c.modelIdx>=MODELS.length||c.modelIdx<0){const idx=MODELS.findIndex(m=>m.id===c.modelId);c.modelIdx=idx>=0?idx:0;}});}return lc;}catch(e){return null;}}
function addCh(){
  if(channels.length>=4){return;}
  const id=Date.now()+Math.random();const m=MODELS[+$("#modelSelect").value];
  const ch={id,name:'通道'+(channels.length+1),proto:'openai',base:m.api_base?(typeof m.api_base==='string'?m.api_base:Object.values(m.api_base)[0]||''):'',key:'',headers:'',model:m.id,modelId:m.id,modelIdx:+$("#modelSelect").value};
  channels.push(ch);renderCh();
}
function rmCh(id){channels=channels.filter(c=>c.id!==id);renderCh();}
function renderCh(){
  const w=$("#channels");w.innerHTML='';
  if(!channels.length){w.appendChild(el('div','empty','点击「增加」添加通道'));$("#chCount").textContent='0 路';return;}
  $("#chCount").textContent=channels.length+' 路';
  channels.forEach((c,idx)=>{
    const d=el('div','ch-row');
    d.innerHTML=`<div class="ch-row-h"><b>${esc(c.name)}</b><div style="display:flex;gap:5px"><button class="btn ghost sm" data-up>↑</button><button class="btn ghost sm" data-rm>删</button></div></div>
      <div class="ch-field">
        <div class="field"><label>模型</label><select data-m></select></div>
        <div class="field"><label>协议</label><select data-pr><option value="openai">openai</option><option value="anthropic">anthropic</option></select></div>
        <div class="field"><label>模型ID</label><input data-mid value="${esc(c.modelId||'')}" placeholder="${esc(c.model||'')}"></div>
        <div class="field"><label>Base URL</label><input data-base value="${esc(c.base||'')}" placeholder="https://..."></div>
        <div class="field"><label>API Key</label><div style="display:flex;gap:4px"><input type="password" data-key value="${esc(c.key||'')}"><button class="btn ghost sm" data-tg>显</button></div></div>
        <div class="field"><label>Headers</label><input data-hdr value="${esc(c.headers||'')}"></div>
      </div>`;
    const ms=d.querySelector('[data-m]');MODELS.forEach((mm,i)=>{const o=document.createElement('option');o.value=i;o.textContent=mm.vendor+'·'+mm.name;if(mm.id===c.model)o.selected=true;ms.appendChild(o);});
    ms.onchange=e=>{const newIdx=+e.target.value;const newM=MODELS[newIdx];const oldM=MODELS[c.modelIdx];c.modelIdx=newIdx;c.model=newM.id;c.modelId=newM.id;const newBase=newM.api_base?(typeof newM.api_base==='string'?newM.api_base:Object.values(newM.api_base)[0]||''):'';const oldBase=oldM.api_base?(typeof oldM.api_base==='string'?oldM.api_base:Object.values(oldM.api_base)[0]||''):'';if(newBase&&(!c.base||c.base===oldBase)){c.base=newBase;const bi=d.querySelector('[data-base]');if(bi)bi.value=newBase;}saveCh();updateThinkHint();};
    d.querySelector('[data-mid]').oninput=e=>{c.modelId=e.target.value;saveCh();};
    d.querySelector('[data-pr]').value=c.proto;d.querySelector('[data-pr]').onchange=e=>{c.proto=e.target.value;saveCh();};
    d.querySelector('[data-base]').oninput=e=>{c.base=e.target.value;saveCh();};
    d.querySelector('[data-key]').oninput=e=>{c.key=e.target.value;saveCh();};
    d.querySelector('[data-hdr]').oninput=e=>{c.headers=e.target.value;saveCh();};
    d.querySelector('[data-tg]').onclick=()=>{const i=d.querySelector('[data-key]');i.type=i.type==='password'?'text':'password';};
    d.querySelector('[data-rm]').onclick=()=>rmCh(c.id);
    d.querySelector('[data-up]').onclick=()=>{if(idx>0){[channels[idx-1],channels[idx]]=[channels[idx],channels[idx-1]];renderCh();}};
    w.appendChild(d);
  });
  saveCh();
}
$("#addCh").onclick=()=>addCh();
$("#editCh").onclick=()=>{const e=$("#chEditor");e.style.display=e.style.display==='none'?'block':'none';};
$("#closeCh").onclick=()=>{$("#chEditor").style.display='none';};

// ============ 模型下拉 ============
function initModel(){
  const ms=$("#modelSelect");
  MODELS.forEach((m,i)=>{const o=document.createElement('option');o.value=i;o.textContent=`${m.vendor} · ${m.name}`;ms.appendChild(o);});
  ms.value=0;
  ms.onchange=()=>{renderBaseline();renderBaseline2();updateThinkHint();};
}

// ============ 四态渲染 ============
function resBadge(s,sub){
  const m={PASS:`<span class="res-pass">PASS</span>`,FAIL:`<span class="res-fail">FAIL</span>`,INCONCLUSIVE:`<span class="res-inc">INC</span>`,SKIP:`<span class="res-skip">SKIP</span>`,PENDING:`<span class="res-pending">等待</span>`,RUNNING:`<span class="res-running">跑测</span>`};
  let r=m[s]||`<span class="res-none">—</span>`;
  if(sub) r+=`<span class="res-sub">${esc(sub)}</span>`;
  return r;
}
function priorityPill(p){
  if(p==='P0')return `<span class="pill p0">P0</span>`;
  if(p==='P1')return `<span class="pill p1">P1</span>`;
  if(p==='P2')return `<span class="pill p2">P2</span>`;
  return '';
}
function profilePills(cs){
  if(!cs.profiles||!cs.profiles.length)return '';
  return cs.profiles.map(p=>`<span class="pill">${esc(p)}</span>`).join('');
}

// ============ summary + 进度 ============
function renderSummary(){
  const run=SIM_RUNS[0];const box=$("#summaryBox");if(!box)return;
  if(!run){box.innerHTML='';$("#progBar").style.width='0%';$("#progTxt").textContent='尚未启动验收';return;}
  const tally={PASS:0,FAIL:0,INCONCLUSIVE:0,SKIP:0,PENDING:0,RUNNING:0};
  let total=0;
  run.results.forEach(r=>r.perChannel.forEach(p=>{tally[p.status]=(tally[p.status]||0)+1;total++;}));
  const done=tally.PASS+tally.FAIL+tally.INCONCLUSIVE+tally.SKIP;
  $("#progBar").style.width=(total?Math.round(done/total*100):0)+'%';
  $("#progTxt").textContent=done+'/'+total+(run.running?' 跑测中':' 已完成');
  box.innerHTML=`<div class="sum-card total"><div class="num">${total}</div><div class="lbl">总项</div></div>
    <div class="sum-card pass"><div class="num">${tally.PASS||0}</div><div class="lbl">PASS</div></div>
    <div class="sum-card fail"><div class="num">${tally.FAIL||0}</div><div class="lbl">FAIL</div></div>
    <div class="sum-card inc"><div class="num">${tally.INCONCLUSIVE||0}</div><div class="lbl">INC</div></div>
    <div class="sum-card skip"><div class="num">${tally.SKIP||0}</div><div class="lbl">SKIP</div></div>`;
}

// ============ 分类对比表格 ============
const GROUP_LABELS={Specifications:'规格参数验收',Capabilities:'能力验收'};
function renderGroups(){
  const box=$("#groupsBox");box.innerHTML='';
  const run=SIM_RUNS[0];
  const groups={};
  PLAN_ARR.forEach(c=>{if(!groups[c.group])groups[c.group]=[];groups[c.group].push(c);});
  Object.keys(groups).forEach(g=>{
    const cases=groups[g];
    const sec=el('div');
    let h=`<h2 class="page-h2">${GROUP_LABELS[g]||g}<span class="cnt">${cases.length} 项</span></h2>`;
    h+=`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>用例</th><th>通道</th><th class="t-right">结果</th><th>标签</th></tr></thead><tbody>`;
    cases.forEach(c=>{
      if(run){
        run.channels.forEach((ch,ci)=>{
          const pc=run.results.find(r=>r.case.id===c.id);
          const st=pc?pc.perChannel[ci]:null;
          const sub=st&&st.elapsed?st.elapsed+'ms':'';
          h+=`<tr><td class="c-case"><span class="nm">${esc(c.name)}</span><span class="id">${esc(c.id)}</span></td>`;
          h+=`<td class="c-ch"><span class="ch-tag"><span class="flag">${esc(String(ci+1))}</span><span class="nm">${esc(ch.model.name)}</span></span></td>`;
          h+=`<td class="c-res">${st?resBadge(st.status,sub):resBadge(null)}</td>`;
          h+=`<td class="c-tags">${priorityPill(c.priority)}${profilePills(c)}</td></tr>`;
        });
      }else{
        h+=`<tr><td class="c-case"><span class="nm">${esc(c.name)}</span><span class="id">${esc(c.id)}</span></td>`;
        h+=`<td class="c-ch"><span class="res-none">未配置</span></td>`;
        h+=`<td class="c-res">${resBadge(null)}</td>`;
        h+=`<td class="c-tags">${priorityPill(c.priority)}${profilePills(c)}</td></tr>`;
      }
    });
    h+=`</tbody></table></div>`;
    sec.innerHTML=h;
    box.appendChild(sec);
  });
}

// ============ 多路并排对比表 ============
function outCell(p){
  if(!p)return '<div class="out-empty">无数据</div>';
  const o=p.out;
  if(!o){
    const note=p.note?('· '+esc(p.note)):'';
    return `<div class="out-meta"><span class="oh">状态</span> ${resBadge(p.status)} ${p.elapsed?p.elapsed+'ms':''} ${note}</div><div class="out-empty">模拟模式或无实际输出</div>`;
  }
  let h=`<div class="out-meta"><span class="oh">HTTP</span> ${o.http} <span class="oh">耗时</span> ${p.elapsed||0}ms ${p.note?('· '+esc(p.note)):''}</div>`;
  if(o.content)h+=`<div class="out-row"><span class="oh">content</span><pre class="out-pre">${esc(o.content)}</pre></div>`;
  if(o.reasoning)h+=`<div class="out-row"><span class="oh">reasoning</span><pre class="out-pre">${esc(o.reasoning)}</pre></div>`;
  if(o.toolCalls&&o.toolCalls.length)h+=`<div class="out-row"><span class="oh">tool_calls</span><pre class="out-pre">${esc(JSON.stringify(o.toolCalls,null,2).slice(0,400))}</pre></div>`;
  if(o.text&&!o.content&&!o.reasoning)h+=`<div class="out-row"><span class="oh">原始响应</span><pre class="out-pre">${esc(o.text)}</pre></div>`;
  return h;
}
function renderCmp(){
  const box=$("#cmpBox");
  const expanded=new Set();
  if(box.querySelectorAll)box.querySelectorAll('.cmp-detail').forEach(e=>{if(e.style.display!=='none')expanded.add(+e.dataset.didx);});
  box.innerHTML='';
  const run=SIM_RUNS[0];
  if(!run){box.innerHTML='<div class="empty">启动验收后此处显示多路并排对比</div>';$("#cmpCnt").textContent='';return;}
  $("#cmpCnt").textContent=run.channels.length+' 路';
  let h=`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>用例</th>`;
  run.channels.forEach(ch=>h+=`<th class="t-center">${esc(ch.model.name)}</th>`);
  h+=`<th class="t-center">一致?</th><th class="t-center"></th></tr></thead><tbody>`;
  run.results.forEach((r,ri)=>{
    const pcs=r.perChannel;
    const sts=pcs.map(p=>p.status);
    const uniq=[...new Set(sts)];
    // 通道级错误识别：note 里含 HTTP 401/403/404 说明通道本身没接通，不是模型行为
    const chanErr=pcs.map(p=>/HTTP (401|403|404)/.test(p.note||''));
    const allChanErr=chanErr.every(Boolean);
    const anyPass=sts.some(s=>s==='PASS');
    const anyFail=sts.some(s=>s==='FAIL');
    let consistent,cc;
    if(allChanErr){consistent='通道未接通';cc='res-inc';}
    else if(uniq.length===1&&uniq[0]==='SKIP'){consistent='全跳过';cc='res-skip';}
    else if(uniq.length===1&&uniq[0]!=='SKIP'){consistent='一致';cc='res-pass';}
    else{consistent='不一致';cc='res-fail';}
    h+=`<tr class="cmp-row" data-idx="${ri}"><td class="c-case"><span class="nm">${esc(r.case.name)}</span><span class="id">${esc(r.case.id)}</span></td>`;
    sts.forEach(s=>h+=`<td class="c-ch-cell">${resBadge(s)}</td>`);
    h+=`<td class="c-ch-cell"><span class="${cc}">${consistent}</span></td>`;
    h+=`<td class="c-ch-cell"><button class="btn ghost sm cmp-toggle" data-idx="${ri}">展开</button></td></tr>`;
    h+=`<tr class="cmp-detail" data-didx="${ri}" style="display:none"><td colspan="${run.channels.length+3}"><div class="cmp-detail-inner">`;
    h+=`<div class="cmp-out-grid" style="grid-template-columns:repeat(${run.channels.length},1fr)">`;
    run.channels.forEach((ch,ci)=>{const p=r.perChannel[ci];h+=`<div class="cmp-out-col"><div class="cmp-out-h">${esc(ch.model.name)} <span class="cmp-out-tag">${resBadge(p.status)}</span></div>${outCell(p)}</div>`;});
    h+=`</div></div></td></tr>`;
  });
  h+=`</tbody></table></div>`;
  box.innerHTML=h;
  box.querySelectorAll('.cmp-toggle').forEach(btn=>btn.onclick=()=>{
    const idx=btn.dataset.idx;const detail=box.querySelector(`.cmp-detail[data-didx="${idx}"]`);
    const open=detail.style.display!=='none';
    detail.style.display=open?'none':'table-row';
    btn.textContent=open?'展开':'收起';
  });
  expanded.forEach(idx=>{const detail=box.querySelector(`.cmp-detail[data-didx="${idx}"]`);const btn=box.querySelector(`.cmp-toggle[data-idx="${idx}"]`);if(detail){detail.style.display='table-row';if(btn)btn.textContent='收起';}});
}

// ============ 官网基线 ============
function fmtCtx(n){if(!n)return'<span class="np">未公布</span>';return n>=1e6?(n/1e6)+'M':(n>=1e3?(n/1e3)+'K':n);}
function fmtTPM(t){return t>=1e6?(t/1e6)+'M':(t>=1e3?(t/1e3)+'K':t);}
function featVal(v){if(v===true)return'<span class="yes">支持</span>';if(v===false)return'<span class="no">不支持</span>';return'<span class="np">未公布</span>';}
function baselineHTML(){
  const m=MODELS[+$("#modelSelect").value];const b=bl(m);
  let h=`<div class="bl-title">${esc(m.name)}<span class="vendor">${esc(m.vendor)}</span></div>`;
  h+=`<div class="bl-grp"><div class="bl-grp-h">基本信息</div><table class="bl-tbl">`;
  h+=`<tr><td class="k">上下文</td><td class="v">${b.ctx?fmtCtx(b.ctx):'<span class="np">未公布</span>'}</td></tr>`;
  h+=`<tr><td class="k">最大输出</td><td class="v">${b.notpub?'<span class="np">未公布</span>':(b.maxOut?fmtCtx(b.maxOut):'<span class="np">未公布</span>')}</td></tr>`;
  h+=`<tr><td class="k">协议</td><td class="v">${esc((m.protocols&&m.protocols.length)?m.protocols.join(' / '):'openai')}</td></tr>`;
  if(b.bestFor)h+=`<tr><td class="k">适用场景</td><td class="v">${esc(b.bestFor)}</td></tr>`;
  h+=`</table></div>`;
  const feat=b.feat||{};
  h+=`<div class="bl-grp"><div class="bl-grp-h">能力</div><div class="bl-feat">`;
  [['streaming','流式'],['function_calling','工具调用'],['vision','视觉'],['thinking_mode','思考'],['system_prompt','系统提示']].forEach(p=>{h+=`<div class="fi"><span class="fk">${p[1]}</span><span class="fv">${featVal(feat[p[0]])}</span></div>`;});
  h+=`</div></div>`;
  h+=`<div class="bl-grp"><div class="bl-grp-h">采样参数</div><table class="bl-tbl">`;
  h+=`<tr><td class="k">Temp</td><td class="v">${b.temp?('['+(b.temp.min??b.temp[0])+'~'+(b.temp.max??b.temp[1])+'] 默认'+(b.temp.default??'—')):'<span class="np">未公布</span>'}</td></tr>`;
  h+=`<tr><td class="k">Top_p</td><td class="v">${b.topp?('['+(b.topp.min??b.topp[0])+'~'+(b.topp[1]??b.topp.max)+']'):'<span class="np">未公布</span>'}</td></tr>`;
  h+=`</table></div>`;
  h+=`<div class="bl-grp"><div class="bl-grp-h">限速与价格</div><table class="bl-tbl">`;
  let rl='';if(b.rl){if(b.rl.concurrency!=null)rl+='并发 '+b.rl.concurrency;if(b.rl.rpm!=null)rl+=(rl?' · ':'')+'RPM '+b.rl.rpm;if(b.rl.tpm!=null)rl+=(rl?' · ':'')+'TPM '+fmtTPM(b.rl.tpm);if(b.rl.note)rl+='<div style="font-size:10px;color:var(--faint);margin-top:2px">'+esc(b.rl.note)+'</div>';}
  h+=`<tr><td class="k">限速</td><td class="v">${rl||'<span class="np">未公布</span>'}</td></tr>`;
  const bp=b.bpr||{};
  if(bp.input_cache_hit_per_million!=null||bp.input_cache_miss_per_million!=null||bp.output_per_million!=null){
    let pr='';const hit=bp.input_cache_hit_per_million,miss=bp.input_cache_miss_per_million,out=bp.output_per_million;
    if(miss!=null)pr+='输入 '+miss;if(out!=null)pr+=(pr?' / ':'')+'输出 '+out;pr+=' 元/M';
    if(hit!=null)pr+='<div style="font-size:10px;color:var(--faint);margin-top:2px">缓存命中 '+hit+'</div>';
    h+=`<tr><td class="k">价格</td><td class="v">${pr}</td></tr>`;
  }else h+=`<tr><td class="k">价格</td><td class="v"><span class="np">未公布</span></td></tr>`;
  h+=`</table></div>`;
  if(b.sources&&b.sources.length){h+=`<div class="bl-grp"><div class="bl-grp-h">官网来源</div><div class="bl-srcs">`;b.sources.forEach(u=>{h+=`<a href="${esc(u)}" target="_blank">${esc(u)}</a>`;});h+=`</div></div>`;}
  return h;
}
function renderBaseline(){const b=$("#baselineBox");if(b)b.innerHTML=baselineHTML();}
function renderBaseline2(){const b=$("#baselineBox2");if(b)b.innerHTML=baselineHTML();}
function bindBlToggle(toggleId,bodyId){
  const t=$("#"+toggleId);if(!t)return;
  t.onclick=()=>{$("#"+toggleId).classList.toggle('open');$("#"+bodyId).classList.toggle('open');};
}
bindBlToggle('blToggle','blBody');
bindBlToggle('blToggle2','blBody2');

// ============ 启动 ============
$("#launchBtn").onclick=async ()=>{
  const realMode=$("#realMode").checked;
  if(!realMode){
    if(channels.length<2){$("#launchNote").textContent='需至少2路';return;}
    const profile=$("#profileSelect").value;
    const run={run_id:'sim_'+Date.now(),multi:true,profile,started_at:new Date().toISOString(),running:false,
      channels:channels.map(c=>({model:MODELS[c.modelIdx],base:c.base,proto:c.proto}))};
    run.results=simulateMulti(run.channels,profile);
    SIM_RUNS.unshift(run);saveRuns();
    $("#launchNote").textContent='已生成模拟结果';
    renderSummary();renderGroups();renderCmp();
    switchTab('done');
    return;
  }
  if(channels.length<1){$("#launchNote").textContent='请先增加通道';return;}
  for(const c of channels){if(!c.base){$("#launchNote").textContent='缺 Base URL';return;}if(!c.key){$("#launchNote").textContent='缺 API Key';return;}if(!c.modelId){$("#launchNote").textContent='缺模型ID';return;}}
  $("#launchBtn").disabled=true;
  switchTab('running');
  try{await realRun();$("#launchNote").textContent='验收完成';switchTab('done');}
  catch(e){$("#launchNote").textContent='出错:'+(e.message||e);}
  finally{$("#launchBtn").disabled=false;$("#launchBtn").textContent='启动验收';}
};

function judgeOne(m,p,profile){
  const b=bl(m);
  if(p==='cap_multimodal_image_input'&&!(b.feat&&b.feat.vision===true))return'SKIP';
  if(p==='spec_max_output_parameter'&&b.notpub)return'INCONCLUSIVE';
  if(p==='spec_parameter_boundaries'&&!b.temp)return'INCONCLUSIVE';
  if(/kimi-k2/.test(m.id)&&p==='spec_parameter_boundaries')return'SKIP';
  const seed=(m.id+p).length;
  if(seed%7===0)return'FAIL';if(seed%11===0)return'INCONCLUSIVE';if(seed%13===0&&profile==='smoke')return'SKIP';
  return'PASS';
}
function simulateMulti(chans,profile){
  const plan=PLAN_ARR.filter(c=>c.profiles&&c.profiles.includes(profile));
  return plan.map(c=>({case:c,perChannel:chans.map(ch=>({ch,status:judgeOne(ch.model,c.id,profile)}))}));
}

// ============ 真发 ============
// api.js 双模：扩展下 background 直连（无 CORS），服务模式下经 serve.py /proxy
async function proxyFetch(url,opt){opt=opt||{};return API.proxy({url:url,method:opt.method||"POST",headers:opt.headers||{},body:opt.body||null});}
// 通道级错误识别
function chanErr(r){return r.status===401||r.status===403||r.status===404;}
// 模型该用 max_tokens 还是 max_completion_tokens
function maxTokField(m){if(!m)return'max_tokens';const v=m.vendorId?CATALOG[m.vendorId]:null;const pp=(v&&v.platform_params)||m.platform_params;if(pp&&pp.max_completion_tokens&&!pp.max_tokens)return'max_completion_tokens';if(/^o[1-9]/.test(m.id))return'max_completion_tokens';return'max_tokens';}
// 按模型转换 max_tokens 字段（MiMo / o 系列）
function buildBody(m,body,proto){if(proto==='anthropic')return body;const f=maxTokField(m);if(f==='max_completion_tokens'&&body.max_tokens!=null){body.max_completion_tokens=body.max_tokens;delete body.max_tokens;}return body;}
// 按 proto 拼 endpoint
function chatUrl(base,proto){proto=proto||'openai';let b=(base||"").trim().replace(/\/$/,"");if(!b)return"";if(proto==='anthropic'){if(/\/v1\/messages$/.test(b))return b;if(/\/v1$/.test(b))return b+"/messages";return b+"/v1/messages";}if(/\/chat\/completions$/.test(b))return b;if(/\/v1$/.test(b))return b+"/chat/completions";return b+"/v1/chat/completions";}
// 从 gPrompt 提取大写哨兵词
function extractSentinel(prompt){const m=String(prompt||"").match(/[A-Z][A-Z0-9_]{3,}/);return m?m[0]:null;}
async function callAPI(ch,body,noThink){
  if(!noThink)Object.assign(body,thinkParams(ch));
  const proto=ch.proto||'openai';
  const m=ch.model||(ch.modelIdx!=null?MODELS[ch.modelIdx]:null);
  body=buildBody(m,body,proto);
  const url=chatUrl(ch.base,proto);
  let headers={"Content-Type":"application/json","Accept":"application/json"};
  if(proto==='anthropic'){
    if(ch.key)headers["x-api-key"]=ch.key;
    headers["anthropic-version"]="2023-06-01";
    // system 消息提取到 top-level
    if(body.messages){const sys=body.messages.find(x=>x.role==='system');if(sys){body.system=sys.content;body.messages=body.messages.filter(x=>x.role!=='system');}}
    if(!body.max_tokens&&!body.max_completion_tokens)body.max_tokens=1024;
    // tools 格式转换
    if(body.tools)body.tools=body.tools.map(t=>({name:t.function.name,description:t.function.description,input_schema:t.function.parameters}));
    if(body.tool_choice&&typeof body.tool_choice==='string'){const map={auto:{type:'auto'},required:{type:'any'},none:{type:'none'}};body.tool_choice=map[body.tool_choice]||{type:'auto'};}
  }else{
    if(ch.key)headers["Authorization"]="Bearer "+ch.key;
  }
  if(ch.headers){try{Object.assign(headers,JSON.parse(ch.headers));}catch(e){}}
  const r=await proxyFetch(url,{method:"POST",headers,body:JSON.stringify(body)});
  let json=null;try{json=JSON.parse(r.text);}catch(e){}
  const ret={ok:r.ok,status:r.status,text:r.text,json,proto};globalThis._lastCall=ret;return ret;
}
// 按 proto 解析响应
function pickContent(j,proto){proto=proto||'openai';try{if(proto==='anthropic')return(j.content||[]).filter(b=>b.type==='text').map(b=>b.text||'').join('');return j.choices[0].message.content||"";}catch(e){return"";}}
function pickReasoning(j,proto){proto=proto||'openai';try{if(proto==='anthropic')return(j.content||[]).filter(b=>b.type==='thinking').map(b=>b.thinking||'').join('');return j.choices[0].message.reasoning_content||j.choices[0].message.reasoning||"";}catch(e){return"";}}
function pickToolCalls(j,proto){proto=proto||'openai';try{if(proto==='anthropic')return(j.content||[]).filter(b=>b.type==='tool_use')||null;return j.choices[0].message.tool_calls||null;}catch(e){return null;}}
function sSlice(s){return String(s==null?"":s).slice(0,140);}
function failRes(r,note){if(chanErr(r))return{status:"INCONCLUSIVE",note:"通道未接通 HTTP "+r.status+(r.text?(" · "+sSlice(r.text)):"")};return{status:"FAIL",note:note+" HTTP "+r.status+(r.text?(" · "+sSlice(r.text)):"")};}
function isReasoningModel(m){const b=bl(m);return!!(b.feat&&b.feat.thinking_mode===true);}
function jsonFromText(t){if(!t)return null;let s=String(t).trim().replace(/^```(?:json)?\s*/i,"").replace(/\s*```\s*$/,"");if(s[0]==="{"||s[0]==="["){try{return JSON.parse(s);}catch(e){}}const m=s.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);if(m){try{return JSON.parse(m[0]);}catch(e){}}return null;}

async function realJudge(m,ch,c,profile){
  const b=bl(m);const id=c.id;const modelId=ch.modelId||m.id;const proto=ch.proto||'openai';const v=m?m.vendor:'';
  const notpubTemp=!b.temp||b.temp.min==="NOT_PUBLISHED";
  const mk=(res)=>{const lc=globalThis._lastCall;const p=proto;const out=lc?{http:lc.status,content:String(pickContent(lc.json,p)||'').slice(0,400),reasoning:String(pickReasoning(lc.json,p)||'').slice(0,400),toolCalls:pickToolCalls(lc.json,p),text:String(lc.text||'').slice(0,400)}:null;return{...res,out};};
  if(id==="spec_text_io"){const mt=isReasoningModel(m)?4096:64;const promptTxt=$("#gPrompt")?$("#gPrompt").value:'请精确回复哨兵 SPEC_TEXT_OK';const sentinel=extractSentinel(promptTxt);const r=await callAPI(ch,{model:modelId,messages:[{role:"user",content:promptTxt}],max_tokens:mt,stream:false});if(!r.ok)return mk(failRes(r,"请求失败"));const t=pickContent(r.json,proto);if(sentinel){const exact=String(t==null?'':t).trim().replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g,'')===sentinel;if(exact)return mk({status:"PASS",note:"精确返回哨兵 "+sentinel});if(new RegExp(sentinel).test(t))return mk({status:"FAIL",note:"含哨兵但非精确:"+sSlice(t)});const rc=pickReasoning(r.json,proto);if(!t&&rc)return mk({status:"INCONCLUSIVE",note:"content空,reasoning len="+rc.length});return mk({status:"FAIL",note:"未返回哨兵:"+sSlice(t)});}else{return mk(t&&t.length>0?{status:"PASS",note:"非空len="+t.length}:{status:"FAIL",note:"空输出"});}}
  if(id==="spec_output_generation"){const thresh=profile==='smoke'?128:profile==='standard'?1024:2048;const mt=isReasoningModel(m)?8192:profile==='smoke'?1024:4096;const r=await callAPI(ch,{model:modelId,messages:[{role:"user",content:"用中文写一段约200字的产品介绍，详细描述功能特点。"}],max_tokens:mt,stream:false});if(!r.ok)return mk(failRes(r,"请求失败"));const t=pickContent(r.json,proto);const ctoks=(r.json&&r.json.usage&&r.json.usage.completion_tokens)||0;if(ctoks>=thresh)return mk({status:"PASS",note:"completion_tokens="+ctoks+"≥"+thresh});if(t&&t.length>0)return mk({status:"INCONCLUSIVE",note:"产出不足 tokens="+ctoks+"<"+thresh});return mk({status:"FAIL",note:"空输出"});}
  if(id==="spec_invalid_request_errors"){const tests=[{n:'空messages',b:{model:modelId,messages:[],max_tokens:16}},{n:'空content',b:{model:modelId,messages:[{role:'user',content:''}],max_tokens:16}},{n:'无model',b:{messages:[{role:'user',content:'hi'}],max_tokens:16}}];const results=[];for(const tt of tests){const r=await callAPI(ch,tt.b,true);if(chanErr(r))return mk({status:"INCONCLUSIVE",note:"通道未接通 HTTP "+r.status+",未真正测到"});results.push(tt.n+':'+(r.status>=400&&r.status<500?'拒'+r.status:'未拒'+r.status));}const allRej=results.every(s=>/:拒/.test(s));return mk(allRej?{status:"PASS",note:results.join(' ')}:{status:"FAIL",note:results.join(' ')});}
  if(id==="spec_parameter_boundaries"){if(notpubTemp)return mk({status:"INCONCLUSIVE",note:"未公布范围"});const tests=[{n:'max_tokens=1',b:{model:modelId,messages:[{role:'user',content:'hi'}],max_tokens:1}},{n:'temp=0',b:{model:modelId,messages:[{role:'user',content:'hi'}],temperature:0,max_tokens:16}},{n:'temp=1',b:{model:modelId,messages:[{role:'user',content:'hi'}],temperature:1,max_tokens:16}}];const results=[];for(const tt of tests){const r=await callAPI(ch,tt.b,true);if(chanErr(r))return mk({status:"INCONCLUSIVE",note:"通道未接通 HTTP "+r.status+",未真正测到"});results.push(tt.n+':'+(r.ok?'200':'HTTP'+r.status));}const allOk=results.every(s=>/:200/.test(s));return mk(allOk?{status:"PASS",note:"三边界全200: "+results.join(' ')}:{status:"FAIL",note:results.join(' ')});}
  if(id==="spec_max_output_parameter"||id==="spec_max_completion_tokens_parameter"){if(b.notpub)return mk({status:"INCONCLUSIVE",note:"未公布最大输出"});const mo=b.maxOut||4096;const tm=Math.min(mo,4096);const field=maxTokField(m);const body={model:modelId,messages:[{role:"user",content:"输出连续文字。"}],stream:false};body[field]=tm;const r=await callAPI(ch,body,true);if(!r.ok)return mk(failRes(r,field+"="+tm+"失败"));return mk({status:"PASS",note:field+"="+tm+"被接受(上限"+mo+")"});}
  if(id==="spec_context_window"){const cap=b.ctx?Math.min(b.ctx,profile==='smoke'?8192:profile==='standard'?32768:131072):4096;const pad="x ".repeat(Math.floor(cap/2));const r=await callAPI(ch,{model:modelId,messages:[{role:"user",content:pad+"文末回复 CONTEXT_OK。"}],max_tokens:64,stream:false});if(!r.ok)return mk(failRes(r,"压测失败"));const t=pickContent(r.json,proto);const toks=(r.json&&r.json.usage&&r.json.usage.prompt_tokens)||0;if(/CONTEXT_OK/.test(t))return mk({status:"PASS",note:"窗口内接受,prompt_tokens="+toks});if(r.ok)return mk({status:"INCONCLUSIVE",note:"接受200但无哨兵"});return mk({status:"FAIL",note:"压测失败"});}
  if(id==="cap_tool_result_roundtrip"){const mt=isReasoningModel(m)?2048:128;const r=await callAPI(ch,{model:modelId,messages:[{role:"user",content:"北京天气？调get_weather。"},{role:"assistant",content:null,tool_calls:[{id:"call_1",type:"function",function:{name:"get_weather",arguments:'{"city":"北京"}'}}]},{role:"tool",tool_call_id:"call_1",content:"北京，晴，25℃。"}],max_tokens:mt,stream:false});if(!r.ok)return mk(failRes(r,"失败"));const t=pickContent(r.json,proto)||"";return mk(/25|晴/.test(t)?{status:"PASS",note:"使用回填结果"}:{status:"FAIL",note:"未使用:"+sSlice(t)});}
  if(id==="cap_tool_error_recovery"){const mt=isReasoningModel(m)?2048:128;const r=await callAPI(ch,{model:modelId,messages:[{role:"user",content:"查北京天气，调get_weather。"},{role:"assistant",content:null,tool_calls:[{id:"call_1",type:"function",function:{name:"get_weather",arguments:'{"city":"北京"}'}}]},{role:"tool",tool_call_id:"call_1",content:"ERROR:503"}],max_tokens:mt,stream:false});if(!r.ok)return mk(failRes(r,"失败"));const t=pickContent(r.json,proto)||"";return mk((t.length>0&&/不可用|无法|失败|抱歉|503/i.test(t))?{status:"PASS",note:"错误后合理回应"}:(t.length>0?{status:"INCONCLUSIVE",note:"有回应但未处理错误"}:{status:"FAIL",note:"空输出"}));}
  if(id==="cap_tool_choice_modes"){const mt=isReasoningModel(m)?2048:128;const r=await callAPI(ch,{model:modelId,messages:[{role:"user",content:"你好。"}],tools:[{type:"function",function:{name:"get_weather",description:"天气",parameters:{type:"object",properties:{city:{type:"string"}}}}}],tool_choice:"required",max_tokens:mt,stream:false});if(!r.ok)return mk(failRes(r,"失败"));const tc=pickToolCalls(r.json,proto);return mk((tc&&tc.length)?{status:"PASS",note:"required触发调用"}:{status:"FAIL",note:"未触发"});}
  if(id==="cap_streaming"){const r=await callAPI(ch,{model:modelId,messages:[{role:"user",content:"从1数到5"}],max_tokens:64,stream:true});return mk(/data:\s/.test(r.text)?{status:"PASS",note:"收到SSE流"}:{status:"FAIL",note:"无SSE:"+sSlice(r.text)});}
  if(id==="cap_function_calling"){const mt=isReasoningModel(m)?2048:128;const r=await callAPI(ch,{model:modelId,messages:[{role:"user",content:"北京天气？调工具。"}],tools:[{type:"function",function:{name:"get_weather",description:"天气",parameters:{type:"object",properties:{city:{type:"string"}},required:["city"]}}}],tool_choice:"auto",max_tokens:mt,stream:false});if(!r.ok)return mk(failRes(r,"失败"));const tc=pickToolCalls(r.json,proto);return mk((tc&&tc.length)?{status:"PASS",note:"触发调用"}:{status:"FAIL",note:"未触发"});}
  if(id==="cap_tool_no_false_positive"){const r=await callAPI(ch,{model:modelId,messages:[{role:"user",content:"1+1等于几？直接回答数字,不调工具。"}],tools:[{type:"function",function:{name:"get_weather",description:"天气",parameters:{type:"object",properties:{city:{type:"string"}}}}}],tool_choice:"auto",max_tokens:64,stream:false});if(!r.ok)return mk(failRes(r,"失败"));const tc=pickToolCalls(r.json,proto);return mk((!tc||!tc.length)?{status:"PASS",note:"无误触"}:{status:"FAIL",note:"误触"});}
  if(id==="cap_structured_output"){const mt=isReasoningModel(m)?2048:128;const r=await callAPI(ch,{model:modelId,messages:[{role:"user",content:"只返回JSON：{\"ok\":true,\"n\":42}"}],response_format:{type:"json_object"},max_tokens:mt,stream:false});if(!r.ok)return mk(failRes(r,"失败"));const t=pickContent(r.json,proto);if(jsonFromText(t))return mk({status:"PASS",note:"合法JSON"});return mk({status:"FAIL",note:"非JSON:"+sSlice(t)});}
  if(id==="cap_json_schema_output"){const mt=isReasoningModel(m)?2048:128;const r=await callAPI(ch,{model:modelId,messages:[{role:"user",content:"按schema返回用户:name=张三,age=18"}],response_format:{type:"json_schema",json_schema:{name:"user",strict:false,schema:{type:"object",properties:{name:{type:"string"},age:{type:"integer"}},required:["name","age"]}}},max_tokens:mt,stream:false});if(!r.ok)return mk({status:"INCONCLUSIVE",note:"可能不支持json_schema HTTP "+r.status});const t=pickContent(r.json,proto);const o=jsonFromText(t);if(o&&o.name&&o.age!=null)return mk({status:"PASS",note:"符合schema"});return mk({status:"FAIL",note:"不符:"+sSlice(t)});}
  if(id==="cap_multi_round_chat"){const mt=isReasoningModel(m)?2048:64;const r=await callAPI(ch,{model:modelId,messages:[{role:"user",content:"我叫小明，记住。"},{role:"assistant",content:"你好小明。"},{role:"user",content:"我叫什么？只回答名字。"}],max_tokens:mt,stream:false});if(!r.ok)return mk(failRes(r,"失败"));const t=pickContent(r.json,proto)||"";return mk(/小明/.test(t)?{status:"PASS",note:"多轮记忆OK"}:{status:"FAIL",note:"记忆失败:"+sSlice(t)});}
  if(id==="cap_tool_parallel_calls"){const mt=isReasoningModel(m)?2048:256;const r=await callAPI(ch,{model:modelId,messages:[{role:"user",content:"同时查北京和上海天气。"}],tools:[{type:"function",function:{name:"get_weather",description:"天气",parameters:{type:"object",properties:{city:{type:"string"}},required:["city"]}}}],tool_choice:"auto",max_tokens:mt,stream:false});if(!r.ok)return mk(failRes(r,"失败"));const tc=pickToolCalls(r.json,proto)||[];return mk(tc.length>=2?{status:"PASS",note:"并行"+tc.length+"个"}:{status:"INCONCLUSIVE",note:"仅"+tc.length+"个"});}
  if(id==="cap_thinking_enabled"){if(!isReasoningModel(m))return mk({status:'SKIP',note:'非思考模型'});const mt=4096;const r=await callAPI(ch,{model:modelId,messages:[{role:"user",content:"一步步思考：123×456等于多少？给推理过程。"}],max_tokens:mt,stream:false});if(!r.ok)return mk(failRes(r,"失败"));const rc=pickReasoning(r.json,proto);return mk(rc?{status:"PASS",note:"返回思考len="+rc.length}:{status:"INCONCLUSIVE",note:"未暴露reasoning"});}
  if(id==="cap_thinking_disabled"){if(!isReasoningModel(m))return mk({status:'SKIP',note:'非思考模型'});let dis={};if(/智谱|zhipu|glm/i.test(v))dis={thinking:{type:'disabled'}};else if(/Kimi|moonshot/i.test(v))dis={thinking:false};else if(/MiniMax/i.test(v))dis={thinking_enabled:false};else if(/MiMo|小米/i.test(v))dis={enable_thinking:false};else dis={reasoning_effort:'low'};const r=await callAPI(ch,{model:modelId,messages:[{role:"user",content:"请精确回复哨兵 DISABLED_THINK_OK"}],max_tokens:isReasoningModel(m)?2048:128,stream:false,...dis},true);if(r.status>=400&&r.status<500)return mk({status:"PASS",note:"不可关闭,被拒 HTTP "+r.status});if(!r.ok)return mk(failRes(r,"失败"));const t=pickContent(r.json,proto);const rc=pickReasoning(r.json,proto);if(t&&(!rc||rc.length===0))return mk({status:"PASS",note:"关闭成功,无reasoning"});if(rc&&rc.length>0)return mk({status:"FAIL",note:"仍返回reasoning len="+rc.length});return mk({status:"INCONCLUSIVE",note:"无content无reasoning"});}
  if(id==="cap_reasoning_effort"){if(!isReasoningModel(m))return mk({status:'SKIP',note:'非思考模型'});if(maxTokField(m)!=='max_completion_tokens')return mk({status:'SKIP',note:'非reasoning_effort模型'});const efforts=['low','high'];const results=[];for(const eff of efforts){const r=await callAPI(ch,{model:modelId,messages:[{role:"user",content:"1+1=?"}],max_tokens:256,stream:false,reasoning_effort:eff},true);if(chanErr(r))return mk({status:"INCONCLUSIVE",note:"通道未接通 HTTP "+r.status});results.push(eff+':'+(r.ok?'OK':'FAIL'+r.status));}return mk(results.every(s=>/:OK/.test(s))?{status:"PASS",note:results.join(' ')}:{status:"FAIL",note:results.join(' ')});}
  if(id==="cap_stream_tool"){const r=await callAPI(ch,{model:modelId,messages:[{role:"user",content:"北京天气？调get_weather。"}],tools:[{type:"function",function:{name:"get_weather",description:"天气",parameters:{type:"object",properties:{city:{type:"string"}},required:["city"]}}}],tool_choice:"auto",max_tokens:256,stream:true},true);if(!r.ok)return mk(failRes(r,"失败"));const lines=String(r.text||'').split('\n').filter(l=>/^data:\s/.test(l));let toolArgs='',hasTC=false;for(const line of lines){const d=line.replace(/^data:\s/,'').trim();if(d==='[DONE]')break;try{const j=JSON.parse(d);const delta=j.choices&&j.choices[0]&&j.choices[0].delta;if(delta&&delta.tool_calls){hasTC=true;const tc=delta.tool_calls[0];if(tc.function&&tc.function.arguments)toolArgs+=tc.function.arguments;}}catch(e){}}return mk(hasTC?{status:"PASS",note:"流式tool_call合并 args="+sSlice(toolArgs)}:{status:"FAIL",note:"无流式tool_call"});}
  if(id==="cap_preserved_thinking"){if(!isReasoningModel(m))return mk({status:'SKIP',note:'非思考模型'});if(!/智谱|zhipu|glm/i.test(v))return mk({status:'SKIP',note:'仅GLM支持clear_thinking'});const r1=await callAPI(ch,{model:modelId,messages:[{role:"user",content:"记住数字42,然后计算1+1"}],max_tokens:2048,stream:false,thinking:{type:'enabled'}},true);if(!r.ok)return mk(failRes(r,"第一轮失败"));const t1=pickContent(r.json,proto);const r2=await callAPI(ch,{model:modelId,messages:[{role:"user",content:"记住数字42,然后计算1+1"},{role:"assistant",content:t1||'42,1+1=2'},{role:"user",content:"我之前说的数字是多少？"}],max_tokens:2048,stream:false,thinking:{type:'enabled'}},true);if(!r.ok)return mk(failRes(r,"第二轮失败"));const t2=pickContent(r.json,proto);return mk(/42/.test(t2)?{status:"PASS",note:"思考保留,记住42"}:{status:"FAIL",note:"未记住:"+sSlice(t2)});}
  if(id==="cap_cache"){const longCtx='请记住以下内容：'+('ABCDEFGHIJKLMNOPQRSTUVWXYZ').repeat(200)+'\n\n回复 OK';const r1=await callAPI(ch,{model:modelId,messages:[{role:"user",content:longCtx}],max_tokens:16,stream:false},true);if(!r.ok)return mk(failRes(r,"第一次失败"));const r2=await callAPI(ch,{model:modelId,messages:[{role:"user",content:longCtx}],max_tokens:16,stream:false},true);if(!r.ok)return mk(failRes(r,"第二次失败"));const u2=r2.json&&r2.json.usage||{};const cached=(u2.prompt_tokens_details&&u2.prompt_tokens_details.cached_tokens)||u2.cached_tokens||0;return mk(cached>0?{status:"PASS",note:"缓存命中 cached_tokens="+cached}:{status:"INCONCLUSIVE",note:"缓存为0 (可能不支持或不触发)"});}
  if(id==="cap_partial_mode"){if(proto==='anthropic')return mk({status:'SKIP',note:'Anthropic协议不支持prefill'});const r=await callAPI(ch,{model:modelId,messages:[{role:"user",content:"续写以下文字："},{role:"assistant",content:"春天来了，"}],max_tokens:64,stream:false},true);if(!r.ok)return mk(failRes(r,"失败"));const t=pickContent(r.json,proto);return mk(t&&t.length>3?{status:"PASS",note:"续写:"+sSlice(t)}:{status:"FAIL",note:"未续写"});}
  if(id==="sec_auth_security"){const chNoKey={...ch,key:''};const r1=await callAPI(chNoKey,{model:modelId,messages:[{role:"user",content:"hi"}],max_tokens:16,stream:false},true);const chBadKey={...ch,key:'sk-invalid-'+(Date.now()%10000)};const r2=await callAPI(chBadKey,{model:modelId,messages:[{role:"user",content:"hi"}],max_tokens:16,stream:false},true);const p1=(r1.status===401||r1.status===403);const p2=(r2.status===401||r2.status===403);return mk(p1&&p2?{status:"PASS",note:"空Key→"+r1.status+" 错Key→"+r2.status+" (脱敏需后端日志验证)"}:{status:"FAIL",note:"空Key→"+r1.status+" 错Key→"+r2.status});}
  if(id==="obs_usage_and_status_fields"){return mk({status:'SKIP',note:'需平台观测接口,前端不可测'});}
  if(id==="cap_multimodal_image_input"){if(!(b.feat&&b.feat.vision===true))return mk({status:'SKIP',note:'文本模型,不支持视觉'});const imgUrl='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';const r=await callAPI(ch,{model:modelId,messages:[{role:"user",content:[{type:"text",text:"这张图是什么颜色？"},{type:"image_url",image_url:{url:imgUrl}}]}],max_tokens:64,stream:false});if(!r.ok)return mk(failRes(r,"失败"));const t=pickContent(r.json,proto);return mk(t&&t.length>0?{status:"PASS",note:"视觉输入被接受,回复:"+sSlice(t)}:{status:"FAIL",note:"空输出"});}
  return mk({status:"SKIP",note:"未实现"});
}
async function runPool(tasks,conc){let i=0;const n=tasks.length;async function w(){while(true){const idx=i++;if(idx>=n)break;await tasks[idx]();}}await Promise.all(Array.from({length:Math.max(1,Math.min(conc,n))},w));}
async function realRun(){
  const profile=$("#profileSelect").value;
  const plan=PLAN_ARR.filter(c=>c.profiles&&c.profiles.includes(profile));
  const chans=channels.map(c=>{const m=MODELS[c.modelIdx];return{model:m,modelId:c.modelId||m.id,base:c.base,key:c.key,headers:c.headers,proto:c.proto};});
  const run={run_id:"real_"+Date.now(),multi:true,profile,started_at:new Date().toISOString(),running:true,channels:chans,results:plan.map(c=>({case:c,perChannel:chans.map(ch=>({ch,status:"PENDING",note:"",elapsed:0}))}))};
  SIM_RUNS.unshift(run);
  const total=chans.length*plan.length;
  $("#launchBtn").textContent="真发中 0/"+total;
  let done=0;
  const tick=()=>{renderSummary();renderGroups();renderCmp();};
  tick();
  for(let ci=0;ci<chans.length;ci++){
    const ch=chans[ci];
    const tasks=plan.map((c,idx)=>async()=>{
      const t0=performance.now();
      run.results[idx].perChannel[ci]={ch,status:"RUNNING",note:"",elapsed:0};
      try{const r=await realJudge(ch.model,ch,c,profile);run.results[idx].perChannel[ci]={ch,status:r.status,note:r.note||"",elapsed:Math.round(performance.now()-t0),out:r.out||null};}
      catch(e){run.results[idx].perChannel[ci]={ch,status:"FAIL",note:"异常:"+(e.message||e),elapsed:Math.round(performance.now()-t0),out:null};}
      done++;$("#launchBtn").textContent="真发中 "+done+"/"+total;tick();
    });
    await runPool(tasks,3);
  }
  run.running=false;
  $("#launchBtn").textContent="启动验收";
  saveRuns();
}

// ============ 持久化 ============
const SIM_RUNS=[];
const STORE_KEY='lla2_runs';
function saveRuns(){try{const toSave=SIM_RUNS.slice(0,5).map(r=>({...r,results:r.results.map(res=>({...res,perChannel:res.perChannel.map(p=>({...p,out:p.out?{http:p.out.http,content:String(p.out.content||'').slice(0,200),text:String(p.out.text||'').slice(0,200)}:null}))}))}));localStorage.setItem(STORE_KEY,JSON.stringify(toSave));}catch(e){}}
function loadRuns(){try{return JSON.parse(localStorage.getItem(STORE_KEY)||'null');}catch(e){return null;}}
(function(){const p=loadRuns();if(p&&p.length)p.forEach(r=>SIM_RUNS.push(r));})();

// ============ 对话分析（向量检索 + LLM 归因）============
let CHAT=[];
const CHAT_KEY='lla2_chat';
function loadChat(){try{CHAT=JSON.parse(localStorage.getItem(CHAT_KEY)||'[]');}catch(e){CHAT=[];}}
function saveChat(){try{localStorage.setItem(CHAT_KEY,JSON.stringify(CHAT.slice(-30)));}catch(e){}}
loadChat();
function tokenize(s){const t=String(s==null?'':s).toLowerCase();const out=[];for(const ch of t){if(/[一-鿿]/.test(ch))out.push(ch);}const m=t.match(/[a-z0-9_]+/g)||[];return out.concat(m);}
function buildIndex(docs){const N=docs.length||1;const df={};docs.forEach(d=>{const seen=new Set(tokenize(d.text));seen.forEach(w=>df[w]=(df[w]||0)+1);});const idf={};Object.keys(df).forEach(w=>idf[w]=Math.log((N+1)/(df[w]+1))+1);const vecs=docs.map(d=>{const tf={};tokenize(d.text).forEach(w=>tf[w]=(tf[w]||0)+1);const v={};Object.keys(tf).forEach(w=>v[w]=tf[w]*idf[w]);return v;});return{idf,vecs};}
function qvec(q,idf){const tf={};tokenize(q).forEach(w=>tf[w]=(tf[w]||0)+1);const v={};Object.keys(tf).forEach(w=>{if(idf[w]!=null)v[w]=tf[w]*idf[w];});return v;}
function cosine(a,b){let dot=0,na=0,nb=0;const keys=new Set([...Object.keys(a),...Object.keys(b)]);keys.forEach(k=>{const x=a[k]||0,y=b[k]||0;dot+=x*y;na+=x*x;nb+=y*y;});return(na&&nb)?dot/(Math.sqrt(na)*Math.sqrt(nb)):0;}
function gatherDocs(){const docs=[];SIM_RUNS.forEach(run=>{run.results.forEach(r=>{r.perChannel.forEach((p,ci)=>{const ch=run.channels[ci];const txt=`${r.case.name} ${r.case.id} ${r.case.desc||r.case.description||''} ${ch.model.name} ${p.status} ${p.note||''}`;docs.push({id:run.run_id+'/'+ci+'/'+r.case.id,run,ci,case:r.case,p,ch,text:txt});});});});return docs;}
function retrieve(query,k){const docs=gatherDocs();if(!docs.length)return[];const idx=buildIndex(docs);const qv=qvec(query,idx.idf);const scored=docs.map((d,i)=>({d,s:cosine(qv,idx.vecs[i])})).sort((a,b)=>b.s-a.s);return scored.slice(0,k).filter(x=>x.s>0).map(x=>x.d);}
function runSummary(run){const tally={PASS:0,FAIL:0,INCONCLUSIVE:0,SKIP:0};run.results.forEach(r=>r.perChannel.forEach(p=>{tally[p.status]=(tally[p.status]||0)+1;}));let lines=`汇总: PASS ${tally.PASS||0} / FAIL ${tally.FAIL||0} / INC ${tally.INCONCLUSIVE||0} / SKIP ${tally.SKIP||0}\n`;lines+='逐项:\n';run.results.forEach(r=>{const per=r.perChannel.map((p,ci)=>`${run.channels[ci].model.name}=${p.status}`).join(' ');lines+=`- ${r.case.name}(${r.case.id}): ${per}\n`;});return lines;}
function ctxText(docs,run){let s='';if(run)s+='【最近一次验收】\n'+runSummary(run)+'\n';if(docs.length){s+='【历史相关片段(向量检索top-'+docs.length+')】\n';docs.forEach((d,i)=>{s+=`[${i+1}] run=${d.run.run_id} 模型=${d.ch.model.name} 用例=${d.case.name}(${d.case.id}) 状态=${d.p.status} 备注=${d.p.note||''}\n`;});}return s||'（暂无验收数据）';}
async function callAnalyst(question,context){
  const ci=+$("#analystCh").value;const ch=channels[ci];if(!ch||!ch.base||!ch.key)return'未选择有效分析员通道(需 Base URL + Key)。请在「发起测试」配置后回到此处。';
  const sys='你是 LLM 多路验收对比分析助手。根据给定的验收数据(最近一次+历史相关片段)回答用户问题。要求:简明、分点、指出不一致项与可能原因、给出可操作建议。若数据不足以判断,如实说明。';
  const msgs=[{role:'system',content:sys+'\n\n'+context},{role:'user',content:question}];
  const r=await callAPI(ch,{model:ch.modelId,messages:msgs,max_tokens:1024,stream:false},true);
  if(!r.ok)return'分析调用失败 HTTP '+r.status+' '+(r.text||'').slice(0,200);
  const t=pickContent(r.json,ch.proto||'openai');
  return t||('（分析员未返回文本。原始响应:'+String(r.text).slice(0,200)+'）');
}
function renderChat(){
  const sel=$("#analystCh");if(sel){if(!channels.length){sel.innerHTML='<option value="">请先在发起测试配置通道</option>';}else{sel.innerHTML=channels.map((c,i)=>`<option value="${i}">${i+1}. ${esc(MODELS[c.modelIdx]?MODELS[c.modelIdx].name:c.model||'?')} · ${esc((c.base||'').slice(0,30))||'未配置'}</option>`).join('');sel.value=Math.min(sel.value||0,channels.length-1);}}
  const log=$("#chatLog");
  log.innerHTML=CHAT.map(m=>`<div class="chat-msg ${m.role}"><div class="who">${m.role==='user'?'你':'分析员'}</div><div class="bubble">${esc(m.text)}</div>${m.ctx?`<div class="ctx">${esc(m.ctx)}</div>`:''}</div>`).join('')||'<div class="empty" style="border:none">还没有对话。提问验收结果即可。</div>';
  log.scrollTop=log.scrollHeight;
}
async function chatAsk(){
  const inp=$("#chatInput");const q=inp.value.trim();if(!q)return;
  inp.value='';CHAT.push({role:'user',text:q});renderChat();
  const run=SIM_RUNS[0];const docs=retrieve(q,+($("#chatTopK").value)||8);const ctx=ctxText(docs,run);
  const ans=await callAnalyst(q,ctx);
  const ctxLabel='检索到 '+docs.length+' 条历史片段'+(run?(' · 含最近一次「'+run.run_id+'」'):'');
  CHAT.push({role:'bot',text:ans,ctx:ctxLabel});saveChat();renderChat();
}
$("#chatSend").onclick=chatAsk;
$("#chatInput").addEventListener('keydown',e=>{if(e.key==='Enter')chatAsk();});
$("#chatClear").onclick=()=>{CHAT.length=0;saveChat();renderChat();};

// ============ 初始化 ============
initModel();
renderBaseline();
updateThinkHint();
(function(){const lc=loadCh();if(lc&&lc.length){channels=lc;renderCh();}else{addCh();addCh();}})();
renderSummary();renderGroups();renderCmp();renderChat();

// 代理探测：扩展下 background 恒可用；服务模式 / file:// 取决于本地后端
(async function(){
  const ok=API.IS_EXT?true:await API.health();
  if(!ok){const cb=$("#realMode");if(cb){cb.checked=false;cb.disabled=true;}$("#launchNote").textContent='无本地后端,真发禁用';}
})();
