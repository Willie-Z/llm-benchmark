# Baseline 版本说明

## 目录结构

- `baselines/v1/` — 2026-07-14 ~ 2026-07-16 抓取的首版基线（原 `baselines/*.json` 归档，原样保留，不再修改）
- `baselines/v2/` — 2026-08-31 起更新的第二版：数据刷新至最新 + 五家统一为同一套字段 schema

## 为什么分版本

- 旧版完整保留，方便对比、回退或重修。
- v2 的核心改进是**结构统一**：消除 v1 中五家字段命名各搞各的（定价字段三种写法、限速三种结构）导致的"前端丢参数、跑不通"问题。
- 数据变化详见 `docs/baseline-update-check-2026-08.md`。

## v2 统一 schema 要点

1. **定价**：统一 `pricing.currency` + `pricing.unit` + 价格对象，字段名固定为 `input_cache_hit` / `input_cache_miss` / `output`。
   - `pricing.model` 取值：`single`（单一价）/ `offpeak_peak_split`（空闲/高峰分时段）/ `tiered_by_input`（按输入长度分档）/ `tiered_by_input_and_output`（按输入+输出分档）
   - 分时段 → `offpeak` / `peak` 两个对象；分档 → `tiers` 数组
2. **限速**：统一 `rate_limits`，标 `metric`（`concurrency` 或 `rpm_tpm`）。
3. **模型**：每模型加 `status`（`current` / `deprecated`）和 `version` 字段。
4. **能力**：`features` 字段名统一（`streaming` / `function_calling` / `json_output` / `thinking_mode` / `vision`）。
5. **平台参数**：统一放 `platform_params`。
6. **未公布项**：统一用 `"NOT_PUBLISHED"` 字符串 + `note`，不再混用 null / 字符串 / 对象。

完整 schema 草案见 `docs/baseline-update-check-2026-08.md` 第三节。
