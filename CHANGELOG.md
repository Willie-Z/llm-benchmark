# 变更说明 · 真发验收 + 多路对比 + 对话分析

> 日期：2026-07-20 ｜ 基于分支 `gh-pages` 的增量改造，未合并前不影响线上原型。

## 背景
原 `index.html` 是纯前端演示原型，验收结果为**模拟值**（未真实调用 LLM）。
本次改造让它能**真实调用 LLM 端点**出真实验收卡，并补齐用户提出的四点需求。

---

## 一、四点需求实现

### ① 多路并排对比表 · 每个用例指标说明
- 对比表每行可**点击展开**，展开后左侧「📋 指标说明」显示该用例的 `desc`（做什么）+ 判定期望（expected）+ 验证要求（requirement）。

### ② 模型输出内容 · 窗口对比
- 展开行右侧「多路输出对比窗口」**并排**显示每路一次请求的实测输出：💬 content / 🧠 reasoning（前300字）/ 🔧 工具调用（JSON）/ 🌊 流式片段 / finish_reason。
- 新增 `outOf()` 捕获每次请求输出、`outWindow()` 渲染；`realJudge` 通过 `mk()` 把 `out` 带回结果。

### ③ 模型参数差异 · 已公布者真测、未公布者标跳过
- `spec_max_output_parameter` 由 SKIP 改为**真实测试**：
  - 已公布最大输出（如 DeepSeek-V4-Pro `384000`）→ 真发请求证明该参数被接受 → **PASS**；
  - 未公布（如 Kimi K2.5 `NOT_PUBLISHED`）→ 按设计判 **INCONCLUSIVE**（不编造、不冤枉）。
- 这样差异在对比表里"真测 vs INC"一目了然，且 LLM 分析能解释 INC ≠ 能力差。

### ④ 历史持久化 + 向量库 + LLM 对话分析
- **持久化**：通道配置、验收结果、对话记录均存 `localStorage`，刷新不丢。
- **本地向量库**：浏览器内 TF-IDF + 余弦相似（轻量、无外部依赖、Key 不出本机）。
  - 检索逻辑 `tokenize/buildIndex/qvec/cosine/gatherDocs/retrieve`，已用合成数据跑通（问"流式不一致"能精准定位到流式用例的 Kimi(FAIL)/DeepSeek(PASS) 记录）。
- **对话分析 Tab**：提问时先向量检索历史相关片段 + 最近一次验收摘要，一起交给所选通道的 LLM 分析（经本机代理转发）。

---

## 二、真发核心改造

### 本地代理 `serve.py`（新增）
- 纯前端直连 LLM 端点常被 **CORS 拦截**；`serve.py` 兼静态服务 + `/proxy` 转发，绕开跨域。
- `POST /proxy {url, method, headers, body}` → 转发到真实端点，返回 `{ok,status,body,headers}`。
- **Key 只在本机内存中转发，不落盘、不记日志。**
- 用法：`python serve.py` → 浏览器开 `http://127.0.0.1:8000/`。

### `index.html` 真发逻辑
- 新增「真发请求」开关；勾选后「启动多路验收」走 `realRun()` → 逐用例逐路 `realJudge()` 真发并判定。
- 思考型模型（Kimi K2.5 / DeepSeek-V4-Pro）`max_tokens` 自适应放大（避免思考预算耗尽致 content 空被误判 FAIL）。
- content 空但有 reasoning → 判 INC（不冤枉）；JSON 解析去掉 ```代码围栏。
- 真测用例覆盖：文本IO、生成、非法请求、参数边界、最大输出、上下文窗口（轻量压测）、流式、函数调用、无误触、结构化输出、JSON Schema、多轮记忆、并行工具、思考、工具结果回传、工具错误恢复、tool_choice 模式。

---

## 三、本轮（B 任务）加固

- **收紧哨兵判定**：`spec_text_io` 由"包含 SPEC_TEXT_OK"改为"去空白后**精确等于** SPEC_TEXT_OK"——前缀"哨兵 SPEC_TEXT_OK"不再算 PASS，严格对齐 PRD 期望。
- **新增 3 条真测 + 1 条改真测**：
  - `spec_context_window`：SKIP → 轻量压测（构造 ~64K 长提示+末尾哨兵 CONTEXT_OK，真发验证窗口内接受）。
  - `cap_tool_result_roundtrip`：真测工具结果回传（第二轮应使用回填的天气结果作答）。
  - `cap_tool_error_recovery`：真测工具鲁棒性（回传 503 错误，模型应合理回应）。
  - `cap_tool_choice_modes`：真测 `tool_choice=required` 强制触发调用。

---

## 四、线上保护（A 任务）

- **自动退回模拟**：页面启动探测 `/proxy` 是否可用；GitHub Pages 纯静态托管无 `serve.py`，探测失败时自动**禁用真发开关 + 探针按钮**并提示"需本地运行 serve.py"。
- 因此合并到 `gh-pages` 后，线上原型默认为模拟演示，真发仅本机可用，**不会因缺代理而报错**。

---

## 五、文件清单

| 文件 | 改动 |
|---|---|
| `index.html` | 真发逻辑 + 四需求 + 加固 + 线上保护 |
| `serve.py` | 新增：本地代理 + 静态服务（仅本机用） |
| `CHANGELOG.md` | 本文档 |

## 六、未改动
- `_data.js`（模型基线数据）未改动。
- `gh-pages` 线上版行为：合并前不变；合并后为"模拟为主、真发需本机代理"。
- PRD 架构（纯前端 + 直连后端）未变；`serve.py` 仅是本机真测的辅助代理，非生产后端。
