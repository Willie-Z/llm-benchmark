# Baseline 更新核对报告

- **核对日期**：2026-08-31
- **上次抓取**：2026-07-14 ~ 2026-07-16
- **核对方式**：WebFetch 抓取各厂商官网文档实时比对
- **结论**：五家均需更新；Kimi 最紧急（今日 8/31 有模型全平台下线）；MiMo 无实质变化但仍同步结构。
- **本次更新目标**：① 刷新数据至最新；② 统一五家 baseline 为同一套字段 schema（消除前端"丢参数、跑不通"的结构性根因）。

---

## 一、五家模型层变化汇总

| 厂商 | 重大变化 | 影响等级 |
|---|---|---|
| **Kimi** | 🚨 新增旗舰 `kimi-k3`（2.8T参数，原生视觉，1M上下文）；`kimi-k2.5` + `moonshot-v1` 全系列今日 8/31 全平台下线，官方建议切 K3 | 极高 |
| **智谱** | 🚨 新增旗舰 `GLM-5.3` + `GLM-5.3-Flash`（1M上下文，"比肩 Claude Fable 5"）；GLM-5.2 降为非旗舰但仍推荐 | 极高 |
| **DeepSeek** | ⚠️ 新增 `v4-flash-vision-exp`（视觉）；定价结构改为空闲/高峰分时段（高峰=空闲×2）；版本号更新（Pro-0813 / Flash-0731） | 高 |
| **MiniMax** | ⚠️ 语言模型无新增（M3/M2.7 定价不变）；M2-her 疑似下线；M2.5/M2.1/M2 降为历史模型；视频/语音/图片/音乐新出多个模型（非语言模型，按需补） | 中 |
| **MiMo** | ✅ 无变化，v2.5 仍是当前版本，定价/限速完全一致 | 低 |

---

## 二、逐家核对明细

### 1. Kimi / Moonshot（极高）

| 项 | 现有 JSON | 官网现在（2026-08-31） | 动作 |
|---|---|---|---|
| 旗舰模型 | kimi-k2.7-code / k2.6 / k2.5 | 新增 `kimi-k3`（2.8T参数，原生视觉，1M上下文，面向长程编程与端到端知识工作） | 新增模型条目 |
| K3 定价 | 无 | hit ¥2 / miss ¥20 / out ¥100（元/百万token） | 填入 |
| K3 能力 | 无 | 自动上下文缓存、工具调用、JSON Mode、联网搜索、`reasoning_effort`（low/high/max，默认max） | 填入 |
| K3 最大输出 / 限速 | 无 | 官网未公布 | 标 NOT_PUBLISHED |
| kimi-k2.5 + moonshot-v1 全系列 | 在售 | **今日 8/31 全平台下线**，官方建议切 K3 | 标弃用（deprecation_notes 加日期） |
| K2 系列（0905/0711/turbo/thinking） | 已记 5/25 下线 | 一致 | ✅ |

**待补**：K3 最大输出、限速（需查 llms.txt 或 list-models 接口）。

### 2. 智谱 Zhipu / BigModel（极高）— ✅ 已完成 v2 (2026-08-31)

v2 baseline 已落地：[baselines/v2/zhipu.json](../baselines/v2/zhipu.json)，10 个模型（含新增 GLM-5.3 / GLM-5.3-Flash）。

| 项 | 现有 JSON | 官网现在 | 动作 | v2 状态 |
|---|---|---|---|---|
| 旗舰 | glm-5.2（1M上下文） | 新增 `GLM-5.3` + `GLM-5.3-Flash`（均 1M上下文 / 128K输出，"比肩 Claude Fable 5"） | 新增条目 | ✅ 已新增 |
| GLM-5.3 定价 | 无 | 定价页 SPA 经登录态 API 加载，公开抓不到绝对数值 | 标 NOT_PUBLISHED + 相对关系 | ⚠️ 待控制台登录补 |
| GLM-5.3-Flash 定价 | 无 | 文档仅给相对定价（=5.3 的 1/10，限时 1/20，Opus4.8 的 1/40） | 记相对关系 | ⚠️ 待控制台登录补 |
| GLM-5.2 | 旗舰 | 降为非旗舰但仍推荐 | 改 tier 标注 | ✅ 已标"非旗舰(前旗舰)" |
| GLM-5.1 / 5 / 5-Turbo | 200K上下文 | 一致 | ✅ | ✅ 沿用核实定价 |
| 新增模型（非旗舰） | — | GLM-4-Long、GLM-4-FlashX-250414、GLM-Image、CogVideoX-3、GLM-ASR-2512、GLM-TTS、GLM-OCR 等 | 按需补（语言模型优先） | ⬜ other_models_available 已列，未展开 |
| 免费模型归类 | 部分散记 | GLM-4.7-Flash / GLM-4.5-Flash / GLM-4-Flash-250414 明确归免费 | 统一标 free | ⬜ 待补 |

**关键修正（v1 → v2）**：
- ✅ **reasoning_effort 不是 GLM-5.2 独有**：对话补全.md 原文"仅 GLM-5.2 及其以上模型支持" → GLM-5.3/5.3-Flash 也支持，但**仅 low/high/max 三档**（5.2 支持全 7 档经映射）。v1 报告"待确认 5.3 是否继承"已确认：继承但档位更少。
- ✅ **GLM-5.3 思考强制 enabled**：不支持 disabled，关闭报错 → 对齐验证"思考开关"项对 5.3 系列判 SKIP。
- ✅ **GLM-5.3 发布 2026-08-19 / GLM-5.3-Flash 发布 2026-08-26**（新品发布页核实）。

**待补**：① GLM-5.3 / GLM-5.3-Flash 绝对定价（需控制台登录）；② GLM-5.3 / 5.3-Flash 并发限速（控制台实测，现标 NOT_PUBLISHED）；③ 免费模型统一标 free；④ 非语言模型（GLM-OCR/Image/ASR/TTS/CogVideoX）按需补。

### 3. DeepSeek（高）

| 项 | 现有 JSON | 官网现在 | 动作 |
|---|---|---|---|
| 模型 | pro / flash | 多 `v4-flash-vision-exp`（视觉，1M上下文，不支持FIM） | 新增条目 |
| 模型版本号 | 无 | v4-pro=`Pro-0813`，v4-flash=`Flash-0731` | 补 `version` 字段 |
| **定价结构** | 单一价 | **空闲/高峰分时段**，高峰=空闲×2 | 改结构 |
| v4-pro 定价 | hit 0.025 / miss 3 / out 6 | 空闲：hit 0.15 / miss 4.5 / out 13.5；高峰：×2 | 改数字+结构 |
| v4-flash 定价 | hit 0.02 / miss 1 / out 2 | 空闲：hit 0.05 / miss 1.5 / out 4.5；高峰：×2 | 改数字+结构 |
| 上下文 / 最大输出 | 1M / 384K | 1M / 384K | ✅ |
| 并发 | pro 500 / flash 2500 | pro 500 / flash 2500 | ✅ |
| 思考模式 | 支持 | 支持（默认思考） | ✅ |
| 高峰时段定义 | 无 | 周一至周五 9:00–12:00、14:00–18:00（北京时间） | 补 note |

### 4. MiniMax（中）— ✅ 已完成 v2 (2026-08-31)

v2 baseline 已落地：[baselines/v2/minimax.json](../baselines/v2/minimax.json)，9 个模型（3 在售 + 5 历史模型 + 1 下线）。

| 项 | 现有 JSON | 官网现在 | 动作 | v2 状态 |
|---|---|---|---|---|
| M3 / M2.7 定价 | in 2.1 / out 8.4 / cache_read 0.42 | **完全一致**（M3 永久五折，按>512K分段） | ✅ 不动 | ✅ 已核实 |
| M2.7-highspeed 定价 | in 4.2 / out 16.8 | 一致 | ✅ | ✅ 已核实 |
| M2-her | 有 | 官网未列出 | 标弃用 | ✅ status=deprecated(下线) |
| M2.5 / M2.1 / M2 | 在售 | 降为"历史模型" | 改 `status: deprecated` | ✅ 已标(含highspeed变体) |
| 限速 | free rpm20/tpm1M，paid rpm200/tpm10M(M3)/rpm500/tpm20M(M2.x) | 一致 | ✅ | ✅ 已核实(语言模型无并发,仅RPM/TPM) |
| 视频模型 | 无 | 新增 MiniMax H3 / H3 Max（替代 Hailuo 系列） | 按需补（非语言模型） | ⬜ other_models_available 已列 |
| 语音/图片/音乐 | 无 | Speech-2.8-HD/Turbo、image-01、music-3.0 | 按需补 | ⬜ 已列 |

**v2 关键产出**：
- ✅ 限速口径 = **rpm_tpm**（与 Kimi 同，与 DeepSeek/智谱的 concurrency 不同）→ 写入 `important_alignment_findings`，提醒前端对齐验证限速项时不能横比并发数。
- ✅ M3 定价结构 = `tiered_by_input_x_service_tier`（按 512K 分段 × standard/priority 1.5x × 永久五折），记五折后价 + 划线原价。
- ✅ highspeed 变体定价规则：input/output ×2，cache_read/cache_write 不变。
- ✅ thinking 模式：M3 可 disabled（能关思考）；M2.x 始终开启不可 disable → 思考开关项 M2.x 判 SKIP。
- ✅ MiniMax 无 reasoning_effort 参数（用 thinking.type disabled/adaptive）→ reasoning_effort 项判 SKIP。

**待补**：① M3 的 cache_write（定价页未列）；② 非语言模型（H3/Speech/image/music）按需展开。

### 5. MiMo 小米（低）— ✅ 已完成 v2 (2026-08-31)

v2 baseline 已落地：[baselines/v2/mimo.json](../baselines/v2/mimo.json)，6 个模型（全部 current，v2.5 系列）。

| 项 | 现有 JSON | 官网现在 | 动作 | v2 状态 |
|---|---|---|---|---|
| 模型 | v2.5 系列 | v2.5 系列 | ✅ | ✅ 一致 |
| pro 定价 | 0.025/3/6（国内） | 0.025/3/6 | ✅ | ✅ 已核实 |
| v2.5 定价 | 0.02/1/2（国内） | 0.02/1/2 | ✅ | ✅ 已核实 |
| 海外定价 | 有 | 一致 | ✅ | ✅ 已核实 |
| 限速 | rpm 100 / tpm 10M | rpm 100 / tpm 10M | ✅ | ✅ 已核实 |
| 已下线 | v2-pro/omni/flash/tts（6/30） | 一致 | ✅ | ✅ 已核实 |

**结论**：数据无变化，仅同步 v2 结构。

**v2 关键产出**：
- ✅ 限速口径 = **rpm_tpm**（账号级聚合，与 Kimi/MiniMax 同，与 DeepSeek/智谱 concurrency 不同）。
- ✅ thinking 模式强制覆盖：思考模式下 pro/v2.5 强制 temp=1.0、top_p=0.95 → 采样参数项判 SKIP。
- ✅ v2.5 为全模态（text+image+audio+video），pro 仅 text → 多模态输入项 pro 判 SKIP。
- ✅ 无 reasoning_effort（用 thinking 模式开关）→ reasoning_effort 项判 SKIP。
- ⚠️ 待确认：小米官方仅 OpenAI 兼容端点，参考站 CATALOG 标 mimo 支持 anthropic，疑为星流平台侧封装（非小米原生）→ 协议对齐验证前须确认。
- ✅ 两种计费模式（Token Plan / 按量）各需独立 Base URL + API Key，混用 401。

---

## 三、结构统一方案（待确认 schema）

当前五家字段命名各搞各的，是前端"丢参数"的结构性根因：

| 字段含义 | deepseek | kimi | minimax | zhipu | mimo |
|---|---|---|---|---|---|
| 缓存命中输入价 | `input_cache_hit_per_million` | `input_cache_hit` | `cache_read` | `cache_hit` | `input_cache_hit` |
| 限速结构 | `concurrency_limit` | `rate_limits.tiers` | `rate_limits.free/paid` | `rate_limits.concurrency` | `rate_limits.rpm/tpm` |
| 平台参数 | 散在各模型 | `params_moonshot_v1` | `platform_params` | `platform_params` | `platform_params` |

**建议统一 schema（草案）**：

```json
{
  "vendor": "deepseek",
  "vendor_name": "DeepSeek",
  "fetched_at": "2026-08-31",
  "fetched_by": "WebFetch crawl",
  "official_docs_base": "https://...",
  "api_base_url": {
    "openai": "...",
    "anthropic": "..."
  },
  "platform_params": {
    "temperature": { "min": 0, "max": 2, "default": 1 },
    "top_p": { "min": 0, "max": 1, "default": 1 },
    "stream": { "default": false }
  },
  "rate_limits": {
    "metric": "concurrency | rpm_tpm",
    "details": "..."
  },
  "sources": ["..."],
  "verification_notes": { "...": "..." },
  "models": [
    {
      "model_id": "deepseek-v4-pro",
      "display_name": "DeepSeek-V4-Pro",
      "version": "Pro-0813",
      "status": "current | deprecated",
      "modality": "text",
      "protocols": ["openai", "anthropic"],
      "context_window": { "official_value": "1M", "parsed": 1000000 },
      "max_output_tokens": { "official_value": "384K", "parsed": 384000 },
      "features": {
        "streaming": true,
        "function_calling": true,
        "json_output": true,
        "thinking_mode": true,
        "vision": false
      },
      "pricing": {
        "currency": "CNY",
        "unit": "per_million_tokens",
        "model": "single | offpeak_peak_split | tiered_by_input",
        "offpeak": { "input_cache_hit": 0.15, "input_cache_miss": 4.5, "output": 13.5 },
        "peak": { "input_cache_hit": 0.30, "input_cache_miss": 9, "output": 27 }
      },
      "rate_limits": { "concurrency": 500 },
      "gaps": []
    }
  ],
  "deprecation_notes": ["..."]
}
```

**统一要点**：
1. 所有定价统一用 `pricing.currency` + `pricing.unit` + 具体价格对象，字段名统一为 `input_cache_hit` / `input_cache_miss` / `output`。
2. 分时段用 `pricing.model: "offpeak_peak_split"` + `offpeak`/`peak` 两个对象；分档用 `tiered_by_input` + 数组。
3. 限速统一放 `rate_limits`，标明 `metric`（concurrency 还是 rpm_tpm）。
4. 每个模型加 `status`（current/deprecated）和 `version` 字段。
5. `features` 字段名统一（streaming/function_calling/json_output/thinking_mode/vision）。
6. 平台级参数统一放 `platform_params`。

---

## 四、执行计划

| 顺序 | 厂商 | 工作量 | 备注 | 状态 |
|---|---|---|---|---|
| 1 | Kimi | 大 | 新增 K3 + 标记今日下线模型，最紧急 | ✅ 完成 |
| 2 | DeepSeek | 中 | 改定价结构（分时段）+ 新增 vision-exp | ✅ 完成 |
| 3 | 智谱 | 大 | 新增 GLM-5.3/5.3-Flash，定价/限速待控制台补 | ✅ 完成（定价限速标 NOT_PUBLISHED） |
| 4 | MiniMax | 中 | 标弃用 + 改 status，限速复核 | ✅ 完成（限速口径 rpm_tpm 已核实） |
| 5 | MiMo | 小 | 仅同步结构，数据不变 | ✅ 完成（数据无变化，结构已同步） |

每家改完同步 `fetched_at` → `2026-08-31`。

### 进度（2026-08-31）— ✅ v2 五家全部完成

| 厂商 | 文件 | 模型数 | current | deprecated | 对齐发现条数 |
|---|---|---|---|---|---|
| Kimi | baselines/v2/kimi.json | 11 | 4 | 7 | 2 |
| DeepSeek | baselines/v2/deepseek.json | 3 | 3 | 0 | — |
| 智谱 | baselines/v2/zhipu.json | 10 | 10 | 0 | 5 |
| MiniMax | baselines/v2/minimax.json | 9 | 3 | 6 | 6 |
| MiMo | baselines/v2/mimo.json | 6 | 6 | 0 | 6 |
| **合计** | | **39** | **26** | **13** | **19+** |

**五家 v2 关键产出汇总**：
- 智谱：① 新增 GLM-5.3（旗舰，强制思考，reasoning_effort 仅 low/high/max）；② 新增 GLM-5.3-Flash（原生多模态，320B/18B 激活）；③ 修正 reasoning_effort 归属（非 5.2 独有）；④ 沿用 2026-07 核实定价。
- MiniMax：① 限速口径 rpm_tpm；② M3 定价 tiered_by_input×service_tier×五折；③ M2.5/M2.1/M2 标 deprecated，M2-her 下线；④ thinking M3 可关/M2.x 强制开。
- MiMo：① 数据无变化仅同步结构；② 限速 rpm_tpm；③ thinking 强制覆盖采样参数；④ v2.5 全模态/pro 仅 text；⑤ anthropic 协议疑为平台封装待确认。

**限速口径三家不同**（前端对齐验证限速项的核心约束）：
- DeepSeek、智谱 = **并发数**（在途请求数）
- Kimi、MiniMax、MiMo = **RPM/TPM**（账号级聚合）
- → 限速项必须按各家口径分别测，不能横比数值。

**共性缺口**（均已标 NOT_PUBLISHED，不阻塞前端拼 URL 对齐，定价项判 INC）：
- 智谱 GLM-5.3/5.3-Flash 绝对定价与并发限速（需登录控制台补，已记相对定价关系）。
- MiniMax M3 cache_write（定价页未列）。
- MiMo anthropic 协议是否原生（需确认是小米原生还是星流平台封装）。