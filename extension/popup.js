/* popup.js —— 工具栏入口：两页链接 + 本地后端（二进制/serve.py）状态探测 */
(async function () {
    const dot = document.getElementById("backendDot");
    const txt = document.getElementById("backendTxt");
    try {
        const r = await fetch("http://127.0.0.1:8000/healthz", {method: "GET"});
        const j = await r.json();
        if (j && j.ok) {
            dot.classList.add("ok");
            txt.textContent = "本地后端运行中 · 工具测试 / 下载验证可用";
            return;
        }
        throw new Error("bad response");
    } catch (e) {
        dot.classList.add("bad");
        txt.textContent = "本地后端未启动 · 真发/模型列表可用，工具测试需启动二进制";
    }
})();
