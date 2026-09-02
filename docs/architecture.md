# 星流 LLM 多路 Endpoint 验收对比工具 · 逻辑架构图

> 生成日期：2026-08-31
> 图格式：Mermaid（VSCode/GitHub 预览可渲染）+ SVG（浏览器直接打开）
> 配套文件：`architecture.svg`（同目录，位图替代）

---

## 一、整体分层架构

```mermaid
graph TB
    subgraph User["用户层 · 浏览器"]
        U["用户<br/>API Key 仅存本地"]
    end

    subgraph Frontend["前端应用层 · React/Vue 纯前端"]
        direction TB
        F1["工作台<br/>选模型/配通道/全局超参"]
        F2["用例生成 Agent<br/>LLM · v2.0"]
        F3["多路调度器<br/>Promise.all + 限速节流 + 轮询"]
        F4["四态判定器<br/>基线驱动"]
        F5["渲染器<br/>验证卡 + 多路对比表"]
        F1 --> F2
        F1 --> F3
        F3 --> F4
        F4 --> F5
    end

    subgraph Data["数据层 · 前端打包/外挂"]
        D1["catalog.json<br/>聚合模型树(39模型)"]
        D2["baselines/v2/*.json<br/>5家·带官网来源"]
        D3["bench_plan.json<br/>27用例"]
        D4["bench_runs.json<br/>3 run样本"]
    end

    subgraph Backend["后端层 · 公司现有(不新建)"]
        B1["kspmas.ksyun.com<br/>120.92.93.22"]
        B2["GET /api/plan<br/>27用例下发"]
        B3["GET·POST /api/runs<br/>run结果"]
        B1 --- B2
        B1 --- B3
    end

    subgraph Exec["执行层 · 三态切换"]
        E1["线上:直连 /api/runs"]
        E2["本地:serve.py 代理<br/>→各厂商端点(绕CORS)"]
        E3["线上无代理:模拟演示"]
    end

    subgraph Target["被测方 · 多路 Endpoint"]
        T1["路1 官网直连"]
        T2["路2 星流中转"]
        T3["路3 自建网关"]
        V["5家厂商<br/>Kimi/DeepSeek/智谱/MiniMax/MiMo"]
        T1 --> V
        T2 --> V
        T3 --> V
    end

    U -->|操作| F1
    F1 -.->|加载基线| D2
    F1 -.->|加载模型树| D1
    F2 -.->|读基线驱动expected| D2
    F3 -.->|拉用例| B2
    F3 -.->|拉/启run| B3
    F3 --> E1
    F3 --> E2
    F3 -.-> E3
    E1 --> Target
    E2 --> Target
    F4 -.->|mock验证| D4

    style User fill:#e8f4f8,stroke:#2196f3
    style Frontend fill:#fff8e1,stroke:#ff9800
    style Data fill:#e8f5e9,stroke:#4caf50
    style Backend fill:#fce4ec,stroke:#e91e63
    style Exec fill:#f3e5f5,stroke:#9c27b0
    style Target fill:#e0e0e0,stroke:#616161
```

---

## 二、工作流（数据流时序）

```mermaid
graph LR
    A["选模型"] --> B["加载v2基线<br/>(含对齐发现)"]
    B --> C["配通道<br/>单路/多路2-4"]
    C --> D["选用例<br/>27标准 / 生成"]
    D --> E["启动测试"]
    E --> F["多路并发调度<br/>按各家限速节流"]
    F --> G["轮询run结果<br/>每5s"]
    G --> H["四态判定<br/>PASS/FAIL/INC/SKIP"]
    H --> I["验证卡渲染"]
    H --> J["多路对比表<br/>横向一致+纵向对齐"]

    style A fill:#bbdefb
    style E fill:#ffe0b2
    style H fill:#ffcdd2
    style I fill:#c8e6c9
    style J fill:#c8e6c9
```

---

## 三、四态判定逻辑

```mermaid
graph TD
    R["执行结果"] --> Q{"基线是否支持<br/>该参数?"}
    Q -->|不支持| SKIP["SKIP ⏭️<br/>不适用"]
    Q -->|支持| Q2{"官网是否公布<br/>该数值?"}
    Q2 -->|未公布| INC["INC ⚠️<br/>无法判定"]
    Q2 -->|公布| Q3{"实测是否<br/>与官方对齐?"}
    Q3 -->|对齐| PASS["PASS ✅"]
    Q3 -->|未对齐| FAIL["FAIL ❌"]

    style SKIP fill:#e0e0e0,stroke-dasharray:5
    style INC fill:#fff9c4
    style PASS fill:#c8e6c9
    style FAIL fill:#ffcdd2
```

---

## 四、多路对比示意

```mermaid
graph LR
    subgraph 同一用例
        L1["路1 官网直连"]
        L2["路2 星流中转"]
        L3["路3 自建网关"]
    end
    L1 --> Cmp["多路对比表"]
    L2 --> Cmp
    L3 --> Cmp
    Cmp --> Out["|用例|路1|路2|路3|一致?|<br/>|最大输出|✅128K|⚠️64K|✅128K|❌路2缩水|<br/>|函数调用|✅|✅|❌|❌路3缺失|"]

    style Cmp fill:#fff8e1
    style Out fill:#e8f5e9
```

---

## 五、限速口径（前端节流依据）

```mermaid
graph TD
    S["启动多路"] --> K{"按厂商限速口径节流"}
    K -->|DeepSeek/智谱| C1["并发数<br/>v4-pro=500/flash=2500<br/>GLM-5.2=10"]
    K -->|Kimi/MiniMax/MiMo| C2["RPM/TPM<br/>MiniMax M3=200RPM/10MTPM<br/>MiMo=100RPM/10MTPM"]
    C1 --> Run["并发发请求"]
    C2 --> Run
    Run --> Note["注:口径不同的通道间<br/>不横比数值"]

    style C1 fill:#e8f4f8
    style C2 fill:#e8f5e9
    style Note fill:#fff9c4
```
