#!/usr/bin/env python3
"""
Local web demo for language switching over the TTS WebSocket.

Type a tutor turn with the taught language in <l2>...</l2>, see what each way
of sending it flushes, and hear it. The WebSocket client is
../language_switching.py; this server only runs it for the page:

  one           the whole turn as one flush
  per_language  one flush per language segment

The page plays one flush on two voices (one with localized prompts, one cloned
from a clip in both languages) and per-language flushes on the first.

The server holds the API key and talks to the TTS WebSocket; the browser only
talks to this server.

    python server.py            # then open http://localhost:8765
"""

import argparse
import asyncio
import base64
import io
import json
import os
import sys
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

import language_switching as ls  # noqa: E402

SYNTHESIS_TIMEOUT_S = 90


def wav_base64(pcm: bytes) -> str:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(ls.SAMPLE_RATE_HZ)
        f.writeframes(pcm)
    return base64.b64encode(buf.getvalue()).decode()


def flushes_for(text: str, strategy: str) -> list[ls.Flush]:
    return ls.per_language_flushes(text) if strategy == "per_language" else ls.one_flush(text)


def plan(text: str) -> dict:
    return {strategy: [{"language": f.language, "text": f.text} for f in flushes_for(text, strategy)]
            for strategy in ("one", "per_language")}


def synthesize(url: str, api_key: str, body: dict) -> dict:
    voice_id = (body.get("voice_id") or "").strip()
    if not voice_id:
        raise ValueError("Set a voice ID.")
    flushes = flushes_for(body.get("text", ""), body.get("strategy", "one"))
    if not flushes:
        raise ValueError("Nothing to synthesize.")
    start = time.time()
    pcm = asyncio.run(asyncio.wait_for(
        ls.synthesize(api_key, flushes, voice_id, body.get("model_id") or "inworld-tts-2", url),
        SYNTHESIS_TIMEOUT_S,
    ))
    return {
        "elapsed_ms": round((time.time() - start) * 1000),
        "audio_wav": wav_base64(pcm),
        "flushes": [
            {
                "language": f.language,
                "text": f.text,
                "duration_s": round(len(f.pcm) / 2 / ls.SAMPLE_RATE_HZ, 3),
                "first_audio_ms": round((f.first_audio_at - f.sent_at) * 1000) if f.first_audio_at else None,
                "audio_wav": wav_base64(bytes(f.pcm)),
            }
            for f in flushes
        ],
    }


def make_handler(url: str, api_key: str):
    class Handler(BaseHTTPRequestHandler):
        def _json(self, status: int, payload: dict):
            data = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if self.path == "/favicon.ico":
                self.send_response(204)
                self.end_headers()
                return
            if self.path not in ("/", "/index.html"):
                self.send_error(404)
                return
            data = (HERE / "index.html").read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_POST(self):
            try:
                length = int(self.headers.get("Content-Length") or 0)
                body = json.loads(self.rfile.read(length) or b"{}")
            except (ValueError, json.JSONDecodeError):
                self._json(400, {"error": "Request body must be JSON."})
                return
            try:
                if self.path == "/api/plan":
                    self._json(200, plan(body.get("text", "")))
                elif self.path == "/api/synthesize":
                    self._json(200, synthesize(url, api_key, body))
                else:
                    self.send_error(404)
            except ValueError as e:
                self._json(400, {"error": str(e)})
            except Exception as e:  # surfaced in the page, not swallowed
                self._json(502, {"error": f"{type(e).__name__}: {e}"})

        def log_request(self, code="-", size="-"):
            # The page calls /api/plan on every keystroke; log synthesis only.
            # Errors still reach log_message through log_error.
            if self.path.startswith("/api/synthesize"):
                super().log_request(code, size)

    return Handler


def main():
    parser = argparse.ArgumentParser(description="Inworld TTS language switching web demo")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--url", default=ls.WEBSOCKET_URL, help="TTS WebSocket endpoint")
    args = parser.parse_args()

    api_key = os.getenv("INWORLD_API_KEY")
    if not api_key:
        print("Error: INWORLD_API_KEY environment variable is not set.")
        print("Please set it with: export INWORLD_API_KEY=your_api_key_here")
        return 1

    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(args.url, api_key))
    print(f"Language switching demo at http://localhost:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    exit(main())
