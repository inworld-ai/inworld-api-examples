#!/usr/bin/env python3
"""
Local playground for the WebSocket guides: type to the agent, hear its reply,
and interrupt it.

The page plays the audio; this server holds your API key, gets each reply
(scripted, or from a live LLM), and speaks it with the guide you pick.

    python server.py            # then open http://localhost:8766
"""

import argparse
import asyncio
import base64
import json
import os
import sys
import time
from http import HTTPStatus
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # dotenv is optional; INWORLD_API_KEY can also be set via export

from websockets.asyncio.server import serve
from websockets.datastructures import Headers
from websockets.http11 import Response

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "auto_mode"))

import replies  # noqa: E402
import sentence_boundary  # noqa: E402

# Every guide exposes the same Speaker interface; the page lists them all.
GUIDES = {
    "sentence_boundary": ("Sentence boundary, one context per turn (recommended)", sentence_boundary),
}


async def conversation(browser, args, api_key: str):
    """One browser tab: one conversation, with its own history and TTS connection."""
    speakers = {}
    history = [{"role": "system", "content": replies.SYSTEM_PROMPT}]
    turns = {}  # turn id -> {"turn", "speaker", "text": the reply so far}

    async def send(message: dict):
        await browser.send(json.dumps(message))

    async def speak(request: dict):
        guide = request.get("guide") or next(iter(GUIDES))
        voice_id = request.get("voice_id") or "Dennis"
        key = (guide, voice_id)
        if key not in speakers:
            speakers[key] = GUIDES[guide][1].Speaker(api_key, voice_id, args.model_id, args.tts_url)
        speaker = speakers[key]

        history.append({"role": "user", "content": request.get("text", "")})
        await send({"type": "history", "messages": history})
        source = request.get("reply")
        reply = (replies.live(list(history), api_key, args.llm_model) if source == "live"
                 else replies.scripted(source))

        start = time.time()
        try:
            turn = await speaker.start_turn()
        except Exception as e:
            await send({"type": "error", "message": f"could not open a TTS context: {e}"})
            return
        record = turns[turn.context_id] = {"turn": turn, "speaker": speaker, "text": "", "start": start}
        await send({"type": "turn", "turn": turn.context_id})

        def log(text: str):
            return send({"type": "log", "turn": turn.context_id, "text": f"+{time.time() - start:.2f}s  {text}"})

        async def forward_events():
            first_audio = True
            while True:
                kind, value = await turn.events.get()
                if kind == "audio":
                    if first_audio:
                        first_audio = False
                        await log("first audio")
                    await send({"type": "audio", "turn": turn.context_id, "pcm": base64.b64encode(value).decode()})
                elif kind == "synthesis":
                    await log(f"synthesis {value} complete ({turn.audio_seconds:.1f}s of audio)")
                elif kind == "error":
                    await send({"type": "error", "message": value})
                    break
                elif kind == "closed":
                    await log("contextClosed: all audio received")
                    break
            await send({"type": "done", "turn": turn.context_id})

        forwarder = asyncio.create_task(forward_events())
        first_token = True
        try:
            async for token in reply:
                if turn.interrupted:
                    break
                if first_token:
                    first_token = False
                    await log("first LLM token")
                record["text"] += token
                await send({"type": "token", "turn": turn.context_id, "text": token})
                await speaker.send_text(turn, token)
            if not turn.interrupted:
                await log("LLM done; closeContext")
        except Exception as e:
            await send({"type": "error", "message": f"reply failed: {e}"})
        finally:
            await reply.aclose()
            await speaker.end_turn(turn)
        await forwarder

    def remember(turn_id: str, heard_seconds: float | None):
        """Keep the reply in the history as far as the user heard it."""
        record = turns.pop(turn_id, None)
        if record is None:
            return None
        text = record["text"] if heard_seconds is None else record["turn"].heard(heard_seconds)
        if text:
            history.append({"role": "assistant", "content": text})
        return text

    tasks = set()
    async for raw in browser:
        request = json.loads(raw)
        if request["type"] == "say":
            task = asyncio.create_task(speak(request))
            tasks.add(task)
            task.add_done_callback(tasks.discard)
        elif request["type"] == "interrupt":
            # The page has already stopped playback; it reports how much of
            # the turn's audio was heard.
            record = turns.get(request["turn"])
            if record is not None:
                was_open = not record["turn"].closing
                await record["speaker"].interrupt(record["turn"])
                heard = remember(request["turn"], request["heard_seconds"])
                await send({"type": "log", "turn": request["turn"],
                            "text": f"+{time.time() - record['start']:.2f}s  interrupted after "
                                    f"{request['heard_seconds']:.1f}s of playback"
                                    + ("; closeContext" if was_open else "")})
                await send({"type": "heard", "turn": request["turn"], "text": heard})
                await send({"type": "history", "messages": history})
        elif request["type"] == "played":
            # The whole reply played: keep all of it.
            remember(request["turn"], None)
            await send({"type": "history", "messages": history})
    for speaker in speakers.values():
        await speaker.close()


def page_handler(options: dict):
    html = (HERE / "index.html").read_text(encoding="utf-8").replace("__OPTIONS__", json.dumps(options))

    def process_request(connection, request):
        if request.path == "/ws":
            return None  # continue with the WebSocket handshake
        if request.path in ("/", "/index.html"):
            body = html.encode()
            headers = Headers([("Content-Type", "text/html; charset=utf-8"), ("Content-Length", str(len(body)))])
            return Response(HTTPStatus.OK, "OK", headers, body)
        return connection.respond(HTTPStatus.NOT_FOUND, "Not found\n")

    return process_request


async def main():
    parser = argparse.ArgumentParser(description="Local playground for the Inworld TTS WebSocket guides")
    parser.add_argument("--port", type=int, default=8766)
    parser.add_argument("--model-id", default="inworld-tts-2", help="TTS model (default: inworld-tts-2)")
    parser.add_argument("--llm-model", default=replies.DEFAULT_LLM_MODEL,
                        help=f"LLM for live replies, through the Inworld Router (default: {replies.DEFAULT_LLM_MODEL})")
    parser.add_argument("--tts-url", default=sentence_boundary.WEBSOCKET_URL, help="TTS WebSocket endpoint")
    args = parser.parse_args()

    api_key = os.getenv("INWORLD_API_KEY")
    if not api_key:
        print("Error: set INWORLD_API_KEY in tts/python/.env or with: export INWORLD_API_KEY=your_api_key_here")
        return 1

    options = {
        "guides": {name: label for name, (label, _) in GUIDES.items()},
        "scripts": {name: {"label": s["label"], "prompt": s["prompt"]} for name, s in replies.SCRIPTS.items()},
        "llm_model": args.llm_model,
    }
    async with serve(lambda ws: conversation(ws, args, api_key), "localhost", args.port,
                     process_request=page_handler(options), max_size=None):
        print(f"Open http://localhost:{args.port}")
        await asyncio.Future()


if __name__ == "__main__":
    try:
        exit(asyncio.run(main()))
    except KeyboardInterrupt:
        pass
