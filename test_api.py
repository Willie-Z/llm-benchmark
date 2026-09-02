# LLM 验收工具 · 从0到1概念启蒙（交互式多轮）
# 运行方式：在 VS Code 终端（PowerShell）里执行
#   pip install --upgrade "openai>=1.0"
#   python "c:\Users\KC\新建文件夹\llm-benchmark\test_api.py"
# 退出方式：在对话中输入  q  或  quit

import os
from openai import OpenAI

# TODO: 把下面换成你自己的 key（别提交到 git，别贴到聊天里）
API_KEY = "sk-YOUR_API_KEY_HERE"
MODEL = "gpt-oss-120b"
BASE_URL = "https://kspmas.ksyun.com/v1/"

client = OpenAI(api_key=API_KEY, base_url=BASE_URL)

# —— 项目真实数据（从 baselines/catalog.json 提取，防止模型编造版本号或数值）——
PROJECT_FACTS = """
【我项目的真实数据，必须以此为准，禁止编造版本号或数值】
项目：llm-benchmark，一个 LLM 验收对比工具。公司聚合平台"星流"接入各家大模型，通过不同通道（Endpoint：官网直连/中转API/自建网关）对外提供。
工具做的事：拿各模型官方公布的参数当标准，测试星流各通道有没有按官方规矩来，每项出验证卡（PASS/FAIL/INC/SKIP），多路并排对比。

五家厂商与真实模型（截至 2026-08-31）：
- DeepSeek：deepseek-v4-pro（版本 Pro-0813，上下文 1M，最大输出 384K，并发 500）、deepseek-v4-flash（版本 Flash-0731，并发 2500）、deepseek-v4-flash-vision-exp（视觉，不支持 FIM）
- 智谱：GLM-5.3 / GLM-5.3-Flash（新旗舰，1M 上下文）、GLM-5.2（1M，已降为非旗舰）、限速用并发数（如 GLM-5.2=10）
- Kimi：kimi-k3（新旗舰，2.8T 参数，原生视觉，1M 上下文；hit 2/miss 20/out 100 元每百万token）、kimi-k2.7-code（256K 上下文，仅思考模式）、k2.6/k2.5（256K，含视觉）；k2.5+moonshot-v1 全系列 8/31 下线；限速按充值档 Tier0-5
- MiniMax：MiniMax-M3（1M 上下文，最大输出 recommended 131K/max 524K，原生多模态 text+image+video）、M2.7（200K 上下文）；限速用档位（free rpm20/paid rpm200）
- 小米 MiMo：mimo-v2.5-pro（1M 上下文，128K 输出，思考模式强制 temp 1.0/top_p 0.95）、mimo-v2.5（全模态）；限速 rpm 100 / tpm 10M

关键事实：
- token 是大模型计费和计长度的单位，约 0.5-1 个词或 1-2 个汉字
- 上下文窗口：一次请求能塞进去的总长度上限；最大输出：模型一次能生成的上限
- 1M = 100 万 token，约 50-70 万字
- 五家 baseline 字段命名不统一（缓存命中价：deepseek 写 input_cache_hit_per_million、kimi 写 input_cache_hit、minimax 写 cache_read），这是前端丢参数的根因
- 27 条标准用例 = Specifications 规格9 + Capabilities 能力18；profile 三档 smoke/standard/full
- 四态：PASS 对齐 / FAIL 未对齐 / INCONCLUSIVE 官网未公布 / SKIP 该模型不适用
- 本地代理 serve.py 转发请求是为了绕开浏览器 CORS 跨域限制；API Key 只存浏览器不落盘
"""

SYSTEM_PROMPT = (
    "你是一位面向新手的编程启蒙老师，带一个零基础用户从0到1理解他自己的 LLM 验收工具项目。"
    "教学原则："
    "1）从零开始，不假设用户有任何前置知识，术语先用一句话白话解释再用；"
    "2）严格按业务链顺序推进，一次只讲一个环节，讲完停下来等用户回复，绝不一次讲完所有环节；"
    "3）每个概念都落到用户真实项目场景里讲，不用比喻代替解释；"
    "4）讲到的任何数值、版本号、模型名必须引用下方项目真实数据，禁止凭记忆编造；"
    "5）语言简洁有力，不要过多括号、引号、感叹号、表情；"
    "6）每个环节讲完后，用一张 markdown 表格做收尾，表格结构为：概念 | 白话解释 | 我项目里的真实例子（必须引用项目真实数据，禁止编造）。表格要让用户一眼对照着看懂；"
    "7）讲完一个环节并给出表格后，用一句话问跟上了吗，跟上回复继续、没跟上回复重讲，然后停住。"
    + PROJECT_FACTS
)

FIRST_USER_MSG = (
    "我是零基础新手，想从0到1理解自己在维护的这个 llm-benchmark 项目。"
    "请按下面这条业务链，从环节1开始，一次只讲一个环节，讲完停下来等我回复：\n\n"
    "环节1 大模型本身：model、版本号、旗舰/flash、modality（text/vision/全模态）、context_window、max_output_tokens、thinking_mode、reasoning_effort\n"
    "环节2 API调用：什么是 API、base_url/endpoint、api_key 鉴权、协议格式（OpenAI兼容 vs Anthropic）、请求字段（model/messages/system/user）、streaming流式、SSE、DONE\n"
    "环节3 调用参数：temperature、top_p、max_tokens vs max_completion_tokens、function_calling/tool_calls、json_output、response_format、多轮对话\n"
    "环节4 容量与速率：context_window 超了怎样、并发 concurrency、rpm、tpm、tiers档位、五家限速口径不同\n"
    "环节5 定价：token、input/cache_hit/cache_miss/output、per_million、currency、定价结构（single/offpeak_peak_split/tiered_by_input）、cache_write\n"
    "环节6 基线数据：JSON、五家字段命名为什么不统一、schema、为什么前端丢参数跑不通、NOT_PUBLISHED、catalog.json 聚合\n"
    "环节7 验收测试：27条用例（规格9+能力18）、profile三档、expected期望值、四态判定、四类对齐维度\n"
    "环节8 前端展示：HTML表格、验证卡、多路并排对比、serve.py 代理绕 CORS、Key不落盘\n"
    "环节9 进阶：RAG 检索增强生成、和直接调API的区别、function_calling 和 RAG 的关系\n\n"
    "现在只讲环节1，用白话加我项目的真实模型数据，讲完停下来问我跟上了没。"
)


def chat_once(messages):
    """发一次请求，流式打印回答，返回完整文本。"""
    stream = client.chat.completions.create(
        model=MODEL,
        messages=messages,
        stream=True,
    )
    full = []
    print("\n老师：", end="", flush=True)
    for chunk in stream:
        # 防御：服务器偶尔发 choices 为空的分片（如结尾的 usage 统计包），跳过即可
        if not chunk.choices:
            continue
        choice = chunk.choices[0]
        delta = getattr(getattr(choice, "delta", None), "content", None) or ""
        print(delta, end="", flush=True)
        full.append(delta)
    print()
    return "".join(full)


def main():
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": FIRST_USER_MSG},
    ]

    print("=" * 60)
    print("LLM 验收工具 · 从0到1概念启蒙（交互式）")
    print("输入 继续 推进下一环节，输入 重讲 要求重讲当前环节，")
    print("也可以直接输入任何具体问题追问，输入 q 退出。")
    print("=" * 60)

    # 第一轮：自动发环节1
    reply = chat_once(messages)
    messages.append({"role": "assistant", "content": reply})

    # 多轮循环
    while True:
        try:
            user_input = input("\n你：").strip()
        except (EOFError, KeyboardInterrupt):
            print("\n再见。")
            break
        if not user_input:
            continue
        if user_input.lower() in ("q", "quit", "exit"):
            print("再见。")
            break

        messages.append({"role": "user", "content": user_input})
        reply = chat_once(messages)
        messages.append({"role": "assistant", "content": reply})


if __name__ == "__main__":
    main()
