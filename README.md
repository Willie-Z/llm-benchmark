# 星流 LLM 多路 Endpoint 验收对比工具

一款纯前端的 LLM 多路验收对比工具。配置 2-4 路 Endpoint（官网直连 / 星流中转 / 公司网关），把同一份验收用例并发发给各路，逐项判定返回是否符合官方基线（PASS/FAIL/INC/SKIP），并排对比哪路对齐、哪路不一致。所有真发请求经本地代理 `serve.py` 转发，API Key 仅存浏览器，不落盘、不记日志。

## 功能特性

- **4-tab 分页**：发起测试 / 进行中 / 已完成 / 对话分析， stone + amber 配色，浅色 / 深色双主题。
- **多路通道配置**：每路可填模型 / 协议（openai / anthropic）/ 模型ID / Base URL / API Key / 自定义 Headers，支持 2-4 路并排。
- **27 个验收用例**：规格参数 9 项（哨兵返回、超界拒绝、上下文压测、max_tokens 上限）+ 能力 19 项（tool_calls 触发、SSE 流式、JSON 结构化、多轮记忆、并行调用、thinking 暴露）。
- **四态判定**：PASS 对齐 / FAIL 未对齐 / INCONCLUSIVE 官网未公布 / SKIP 不适用。不把"不知道"硬判 FAIL，不把"不适用"算进失败率。
- **通道级错误识别**：401 / 403 / 404 标 INC「未真正测到」，不误判 PASS；两路都通道错误标「通道未接通」，不误判「一致」。
- **实测展开对比**：每行可展开看各路 HTTP 状态 / content / reasoning / tool_calls / 原始响应，区分"真跑通"与"请求失败"。
- **实时进度**：真发时 summary 卡（各态计数）+ 进度条 + 分类表格实时刷新。
- **对话分析归因**：TF-IDF 向量检索历史验收片段 + LLM 归因，自然语言提问（如「哪几项不一致？为什么 Kimi 判 INC 而 DeepSeek 判 PASS？」）。
- **离线退回**：无 `serve.py` 时自动禁用真发、退回模拟演示，不报错。

## 目录结构

```
├── docs/                         # 规格文档
│   ├── PRD-产品版.md             # 产品版 PRD（Deer-Flow 风格）
│   ├── PRD.md                    # 原始 PRD
│   ├── architecture.md / .svg    # 逻辑架构图
│   ├── 建站主规格-面向AI生成.md   # 喂给 AI 生成正式网站
│   ├── 参考网站拆解报告-DeerFlow风格.md
│   └── baseline-update-check-2026-08.md
├── baselines/                    # 5 家官方参数基线
│   ├── v2/                       # 最新基线（deepseek/kimi/mimo/minimax/zhipu）
│   └── v1/                       # 旧版保留
├── data/                         # 参考站点数据
│   ├── bench_plan.json           # 27 测试用例
│   ├── bench_runs.json           # 运行结果样本
│   └── catalog.json              # 聚合模型树（39 模型）
└── prototype/                    # 可运行原型
    ├── prototype-llmabacus.html  # 主版本：4-tab + 真发对比 + 答案展开
    ├── prototype-promptfoo.html  # promptfoo 风格双主题版本
    ├── prototype-v3.html         # v3 工作版本
    ├── prototype-coze.html       # Coze 风格版本
    ├── prototype.html            # 早期版本
    ├── _data.js                  # CATALOG + PLAN + SAMPLE_RUNS
    └── serve.py                  # 本地代理（绕 CORS，转发到真实 Endpoint）
```

## 安装

1. 克隆仓库，进入 prototype 目录：
   ```bash
   cd prototype
   python serve.py
   ```
2. 浏览器打开 http://127.0.0.1:8000/prototype-llmabacus.html
3. 无需构建，原生 HTML + JS，直接可用。

仅加载 `prototype/` 目录；项目无构建步骤、无第三方运行时依赖。

## 使用

### 首次配置

打开页面后切到「发起测试」tab，点「编辑通道」，每路填入：

| 配置项 | 示例 |
|---|---|
| 模型 | DeepSeek · DeepSeek-V4-Flash |
| 协议 | openai / anthropic |
| 模型ID | deepseek-chat |
| Base URL | https://api.deepseek.com |
| API Key | sk-... |
| Headers | （可选）自定义 JSON 头 |

勾「真发」→ 点「启动验收」。插件会经 `serve.py` 转发到真实 Endpoint，逐用例判定四态。

隐私提示：API Key 仅存浏览器 localStorage，经本机 `serve.py` 内存转发，不落盘、不记日志。只有在点击「启动验收」后，用例内容才会发送到配置的 Endpoint。

### 跑验收

1. **发起测试 tab**：配通道、勾真发、启动。启动后自动跳「进行中」。
2. **进行中 tab**：实时看 summary 卡 + 进度条 + 分类表格，状态从 等待 → 跑测 → PASS/FAIL。
3. **已完成 tab**：多路并排对比表，每用例一行各路一列，末列标一致性。点「展开」看各路实测返回。
4. **对话分析 tab**：选分析员通道，自然语言提问验收结果。

### 怎么判断真跑通了

三条硬证据：

1. **展开看 content**：有模型真实回复（如 `SPEC_TEXT_OK`、一段中文、JSON），不是空。
2. **看耗时**：有真实 `ms` 数（模拟模式没有）。
3. **连跑两次结果不同**：模拟模式是种子确定的，真发会有网络 / 采样波动。

## API 兼容性

- **协议**：OpenAI-compatible `/v1/chat/completions`（非流式 + 流式 SSE）。
- **认证**：Bearer Token，经 `Authorization` header 注入。
- **Base URL 规范化**：自动补全 `/v1/chat/completions`——填 `https://api.deepseek.com` 或 `https://api.deepseek.com/v1` 均可；已带 `/chat/completions` 则不再补。
- **已验证厂商**：DeepSeek、Kimi、智谱、MiniMax、MiMo（v2 基线 39 模型）。
- **公司网关**：支持星流聚合 API（`kspmas.ksyun.com`），路径需按网关实际填写。

## 隐私与安全

- API Key 仅存浏览器 localStorage，经本机 `serve.py` 内存转发，不落盘、不记日志。
- `serve.py` 转发时不记录请求体与 Key，仅透传。
- 无 `serve.py` 时真发自动禁用，退回模拟模式。
- 官网未公布的参数标 INC，不编造；不适用项标 SKIP，不误判 FAIL。

## 工具逻辑

1. **逐项验收，不笼统跑分**：27 个独立用例，每个只验一个点。
2. **四态判定**：PASS / FAIL / INC / SKIP，官网未公布不编造，不适用不误判。
3. **多路并排抓不一致**：同一模型配 N 路，一路 PASS 一路 FAIL 即中转链路改了东西。
4. **实测可展开**：看各路实际返回，区分"真跑通"与"请求失败"。
5. **对话分析归因**：向量检索 + LLM 归因。

## 要点

- **基线各自独立**：各模型按各自官方信息建基座，不强套统一模板。官网未公布的项不测。
- **限速口径各家不同**：DeepSeek / 智谱用并发数，MiniMax 用档位，Kimi 用充值档，MiMo 用 RPM 和 TPM。
- **参考站点复用**：后端接口 `/api/plan` 和 `/api/runs` 公开可调，本工具直连复用。

## 两个增量

1. **多路 Endpoint 并排对比**：同一用例多路并发，横向对比一致性，纵向对比官方对齐。
2. **按客户标准生成用例**：结合基线和四类对齐维度，产出结构化用例并入用例树。

详见 docs/PRD-产品版.md。

## 开发

### 验证

```bash
cd prototype
# 语法检查
node -e "const fs=require('fs');const s=fs.readFileSync('prototype-llmabacus.html','utf8');const m=s.match(/<script>([\s\S]*?)<\/script>/);fs.writeFileSync('_tmp.js',m[1]);" && node --check _tmp.js && rm _tmp.js
# 启动本地代理
python serve.py
```

验证项：JS 语法（`node --check`）、标签平衡、`serve.py` 下 HTTP 200。

### 目录约定

- 无构建步骤、无第三方运行时依赖，原生 JS（单文件 HTML + `_data.js` + `serve.py`）。
- `serve.py` 硬编码端口 8000，提供 `/proxy` 端点转发 + 静态文件服务。
- `_data.js` 提供 CATALOG（模型树）/ PLAN（27 用例）/ SAMPLE_RUNS，前后端共享。

## 当前阶段与待办

本仓库目前是规格包 + 数据 + 可真发验收的原型，尚未接入参考站后端，非可直接交付的成品。

| 文件 | 实际用处 | 局限 |
|---|---|---|
| baselines/v2 + catalog.json | 真实可用数据，作为官方标准 | 静态数据，需人维护，个别项官网未公布已标注 |
| prototype-llmabacus.html | 主版本：4-tab + 真发对比 + 答案展开 | 线上退回模拟；参考站后端接入待办 |
| docs 下文档 | PRD 待评审，主规格喂 AI，拆解报告作蓝本 | 是文档不是实现，需按评审更新 |

### 待办

1. **后端接入**：前端调用参考站接口，需确认跨域、鉴权、多路并发，需后端或运维配合。
2. **对接 /api/runs 编排**：本地已支持多路并发直连各端点，参考站真实编排调用仍待后端接口。
3. **客户标准生成用例**：落地生成逻辑。
4. **部署**：公司服务器能连真后端最稳，公开仓 GitHub Pages 只能演示。
