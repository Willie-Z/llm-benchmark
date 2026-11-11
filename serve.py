#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
星流 LLM 验收工具 · 本地代理 + 静态服务
- GET /healthz  →  存活探测 {ok:true}（浏览器插件与 popup 用它判断本地后端是否在跑）
- GET /  →  默认返回 index.html，没有则回退 multitool.html（同源，浏览器无跨域问题）
- GET /<file>  →  返回静态文件（extension/pages/——
  多工具页与 LLM 验收页，本服务同时托管以便不开扩展时使用）
- POST /proxy  {url, method, headers, body, proxy}  →  转发到真实 LLM Endpoint，返回 {ok,status,body,headers}
  浏览器直连 LLM Endpoint 常被 CORS 拦截；经本机代理转发即可绕开。
  Key 仅在本机内存中转发，不落盘、不记日志。
  可选字段 proxy：上游 HTTP 代理（4 层，如 http://10.0.0.1:8080，gost/shadowsocks 搭建），
  传入后本机经该代理转发目标请求（用于境内访问 GitHub 等）；不传则直连。
- POST /tooltest  {base_url, model, api_key, prompt?, repo?, tag?, ver?, proxy?}  →  拉起 codex（优先页面所选版本）端到端测试
- POST /cfg  {content, env?, path?, ttl?}  →  写入工具接入配置 config.toml（可选 env.sh）
  path 指定（如 /tmp/mytest）则写到该目录；path 留空写系统临时目录并在 ttl 秒（默认 600）后自动删除。
用法（在本文件所在目录运行）：
    python serve.py
  然后浏览器开 http://127.0.0.1:8000/   （会自动打开 multitool.html）
  分发为单文件二进制（免装 Python）：sh build.sh  →  dist/starflow-backend
"""
import os, sys, json, ssl, time, shutil, tempfile, threading, platform, subprocess, tarfile, zipfile, urllib.request, urllib.error, urllib.parse
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

# Windows 控制台默认 cp1252，编码不了中文会崩溃（PyInstaller 打包后无 PYTHONIOENCODING），强制 UTF-8
for _s in ( sys.stdout, sys.stderr ):
    try:
        _s.reconfigure( encoding = "utf-8", errors = "replace" )
    except Exception:
        pass


def _static_dirs():
    """静态查找目录：extension/pages/（两个主页面）。
    PyInstaller 冻结后静态资源解压到 sys._MEIPASS，同时兼容可执行文件旁的
    dist/starflow-backend 场景；页面已随二进制打包，安装包不依赖仓库目录。"""
    bases = []
    if getattr( sys, "frozen", False ):
        meipass = getattr( sys, "_MEIPASS", None )
        if meipass:
            bases.append( os.path.abspath( meipass ) )
        exe_dir = os.path.dirname( os.path.abspath( sys.executable ) )
        bases.extend( [exe_dir, os.path.dirname( exe_dir )] )
    else:
        bases.append( os.path.dirname( os.path.abspath( __file__ ) ) )
    
    candidates = []
    for base in bases:
        for d in (
                base,
                os.path.join( base, "extension", "pages" ),
                os.path.normpath( os.path.join( base, os.pardir, "extension", "pages" ) ),
        ):
            if d not in candidates:
                candidates.append( d )
    return candidates


ROOT = os.path.dirname( os.path.abspath( __file__ ) ) if not getattr( sys, "frozen", False ) \
    else os.path.dirname( os.path.abspath( sys.executable ) )
STATIC_DIRS = _static_dirs( )
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
            if os.path.isfile( os.path.join( d, name ) ):
                return "/" + name
    return "/index.html"


# ============ codex 二进制下载 / 缓存（供 /tool 与 /tooltest 共用） ============
_CODEX_BIN_CACHE = { }  # key -> {"dir","path"}，进程内复用，不设过期（长测试不会中途被清场）
_CODEX_BIN_LOCK = threading.Lock( )


def _open_url( url, proxy=None, timeout=60 ):
    r = urllib.request.Request( url, headers={ "User-Agent": "starflow-verify/1.0 (local-proxy)" } )
    ctx = ssl.create_default_context( )
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    if proxy:
        opener = urllib.request.build_opener(
            urllib.request.ProxyHandler( { "http": proxy, "https": proxy } ),
            urllib.request.HTTPSHandler( context=ctx )
        )
        return opener.open( r, timeout=timeout )
    return urllib.request.urlopen( r, timeout=timeout, context=ctx )


def _platform_triple():
    m = platform.machine( ).lower( )
    arch = "aarch64" if m in ("arm64", "aarch64") else "x86_64"
    if sys.platform == "darwin": return arch + "-apple-darwin"
    if sys.platform.startswith( "linux" ): return arch + "-unknown-linux-musl"
    if sys.platform.startswith( "win" ): return arch + "-pc-windows-msvc"
    return None


def _resolve_codex_asset( repo, tag, plat, proxy ):
    """解析 Release 资产：优先直拼确定性 URL（不耗 API 限额），404 再回退资产清单。返回 (asset_name, dl_url, err)"""
    exe_sfx = ".exe" if plat.endswith( "windows-msvc" ) else ""
    base = "https://github.com/%s/releases/download/%s/" % (repo, tag)
    api_err = None
    for name in ("codex-%s%s.tar.gz" % (plat, exe_sfx), "codex-%s%s.zip" % (plat, exe_sfx)):
        try:
            with _open_url( base + name, proxy, 30 ) as resp:
                if resp.status == 200: return name, base + name, None
        except urllib.error.HTTPError as e:
            if e.code == 404: continue
            api_err = "HTTP %s" % e.code
            break
        except Exception as e:
            api_err = str( e )
            break
    rel = None
    try:
        with _open_url( "https://api.github.com/repos/%s/releases/tags/%s" % (repo, tag), proxy, 60 ) as resp:
            rel = json.loads( resp.read( ).decode( "utf-8", "replace" ) )
    except urllib.error.HTTPError as e:
        try:
            rel = json.loads( e.read( ).decode( "utf-8", "replace" ) )
        except Exception:
            rel = { "message": "HTTP %s" % e.code }
    except Exception as e:
        rel = { "message": str( e ) }
    assets = (rel or { }).get( "assets" ) or []
    skip = (
        "app-server", "symbols", "package", "responses-api-proxy", "code-mode",
        "command-runner", "sandbox", "provisioned", "npm", "whl", "sigstore"
    )
    cands = [a for a in assets if a.get( "name", "" ).startswith( "codex-" )
             and plat in a.get( "name", "" ) and "-bazel" not in a.get( "name", "" )
             and not any( k in a.get( "name", "" ) for k in skip )]
    for suf in (".tar.gz", ".zip"):
        a = next( (a for a in cands if a.get( "name", "" ).endswith( suf )), None )
        if a: return a["name"], a["browser_download_url"], None
    msg = (rel or { }).get( "message" ) if isinstance( rel, dict ) else None
    hint = "（GitHub API 限流？请勾选代理重试）" if (msg and "rate limit" in msg) else ""
    return None, None, "未能解析下载地址" + (("：" + msg) if msg else "") + (api_err or "") + hint


def _codex_cache_get( key ):
    with _CODEX_BIN_LOCK:
        e = _CODEX_BIN_CACHE.get( key )
        if e and os.path.isfile( e["path"] ):
            return e["path"]
        if e:
            _CODEX_BIN_CACHE.pop( key, None )  # 文件被外部清理时丢弃记录
    return None


def _codex_cache_put( key, path ):
    # 同 key 重新下载（如页面重试）时替换旧目录；不做定时删除，二进制保留到进程/系统清理
    with _CODEX_BIN_LOCK:
        old = _CODEX_BIN_CACHE.pop( key, None )
        if old: shutil.rmtree( old["dir"], ignore_errors=True )
        _CODEX_BIN_CACHE[key] = { "dir": os.path.dirname( path ), "path": path }


def _download_codex_bin( repo, tag, ver, proxy, prog=None ):
    """下载指定版本 codex 二进制（带缓存）。prog 为可选进度 dict（received/total）。返回 (bin_path, asset_name, err)"""
    plat = _platform_triple( )
    if not plat: return None, None, "不支持的平台: %s" % sys.platform
    tag = tag if tag.startswith( "rust-v" ) else "rust-v" + tag
    key = "%s#%s#%s" % (repo, tag, plat)
    hit = _codex_cache_get( key )
    if hit: return hit, None, None
    asset_name, dl_url, err = _resolve_codex_asset( repo, tag, plat, proxy )
    if not asset_name: return None, None, err
    d = tempfile.mkdtemp( prefix="codex-bin-" )
    try:
        arc = os.path.join( d, asset_name )
        with _open_url( dl_url, proxy, 600 ) as resp, open( arc, "wb" ) as f:
            if prog is not None:
                try:
                    prog["total"] = int( resp.headers.get( "Content-Length" ) or 0 )
                except Exception:
                    prog["total"] = 0
                prog["received"] = 0
            while True:
                chunk = resp.read( 1 << 20 )
                if not chunk: break
                f.write( chunk )
                if prog is not None: prog["received"] += len( chunk )
        if arc.endswith( ".tar.gz" ):
            with tarfile.open( arc, "r:gz" ) as tf:
                tf.extractall( d )
        else:
            with zipfile.ZipFile( arc ) as zf:
                zf.extractall( d )
        exe_sfx = ".exe" if plat.endswith( "windows-msvc" ) else ""
        exe = "codex.exe" if exe_sfx else "codex"
        bin_path = None
        for want in (exe, "codex-" + plat + exe_sfx):
            for root, _, files in os.walk( d ):
                if want in files: bin_path = os.path.join( root, want ) ; break
            if bin_path: break
        if not bin_path:
            shutil.rmtree( d, ignore_errors=True )
            return None, asset_name, "解压后未找到 %s" % exe
        renamed = os.path.join( d, "codex-" + ver + (".exe" if exe_sfx else "") )
        os.rename( bin_path, renamed )
        os.chmod( renamed, 0o755 )
        _codex_cache_put( key, renamed )
        return renamed, asset_name, None
    except Exception as e:
        shutil.rmtree( d, ignore_errors=True )
        return None, asset_name, str( e )


def _claude_plat():
    """Claude 资产平台串（与官方 install.sh 一致）：darwin/linux/win32 + x64/arm64，Linux 可带 -musl"""
    m = platform.machine( ).lower( )
    arch = "arm64" if m in ("arm64", "aarch64") else "x64"
    if sys.platform == "darwin":
        return "darwin-" + arch
    if sys.platform.startswith( "win" ):
        return "win32-" + arch
    if sys.platform.startswith( "linux" ):
        musl = os.path.exists( "/lib/libc.musl-x86_64.so.1" ) or os.path.exists( "/lib/libc.musl-aarch64.so.1" )
        if not musl:
            try:
                musl = "musl" in (subprocess.run( ["ldd", "/bin/ls"], capture_output=True, text=True ).stderr or "")
            except Exception:
                pass
        return "linux-" + arch + ("-musl" if musl else "")
    return None


def _resolve_claude_asset( repo, tag, plat, proxy ):
    """解析 Claude Release 资产：优先直拼 claude-<plat>.tar.gz/.zip，404 回退资产清单。返回 (asset_name, dl_url, err)"""
    base = "https://github.com/%s/releases/download/%s/" % (repo, tag)
    names = ("claude-%s.zip" % plat,) if plat.startswith( "win32" ) else ("claude-%s.tar.gz" % plat,)
    api_err = None
    for name in names:
        try:
            with _open_url( base + name, proxy, 30 ) as resp:
                if resp.status == 200: return name, base + name, None
        except urllib.error.HTTPError as e:
            if e.code == 404: continue
            api_err = "HTTP %s" % e.code
            break
        except Exception as e:
            api_err = str( e )
            break
    rel = None
    try:
        with _open_url( "https://api.github.com/repos/%s/releases/tags/%s" % (repo, tag), proxy, 60 ) as resp:
            rel = json.loads( resp.read( ).decode( "utf-8", "replace" ) )
    except urllib.error.HTTPError as e:
        try:
            rel = json.loads( e.read( ).decode( "utf-8", "replace" ) )
        except Exception:
            rel = { "message": "HTTP %s" % e.code }
    except Exception as e:
        rel = { "message": str( e ) }
    assets = (rel or { }).get( "assets" ) or []
    cands = [a for a in assets if a.get( "name", "" ).startswith( "claude-" + plat )]
    for suf in (".tar.gz", ".zip"):
        a = next( (a for a in cands if a.get( "name", "" ).endswith( suf )), None )
        if a: return a["name"], a["browser_download_url"], None
    msg = (rel or { }).get( "message" ) if isinstance( rel, dict ) else None
    hint = "（GitHub API 限流？请勾选代理重试）" if (msg and "rate limit" in msg) else ""
    return None, None, "未能解析下载地址" + (("：" + msg) if msg else "") + (api_err or "") + hint


def _download_claude_bin( repo, tag, ver, proxy, prog=None ):
    """下载指定版本 Claude Code 二进制（带缓存）。tag 自动补 v 前缀（v2.1.317）。返回 (bin_path, asset_name, err)"""
    plat = _claude_plat( )
    if not plat: return None, None, "不支持的平台: %s" % sys.platform
    tag = tag if tag.startswith( "v" ) else "v" + tag
    key = "claude#%s#%s#%s" % (repo, tag, plat)
    hit = _codex_cache_get( key )
    if hit: return hit, None, None
    asset_name, dl_url, err = _resolve_claude_asset( repo, tag, plat, proxy )
    if not asset_name: return None, None, err
    d = tempfile.mkdtemp( prefix="claude-bin-" )
    try:
        arc = os.path.join( d, asset_name )
        with _open_url( dl_url, proxy, 600 ) as resp, open( arc, "wb" ) as f:
            if prog is not None:
                try:
                    prog["total"] = int( resp.headers.get( "Content-Length" ) or 0 )
                except Exception:
                    prog["total"] = 0
                prog["received"] = 0
            while True:
                chunk = resp.read( 1 << 20 )
                if not chunk: break
                f.write( chunk )
                if prog is not None: prog["received"] += len( chunk )
        if arc.endswith( ".tar.gz" ):
            with tarfile.open( arc, "r:gz" ) as tf:
                tf.extractall( d )
        else:
            with zipfile.ZipFile( arc ) as zf:
                zf.extractall( d )
        exe_sfx = ".exe" if plat.startswith( "win32" ) else ""
        exe = "claude.exe" if exe_sfx else "claude"
        bin_path = None
        for want in (exe,):
            for root, _, files in os.walk( d ):
                if want in files: bin_path = os.path.join( root, want ) ; break
            if bin_path: break
        if not bin_path:
            shutil.rmtree( d, ignore_errors=True )
            return None, asset_name, "解压后未找到 %s" % exe
        renamed = os.path.join( d, "claude-" + ver + exe_sfx )
        os.rename( bin_path, renamed )
        os.chmod( renamed, 0o755 )
        _codex_cache_put( key, renamed )
        return renamed, asset_name, None
    except Exception as e:
        shutil.rmtree( d, ignore_errors=True )
        return None, asset_name, str( e )


def _download_tool_bin( kind, repo, tag, ver, proxy, prog=None ):
    """按工具类型分发下载：claude-code → GitHub claude-<plat> 资产；其余 → codex rust 三段资产"""
    if kind == "claude-code":
        return _download_claude_bin( repo, tag, ver, proxy, prog=prog )
    return _download_codex_bin( repo, tag, ver, proxy, prog=prog )


# ============ 数据集压测（快照多轮脚本 → 并发拉起 codex/claude 执行） ============
_DS_JOBS = { }
_DS_JOBS_LOCK = threading.Lock( )


def _ds_summary( results ):
    """汇总：成功率 + 成功耗时 P50/P95 + 失败原因分类"""
    total = len( results )
    ok = sum( 1 for r in results if r.get( "ok" ) )
    el = sorted( r.get( "elapsed", 0 ) for r in results if r.get( "ok" ) )
    
    def pct( p ):
        return round( el[min( len( el ) - 1, int( len( el ) * p ) )], 2 ) if el else 0
    
    errs = { }
    for r in results:
        if not r.get( "ok" ):
            e = str( r.get( "error" ) or "未知" )
            k = ("超时" if "超时" in e else "空输出" if "空输出" in e
            else "哨兵不符" if "哨兵" in e else "执行失败")
            errs[k] = errs.get( k, 0 ) + 1
    return {
        "total": total, "ok": ok, "rate": round( ok / total, 3 ) if total else 0,
        "p50":   pct( 0.5 ), "p95": pct( 0.95 ), "errors": errs
    }


def _err_tail( p ):
    """合并 stderr/stdout 去掉启动横幅/噪声行后取尾部：错误信息（ERROR:/API 报错）在
    codex/claude 输出末尾，旧实现取头部 120 字符只会截到启动横幅，真正的报错看不到"""
    raw = ((getattr( p, "stderr", None ) or "") + "\n" + (getattr( p, "stdout", None ) or "")).strip( )
    noise = (
        "reading prompt from stdin", "openai codex", "-----", "workdir:", "model:",
        "provider:", "approval:", "sandbox:", "reasoning effort:", "reasoning summaries:",
        "session id:", "warning: model metadata", "claude cli"
    )
    lines = [l.strip( ) for l in raw.splitlines( )
             if l.strip( ) and not l.strip( ).lower( ).startswith( noise )]
    text = " / ".join( lines ) or raw
    return text[-400:]


def _ds_run_case( kind, tool, base, model, key, case, rep, timeout, on_round=None ):
    """执行一条用例（多轮顺序跑完）。codex 走 exec/exec resume --last（CODEX_HOME 隔离），
    claude 走 -p/--resume（session_id 从 --output-format json 取，缺失则拼前文降级）。
    on_round 每轮结束（含超时中断的补齐）回调一次，供进度按轮上报。"""
    t0 = time.time( )
    rounds_out = []
    ok_all = True
    err = None
    sent = (case.get( "sentinel" ) or "").strip( )
    rounds = case.get( "rounds" ) or []
    fired = 0
    d = tempfile.mkdtemp( prefix="dsrun-" )
    try:
        env = dict( os.environ )
        session_id = None
        transcript = ""
        if kind == "claude-code":
            env["ANTHROPIC_BASE_URL"] = base[:-3] if base.endswith( "/v1" ) else base
            env["ANTHROPIC_AUTH_TOKEN"] = key
            env["ANTHROPIC_API_KEY"] = key
            env["CLAUDE_CODE_DISABLE_AUTOUPDATER"] = "1"
        else:
            with open( os.path.join( d, "config.toml" ), "w", encoding="utf-8" ) as f:
                f.write(
                    'model = "%s"\nmodel_provider = "starflow"\n\n'
                    '[model_providers.starflow]\nname = "星流聚合网关"\n'
                    'base_url = "%s"\nwire_api = "responses"\nenv_key = "STARFLOW_API_KEY"\n'
                    % (model, base)
                    )
            env["STARFLOW_API_KEY"] = key
            env["CODEX_HOME"] = d
        for ri, prompt in enumerate( rounds ):
            r0 = time.time( )
            out = ""
            round_err = None
            try:
                if kind == "claude-code":
                    cmd = [tool, "-p", "--output-format", "json"]
                    send = prompt
                    if ri > 0:
                        if session_id:
                            cmd += ["--resume", session_id]
                        else:
                            send = "【前文】\n" + transcript[-4000:] + "\n\n【本轮】\n" + prompt
                    p = subprocess.run(
                        cmd, input=send, capture_output=True, text=True,
                        timeout=timeout, env=env, cwd=d
                        )
                    try:
                        j = json.loads( p.stdout or "{}" )
                    except Exception:
                        j = { }
                    session_id = j.get( "session_id" ) or session_id
                    out = (j.get( "result" ) or p.stdout or "").strip( )
                else:
                    out_file = os.path.join( d, "out_%d.txt" % ri )
                    cmd = ([tool, "exec", "--skip-git-repo-check", "-o", out_file] if ri == 0
                           else [tool, "exec", "resume", "--last", "--skip-git-repo-check", "-o", out_file])
                    p = subprocess.run(
                        cmd, input=prompt, capture_output=True, text=True,
                        timeout=timeout, env=env, cwd=d
                        )
                    try:
                        out = open( out_file, encoding="utf-8" ).read( ).strip( )
                    except Exception:
                        out = ""
                if p.returncode != 0:
                    ok_all = False
                    round_err = err = "执行失败 exit %s %s" % (p.returncode, _err_tail( p ))
                elif not out:
                    ok_all = False
                    tail = _err_tail( p )
                    round_err = err = "空输出" + (("：" + tail) if tail else "")
                elif sent and sent not in out:
                    ok_all = False
                    round_err = err = "哨兵不符"
                rounds_out.append(
                    {
                        "ok":      round_err is None,
                        "elapsed": round( time.time( ) - r0, 2 ),
                        "output":  out[:200], "error": round_err
                    }
                    )
                transcript += "\n" + out
            except subprocess.TimeoutExpired:
                ok_all = False
                round_err = err = "超时(>%.0fs)" % timeout
                rounds_out.append( { "ok": False, "elapsed": timeout, "output": "", "error": round_err } )
                fired += 1
                if on_round: on_round( )
                break  # 多轮脚本轮次超时即中断
            fired += 1
            if on_round: on_round( )
        # 超时提前中断时补齐剩余轮次的进度计数，避免 done 永远落后 total
        if on_round:
            for _ in range( len( rounds ) - fired ):
                on_round( )
    finally:
        shutil.rmtree( d, ignore_errors=True )
    return {
        "case":    case.get( "id" ) or "case", "rep": rep, "ok": ok_all,
        "elapsed": round( time.time( ) - t0, 2 ), "error": err, "rounds": rounds_out
    }


_DL_JOBS = { }
_DL_JOBS_LOCK = threading.Lock( )

# ============ 清理缓存（工具二进制缓存 + 任务记录 + 测试临时目录） ============
_BUSY_LOCK = threading.Lock( )
_TOOLTEST_RUNNING = [0]  # /tooltest 进行中计数（无 job 表，清理时据此拒绝）
_TMP_PREFIXES = ("codex-bin-", "claude-bin-", "dsrun-", "tooltest-", "codex-cfg-")


def _dir_size( path ):
    total = 0
    for root, _, files in os.walk( path ):
        for f in files:
            try:
                total += os.path.getsize( os.path.join( root, f ) )
            except OSError:
                pass
    return total


class Handler( BaseHTTPRequestHandler ):
    def log_message( self, *a ):
        pass  # 静默
    
    def _cors( self ):
        self.send_header( "Access-Control-Allow-Origin", "*" )
        self.send_header( "Access-Control-Allow-Methods", "GET, POST, OPTIONS" )
        self.send_header( "Access-Control-Allow-Headers", "Content-Type, Authorization" )
    
    def _send_json( self, code, obj ):
        data = json.dumps( obj, ensure_ascii=False ).encode( "utf-8" )
        self.send_response( code )
        self._cors( )
        self.send_header( "Content-Type", "application/json; charset=utf-8" )
        self.send_header( "Content-Length", str( len( data ) ) )
        self.end_headers( )
        self.wfile.write( data )
    
    def do_OPTIONS( self ):
        self.send_response( 204 )
        self._cors( )
        self.end_headers( )
    
    def _do_dljob( self ):
        """POST 启动后台下载任务（同 key 复用）；GET ?id= 轮询进度 {status,received,total,bin,error}"""
        if self.command == "POST":
            req = self._read_body( )
            if req is None: return
            repo = (req.get( "repo" ) or "openai/codex").strip( )
            kind = (req.get( "kind" ) or "codex").strip( )
            tag = (req.get( "tag" ) or "").strip( )
            ver = (req.get( "ver" ) or tag.replace( "rust-v", "" ).lstrip( "v" )).strip( )
            proxy = req.get( "proxy" )
            if not tag:
                self._send_json( 400, { "error": "no tag" } )
                return
            jid = "%s#%s#%s#%s" % (kind, repo, tag, _claude_plat( ) if kind == "claude-code" else _platform_triple( ))
            with _DL_JOBS_LOCK:
                st = _DL_JOBS.get( jid )
                if st and st.get( "status" ) == "running":
                    self._send_json( 200, { "ok": True, "id": jid, "already": True } )
                    return
                prog = { "received": 0, "total": 0 }
                _DL_JOBS[jid] = { "status": "running", "prog": prog }
            
            def run():
                try:
                    bin_path, asset, err = _download_tool_bin( kind, repo, tag, ver, proxy, prog=prog )
                    with _DL_JOBS_LOCK:
                        if bin_path:
                            _DL_JOBS[jid] = { "status": "done", "bin": os.path.basename( bin_path ), "bin_path": bin_path }
                        else:
                            _DL_JOBS[jid] = { "status": "error", "error": err or "下载失败" }
                except Exception as e:
                    with _DL_JOBS_LOCK:
                        _DL_JOBS[jid] = { "status": "error", "error": str( e ) }
            
            threading.Thread( target=run, daemon=True ).start( )
            self._send_json( 200, { "ok": True, "id": jid } )
        else:
            qs = urllib.parse.parse_qs( self.path.split( "?", 1 )[1] if "?" in self.path else "" )
            jid = (qs.get( "id" ) or [""])[0]
            with _DL_JOBS_LOCK:
                st = dict( _DL_JOBS.get( jid ) or { } )
            if not st:
                self._send_json( 200, { "ok": False, "error": "no such job" } )
                return
            prog = st.pop( "prog", None ) or { }
            self._send_json(
                200, {
                    "ok":       True, "status": st.get( "status" ),
                    "received": prog.get( "received", 0 ), "total": prog.get( "total", 0 ),
                    "bin":      st.get( "bin" ), "error": st.get( "error" )
                }
                )
    
    def do_GET( self ):
        path = self.path.split( "?", 1 )[0]
        if path == "/healthz":
            self._send_json( 200, { "ok": True, "service": "starflow-backend" } )
            return
        if path == "/dljob":
            self._do_dljob( )
            return
        if path == "/datasetrun":
            self._do_datasetrun( )
            return
        if path == "/":
            path = default_page( )
        # 旧文件名兼容映射（两个主页面已迁 extension/pages/，老链接不断）
        LEGACY_NAMES = {
            "prototype-multitool.html": "multitool.html",
            "prototype-llmabacus.html": "llmabacus.html",
        }
        rel = LEGACY_NAMES.get( path.lstrip( "/" ), path.lstrip( "/" ) )
        # 防目录穿越 + 目录查找（extension/pages/）
        safe = None
        for d in STATIC_DIRS:
            cand = os.path.normpath( os.path.join( d, rel ) )
            if (cand == d or cand.startswith( d + os.sep )) and os.path.isfile( cand ):
                safe = cand
                break
        if not safe:
            self.send_response( 404 )
            self._cors( )
            self.end_headers( )
            return
        ext = os.path.splitext( safe )[1].lower( )
        ctype = CTYPES.get( ext, "application/octet-stream" )
        with open( safe, "rb" ) as f:
            data = f.read( )
        self.send_response( 200 )
        self._cors( )
        self.send_header( "Content-Type", ctype )
        self.send_header( "Cache-Control", "no-store" )  # 原型页频繁改动，禁用浏览器缓存避免旧 JS
        self.send_header( "Content-Length", str( len( data ) ) )
        self.end_headers( )
        self.wfile.write( data )
    
    def _read_body( self ):
        n = int( self.headers.get( "Content-Length", 0 ) or 0 )
        raw = self.rfile.read( n ) if n else b""
        try:
            return json.loads( raw.decode( "utf-8" ) or "{}" )
        except Exception as e:
            self._send_json( 400, { "error": "bad json: %s" % e } )
            return None
    
    _platform_triple = staticmethod( _platform_triple )
    _open_url = staticmethod( _open_url )
    
    def _do_tool( self ):
        """下载并验证工具二进制：{kind?, repo?, tag?, ver?, proxy?}
        平台自动识别 → 拉 Release 资产清单 → 选适配资产下载到临时目录 →
        解压并重命名为 <工具>-<ver> → 执行 --version 验证 → 无论成败立即删除临时目录。
        """
        req = self._read_body( )
        if req is None: return
        kind = (req.get( "kind" ) or "codex").strip( )
        repo = (req.get( "repo" ) or "openai/codex").strip( )
        tag = (req.get( "tag" ) or "").strip( )  # 纯版本号或完整 tag（codex: rust-v0.164.0 / claude: v2.1.317）
        ver = (req.get( "ver" ) or tag.replace( "rust-v", "" ).lstrip( "v" )).strip( )
        proxy = req.get( "proxy" )
        if not tag:
            self._send_json( 400, { "error": "no tag" } )
            return
        plat = _claude_plat( ) if kind == "claude-code" else self._platform_triple( )
        if not plat:
            self._send_json( 200, { "ok": False, "error": "不支持的平台: %s" % sys.platform } )
            return
        try:
            bin_path, asset_name, err = _download_tool_bin( kind, repo, tag, ver, proxy )
            if not bin_path:
                self._send_json( 200, { "ok": False, "error": err or "下载失败", "platform": plat } )
                return
            # 执行 --version 验证（二进制保留在缓存中供 /tooltest 复用，不自动删除）
            try:
                p = subprocess.run(
                    [bin_path, "--version"], capture_output=True, text=True,
                    timeout=60, stdin=subprocess.DEVNULL
                    )
                out = ((p.stdout or "") + (p.stderr or "")).strip( )
                code = p.returncode
            except Exception as e:
                out, code = str( e ), -1
            self._send_json(
                200, {
                    "ok":   code == 0, "platform": plat, "asset": asset_name or "(缓存复用)",
                    "bin":  os.path.basename( bin_path ), "bin_path": bin_path,
                    "code": code, "output": out
                }
                )
        except Exception as e:
            self._send_json( 200, { "ok": False, "error": str( e ), "platform": plat } )
    
    @staticmethod
    def _find_codex():
        p = shutil.which( "codex" )
        if p:
            return p
        for c in (
                "/opt/homebrew/bin/codex", "/usr/local/bin/codex",
                os.path.expanduser( "~/.codex/bin/codex" )
        ):
            if os.path.isfile( c ) and os.access( c, os.X_OK ):
                return c
        return None
    
    @staticmethod
    def _find_claude():
        p = shutil.which( "claude" )
        if p:
            return p
        for c in (
                "/opt/homebrew/bin/claude", "/usr/local/bin/claude",
                os.path.expanduser( "~/.local/bin/claude" ),
                os.path.expanduser( "~/.claude/local/claude" )
        ):
            if os.path.isfile( c ) and os.access( c, os.X_OK ):
                return c
        return None
    
    def _do_tooltest( self ):
        """工具端到端测试：{kind?, base_url, model, api_key, prompt?, repo?, tag?, ver?, proxy?}
        优先使用页面所选版本的工具二进制（与「下载并验证」同一套下载逻辑，带缓存复用），
        未提供版本时回退本机工具。codex：写临时配置目录跑 codex exec；
        claude-code：环境变量注入网关跑 claude -p。→ 回传输出 → 删除临时目录。
        """
        req = self._read_body( )
        if req is None: return
        kind = (req.get( "kind" ) or "codex").strip( )
        base = (req.get( "base_url" ) or "").strip( ).rstrip( "/" )
        model = (req.get( "model" ) or "").strip( )
        key = req.get( "api_key" ) or ""
        prompt = (req.get( "prompt" ) or "请只回复一个词：SPEC_TEXT_OK").strip( )
        repo = (req.get( "repo" ) or "openai/codex").strip( )
        tag = (req.get( "tag" ) or "").strip( )
        ver = (req.get( "ver" ) or tag.replace( "rust-v", "" ).lstrip( "v" )).strip( )
        proxy = req.get( "proxy" )
        if not base or not model:
            self._send_json( 400, { "error": "需要 base_url 与 model" } )
            return
        tool = None
        tool_label = None
        if tag:
            tool, _, err = _download_tool_bin( kind, repo, tag, ver, proxy )
            if not tool:
                self._send_json( 200, { "ok": False, "error": "获取指定版本工具失败：" + (err or "") } )
                return
            tool_label = os.path.basename( tool ) + "（页面所选版本）"
        else:
            tool = self._find_claude( ) if kind == "claude-code" else self._find_codex( )
            tool_label = tool
        if not tool:
            if kind == "claude-code":
                self._send_json( 200, { "ok": False, "error": "未找到本机 claude（请先安装：curl -fsSL https://claude.ai/install.sh | bash）" } )
                return
            self._send_json( 200, { "ok": False, "error": "未找到本机 codex（请先安装：npm i -g @openai/codex 或 brew install codex）" } )
            return
        d = None
        with _BUSY_LOCK:
            _TOOLTEST_RUNNING[0] += 1
        try:
            d = tempfile.mkdtemp( prefix="tooltest-" )
            env = dict( os.environ )
            if kind == "claude-code":
                # Claude Code：ANTHROPIC_BASE_URL 不带 /v1（工具自行拼 /v1/messages）；
                # AUTH_TOKEN(Bearer) 与 API_KEY(x-api-key) 同时注入，兼容两种鉴权头
                env.pop( "CODEX_HOME", None )
                env["ANTHROPIC_BASE_URL"] = base[:-3] if base.endswith( "/v1" ) else base
                env["ANTHROPIC_AUTH_TOKEN"] = key
                env["ANTHROPIC_API_KEY"] = key
                env["CLAUDE_CODE_DISABLE_AUTOUPDATER"] = "1"
                cmd = [tool, "-p", prompt, "--model", model]
            else:
                with open( os.path.join( d, "config.toml" ), "w", encoding="utf-8" ) as f:
                    f.write(
                        'model = "%s"\nmodel_provider = "starflow"\n\n'
                        '[model_providers.starflow]\nname = "星流聚合网关"\n'
                        'base_url = "%s"\nwire_api = "responses"\nenv_key = "STARFLOW_API_KEY"\n'
                        % (model, base)
                        )
                env["STARFLOW_API_KEY"] = key
                env["CODEX_HOME"] = d
                cmd = [tool, "exec", "--skip-git-repo-check", prompt]
            try:
                p = subprocess.run(
                    cmd,
                    capture_output=True, text=True, timeout=180, env=env, cwd=d,
                    stdin=subprocess.DEVNULL
                    )  # 两者都会读 stdin，必须关掉否则挂起
                out = ((p.stdout or "") + (p.stderr or "")).strip( )
                code = p.returncode
            except subprocess.TimeoutExpired:
                out, code = "超时（180s）", -1
            self._send_json(
                200, {
                    "ok":       code == 0 and bool( out ), "tool": tool_label, "model": model,
                    "base_url": base, "code": code, "output": out
                }
                )
        except Exception as e:
            self._send_json( 200, { "ok": False, "error": str( e ) } )
        finally:
            with _BUSY_LOCK:
                _TOOLTEST_RUNNING[0] -= 1
            if d:
                shutil.rmtree( d, ignore_errors=True )
    
    def _do_datasetrun( self ):
        """数据集压测。POST {kind?, repo?, tags?|tag?, ver?, base_url, model, api_key, cases, conc?, repeat?, timeout?, proxy?}
        cases=[{id?, rounds:[prompt,...], sentinel?}]（快照解析出的多轮脚本）；
        tags:[ver,...] 为多版本对比压测（每个版本各跑一遍全部用例），兼容旧字段 tag/ver 单版本；
        并发拉起工具逐用例多轮执行。GET ?id= 轮询 {status,done,total,results,summary,summaries}。"""
        if self.command == "POST":
            req = self._read_body( )
            if req is None: return
            cases = req.get( "cases" ) or []
            base = (req.get( "base_url" ) or "").strip( ).rstrip( "/" )
            model = (req.get( "model" ) or "").strip( )
            if not cases or not base or not model:
                self._send_json( 400, { "error": "需要 cases/base_url/model" } )
                return
            kind = (req.get( "kind" ) or "codex").strip( )
            repo = (req.get( "repo" ) or "openai/codex").strip( )
            # 多版本：tags:[ver,...] 每个勾选版本各跑一遍；兼容旧字段 tag/ver（单版本）与空（本机工具）
            tags_in = req.get( "tags" )
            if isinstance( tags_in, list ) and tags_in:
                vers = [{ "tag": str( v ).strip( ), "ver": str( v ).strip( ) } for v in tags_in if str( v ).strip( )]
            else:
                tag = (req.get( "tag" ) or "").strip( )
                ver = (req.get( "ver" ) or tag.replace( "rust-v", "" ).lstrip( "v" )).strip( )
                vers = [{ "tag": tag, "ver": ver }] if tag else [{ "tag": "", "ver": "" }]
            if not vers:
                self._send_json( 400, { "error": "需要 tags 或 tag" } )
                return
            key = req.get( "api_key" ) or ""
            proxy = req.get( "proxy" )
            
            def to_int( v, d, lo, hi ):
                try:
                    return max( lo, min( hi, int( v ) ) )
                except Exception:
                    return d
            
            conc = to_int( req.get( "conc" ), 2, 1, 8 )
            repeat = to_int( req.get( "repeat" ), 1, 1, 20 )
            timeout = to_int( req.get( "timeout" ), 180, 30, 3600 )
            jid = "ds-%s-%d" % (kind, int( time.time( ) * 1000 ))
            # 进度按「轮」计数：一条用例的全部轮次跑完才 +1 会让进度条几分钟不动；多版本轮数 = 单版本 × 版本数
            total = sum( len( c.get( "rounds" ) or [] ) for c in cases ) * repeat * len( vers )
            with _DS_JOBS_LOCK:
                _DS_JOBS[jid] = {
                    "status":  "running", "done": 0, "total": total,
                    "stage":   "download" if any( v["tag"] for v in vers ) else "run",
                    "results": [], "summary": None, "summaries": { }
                }
            
            def run():
                # 逐版本获取工具二进制（下载带缓存）；某版本失败不阻塞其他版本
                tools = { }
                dl_errs = { }
                for v in vers:
                    vk = v["ver"] or "本机"
                    if v["tag"]:
                        tool, _, err = _download_tool_bin( kind, repo, v["tag"], v["ver"], proxy )
                    else:
                        tool = self._find_claude( ) if kind == "claude-code" else self._find_codex( )
                        err = None if tool else "未找到工具二进制"
                    if tool:
                        tools[vk] = tool
                    else:
                        dl_errs[vk] = err or "获取工具失败"
                with _DS_JOBS_LOCK:
                    j = _DS_JOBS.get( jid )
                    if j: j["stage"] = "run"
                if not tools:
                    with _DS_JOBS_LOCK:
                        _DS_JOBS[jid] = {
                            "status": "error",
                            "error":  "; ".join( "%s: %s" % kv for kv in dl_errs.items( ) ) or "未找到工具二进制"
                        }
                    return
                vkeys = [v["ver"] or "本机" for v in vers]
                tasks = [(vi, ci, ri) for vi in range( len( vkeys ) ) for ci in range( len( cases ) ) for ri in range( repeat )]
                lock = threading.Lock( )
                pos = [0]
                
                def worker():
                    while True:
                        with lock:
                            i = pos[0]
                            pos[0] += 1
                        if i >= len( tasks ): return
                        vi, ci, ri = tasks[i]
                        vk = vkeys[vi]
                        
                        def tick():  # 每轮结束进度 +1（含超时中断补齐）
                            with _DS_JOBS_LOCK:
                                j = _DS_JOBS.get( jid )
                                if j: j["done"] += 1
                        
                        if vk in dl_errs:
                            res = {
                                "case":    cases[ci].get( "id" ) or "case", "rep": ri, "ver": vk, "ok": False,
                                "elapsed": 0, "error": "工具获取失败：" + dl_errs[vk], "rounds": []
                            }
                            for _ in range( len( cases[ci].get( "rounds" ) or [] ) ):
                                tick( )
                        else:
                            try:
                                res = _ds_run_case( kind, tools[vk], base, model, key, cases[ci], ri, timeout, on_round=tick )
                            except Exception as e:
                                res = {
                                    "case":    cases[ci].get( "id" ) or "case", "rep": ri, "ver": vk, "ok": False,
                                    "elapsed": 0, "error": "异常:" + str( e ), "rounds": []
                                }
                                # 异常路径 _ds_run_case 未回调，补齐该用例全部轮次
                                for _ in range( len( cases[ci].get( "rounds" ) or [] ) ):
                                    tick( )
                            res["ver"] = vk
                        with _DS_JOBS_LOCK:
                            j = _DS_JOBS.get( jid )
                            if not j: return
                            j["results"].append( res )
                            if len( j["results"] ) >= len( tasks ):
                                j["status"] = "done"
                                j["summary"] = _ds_summary( j["results"] )
                                by = { }
                                for r in j["results"]:
                                    by.setdefault( r.get( "ver" ) or "本机", [] ).append( r )
                                j["summaries"] = { k: _ds_summary( rs ) for k, rs in by.items( ) }
                
                for _ in range( conc ):
                    threading.Thread( target=worker, daemon=True ).start( )
            
            threading.Thread( target=run, daemon=True ).start( )
            self._send_json( 200, { "ok": True, "id": jid, "total": total } )
        else:
            qs = urllib.parse.parse_qs( self.path.split( "?", 1 )[1] if "?" in self.path else "" )
            jid = (qs.get( "id" ) or [""])[0]
            with _DS_JOBS_LOCK:
                st = dict( _DS_JOBS.get( jid ) or { } )
            if not st:
                self._send_json( 404, { "ok": False, "error": "job not found" } )
                return
            st["ok"] = True
            st["id"] = jid
            self._send_json( 200, st )
    
    def _do_clearcache( self ):
        """清理缓存：已下载的 codex/claude 二进制、下载/压测任务记录、测试临时目录残留。
        有下载/工具测试/压测进行中时拒绝，避免拆掉运行中任务的工作目录。"""
        with _DL_JOBS_LOCK:
            dl_running = any( st.get( "status" ) == "running" for st in _DL_JOBS.values( ) )
        with _DS_JOBS_LOCK:
            ds_running = any( st.get( "status" ) == "running" for st in _DS_JOBS.values( ) )
        if dl_running or ds_running or _TOOLTEST_RUNNING[0]:
            self._send_json(
                200, {
                    "ok":    False,
                    "error": "有任务正在进行（下载/工具测试/压测），请等完成后再清理"
                }
                )
            return
        freed = 0
        removed = 0
        # 1. 工具二进制缓存（下载并验证 / 工具测试 / 压测共用）
        with _CODEX_BIN_LOCK:
            entries = list( _CODEX_BIN_CACHE.values( ) )
            _CODEX_BIN_CACHE.clear( )
        for e in entries:
            d = e.get( "dir" )
            if d and os.path.isdir( d ):
                freed += _dir_size( d )
                shutil.rmtree( d, ignore_errors=True )
                removed += 1
        # 2. 任务记录
        with _DL_JOBS_LOCK:
            _DL_JOBS.clear( )
        with _DS_JOBS_LOCK:
            _DS_JOBS.clear( )
        # 3. 临时目录残留（进程崩溃遗留的下载/压测/测试/配置目录）
        try:
            names = os.listdir( tempfile.gettempdir( ) )
        except OSError:
            names = []
        for name in names:
            if not name.startswith( _TMP_PREFIXES ): continue
            p = os.path.join( tempfile.gettempdir( ), name )
            if not os.path.isdir( p ): continue
            freed += _dir_size( p )
            shutil.rmtree( p, ignore_errors=True )
            removed += 1
        self._send_json( 200, { "ok": True, "removed": removed, "freed": freed } )
    
    def _do_cfg( self ):
        """写入工具接入配置
        - 覆盖模式：{content, overwrite} → 直接覆盖真实配置文件（overwrite 为
          ~/.codex/config.toml / ~/.claude/settings.json 这类路径，展开 ~ 后写入）
        - 旧模式：{content, env?, path?, ttl?} → path 指定（如 /tmp/mytest）写
          path/config.toml 与 path/env.sh 不自动删除；path 留空写系统临时目录，
          ttl 秒（默认 600）后线程自动删除
        """
        req = self._read_body( )
        if req is None: return
        content = req.get( "content" ) or ""
        env = req.get( "env" ) or ""
        target = (req.get( "path" ) or "").strip( )
        overwrite = (req.get( "overwrite" ) or "").strip( )
        try:
            ttl = max( 30, int( req.get( "ttl" ) or 600 ) )
        except Exception:
            ttl = 600
        if not content:
            self._send_json( 400, { "error": "no content" } )
            return
        try:
            if overwrite:
                p = os.path.abspath( os.path.expanduser( overwrite ) )
                os.makedirs( os.path.dirname( p ), exist_ok=True )
                with open( p, "w", encoding="utf-8" ) as f:
                    f.write( content )
                self._send_json( 200, { "ok": True, "file": p, "mode": "overwrite" } )
                return
            if target:
                d = os.path.abspath( os.path.expanduser( target ) )
                os.makedirs( d, exist_ok=True )
                tmp = False
            else:
                d = tempfile.mkdtemp( prefix="codex-cfg-" )
                tmp = True
            p = os.path.join( d, "config.toml" )
            with open( p, "w", encoding="utf-8" ) as f:
                f.write( content )
            if env:
                with open( os.path.join( d, "env.sh" ), "w", encoding="utf-8" ) as f:
                    f.write( env )
            if tmp:
                def _rm():
                    time.sleep( ttl )
                    shutil.rmtree( d, ignore_errors=True )
                
                threading.Thread( target=_rm, daemon=True ).start( )
            self._send_json( 200, { "ok": True, "dir": d, "file": p, "temp": tmp, "ttl": ttl } )
        except Exception as e:
            self._send_json( 200, { "ok": False, "error": str( e ) } )
    
    def do_POST( self ):
        path = self.path.split( "?", 1 )[0]
        if path == "/cfg":
            self._do_cfg( )
            return
        if path == "/tool":
            self._do_tool( )
            return
        if path == "/tooltest":
            self._do_tooltest( )
            return
        if path == "/dljob":
            self._do_dljob( )
            return
        if path == "/datasetrun":
            self._do_datasetrun( )
            return
        if path == "/clearcache":
            self._do_clearcache( )
            return
        if path != "/proxy":
            self.send_response( 404 )
            self._cors( )
            self.end_headers( )
            return
        n = int( self.headers.get( "Content-Length", 0 ) or 0 )
        raw = self.rfile.read( n ) if n else b""
        try:
            req = json.loads( raw.decode( "utf-8" ) or "{}" )
        except Exception as e:
            self._send_json( 400, { "error": "bad json: %s" % e } )
            return
        url = req.get( "url" )
        method = (req.get( "method" ) or "POST").upper( )
        headers = req.get( "headers" ) or { }
        body = req.get( "body" )
        proxy = req.get( "proxy" )  # 可选：4 层上游 HTTP 代理，如 http://10.0.0.1:8080
        if not url:
            self._send_json( 400, { "error": "no url" } )
            return
        try:
            data = body.encode( "utf-8" ) if isinstance( body, str ) else (None if body is None else json.dumps( body ).encode( ))
            r = urllib.request.Request( url, data=data, method=method )
            for k, v in headers.items( ):
                r.add_header( k, v )
            if not any( k.lower( ) == "user-agent" for k in headers ):
                r.add_header( "User-Agent", "starflow-verify/1.0 (local-proxy)" )
            ctx = ssl.create_default_context( )
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            if proxy:
                opener = urllib.request.build_opener(
                    urllib.request.ProxyHandler( { "http": proxy, "https": proxy } ),
                    urllib.request.HTTPSHandler( context=ctx ),
                )
                resp = opener.open( r, timeout=TIMEOUT )
            else:
                resp = urllib.request.urlopen( r, timeout=TIMEOUT, context=ctx )
            with resp:
                status = resp.status
                rheaders = { k: v for k, v in resp.headers.items( ) }
                rbody = resp.read( ).decode( "utf-8", "replace" )
            self._send_json( 200, { "ok": 200 <= status < 300, "status": status, "body": rbody, "headers": rheaders } )
        except urllib.error.HTTPError as e:
            try:
                rbody = e.read( ).decode( "utf-8", "replace" )
            except Exception:
                rbody = str( e )
            self._send_json( 200, { "ok": False, "status": e.code, "body": rbody, "headers": dict( e.headers.items( ) ) if e.headers else { } } )
        except Exception as e:
            self._send_json( 200, { "ok": False, "status": 0, "body": "代理转发失败: %s" % e, "headers": { } } )


if __name__ == "__main__":
    ThreadingHTTPServer.allow_reuse_address = True
    srv = ThreadingHTTPServer( ("127.0.0.1", PORT), Handler )
    print( "星流验收工具本地代理+静态服务已启动: http://127.0.0.1:%d/  (默认页 %s, Ctrl+C 退出)" % (PORT, default_page( )) )
    try:
        srv.serve_forever( )
    except KeyboardInterrupt:
        print( "\n已退出。" )
