# 星流 LLM 多路 Endpoint 验收对比工具

> 让 AI 1:1 复刻参考验收站点（`120.92.93.22/llm-benchmark`）并叠加「多路对比」「按客户标准生成用例」两个增量的规格包。
> 纯前端方案：直连公司现有后端，不新建后端。

## 仓库结构

```
docs/         PRD、建站主规格、参考网站拆解报告（喂给 AI 的规格）
baselines/    5 家官方参数基线 JSON（DeepSeek/智谱/MiniMax/Kimi/MiMo）
data/         参考站点数据：27 测试用例(bench_plan)、运行结果(bench_runs)、聚合模型树(catalog)、参考前端源码
prototype/    可运行原型：双击 prototype.html 即开
```

## 快速开始

1. **看最终网站长什么样** → 打开 `prototype/prototype.html`（需同目录 `_data.js`）
2. **喂 AI 生成正式网站** → 先读 `docs/建站主规格-面向AI生成.md`（含喂料顺序），再读 PRD 与拆解报告
3. **基线数据** → `baselines/*.json` 每条带官网来源，"官网未公布"项标 NOT_PUBLISHED

## 关键说明

- **基线各自独立**：各模型按各自官方信息建基座，不强套统一模板；官网未公布的项（如 Kimi 最大输出、各厂 benchmark）不测，判 INC/SKIP。
- **限速口径各家不同**：DeepSeek=并发数、智谱=并发数(已登录补全)、MiniMax=档位、Kimi=充值档、MiMo=RPM/TPM。
- **判定四态**：✅ PASS / ❌ FAIL / ⚠️ INCONCLUSIVE（官网未公布）/ ⏭️ SKIP（该项不适用）。
- 参考站点 `120.92.93.22/llm-benchmark` 为公司自有系统，后端 API（`/api/plan`、`/api/runs`）公开可调，本工具直连复用。

## 两个增量（领导要求，参考站点没有）

1. **多路 Endpoint 并排对比**：同一用例多路并发，横向对比一致性 + 纵向对比官方对齐。
2. **按客户测试标准生成新用例**：结合基线 + 四类对齐维度，产出结构化用例并入用例树。

详见 `docs/PRD.md`。
