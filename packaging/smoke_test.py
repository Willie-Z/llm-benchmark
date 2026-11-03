#!/usr/bin/env python3
"""Start a packaged backend and verify health plus bundled static pages."""

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path


BASE_URL = "http://127.0.0.1:8000"


def fetch(path):
    with urllib.request.urlopen(BASE_URL + path, timeout=3) as response:
        return response.status, response.read().decode("utf-8", "replace")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("binary", type=Path)
    args = parser.parse_args()
    binary = args.binary.resolve()
    if not binary.is_file():
        raise SystemExit(f"backend binary not found: {binary}")

    output = tempfile.TemporaryFile(mode="w+b")
    creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    process = subprocess.Popen(
        [str(binary)],
        stdout=output,
        stderr=subprocess.STDOUT,
        creationflags=creation_flags,
    )
    try:
        last_error = None
        health_status = None
        health_body = None
        for _ in range(80):
            if process.poll() is not None:
                output.seek(0)
                details = output.read().decode("utf-8", "replace")
                raise RuntimeError(f"backend exited early:\n{details}")
            try:
                health_status, health_body = fetch("/healthz")
                break
            except Exception as exc:  # startup race is expected
                last_error = exc
                time.sleep(0.25)
        else:
            raise RuntimeError(f"health check failed: {last_error}")

        if health_status != 200:
            raise RuntimeError(f"health returned HTTP {health_status}")
        health = json.loads(health_body)
        if health != {"ok": True, "service": "starflow-backend"}:
            raise RuntimeError(f"unexpected health payload: {health}")

        for path, marker in (
            ("/multitool.html", "<title>星流多工具测试</title>"),
            ("/llmabacus.html", "<title>LLM 验收对比</title>"),
        ):
            status, body = fetch(path)
            if status != 200 or marker not in body:
                raise RuntimeError(f"packaged page check failed: {path}")

        print("packaged backend smoke test: OK")
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        output.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"smoke test failed: {exc}", file=sys.stderr)
        sys.exit(1)
