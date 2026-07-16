# 建站主规格 · 面向 AI 生成（星流 LLM 多路验收对比工具）

> 用途：喂给 AI 代码生成工具，1:1 复刻参考站点并叠加增量。
> 生成目标：**一个纯前端 Web 应用**（React/Vue 任选），直连公司现有后端，无需新建后端。
> 版本：v1 ｜ 日期：2026-07-16

---

## 0. 一句话生成指令

> 做一个纯前端 Web 应用，**1:1 复刻 `http://120.92.93.22/llm-benchmark` 的验收控制台**（三Tab、验证卡、PASS/FAIL/INC/SKIP），并叠加两个增量：**①多路 Endpoint 并排对比**（前端并发调用、聚合对比）**②按客户测试标准生成新用例**。前端直连公司现有后端 API（`/api/plan`、`/api/runs`），**不新建任何后端**。所有功能依据见同目录《PRD-v2》与《参考网站拆解报告》。

---

## 1. 关键前提（AI 必须遵守）

1. **纯前端**：React 或 Vue 均可。无后端代码生成，不引入数据库。
2. **直连现有后端**：用公司现有 API，配置见 §3。绝不新建后端。
3. **API Key 仅存浏览器**（localStorage / 内存），不上传后端，不写日志。密码框明文/隐藏切换。
4. **复刻 + 增量**：先 1:1 还原参考站点全部 UI/交互，再加 §5 两个增量。不要在复刻时擅自改设计。

---

## 2. 参考站点要复刻的形态（目标长相）

来源：`llm_console.html`（前端源码）、`bench_plan.json`、`bench_runs.json`。

### 2.1 布局
- 顶部三 Tab：**发起测试(launch) / 进行中(running) / 已完成(done)**。URL hash 路由（`#launch` 等）。
- 进行中 Tab 每 5 秒轮询 `/api/runs`（参考站点 `setInterval(loadRuns, 5000)`）。

### 2.2 发起测试页
- 模型选择：分组级联（厂商→系列→版本），来自 `CATALOG`（前端硬编码，见 §4.1，用我提供的增强版）。
- 选模型后展示其官方基线（上下文/最大输出/协议/限速），数据来自 §4.2 基线 JSON。
- 测试参数：协议格式（openai/anthropic，按模型 `protocols` 给可选）、profile 档位（smoke/standard/full）、可选限速覆盖（rpm/tpm/max_output_tokens）。
- API Key 输入（留空走后端默认 Key）、Endpoint（默认按协议给出官方路径）、自定义 Headers（可选）。
- 「启动测试」→ POST `/api/runs`（契约见 §3.2），成功后跳 进行中 Tab。

### 2.3 进行中 / 已完成页
- 卡片网格，每个 run 一张卡：
  - 头：模型 + 协议 + profile + 起止时间 + 状态(running/✅完成/❌异常)。
  - 计数徽章：`PASS / FAIL / INCONCLUSIVE / SKIP`（用绿/红/灰/虚线区分）。
  - 底：run_id + 操作（查看明细/删除）。

### 2.4 验证卡（单个 run 明细）—— 复刻 + 增强可读性
- 分两组展示：**Specifications（9） / Capabilities（18）**。
- 每项一行：用例名 + 判定徽章(✅❌⚠️⏭️) + 可展开看 `expected vs 实测` + `refs` 官网链接。
- 顶部摘要：`整体 ⚠️ 部分对齐 · 规格 ●●●○○ · 能力 ●●●●●`（进度点直观）。
- 这是领导"可读卡片、不堆原始数据"原则的落点。

---

## 3. 后端 API 契约（直连，真实可用）

### 3.1 GET `/api/plan` → 测试用例清单
- 已验证：`http://120.92.93.22/llm-benchmark/api/plan` → HTTP 200，application/json，无需登录。
- 返回：**数组，27 个用例**，字段见 `bench_plan.json`：
  `id, group(Specifications|Capabilities), priority(P0|P1), profiles[], name, desc, description, requirement, expected, run, source, refs[{label,url}]`
- AI 用法：前端启动后拉取，渲染用例树；`expected` 决定判定展示，`refs` 渲染官网引用。

### 3.2 GET/POST `/api/runs` → 运行结果
- 已验证：`http://120.92.93.22/llm-benchmark/api/runs` → HTTP 200，返回 run 数组。
- 单 run 字段（见 `bench_runs.json`）：
  ```
  run_id, metadata{run_id, started_at, ended_at, model, api_format,
    endpoint, endpoint_path, profile, rpm_limit, tpm_limit,
    max_output_tokens, force_128k_output, host, authorization_persisted},
  counts{PASS,FAIL,INCONCLUSIVE,SKIP}, running, returncode, started_at, mtime
  ```
- AI 用法：进行中/已完成 Tab 轮询此接口渲染卡片。counts 决定徽章数字。
- ⚠️ 注：`120.92.93.22` 与 `kspmas.ksyun.com` 同一服务；前端直接用 `120.92.93.22/llm-benchmark` 作 BASE（无 token 即可读；写操作鉴权以公司内部约定为准）。

### 3.3 鉴权说明
- 读接口（plan/runs）公开无需 token。
- 发起/删除 run 等写操作若需鉴权，沿用公司现有机制（`window.AUTH_TOKEN`，当前为空走默认 Key）。AI 不要自造鉴权。

---

## 4. 数据资产（前端打包或外挂，AI 直接用）

### 4.1 CATALOG（模型树）—— 用增强版
参考站点 `CATALOG` 较简；用我提供的 `baselines/*.json` 补全后构建，结构保持：
```json
[{ "id":"zhipu","name":"智谱","series":[{ "id":"glm-5","name":"GLM-5系列",
   "versions":[{ "id":"glm-5.2","name":"GLM-5.2",
     "protocols":["openai"], "maxOutput":131072, "rpm":500, "tpm":1000000 }] }] }, ...]
```
增强：每版本挂 `baseline` 指向 §4.2 对应条目（带 temp/top_p 范围、功能开关、官网来源、价格、NOT_PUBLISHED 标记）。

### 4.2 官方参数基线 —— `baselines/*.json`（5 家，已就绪）
- `deepseek.json / zhipu.json / minimax.json / kimi.json / mimo.json`
- 每条带 `source`（官网 URL）、`verification_notes`、"官网未公布"标 `NOT_PUBLISHED`。
- 基线各自独立（不强套统一模板）—— 满足领导原则2。
- AI 用法：选模型后渲染基线；驱动用例 expected；未公布项前端显示"⚠️ 官网未公布 → 不测"。

### 4.3 标准用例 —— `bench_plan.json`（27 条，已就绪）
直接用 `/api/plan` 拉取或前端内置此 JSON 兜底。含 expected/requirement/refs。

### 4.4 实测样本 —— `bench_runs.json`（3 个真实 run，已就绪）
开发期可作 mock 数据，验证渲染逻辑。

---

## 5. 增量1：多路 Endpoint 并排对比（需求文档核心）

### 5.1 交互
- 工作台支持动态增减通道：最少 2 路，最多 4 路。每路独立：模型、协议、BaseURL、API Key、自定义 Headers。
- 全局统一超参（Temperature/Top_p/Max_Tokens），保证多路发同一份（测试变量唯一）。

### 5.2 实现（纯前端，§已与用户确认）
- 前端对每路通道**并发调用** `/api/runs`（或现有跑测接口），各自启动一个 run。
- 轮询各路 run 结果，聚合到一张**多路对比表**：
  | 用例 | 路1 官网直连 | 路2 中转 | 路3 网关 | 一致? |
  |---|---|---|---|---|
  | 最大输出 | ✅128K | ⚠️64K | ✅128K | ❌路2缩水 |
  | 函数调用 | ✅ | ✅ | ❌ | ❌路3缺失 |
- 横向(多路间一致性) + 纵向(每路 vs 官方基线) 在同一界面并存。

### 5.3 约束
- 限速口径各异（DeepSeek并发/MiniMax档位/Kimi充值档/MiMo RPM·TPM/智谱并发数），前端做并发节流避免触发限流。
- 协议基线约束自动标 SKIP（如 Kimi K2 不暴露采样参数、MiMo 思考模式覆盖 temp/top_p）。

---

## 6. 增量2：按客户测试标准生成新用例（领导阶段2 核心）

### 6.1 交互
- 一个"用例生成器"面板：输入客户测试标准（结构化表 + 自然语言描述）。
- 选定目标模型后，结合该模型基线 + 四类对齐维度，生成符合 §3.1 用例结构的新用例（含 expected/refs）。

### 6.2 生成规则
- 四类对齐维度作为模板：A能力存在性 / B参数边界 / C默认值 / D参数生效。
- expected 参照基线字段自动填（如温度超界→FAIL；官网未公布→INC）。
- 生成结果并入用例树，可单独跑或随标准27条一起跑。
- ⚠️ 这是参考站点没有的能力，AI 需新建此面板与生成逻辑。

---

## 7. 四态判定（复刻参考站点，勿自创）

`PASS` 对齐 ｜ `FAIL` 未对齐 ｜ `INCONCLUSIVE` 官网未公布无法判定 ｜ `SKIP` 该模型该项不适用。
- 配色：PASS 绿 / FAIL 红 / INC 灰(⚠️) / SKIP 虚线(⏭️)。
- 整体卡摘要：全PASS→✅对齐；有FAIL→❌未对齐；无FAIL有INC→⚠️部分对齐。

---

## 8. 技术约束清单（AI 生成时遵守）

- 栈：React 18 或 Vue3 + TypeScript；UI 库可复刻参考站点配色（见 `llm_console.html` CSS 变量：--bg/--accent/#C96442 等）。
- 路由：hash 路由复刻（#launch #running #done）。
- 状态：多路并发用 Promise.all + 轮询；Key 仅存内存/localStorage。
- 安全：API Key 不出浏览器；不 console.log 敏感字段。
- i18n：中文为主（参考站点中文）。
- 无后端、无 DB、无鉴权自造。

---

## 9. 验收标准（AI 生成完应满足）

1. 1:1 复刻三 Tab + 验证卡 + 四态徽章 + 进行中轮询。
2. 直连 `/api/plan` `/api/runs`，能真实拉到 27 用例与 run 结果。
3. 多路工作台：≥2 路独立配置，并发跑，出多路对比表。
4. 客户标准生成器：能输入标准、产出结构化用例并入树。
5. 各模型基线各自独立展示，官网未公布项显示 ⚠️ 不测。
6. API Key 仅存浏览器。

---

## 10. 喂给 AI 的完整物料清单（同目录文件）

| 文件 | 喂什么 |
|---|---|
| 本文档 | 主规格（生成蓝图） |
| `星流-LLM多路Endpoint验收对比工具-PRD-v2.md` | 功能需求与原则 |
| `参考网站拆解报告-LLM验收控制台.md` | 站点架构与复用点 |
| `llm_console.html` | 参考站点前端源码（UI/交互/CSS 1:1 参考） |
| `bench_plan.json` | 27 标准用例（数据契约样本） |
| `bench_runs.json` | 运行结果（数据契约样本 + mock） |
| `baselines/*.json` | 5 家官方参数基线（标准数据） |

> 建议喂法：把本主规格放最前，其余作附件；让 AI 先读主规格与 `llm_console.html`、两份 JSON，再读 PRD 与基线。
