#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
星流 LLM 验收工具 · 本地代理 + 静态服务（prototype 目录版）
- GET /healthz  →  存活探测 {ok:true}（浏览器插件与 popup 用它判断本地后端是否在跑）
- GET /  →  默认返回 index.html，没有则回退 multitool.html（同源，浏览器无跨域问题）
- GET /<file>  →  返回静态文件（先查 prototype/，再查 extension/pages/——
  多工具页与 LLM 验收页已迁往扩展目录，本服务同时托管以便不开扩展时使用）
- POST /proxy  {url, method, headers, body, proxy}  →  转发到真实 LLM Endpoint，返回 {ok,status,body,headers}
  浏览器直连 LLM Endpoint 常被 CORS 拦截；经本机代理转发即可绕开。
  Key 仅在本机内存中转发，不落盘、不记日志。
  可选字段 proxy：上游 HTTP 代理（4 层，如 http://10.0.0.1:8080，gost/shadowsocks 搭建），
  传入后本机经该代理转发目标请求（用于境内访问 GitHub 等）；不传则直连。
- POST /tooltest  {base_url, model, api_key, prompt?, repo?, tag?, ver?, proxy?}  →  拉起 codex（优先页面所选版本）端到端测试
- POST /cfg  {content, env?, path?, ttl?}  →  写入工具接入配置 config.toml（可选 env.sh）
  path 指定（如 /tmp/mytest）则写到该目录；path 留空写系统临时目录并在 ttl 秒（默认 600）后自动删除。
用法（在本文件所在目录运行）：
    cd prototype
    python serve.py
  然后浏览器开 http://127.0.0.1:8000/   （会自动打开 multitool.html）
  分发为单文件二进制（免装 Python）：sh build.sh  →  dist/starflow-backend
"""
import os, sys, json, ssl, time, shutil, tempfile, threading, platform, subprocess, tarfile, zipfile, urllib.request, urllib.error, urllib.parse
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

def _static_dirs():
    """静态查找目录：prototype/（历史原型）与 extension/pages/（两个主页面）。
    PyInstaller 冻结后静态资源解压到 sys._MEIPASS，同时兼容可执行文件旁的
    dist/starflow-backend 场景；页面已随二进制打包，安装包不依赖仓库目录。"""
    bases = []
    if getattr(sys, "frozen", False):
        meipass = getattr(sys, "_MEIPASS", None)
        if meipass:
            bases.append(os.path.abspath(meipass))
        exe_dir = os.path.dirname(os.path.abspath(sys.executable))
        bases.extend([exe_dir, os.path.dirname(exe_dir)])
    else:
        bases.append(os.path.dirname(os.path.abspath(__file__)))

    candidates = []
    for base in bases:
        for d in (
            base,
            os.path.join(base, "prototype"),
            os.path.join(base, "extension", "pages"),
            os.path.normpath(os.path.join(base, os.pardir, "extension", "pages")),
        ):
            if d not in candidates:
                candidates.append(d)
    return candidates

ROOT = os.path.dirname(os.path.abspath(__file__)) if not getattr(sys, "frozen", False) \
    else os.path.dirname(os.path.abspath(sys.executable))
STATIC_DIRS = _static_dirs()
PORT = 8000
TIMEOUT = 180  # 思考类请求可能较慢

CTYPES = {
    ".html": "text/html; charset=utf-8",
    ".js":   "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".css":  "text/css; charset=utf-8",
    ".svg":  "image/svg+xml",
}

def default_page():
    for name in ("index.html", "multitool.html", "prototype-multitool.html"):
        for d in STATIC_DIRS:
            if os.path.isfile(os.path.join(d, name)):
                return "/" + name
    return "/index.html"


# ============ codex 二进制下载 / 缓存（供 /tool 与 /tooltest 共用） ============
_CODEX_BIN_CACHE={}   # key -> {"dir","path","deadline"}
_CODEX_BIN_LOCK=threading.Lock()
_CODEX_BIN_TTL=900    # 缓存 15 分钟，到点自动删除，重复测试间复用

def _open_url(url, proxy=None, timeout=60):
    r=urllib.request.Request(url, headers={"User-Agent":"starflow-verify/1.0 (local-proxy)"})
    ctx=ssl.create_default_context(); ctx.check_hostname=False; ctx.verify_mode=ssl.CERT_NONE
    if proxy:
        opener=urllib.request.build_opener(
            urllib.request.ProxyHandler({"http":proxy,"https":proxy}),
            urllib.request.HTTPSHandler(context=ctx))
        return opener.open(r, timeout=timeout)
    return urllib.request.urlopen(r, timeout=timeout, context=ctx)

def _platform_triple():
    m=platform.machine().lower()
    arch="aarch64" if m in ("arm64","aarch64") else "x86_64"
    if sys.platform=="darwin": return arch+"-apple-darwin"
    if sys.platform.startswith("linux"): return arch+"-unknown-linux-musl"
    if sys.platform.startswith("win"): return arch+"-pc-windows-msvc"
    return None

def _resolve_codex_asset(repo, tag, plat, proxy):
    """解析 Release 资产：优先直拼确定性 URL（不耗 API 限额），404 再回退资产清单。返回 (asset_name, dl_url, err)"""
    exe_sfx=".exe" if plat.endswith("windows-msvc") else ""
    base="https://github.com/%s/releases/download/%s/"%(repo,tag)
    api_err=None
    for name in ("codex-%s%s.tar.gz"%(plat,exe_sfx), "codex-%s%s.zip"%(plat,exe_sfx)):
        try:
            with _open_url(base+name, proxy, 30) as resp:
                if resp.status==200: return name, base+name, None
        except urllib.error.HTTPError as e:
            if e.code==404: continue
            api_err="HTTP %s"%e.code; break
        except Exception as e:
            api_err=str(e); break
    rel=None
    try:
        with _open_url("https://api.github.com/repos/%s/releases/tags/%s"%(repo,tag), proxy, 60) as resp:
            rel=json.loads(resp.read().decode("utf-8","replace"))
    except urllib.error.HTTPError as e:
        try: rel=json.loads(e.read().decode("utf-8","replace"))
        except Exception: rel={"message":"HTTP %s"%e.code}
    except Exception as e:
        rel={"message":str(e)}
    assets=(rel or {}).get("assets") or []
    skip=("app-server","symbols","package","responses-api-proxy","code-mode",
          "command-runner","sandbox","provisioned","npm","whl","sigstore")
    cands=[a for a in assets if a.get("name","").startswith("codex-")
           and plat in a.get("name","") and "-bazel" not in a.get("name","")
           and not any(k in a.get("name","") for k in skip)]
    for suf in (".tar.gz",".zip"):
        a=next((a for a in cands if a.get("name","").endswith(suf)),None)
        if a: return a["name"], a["browser_download_url"], None
    msg=(rel or {}).get("message") if isinstance(rel,dict) else None
    hint="（GitHub API 限流？请勾选代理重试）" if (msg and "rate limit" in msg) else ""
    return None, None, "未能解析下载地址"+(("："+msg) if msg else "")+(api_err or "")+hint

def _codex_cache_get(key):
    with _CODEX_BIN_LOCK:
        e=_CODEX_BIN_CACHE.get(key)
        if e and time.time()<e["deadline"] and os.path.isfile(e["path"]):
            e["deadline"]=time.time()+_CODEX_BIN_TTL   # 复用时续期
            return e["path"]
        if e:
            shutil.rmtree(e["dir"],ignore_errors=True)
            _CODEX_BIN_CACHE.pop(key,None)
    return None

def _codex_cache_put(key, path, ttl=_CODEX_BIN_TTL):
    with _CODEX_BIN_LOCK:
        old=_CODEX_BIN_CACHE.pop(key,None)
        if old: shutil.rmtree(old["dir"],ignore_errors=True)
        _CODEX_BIN_CACHE[key]={"dir":os.path.dirname(path),"path":path,"deadline":time.time()+ttl}
    def _rm():
        time.sleep(ttl)
        with _CODEX_BIN_LOCK:
            e=_CODEX_BIN_CACHE.get(key)
            if e and e["path"]==path and time.time()>=e["deadline"]:
                shutil.rmtree(e["dir"],ignore_errors=True)
                _CODEX_BIN_CACHE.pop(key,None)
    threading.Thread(target=_rm,daemon=True).start()

def _download_codex_bin(repo, tag, ver, proxy, prog=None):
    """下载指定版本 codex 二进制（带缓存）。prog 为可选进度 dict（received/total）。返回 (bin_path, asset_name, err)"""
    plat=_platform_triple()
    if not plat: return None,None,"不支持的平台: %s"%sys.platform
    tag=tag if tag.startswith("rust-v") else "rust-v"+tag
    key="%s#%s#%s"%(repo,tag,plat)
    hit=_codex_cache_get(key)
    if hit: return hit, None, None
    asset_name, dl_url, err=_resolve_codex_asset(repo, tag, plat, proxy)
    if not asset_name: return None, None, err
    d=tempfile.mkdtemp(prefix="codex-bin-")
    try:
        arc=os.path.join(d,asset_name)
        with _open_url(dl_url, proxy, 600) as resp, open(arc,"wb") as f:
            if prog is not None:
                try: prog["total"]=int(resp.headers.get("Content-Length") or 0)
                except Exception: prog["total"]=0
                prog["received"]=0
            while True:
                chunk=resp.read(1<<20)
                if not chunk: break
                f.write(chunk)
                if prog is not None: prog["received"]+=len(chunk)
        if arc.endswith(".tar.gz"):
            with tarfile.open(arc,"r:gz") as tf: tf.extractall(d)
        else:
            with zipfile.ZipFile(arc) as zf: zf.extractall(d)
        exe_sfx=".exe" if plat.endswith("windows-msvc") else ""
        exe="codex.exe" if exe_sfx else "codex"
        bin_path=None
        for want in (exe, "codex-"+plat+exe_sfx):
            for root,_,files in os.walk(d):
                if want in files: bin_path=os.path.join(root,want); break
            if bin_path: break
        if not bin_path:
            shutil.rmtree(d,ignore_errors=True)
            return None, asset_name, "解压后未找到 %s"%exe
        renamed=os.path.join(d,"codex-"+ver+(".exe" if exe_sfx else ""))
        os.rename(bin_path,renamed); os.chmod(renamed,0o755)
        _codex_cache_put(key, renamed)
        return renamed, asset_name, None
    except Exception as e:
        shutil.rmtree(d,ignore_errors=True)
        return None, asset_name, str(e)


_DL_JOBS={}
_DL_JOBS_LOCK=threading.Lock()

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass  # 静默

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")

    def _send_json(self, code, obj):
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def _do_dljob(self):
        """POST 启动后台下载任务（同 key 复用）；GET ?id= 轮询进度 {status,received,total,bin,error}"""
        if self.command == "POST":
            req = self._read_body()
            if req is None: return
            repo = (req.get("repo") or "openai/codex").strip()
            tag = (req.get("tag") or "").strip()
            ver = (req.get("ver") or tag.replace("rust-v", "")).strip()
            proxy = req.get("proxy")
            if not tag:
                self._send_json(400, {"error": "no tag"}); return
            jid = "%s#%s#%s" % (repo, tag if tag.startswith("rust-v") else "rust-v" + tag, _platform_triple())
            with _DL_JOBS_LOCK:
                st = _DL_JOBS.get(jid)
                if st and st.get("status") == "running":
                    self._send_json(200, {"ok": True, "id": jid, "already": True}); return
                prog = {"received": 0, "total": 0}
                _DL_JOBS[jid] = {"status": "running", "prog": prog}
            def run():
                try:
                    bin_path, asset, err = _download_codex_bin(repo, tag, ver, proxy, prog=prog)
                    with _DL_JOBS_LOCK:
                        if bin_path:
                            _DL_JOBS[jid] = {"status": "done", "bin": os.path.basename(bin_path), "bin_path": bin_path}
                        else:
                            _DL_JOBS[jid] = {"status": "error", "error": err or "下载失败"}
                except Exception as e:
                    with _DL_JOBS_LOCK:
                        _DL_JOBS[jid] = {"status": "error", "error": str(e)}
            threading.Thread(target=run, daemon=True).start()
            self._send_json(200, {"ok": True, "id": jid})
        else:
            qs = urllib.parse.parse_qs(self.path.split("?", 1)[1] if "?" in self.path else "")
            jid = (qs.get("id") or [""])[0]
            with _DL_JOBS_LOCK:
                st = dict(_DL_JOBS.get(jid) or {})
            if not st:
                self._send_json(200, {"ok": False, "error": "no such job"}); return
            prog = st.pop("prog", None) or {}
            self._send_json(200, {"ok": True, "status": st.get("status"),
                                  "received": prog.get("received", 0), "total": prog.get("total", 0),
                                  "bin": st.get("bin"), "error": st.get("error")})

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/healthz":
            self._send_json(200, {"ok": True, "service": "starflow-backend"}); return
        if path == "/dljob":
            self._do_dljob(); return
        if path == "/":
            path = default_page()
        # 旧文件名兼容映射（两个主页面已迁 extension/pages/，老链接不断）
        LEGACY_NAMES = {
            "prototype-multitool.html": "multitool.html",
            "prototype-llmabacus.html": "llmabacus.html",
        }
        rel = LEGACY_NAMES.get(path.lstrip("/"), path.lstrip("/"))
        # 防目录穿越 + 双目录查找（prototype/ 与 extension/pages/）
        safe = None
        for d in STATIC_DIRS:
            cand = os.path.normpath(os.path.join(d, rel))
            if (cand == d or cand.startswith(d + os.sep)) and os.path.isfile(cand):
                safe = cand; break
        if not safe:
            self.send_response(404); self._cors(); self.end_headers(); return
        ext = os.path.splitext(safe)[1].lower()
        ctype = CTYPES.get(ext, "application/octet-stream")
        with open(safe, "rb") as f:
            data = f.read()
        self.send_response(200); self._cors()
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")  # 原型页频繁改动，禁用浏览器缓存避免旧 JS
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _read_body(self):
        n = int(self.headers.get("Content-Length", 0) or 0)
        raw = self.rfile.read(n) if n else b""
        try:
            return json.loads(raw.decode("utf-8") or "{}")
        except Exception as e:
            self._send_json(400, {"error": "bad json: %s" % e}); return None

    _platform_triple = staticmethod(_platform_triple)
    _open_url = staticmethod(_open_url)

    def _do_tool(self):
        """下载并验证工具二进制：{repo?, tag?, ver?, proxy?}
        平台自动识别 → 拉 Release 资产清单 → 选适配资产下载到临时目录 →
        解压并重命名为 codex-<ver> → 执行 --version 验证 → 无论成败立即删除临时目录。
        """
        req = self._read_body()
        if req is None: return
        repo = (req.get("repo") or "openai/codex").strip()
        tag = (req.get("tag") or "").strip()   # 纯版本号或完整 tag（rust-v0.164.0）
        ver = (req.get("ver") or tag.replace("rust-v", "")).strip()
        proxy = req.get("proxy")
        if not tag:
            self._send_json(400, {"error": "no tag"}); return
        plat = self._platform_triple()
        if not plat:
            self._send_json(200, {"ok": False, "error": "不支持的平台: %s" % sys.platform}); return
        try:
            bin_path, asset_name, err = _download_codex_bin(repo, tag, ver, proxy)
            if not bin_path:
                self._send_json(200, {"ok": False, "error": err or "下载失败", "platform": plat}); return
            # 执行 --version 验证（二进制保留在缓存中供 /tooltest 复用，TTL 到点自动删除）
            try:
                p = subprocess.run([bin_path, "--version"], capture_output=True, text=True,
                                   timeout=60, stdin=subprocess.DEVNULL)
                out = ((p.stdout or "") + (p.stderr or "")).strip()
                code = p.returncode
            except Exception as e:
                out, code = str(e), -1
            self._send_json(200, {"ok": code == 0, "platform": plat, "asset": asset_name or "(缓存复用)",
                                  "bin": os.path.basename(bin_path), "bin_path": bin_path,
                                  "code": code, "output": out})
        except Exception as e:
            self._send_json(200, {"ok": False, "error": str(e), "platform": plat})

    @staticmethod
    def _find_codex():
        p = shutil.which("codex")
        if p:
            return p
        for c in ("/opt/homebrew/bin/codex", "/usr/local/bin/codex",
                  os.path.expanduser("~/.codex/bin/codex")):
            if os.path.isfile(c) and os.access(c, os.X_OK):
                return c
        return None

    def _do_tooltest(self):
        """工具端到端测试：{base_url, model, api_key, prompt?, repo?, tag?, ver?, proxy?}
        优先使用页面所选版本的 codex 二进制（与「下载并验证」同一套下载逻辑，带 TTL 缓存），
        未提供版本时回退本机 codex。写临时配置目录（完整网关路径 + 模型名，wire_api=responses），
        运行 codex exec <prompt> → 回传输出 → 删除临时配置目录。
        """
        req = self._read_body()
        if req is None: return
        base = (req.get("base_url") or "").strip().rstrip("/")
        model = (req.get("model") or "").strip()
        key = req.get("api_key") or ""
        prompt = (req.get("prompt") or "请只回复一个词：SPEC_TEXT_OK").strip()
        repo = (req.get("repo") or "openai/codex").strip()
        tag = (req.get("tag") or "").strip()
        ver = (req.get("ver") or tag.replace("rust-v", "")).strip()
        proxy = req.get("proxy")
        if not base or not model:
            self._send_json(400, {"error": "需要 base_url 与 model"}); return
        codex = None; codex_label = None
        if tag:
            codex, _, err = _download_codex_bin(repo, tag, ver, proxy)
            if not codex:
                self._send_json(200, {"ok": False, "error": "获取指定版本 codex 失败：" + (err or "")}); return
            codex_label = os.path.basename(codex) + "（页面所选版本）"
        else:
            codex = self._find_codex()
            codex_label = codex
        if not codex:
            self._send_json(200, {"ok": False, "error": "未找到本机 codex（请先安装：npm i -g @openai/codex 或 brew install codex）"}); return
        d = None
        try:
            d = tempfile.mkdtemp(prefix="codex-tooltest-")
            with open(os.path.join(d, "config.toml"), "w", encoding="utf-8") as f:
                f.write('model = "%s"\nmodel_provider = "starflow"\n\n'
                        '[model_providers.starflow]\nname = "星流聚合网关"\n'
                        'base_url = "%s"\nwire_api = "responses"\nenv_key = "STARFLOW_API_KEY"\n'
                        % (model, base))
            env = dict(os.environ)
            env["STARFLOW_API_KEY"] = key
            env["CODEX_HOME"] = d
            try:
                p = subprocess.run([codex, "exec", "--skip-git-repo-check", prompt],
                                   capture_output=True, text=True, timeout=180, env=env, cwd=d,
                                   stdin=subprocess.DEVNULL)  # codex 会读 stdin，必须关掉否则挂起
                out = ((p.stdout or "") + (p.stderr or "")).strip()
                code = p.returncode
            except subprocess.TimeoutExpired:
                out, code = "超时（180s）", -1
            self._send_json(200, {"ok": code == 0 and bool(out), "codex": codex_label, "model": model,
                                  "base_url": base, "code": code, "output": out})
        except Exception as e:
            self._send_json(200, {"ok": False, "error": str(e)})
        finally:
            if d:
                shutil.rmtree(d, ignore_errors=True)

    def _do_cfg(self):
        """写入工具接入配置：{content, env?, path?, ttl?}
        - path 指定（如 /tmp/mytest）：写 path/config.toml 与 path/env.sh，不自动删除
        - path 留空：写入系统临时目录（mkdtemp），ttl 秒（默认 600）后线程自动删除
        """
        req = self._read_body()
        if req is None: return
        content = req.get("content") or ""
        env = req.get("env") or ""
        target = (req.get("path") or "").strip()
        try:
            ttl = max(30, int(req.get("ttl") or 600))
        except Exception:
            ttl = 600
        if not content:
            self._send_json(400, {"error": "no content"}); return
        try:
            if target:
                d = os.path.abspath(os.path.expanduser(target))
                os.makedirs(d, exist_ok=True)
                tmp = False
            else:
                d = tempfile.mkdtemp(prefix="codex-cfg-")
                tmp = True
            p = os.path.join(d, "config.toml")
            with open(p, "w", encoding="utf-8") as f:
                f.write(content)
            if env:
                with open(os.path.join(d, "env.sh"), "w", encoding="utf-8") as f:
                    f.write(env)
            if tmp:
                def _rm():
                    time.sleep(ttl)
                    shutil.rmtree(d, ignore_errors=True)
                threading.Thread(target=_rm, daemon=True).start()
            self._send_json(200, {"ok": True, "dir": d, "file": p, "temp": tmp, "ttl": ttl})
        except Exception as e:
            self._send_json(200, {"ok": False, "error": str(e)})

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        if path == "/cfg":
            self._do_cfg(); return
        if path == "/tool":
            self._do_tool(); return
        if path == "/tooltest":
            self._do_tooltest(); return
        if path == "/dljob":
            self._do_dljob(); return
        if path != "/proxy":
            self.send_response(404); self._cors(); self.end_headers(); return
        n = int(self.headers.get("Content-Length", 0) or 0)
        raw = self.rfile.read(n) if n else b""
        try:
            req = json.loads(raw.decode("utf-8") or "{}")
        except Exception as e:
            self._send_json(400, {"error": "bad json: %s" % e}); return
        url = req.get("url")
        method = (req.get("method") or "POST").upper()
        headers = req.get("headers") or {}
        body = req.get("body")
        proxy = req.get("proxy")  # 可选：4 层上游 HTTP 代理，如 http://10.0.0.1:8080
        if not url:
            self._send_json(400, {"error": "no url"}); return
        try:
            data = body.encode("utf-8") if isinstance(body, str) else (None if body is None else json.dumps(body).encode())
            r = urllib.request.Request(url, data=data, method=method)
            for k, v in headers.items():
                r.add_header(k, v)
            if not any(k.lower() == "user-agent" for k in headers):
                r.add_header("User-Agent", "starflow-verify/1.0 (local-proxy)")
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            if proxy:
                opener = urllib.request.build_opener(
                    urllib.request.ProxyHandler({"http": proxy, "https": proxy}),
                    urllib.request.HTTPSHandler(context=ctx),
                )
                resp = opener.open(r, timeout=TIMEOUT)
            else:
                resp = urllib.request.urlopen(r, timeout=TIMEOUT, context=ctx)
            with resp:
                status = resp.status
                rheaders = {k: v for k, v in resp.headers.items()}
                rbody = resp.read().decode("utf-8", "replace")
            self._send_json(200, {"ok": 200 <= status < 300, "status": status, "body": rbody, "headers": rheaders})
        except urllib.error.HTTPError as e:
            try:
                rbody = e.read().decode("utf-8", "replace")
            except Exception:
                rbody = str(e)
            self._send_json(200, {"ok": False, "status": e.code, "body": rbody, "headers": dict(e.headers.items()) if e.headers else {}})
        except Exception as e:
            self._send_json(200, {"ok": False, "status": 0, "body": "代理转发失败: %s" % e, "headers": {}})

if __name__ == "__main__":
    ThreadingHTTPServer.allow_reuse_address = True
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print("星流验收工具本地代理+静态服务已启动: http://127.0.0.1:%d/  (默认页 %s, Ctrl+C 退出)" % (PORT, default_page()))
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n已退出。")
