# 参考网站拆解报告 · LLM 验收控制台（Deer-Flow 风格版）

> 版本：v2.0（Deer-Flow 风格重写） ｜ 拆解日期：2026-07-16 ｜ 重写日期：2026-08-31
> 原文件：`参考网站拆解报告-LLM验收控制台.md`（保留不覆盖）
> 网址：`http://120.92.93.22/llm-benchmark/?token=#launch`
> 方法：完整抓取前端 HTML + 公开后端 API（`/api/plan`、`/api/runs`，均 HTTP 200 无需登录）

---

## 文档目录

1. 拆解背景（1.1 拆解对象 / 1.2 拆解方法 / 1.3 拆解目标）
2. 站点定位（2.1 站点定义 / 2.2 核心价值 / 2.3 与本工具的关系 / 2.4 拆解差异化）
3. 用户故事（3.1～3.4 反推站点用户）
4. 节点故事（4.1 用例下发节点 / 4.2 执行节点 / 4.3 判定节点 / 4.4 展示节点 / 4.5 节点 vs 技术实现 / 4.6 核心价值）
5. 拆解旅程（5.1 完整拆解六阶段 / 5.2 拆解设计原则）
6. 工作流拆解（6.1 站点工作流 / 6.2 各节点职责 / 6.3 关键时序）
7. 数据模型清单（7.1 基线 CATALOG / 7.2 测试用例 / 7.3 判定状态 / 7.4 运行结果）
8. 27 用例骨架（8.1 Specifications / 8.2 Capabilities）
9. API 契约（9.1 /api/plan / 9.2 /api/runs / 9.3 鉴权）
10. 测试与判定标准（10.1 四态 / 10.2 实测计数印证 / 10.3 profile 档位）
11. 异常与边界处理
12. 非功能观察
13. 与本工具的差距（迭代点）
14. 附录（14.1 术语表 / 14.2 文件清单 / 14.3 原始数据）
15. 重写说明

---

## 1. 拆解背景

### 1.1 拆解对象

`http://120.92.93.22/llm-benchmark`（同 `https://kspmas.ksyun.com`），公司自有的 LLM 验收控制台。带后端的真实系统，不是纯前端 demo：
- 前端：单页 HTML（已存 `llm_console.html`，26KB）
- 后端：金山云 `kspmas.ksyun.com`，前端调 `/api/plan`（出用例）+ `/api/runs`（出结果）
- API Key 留空 → 走服务器 `.env` 的 `LLM_API_KEY`；填写则覆盖

### 1.2 拆解方法

| 步骤 | 方法 | 产出 |
|---|---|---|
| 抓前端 | 完整抓取 HTML 源码 | `llm_console.html`（含 CATALOG） |
| 抓用例 | GET `/api/plan` | `bench_plan.json`（27 用例完整结构） |
| 抓结果 | GET `/api/runs` | `bench_runs.json`（3 个真实 run） |
| 核实公开性 | HTTP 200 无需登录 | 读接口公开，写操作鉴权以公司约定为准 |

### 1.3 拆解目标

这个网站已经把规格加能力、官方参数基线、测试用例、判定 PASS/FAIL/INC/SKIP、验收卡整条链路跑通了。本工具要做的不是从零建基线，而是**拆解它、对齐它、然后扩展**两个能力：按客户测试标准生成新用例 + 多路 Endpoint 并排对比。

---

## 2. 站点定位

### 2.1 站点定义

LLM 验收控制台，按 Specifications（规格）/ Capabilities（能力）两大组对模型 Endpoint 做在线验证，逐项产出四态判定与验收卡。

### 2.2 核心价值

1. **以官方为基线**：前端硬编码 CATALOG + 每用例 refs 官网引用。
2. **标准用例就绪**：`/api/plan` 返回 27 用例，含 expected 期望值。
3. **四态判定跑通**：PASS/FAIL/INCONCLUSIVE/SKIP，真实 run 计数印证。
4. **验收卡可读**：逐项徽章，不堆原始数据。

### 2.3 与本工具的关系

| 维度 | 关系 |
|---|---|
| 基线 | 复用网站 CATALOG，并用爬取的 v2 基线补全校对（网站 CATALOG 较简） |
| 用例 | 直接复用 27 条为标准用例 |
| 判定 | 复用四态框架 |
| 协议 | 复用 openai/anthropic |
| 多路对比 | 网站单端点，本工具需新建（方向 A） |
| 用例生成 | 网站无，本工具需新建（核心增量） |

### 2.4 拆解差异化

| 对比维度 | 纯前端 demo | 本参考站点 | 拆解价值 |
|---|---|---|---|
| 后端 | 无 | 有（金山云） | 可复用真实 API |
| 用例 | mock | 27 条真实 | 直接采用 |
| 判定 | 模拟 | 四态真实计数 | 框架照搬 |
| 基线 | 简化 | CATALOG+refs | 校对补全 |

---

## 3. 用户故事

> 基于站点功能反推用户画像。

### 3.1 验收工程师的逐项验证需求

**作为** 验收工程师
**我希望** 选模型+Endpoint 跑 27 用例，看逐项四态判定
**以便于** 定位哪项参数未与官方对齐

**验收标准**：Specifications 9 + Capabilities 18，每项 PASS/FAIL/INC/SKIP，可展开 expected vs 实测 + refs。

### 3.2 模型接入方的冒烟需求

**作为** 模型接入方
**我希望** 用 smoke 档快速冒烟一个新通道
**以便于** 快速判断通道是否基本可用

**验收标准**：profile 三档（smoke/standard/full），按 Token 预算取舍。

### 3.3 决策层的看板需求

**作为** 决策层
**我希望** 看 run 的计数徽章与验收卡摘要
**以便于** 判断通道准入

**验收标准**：counts{PASS,FAIL,INC,SKIP} + 卡片摘要。

### 3.4 运维的观测需求

**作为** 运维
**我希望** 看 run metadata（host/endpoint/起止时间/returncode）
**以便于** 排查通道异常

**验收标准**：run metadata 完整记录调用上下文。

---

## 4. 节点故事

> 参考站点不是多 Agent 系统，无 LLM 调用。用"节点故事"格式（同 Deer-Flow 模型故事格式）描述各功能节点的需求，便于开发团队统一理解。
> 格式：作为 [节点]，在 [场景] 下，为了 [目标]，我需要 [上下文/能力/约束]。

### 4.1 用例下发节点故事

```
作为 用例下发节点
在 用户进入发起测试页时
为了 给执行器提供标准测试集
我需要：

【上下文信息】
- CATALOG 模型树（vendor→series→versions→{protocols,maxOutput,rpm,tpm}）
- 选定模型与协议
- profile 档位

【能力支持】
- 拉取 /api/plan 返回 27 用例
- 按模型/协议过滤适用用例
- 渲染用例树

【约束条件】
- 用例字段完整：id/group/priority/profiles/name/desc/requirement/expected/run/refs/source
- 每用例必带 refs 官网引用
```

**为什么需要这些**：用例是验收的输入，必须字段完整且带官方凭证，否则判定无标准。

### 4.2 执行节点故事

```
作为 执行节点
在 用户启动测试后
为了 拼参数发请求收结果
我需要：

【上下文信息】
- Endpoint（默认按协议给官方路径）
- API Key（留空走服务器 .env，填写则覆盖）
- 协议端点：openai→/v1/chat/completions，anthropic→/v1/messages
- 全局超参 + profile Token 预算

【能力支持】
- 拼请求参数（含 max_output_tokens/force_128k_output）
- 调用真实端点
- 收集返回与耗时

【约束条件】
- 尊重 rpm_limit/tpm_limit/max_output_tokens
- 失败记录 returncode
```

**为什么需要这些**：执行是验收的核心动作，参数拼对才能与官网对齐——这正是"URL 跑出来应该跟官网一样"的落点。

### 4.3 判定节点故事

```
作为 判定节点
在 收到执行结果后
为了 判定每项四态
我需要：

【上下文信息】
- 用例 expected 与判定规则
- 实际返回（HTTP 状态/哨兵/内容）

【判定规则】（四态）
- PASS：与 expected 对齐（如 HTTP 200 且含 CONTEXT_OK）
- FAIL：未对齐
- INCONCLUSIVE：无法判定（如无哨兵）
- SKIP：该模型该项不适用

【约束条件】
- 严格按 expected 判定规则，不自由发挥
- INC 与 FAIL 区分（无法判定≠未对齐）
```

**为什么需要这些**：四态是验收的结论，必须严格按规则，避免误判。

### 4.4 展示节点故事

```
作为 展示节点
在 run 完成后
为了 让用户一眼看出对齐情况
我需要：

【上下文信息】
- counts{PASS,FAIL,INC,SKIP}
- 各用例 expected vs 实测
- refs 官网链接

【能力支持】
- 卡片网格渲染（头/计数徽章/底run_id）
- 验证卡分组（Specifications/Capabilities）
- 明细可展开

【约束条件】
- 配色：PASS 绿/FAIL 红/INC 灰/SKIP 虚线
- 进行中每 5s 轮询 /api/runs
```

**为什么需要这些**：可读卡片是验收结论的呈现，必须直观。

### 4.5 节点故事 vs 技术实现

| 节点故事需求 | 技术实现 |
|---|---|
| 上下文信息 | CATALOG 硬编码、/api/plan 返回、metadata |
| 能力支持 | fetch 调用、判定函数、渲染逻辑 |
| 约束条件 | expected 规则、限速字段、配色规范 |

### 4.6 节点故事的核心价值

- **对产品经理**：清晰表达站点各节点能力边界。
- **对开发团队**：明确复用哪些节点、新建哪些节点。
- **对测试团队**：理解验收链路的各环节输入输出。

---

## 5. 拆解旅程

### 5.1 完整拆解六阶段

#### 阶段 1：站点定位（确认是什么）
- 抓标题：`LLM 验收控制台 · Specifications / Capabilities`。
- 确认性质：带后端真实系统，前端单页 + 金山云后端。

#### 阶段 2：前端抓取（拿 UI 蓝本）
- 存 `llm_console.html`（26KB），含 CATALOG 与 CSS 变量。
- 确认三 Tab + hash 路由 + 5s 轮询。

#### 阶段 3：用例抓取（拿标准集）
- GET `/api/plan` → 27 用例完整结构。
- 字段：id/group/priority/profiles/name/desc/requirement/expected/run/refs/source。

#### 阶段 4：结果抓取（拿真实判定）
- GET `/api/runs` → 3 个真实 run。
- 计数印证四态：glm-5.2 PASS 22/FAIL 2/INC 2/SKIP 2。

#### 阶段 5：数据模型拆解（拿契约）
- CATALOG 结构、用例 schema、run 字段、判定规则。
- 端点实测：openai `/v1/chat/completions`、anthropic `/v1/messages`。

#### 阶段 6：差距识别（定增量）
- 网站无：客户标准生成用例、多路对比。
- 本工具补：这两个增量。

### 5.2 拆解设计原则

1. **以官方为标准**：基线、refs 均以官方为凭证。
2. **复用优先**：27 用例、四态、CATALOG 直接复用，不从零建。
3. **校对补全**：网站 CATALOG 较简，用 v2 基线补全。
4. **增量明确**：只新建两个缺口，不重造已有。

---

## 6. 工作流拆解

### 6.1 站点工作流

```
用户选模型 → CATALOG 加载 → 选协议/profile → 填Endpoint/Key
  → 启动测试 → 执行节点拼参数发请求 → 判定节点四态
  → 展示节点验收卡 → 进行中5s轮询 → 已完成卡片网格
```

### 6.2 各节点职责

| 节点 | 职责 | 复用/新建 |
|---|---|---|
| CATALOG | 模型树+基线 | 复用+v2补全 |
| /api/plan | 27 用例下发 | 复用 |
| 执行 | 拼参数发请求 | 复用（多路时扩展） |
| 判定 | 四态 | 复用 |
| 展示 | 验收卡 | 复用+增强 |
| 用例生成 | 客户标准→用例 | 新建 |
| 多路调度 | N 路并发 | 新建 |

### 6.3 关键时序

#### 6.3.1 单路验收时序
```
选模型→加载CATALOG→填Key→启动→POST /api/runs→返回run_id
  →每5s GET /api/runs轮询→完成→判定四态→验收卡
```

#### 6.3.2 多路对比时序（本工具增量）
```
配N路→全局超参→并发POST各路 /api/runs→各路run_id
  →并行轮询→各路完成→聚合多路对比表
```

---

## 7. 数据模型清单

### 7.1 基线 CATALOG（前端硬编码）

```
vendor → series → versions → {protocols, maxOutput, rpm, tpm}
例：智谱/GLM-5系列/GLM-5.2 → {protocols:[openai], maxOutput:131072, rpm:500, tpm:1000000}
```

以官方为标准的基线数据。本工具 v2 基线（`baselines/v2/*.json`，39 模型）与它等价但更全，二者合并校对。

### 7.2 测试用例（`/api/plan` 返回 27 个）

| 字段 | 含义 | 示例 |
|---|---|---|
| `id` | 用例标识 | `spec_context_window` |
| `group` | Specifications / Capabilities | `Specifications` |
| `priority` | P0(15) / P1(12) | `P0` |
| `profiles` | full / standard / smoke | `[full, smoke, standard]` |
| `name`/`desc` | 中文名称 + 描述 | 上下文窗口 |
| `requirement` | 测试要求（标准） | 最大上下文窗口：窗口内接受，full 档记录越界观察 |
| `expected` | 期望 + 判定规则 | HTTP 200 且含 CONTEXT_OK 为 PASS；无哨兵为 INC；失败为 FAIL |
| `run` | 后端测试函数名 | `test_context` |
| `refs` | 官网引用链接（凭证） | GLM-5.2 产品说明 + Function Calling 文档 |
| `source` | 来源标记 | `info.text` |

> requirement + expected + refs 三件套 = 测试标准 + 官方凭证，拆解最有价值的部分。

### 7.3 判定状态（4 态）

PASS、FAIL、INCONCLUSIVE、SKIP。网站真实 run 计数印证见 §10.2。

### 7.4 运行结果（`/api/runs` 字段）

```
run_id, metadata{model, api_format, endpoint, profile, rpm_limit, tpm_limit,
                 max_output_tokens, force_128k_output, host, started_at, ended_at},
counts{PASS,FAIL,INCONCLUSIVE,SKIP}, running, returncode
```

端点实测：`https://kspmas.ksyun.com/v1/chat/completions`（openai）与 `/v1/messages`（anthropic）。

---

## 8. 27 用例骨架

### 8.1 Specifications（规格，9 个）

| 优先级 | 用例 id | 名称 |
|---|---|---|
| P0 | spec_text_io | 文本输入/输出 |
| P0 | spec_context_window | 上下文窗口 |
| P0 | spec_max_output_parameter | 最大输出参数(Max Output) |
| P0 | spec_max_completion_tokens_parameter | max_completion_tokens |
| P0 | spec_output_generation | 最大输出·实际生成 |
| P0 | spec_parameter_boundaries | 请求参数边界 |
| P0 | spec_invalid_request_errors | 错误信息返回 |
| P0 | sec_auth_security | 鉴权与安全 |
| P0 | obs_usage_and_status_fields | 线上观测字段 |

### 8.2 Capabilities（能力，18 个）

| 优先级 | 用例 id | 名称 |
|---|---|---|
| P0 | cap_thinking_enabled | 深度思考 |
| P0 | cap_thinking_disabled | 思考模式·关闭 |
| P0 | cap_multi_round_chat | 多轮对话 |
| P1 | cap_reasoning_effort | 思考力度 |
| P0 | cap_streaming | 流式输出 |
| P0 | cap_function_calling | 函数调用 |
| P1 | cap_stream_tool | 流式工具调用 |
| P1 | cap_tool_no_false_positive | 工具鲁棒性(无误触) |
| P1 | cap_structured_output | 结构化输出 |
| P1 | cap_json_schema_output | JSON Schema 输出 |
| P1 | cap_multimodal_image_input | 多模态输入(图片) |
| P1 | cap_partial_mode | Partial Mode |
| P1 | cap_tool_choice_modes | 工具选择模式 |
| P1 | cap_tool_parallel_calls | 并行工具调用 |
| P1 | cap_tool_error_recovery | 工具错误恢复 |

> 上表为已读到的部分；完整 27 条见 `bench_plan.json`，含全部 expected/refs。

---

## 9. API 契约

### 9.1 GET `/api/plan` → 测试用例清单

- 已验证：`http://120.92.93.22/llm-benchmark/api/plan` → HTTP 200，application/json，无需登录。
- 返回：数组，27 个用例，字段见 §7.2。
- 用法：前端启动后拉取渲染用例树；expected 决定判定，refs 渲染官网引用。

### 9.2 GET/POST `/api/runs` → 运行结果

- 已验证：`http://120.92.93.22/llm-benchmark/api/runs` → HTTP 200，返回 run 数组。
- 单 run 字段见 §7.4。
- 用法：进行中/已完成 Tab 轮询渲染卡片；counts 决定徽章。
- 注：`120.92.93.22` 与 `kspmas.ksyun.com` 同一服务；前端直接用 `120.92.93.22/llm-benchmark` 作 BASE。

### 9.3 鉴权

- 读接口（plan/runs）公开无需 token。
- 发起/删除 run 等写操作若需鉴权，沿用公司现有机制（`window.AUTH_TOKEN`，当前为空走默认 Key）。
- AI 不要自造鉴权。

---

## 10. 测试与判定标准

### 10.1 四态判定

| 状态 | 含义 | 配色 |
|---|---|---|
| PASS | 与 expected 对齐 | 绿 |
| FAIL | 未对齐 | 红 |
| INCONCLUSIVE | 无法判定（无哨兵/未公布） | 灰(⚠️) |
| SKIP | 该模型该项不适用 | 虚线(⏭️) |

### 10.2 实测计数印证

| run | 计数 |
|---|---|
| glm-5.2 (openai, full) | PASS 22 / FAIL 2 / INC 2 / SKIP 2 |
| deepseek-v4-pro (anthropic, full) | PASS 21 / FAIL 0 / INC 2 / SKIP 5 |
| deepseek-v4-pro (anthropic, full) 另一次 | PASS 16 / FAIL 1 / INC 2 / SKIP 5 |

### 10.3 profile 档位

| 档位 | 用途 | Token 预算 |
|---|---|---|
| smoke | 快速冒烟 | ≈4K |
| standard | 标准 | ≈64K |
| full | 全量+越界观测 | ≈999K |

---

## 11. 异常与边界处理

| 场景 | 站点处理 | 本工具对齐 |
|---|---|---|
| 无哨兵 | INC | 复用 |
| 参数不适用 | SKIP | 复用（基线 important_alignment_findings 驱动） |
| 执行失败 | returncode 记录 | 复用 |
| Key 留空 | 走服务器 .env | 复用（多路时各路独立 Key） |
| 限流 | rpm/tpm_limit 字段 | 扩展（按各家口径节流） |

---

## 12. 非功能观察

- 三 Tab + hash 路由（#launch #running #done）。
- 进行中每 5s 轮询（`setInterval(loadRuns, 5000)`）。
- 前端 26KB 单页，CSS 变量（--bg/--accent/#C96442）。
- 中文界面。
- 后端金山云，API 公开可读。

---

## 13. 与本工具的差距（迭代点）

| 能力 | 网站 | 本工具要做 | 状态 |
|---|---|---|---|
| 官方参数基线 | CATALOG+refs | 复用+v2 补全（39 模型） | ✅ v2 已就绪 |
| 27 标准用例 | /api/plan | 直接复用 | ✅ |
| 四态判定 | 已有 | 复用 | ✅ |
| 多协议 | openai/anthropic | 复用 | ✅ |
| profile 档位 | smoke/standard/full | 复用 | ✅ |
| 按客户标准生成用例 | 无 | 新建（用例生成 Agent） | ⬜ v2.0 |
| 多路 Endpoint 对比 | 单端点 | 新建（方向 A） | ⬜ v1.5 |

**核心结论**：网站把以官方为标准的验收做完了。本工具要补两个增量：①客户测试标准动态生成用例；②多路 Endpoint 并排对比。

---

## 14. 附录

### 14.1 术语表

| 术语 | 含义 |
|---|---|
| Specifications | 规格组，9 条用例（文本IO/上下文/输出/边界/错误/鉴权/观测） |
| Capabilities | 能力组，18 条用例（思考/多轮/流式/工具/结构化/多模态） |
| CATALOG | 前端硬编码模型树（vendor→series→versions→基线字段） |
| profile | 执行档位 smoke/standard/full |
| 四态 | PASS/FAIL/INCONCLUSIVE/SKIP |
| refs | 官网引用链接，以官方为标准的凭证 |
| expected | 期望结果+判定规则 |
| force_128k_output | run metadata 字段，强制 128K 输出标记 |

### 14.2 文件清单

| 文件 | 用途 |
|---|---|
| `llm_console.html` | 网站前端完整源码（含 CATALOG） |
| `bench_plan.json` | 27 用例完整结构（含 expected/requirement/refs） |
| `bench_runs.json` | 3 个真实运行结果（含四态计数） |
| `baselines/v2/*.json` | v2 基线（39 模型，用于校对 CATALOG） |

### 14.3 原始数据

已抓取可随时查阅：`llm_console.html` / `bench_plan.json` / `bench_runs.json` / `baselines/v2/*.json`。

---

## 15. 重写说明

### 15.1 本版与原版的区别
- 原版（`参考网站拆解报告-LLM验收控制台.md`）：技术拆解，6 节。
- 本版（Deer-Flow 风格）：15 节，引入节点故事、拆解旅程、工作流拆解、术语表，结构对齐 Deer-Flow PRD。
- 技术内容完全保留（27 用例/数据模型/四态/API 契约/实测计数）。

### 15.2 节点故事的适用性
参考站点无 LLM 调用，故用"节点故事"（格式同模型故事）替代，描述各功能节点需求，便于开发团队统一理解复用点与新建点。

### 15.3 与真实项目的对应
- v2 基线已就绪（39 模型，2026-08-31）。
- 原型已支持本地真发验收卡 + 多路对比（PR #1）。
- 用例生成 Agent 与多路调度为待落地项。
