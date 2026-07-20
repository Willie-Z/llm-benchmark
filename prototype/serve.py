#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
星流 LLM 验收工具 · 本地代理 + 静态服务（prototype 目录版）
- GET /  →  默认返回 index.html，没有则回退 prototype.html（同源，浏览器无跨域问题）
- GET /<file>  →  返回静态文件
- POST /proxy  {url, method, headers, body}  →  转发到真实 LLM Endpoint，返回 {ok,status,body,headers}
  浏览器直连 LLM Endpoint 常被 CORS 拦截；经本机代理转发即可绕开。
  Key 仅在本机内存中转发，不落盘、不记日志。
用法（在本文件所在目录运行）：
    cd prototype
    python serve.py
  然后浏览器开 http://127.0.0.1:8000/   （会自动打开 prototype.html）
"""
import os, json, ssl, urllib.request, urllib.error
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

ROOT = os.path.dirname(os.path.abspath(__file__))
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
    for name in ("index.html", "prototype.html"):
        if os.path.isfile(os.path.join(ROOT, name)):
            return "/" + name
    return "/index.html"

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

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/":
            path = default_page()
        # 防目录穿越
        safe = os.path.normpath(os.path.join(ROOT, path.lstrip("/")))
        if not safe.startswith(ROOT) or not os.path.isfile(safe):
            self.send_response(404); self._cors(); self.end_headers(); return
        ext = os.path.splitext(safe)[1].lower()
        ctype = CTYPES.get(ext, "application/octet-stream")
        with open(safe, "rb") as f:
            data = f.read()
        self.send_response(200); self._cors()
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        if self.path.split("?", 1)[0] != "/proxy":
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
            with urllib.request.urlopen(r, timeout=TIMEOUT, context=ctx) as resp:
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
