#!/usr/bin/env python3
"""Regenerate each sample's model answer with a new model through OpenRouter.

Usage (from the repo root):
    export OPENROUTER_API_KEY=...        # your key, never committed
    python3 scripts/regenerate_model.py                  # all three samples
    python3 scripts/regenerate_model.py moraine bamboo   # just some

For each sample it sends the reference photo plus the original prompt, then
writes:
    samples/<id>/model.html            the new answer (the page the viewer shows)
    samples/<id>/model_argon.html      the previous answer, kept once as a backup
    samples/<id>/model_response.json   the raw API response, for provenance

Standard library only, no installs needed.
"""
import base64
import json
import os
import re
import shutil
import sys
import time
import urllib.error
import urllib.request

MODEL = "google/gemini-4-neon"
PROMPT = "transform this image into a photorealistic 3D scene"
SAMPLES = ["moraine", "bamboo", "lighthouse"]
URL = "https://openrouter.ai/api/v1/chat/completions"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def extract_html(text):
    """Pull the HTML document out of the reply, with or without code fences."""
    fences = re.findall(r"```(?:html|HTML)?\s*\n(.*?)```", text, re.S)
    candidates = [f for f in fences if "<html" in f.lower() or "<!doctype" in f.lower()]
    if candidates:
        return max(candidates, key=len).strip() + "\n"
    m = re.search(r"(<!DOCTYPE html.*?</html>)", text, re.S | re.I) or \
        re.search(r"(<html.*?</html>)", text, re.S | re.I)
    if m:
        return m.group(1).strip() + "\n"
    return None


def call(sample, key):
    with open(os.path.join(ROOT, "img", f"{sample}_ref.jpg"), "rb") as f:
        b64 = base64.b64encode(f.read()).decode()
    body = {
        "model": MODEL,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": PROMPT},
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
            ],
        }],
    }
    req = urllib.request.Request(
        URL,
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=900) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            msg = e.read().decode(errors="replace")[:500]
            if e.code in (429, 500, 502, 503, 504) and attempt < 3:
                print(f"  HTTP {e.code}, retrying in {10 * 2 ** attempt}s: {msg}")
                time.sleep(10 * 2 ** attempt)
                continue
            sys.exit(f"  HTTP {e.code}: {msg}")
        except urllib.error.URLError as e:
            if attempt < 3:
                print(f"  network error, retrying: {e}")
                time.sleep(10 * 2 ** attempt)
                continue
            raise


def main():
    key = os.environ.get("OPENROUTER_API_KEY")
    if not key:
        sys.exit("Set OPENROUTER_API_KEY first.")
    targets = sys.argv[1:] or SAMPLES
    for s in targets:
        if s not in SAMPLES:
            sys.exit(f"Unknown sample {s!r}; choose from {SAMPLES}")
    for s in targets:
        d = os.path.join(ROOT, "samples", s)
        print(f"{s}: calling {MODEL} ...")
        resp = call(s, key)
        latest = os.path.join(d, "model_response.json")
        if os.path.exists(latest):  # keep earlier attempts as a record
            n = 1
            while os.path.exists(os.path.join(d, f"model_response_attempt{n}.json")):
                n += 1
            os.rename(latest, os.path.join(d, f"model_response_attempt{n}.json"))
        with open(latest, "w") as f:
            json.dump(resp, f, indent=1)
        served = resp.get("model", "?")
        if served != MODEL:
            print(f"  WARNING: OpenRouter served {served!r}, not {MODEL!r}")
        text = resp["choices"][0]["message"].get("content") or ""
        html = extract_html(text)
        if not html:
            print(f"  No HTML found in the reply; see {d}/model_response.json")
            continue
        backup = os.path.join(d, "model_argon.html")
        if not os.path.exists(backup):
            shutil.copy(os.path.join(d, "model.html"), backup)
        with open(os.path.join(d, "model.html"), "w") as f:
            f.write(html)
        usage = resp.get("usage", {})
        print(f"  wrote model.html ({len(html):,} bytes, served by {served}, "
              f"tokens {usage.get('prompt_tokens')}→{usage.get('completion_tokens')})")


if __name__ == "__main__":
    main()
