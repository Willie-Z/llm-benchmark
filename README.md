# 星流 LLM 多路 Endpoint 验收对比工具

## 当前阶段

本仓库目前是规格包加数据加可真发验收的原型，尚未接入参考站后端，不是可直接交付的成品。

- **prototype 已支持真发**：用户可配置多路通道（模型/协议/模型ID/Base URL/API Key/Headers），勾选真发后经本地代理 `serve.py` 转发到真实 LLM Endpoint，逐用例判定四态（PASS/FAIL/INC/SKIP），展开看各路实测返回（content/reasoning/tool_calls/原始响应）。未运行 `serve.py` 时（含 GitHub Pages 线上）自动退回模拟演示，不报错。
- baselines 和 catalog.json 是真实可用的数据，带官网来源，已经核实。
- docs 是规格文档，PRD 待评审，主规格用于喂给 AI 生成，拆解报告作为蓝本，需要按评审更新。

待办见本文末尾。

## 目标

做一个前端网站，1 比 1 复刻参考验收站点 120.92.93.22/llm-benchmark，并在其基础上增加两个能力：多路对比，以及按客户测试标准生成新用例。采用纯前端方案，直连公司现有后端，不新建后端。

## 仓库结构

```
docs/         PRD、建站主规格、参考网站拆解报告、逻辑架构图
baselines/    5 家官方参数基线（v2 为最新，v1 保留），DeepSeek 智谱 MiniMax Kimi MiMo
data/         参考站点数据：27 测试用例，运行结果，聚合模型树，参考前端源码
prototype/    可运行原型
  prototype-llmabacus.html   主版本：4-tab + 真发对比 + 答案展开
  prototype-promptfoo.html   promptfoo 风格版本（双主题）
  prototype-v3.html          v3 工作版本
  prototype-coze.html        Coze 风格版本
  prototype.html             早期版本
  _data.js                   CATALOG 模型树 + PLAN 27用例 + SAMPLE_RUNS
  serve.py                   本地代理（绕 CORS，转发到真实 Endpoint）
```

## 快速开始

### 真发跑通（推荐）

1. `cd prototype && python serve.py`
2. 浏览器开 http://127.0.0.1:8000/prototype-llmabacus.html
3. 「发起测试」tab → 点「编辑通道」，每路填：模型 / 协议 / 模型ID / Base URL / API Key
4. 勾「真发」→ 启动验收
5. 跑完切「已完成」tab，点任意用例「展开」看各路实测返回

Key 仅存浏览器 localStorage，经本机 `serve.py` 内存转发，不落盘、不记日志。

### 模拟演示（无 Key / 无代理）

直接双击 `prototype-llmabacus.html` 打开，不勾「真发」点启动——秒出固定结果，用于熟悉界面。无 `serve.py` 时真发开关自动禁用并提示。

### 喂给 AI 生成正式网站

先读 docs/建站主规格，再读 PRD 与拆解报告。基线数据在 baselines 下，每条带官网来源，官网未公布的项标为 NOT_PUBLISHED。

## 工具逻辑（5 个环节）

1. **逐项验收，不笼统跑分**。27 个独立用例，每个只验一个点：规格参数 9 项（哨兵返回、超界拒绝、上下文压测、max_tokens 上限等）+ 能力 19 项（tool_calls 触发、SSE 流式、JSON 结构化、多轮记忆、并行调用、thinking 暴露等）。
2. **四态判定**。PASS 对齐 / FAIL 未对齐 / INC 官网未公布无法判定 / SKIP 该项不适用。不把"不知道"硬判 FAIL，不把"不适用"算进失败率。
3. **多路并排抓不一致**。同一模型配 N 路（官网直连 / 星流中转 / 公司网关），每用例一行各路一列，末列标一致性。一路 PASS 一路 FAIL 即中转链路改了东西——这是验收要抓的核心。
4. **实测可展开**。每行展开看各路 HTTP 状态 / content / reasoning / tool_calls / 原始响应。401/403/404 通道级错误标 INC「未真正测到」，不误判 PASS；两路都通道错误标「通道未接通」，不误判「一致」。
5. **对话分析归因**。跑完后用 TF-IDF 向量检索历史验收片段 + LLM 归因，自然语言提问（如「哪几项不一致？为什么 Kimi 判 INC 而 DeepSeek 判 PASS？」）。

## 要点

- 基线各自独立。各模型按各自官方信息建基座，不强套统一模板。官网未公布的项不测，判为 INC 或 SKIP。
- 限速口径各家不同。DeepSeek 用并发数，智谱用并发数，MiniMax 用档位，Kimi 用充值档，MiMo 用 RPM 和 TPM。
- 判定四态。PASS 对齐，FAIL 未对齐，INCONCLUSIVE 官网未公布无法判定，SKIP 该项不适用。
- 参考站点是公司自有系统，后端接口 /api/plan 和 /api/runs 公开可调，本工具直连复用。

## 两个增量

1. 多路 Endpoint 并排对比。同一用例多路并发，横向对比一致性，纵向对比官方对齐。
2. 按客户测试标准生成新用例。结合基线和四类对齐维度，产出结构化用例并入用例树。

详见 docs/PRD-产品版.md。

## 怎么判断真跑通了（不是假数据）

三条硬证据：
1. **展开看 content**：有模型真实回复（如 `SPEC_TEXT_OK`、一段中文、JSON），不是空
2. **看耗时**：有真实 `ms` 数（模拟模式没有）
3. **连跑两次结果不同**：模拟模式是种子确定的，真发会有网络/采样波动

## 当前阶段与待办

### 各文件实际用处

| 文件 | 实际用处 | 局限 |
|---|---|---|
| baselines/v2 和 catalog.json | 真实可用数据，作为官方标准，前后端直接用 | 静态数据，需人维护更新，个别项官网未公布已标注 |
| prototype/prototype-llmabacus.html | 主版本：4-tab + 真发对比 + 答案展开 + 对话分析 | 线上/GitHub Pages 退回模拟；参考站 /api/runs 后端接入仍待办，非成品 |
| prototype/prototype-promptfoo.html | promptfoo 风格双主题版本（功能同主版本） | 同上 |
| data/bench_plan.json 和 bench_runs.json | 参考站真实数据样本，照着写或改后端接口结构 | 是参考站快照，非本仓库产出 |
| docs 下文档 | 规格文档，PRD 待评审，主规格喂给 AI，拆解报告作蓝本 | 是文档不是实现，需按评审更新 |

### 待办

1. 后端接入最关键。前端要能调用参考站接口，需确认跨域、鉴权 token、是否能多路并发，需要后端或运维配合。
2. 判定接真实接口（部分完成）。prototype-llmabacus.html 已支持经本地代理 serve.py 真实调用各 LLM 端点并出验收卡；但对接参考站 /api/runs 的真实编排调用仍待后端接口。
3. 多路接口。参考站现有接口是单路跑测，多路对比可能需要后端加编排接口。（前端本地已支持多路并发直连各端点）
4. 客户标准生成用例。落地生成逻辑。
5. 部署到可访问地址。公司服务器能连真后端最稳，公开仓 GitHub Pages 只能演示（线上无代理自动退回模拟）。

结论：已可本地真实调用 LLM 出验收卡并多路对比；线上与参考站后端编排接入仍待办。
