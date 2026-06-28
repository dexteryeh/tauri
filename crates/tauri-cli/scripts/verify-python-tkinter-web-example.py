#!/usr/bin/env python3

import html
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path


WEB_EXAMPLE_URL = "https://www.w3schools.com/jsref/tryit.asp?filename=tryjsref_win_localstorage"
EXPECTED_SNAPSHOT = {
    "elements": {"demo": "Smith"},
    "storage": {"lastname": "Smith"},
    "variables": {},
}


def repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def fetch_w3schools_tryit_html() -> str:
    with urllib.request.urlopen(WEB_EXAMPLE_URL, timeout=20) as response:
        page = response.read().decode("utf-8", errors="ignore")

    match = re.search(r'<textarea[^>]*id="textareaCode"[^>]*>(.*?)</textarea>', page, re.S)
    if not match:
        raise RuntimeError("W3Schools Tryit textareaCode example was not found")
    return html.unescape(match.group(1))


def render_generated_python_app(target: Path, index_html: str) -> Path:
    dist_dir = target / "dist"
    app_dir = target / "src-python"
    dist_dir.mkdir(parents=True)
    app_dir.mkdir(parents=True)

    (dist_dir / "index.html").write_text(index_html, encoding="utf-8")

    template = (
        repo_root()
        / "crates"
        / "tauri-cli"
        / "templates"
        / "python-tkinter"
        / "src-python"
        / "main.py"
    ).read_text(encoding="utf-8")
    rendered = (
        template.replace("{{ app_name }}", "W3Schools Verify")
        .replace("{{ window_title }}", "W3Schools Verify")
        .replace("{{ frontend_dist }}", "../dist")
    )

    app_path = app_dir / "main.py"
    app_path.write_text(rendered, encoding="utf-8")
    return app_path


def run_generated_app(app_path: Path) -> dict:
    env = os.environ.copy()
    env["PYTHONPYCACHEPREFIX"] = str(app_path.parent.parent / "pycache")
    env["TKINTER_WEBAPP_TEST"] = "1"

    subprocess.run([sys.executable, "-m", "py_compile", str(app_path)], check=True, env=env)
    output = subprocess.check_output([sys.executable, str(app_path)], text=True, env=env)
    return json.loads(output)


def main() -> int:
    index_html = fetch_w3schools_tryit_html()
    with tempfile.TemporaryDirectory(prefix="tauri-python-tkinter-verify-") as temp:
        app_path = render_generated_python_app(Path(temp), index_html)
        snapshot = run_generated_app(app_path)

    if snapshot != EXPECTED_SNAPSHOT:
        print("Generated Python/Tkinter app did not match the web example.", file=sys.stderr)
        print("Expected:", json.dumps(EXPECTED_SNAPSHOT, sort_keys=True), file=sys.stderr)
        print("Actual:  ", json.dumps(snapshot, sort_keys=True), file=sys.stderr)
        return 1

    print(f"Verified {WEB_EXAMPLE_URL}")
    print(json.dumps(snapshot, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
