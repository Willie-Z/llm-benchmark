# 星流 LLM 多路 Endpoint 验收对比工具


一款纯前端的 LLM 多路验收对比工具。配置 2-4 路 Endpoint（官网直连 / 星流中转 / 公司网关），将同一份验收用例并发发给各路，逐项判定返回是否符合官方基线（PASS / FAIL / INC / SKIP），并排对比哪路对齐、哪路不一致。所有真发请求经本地代理 `serve.py` 转发，API Key 仅存浏览器本地存储，不落盘、不记日志。

## 功能特性

- **多路通道配置**：每路可填模型 / 协议（OpenAI / Anthropic）/ 模型ID / Base URL / API Key / 自定义 Headers，支持 2-4 路并排对比。
- **27 个验收用例**：规格参数 9 项（哨兵返回、参数边界、上下文压测、max_tokens 上限）+ 能力 19 项（tool_calls 触发、SSE 流式、JSON 结构化、多轮记忆、并行调用、思考模式）。
- **Profile 分级**：smoke（13 项快速验证）/ standard（27 项标准）/ full（27 项全量），按需选择跑测范围。
- **四态判定**：PASS 对齐 / FAIL 未对齐 / INCONCLUSIVE 官网未公布 / SKIP 不适用。通道级错误（401 / 403 / 404）自动识别为「未真正测到」，不误判 PASS。
- **思考模式开关**：按模型厂商自动注入思考参数（智谱 `thinking.type` / Kimi `thinking` / MiniMax `thinking_enabled` / OpenAI `reasoning_effort` / Anthropic `thinking.budget_tokens`），非思考模型自动跳过；支持附加属性 JSON 覆盖。
- **实测展开对比**：每个用例行可展开，查看各路 HTTP 状态 / content / reasoning / tool_calls / 原始响应，区分「真跑通」与「请求失败」。
- **对话分析归因**：基于 TF-IDF 向量检索历史验收片段 + LLM 归因，自然语言提问（如「哪几项不一致？为什么 Kimi 判 INC 而 DeepSeek 判 PASS？」）。
- **双主题**：浅色 / 深色，stone + amber 配色，本地偏好记忆。
- **离线退回**：无 `serve.py` 时自动禁用真发、退回模拟演示，不报错。

## 目录结构

```
├── docs/                         # 规格文档（PRD、架构图、建站主规格、拆解报告）
├── baselines/                    # 5 家官方参数基线
│   ├── v2/                       # 最新基线（DeepSeek / Kimi / MiMo / MiniMax / 智谱）
│   └── v1/                       # 旧版保留
├── data/                         # 参考站点数据（27 用例、运行结果、聚合模型树）
└── prototype/                    # 可运行原型
    ├── prototype-llmabacus.html  # 主版本：4-tab + 真发对比 + 答案展开
    ├── prototype-promptfoo.html  # promptfoo 风格双主题版本
    ├── prototype-v3.html         # v3 工作版本
    ├── prototype-coze.html       # Coze 风格版本
    ├── _data.js                  # CATALOG 模型树 + PLAN 27 用例 + 示例结果
    └── serve.py                  # 本地代理（绕 CORS，转发到真实 Endpoint）
```

## 安装

1. 克隆仓库并进入 prototype 目录：

   ```bash
   git clone https://github.com/Willie-Z/llm-benchmark.git
   cd llm-benchmark/prototype
   python serve.py
   ```

2. 浏览器打开 http://127.0.0.1:8000/prototype-llmabacus.html

无需构建，原生 HTML + JavaScript，仅依赖 Python 3 运行本地代理。

## 使用

### 首次配置

打开页面后进入「发起测试」tab，点击「编辑通道」，为每路填入：

| 配置项 | 示例 |
|---|---|
| 模型 | DeepSeek · DeepSeek-V4-Flash |
| 协议 | openai / anthropic |
| 模型ID | deepseek-chat |
| Base URL | https://api.deepseek.com |
| API Key | sk-... |
| Headers | （可选）自定义 JSON 头 |

勾选「真发」→ 点击「启动验收」。请求将经 `serve.py` 转发到各路真实 Endpoint，逐用例判定四态。

### 跑测流程

1. **发起测试**：配置通道、选择 Profile（smoke / standard / full）、勾真发、启动。
2. **进行中**：实时查看各用例 × 通道的判定状态，summary 卡 + 进度条 + 分类表格。
3. **已完成**：多路并排对比表，每用例一行各路一列，末列标注一致性。点击「展开」查看各路实测返回。
4. **对话分析**：选择分析员通道，自然语言提问验收结果。

### 如何判断真跑通

三条硬证据：

1. **展开看 content**：有模型真实回复（如 `SPEC_TEXT_OK`、一段中文、JSON），不是空。
2. **看耗时**：有真实 `ms` 数（模拟模式没有）。
3. **连跑两次结果不同**：模拟模式是种子确定的，真发会有网络 / 采样波动。

## API 兼容性

- **协议**：OpenAI-compatible `/v1/chat/completions`（非流式 + 流式 SSE）；Anthropic `/v1/messages`。
- **认证**：OpenAI 用 `Authorization: Bearer`；Anthropic 用 `x-api-key` + `anthropic-version`。
- **Base URL 规范化**：自动补全端点路径——填 `https://api.deepseek.com` 或 `https://api.deepseek.com/v1` 均可；已带 `/chat/completions` 则不再补。
- **max_tokens 兼容**：MiMo / OpenAI o 系列自动改用 `max_completion_tokens`。
- **已验证厂商**：DeepSeek、Kimi、智谱、MiniMax、MiMo（v2 基线 39 模型）。
- **公司网关**：支持星流聚合 API（`kspmas.ksyun.com`）。

## 隐私与安全

- API Key 仅存浏览器 `localStorage`，经本机 `serve.py` 内存转发，不落盘、不记日志。
- `serve.py` 转发时不记录请求体与 Key，仅透传。
- 无 `serve.py` 时真发自动禁用，退回模拟模式。
- 官网未公布的参数标 INC，不编造；不适用项标 SKIP，不误判 FAIL。

## 开发

### 验证

```bash
cd prototype
# 语法检查
node -e "const fs=require('fs');const s=fs.readFileSync('prototype-llmabacus.html','utf8');const m=s.match(/<script>([\s\S]*?)<\/script>/);fs.writeFileSync('_t.js',m[1]);" && node --check _t.js && rm _t.js
# 启动本地代理
python serve.py
```

验证项：JS 语法（`node --check`）、HTML 标签平衡、`serve.py` 下 HTTP 200。

### 技术栈

- 无构建步骤、无第三方运行时依赖，原生 JavaScript（单文件 HTML + `_data.js` + `serve.py`）。
- `serve.py` 硬编码端口 8000，提供 `/proxy` 端点转发 + 静态文件服务。
- `_data.js` 提供 CATALOG（模型树）/ PLAN（27 用例）/ 示例结果，前后端共享。

## 许可

系统设计、架构与审校由人类架构师完成，大部分代码 token 由 AI 合成。允许免费使用、修改、分发（包括将代码投喂给其他大语言模型），唯一条件是保留原始仓库链接与作者 / 架构师署名。

本项目不接受 Pull Request，但欢迎通过 Issue 参与讨论，并提出更多改进建议。

Pull requests are not accepted for this project; however, discussions via Issues and further suggestions are more than welcome.
