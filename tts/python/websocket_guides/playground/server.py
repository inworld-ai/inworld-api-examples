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
for guide_dir in ("barge_in", "auto_mode", "sentence_boundary"):
    sys.path.insert(0, str(HERE.parent / guide_dir))

import client_segmented  # noqa: E402
import replies  # noqa: E402
import sentence_boundary  # noqa: E402
import whole_turn  # noqa: E402

# Each guide's Speaker is one way to send a reply; the page offers them as modes.
GUIDES = {
    "whole_turn": ("One flush per turn", "Send the whole reply once the LLM finishes.", whole_turn),
    "client_segmented": ("Client-side sentence segmentation",
                         "Send each sentence as soon as the LLM completes it.", client_segmented),
    "sentence_boundary": ("One token at a time", "Send every token as it arrives; the service finds the sentences. Preview.",
                          sentence_boundary),
}


async def conversation(browser, args, api_key: str):
    """One browser tab: one conversation, with its own history and TTS connection."""
    speakers = {}
    history = [{"role": "system", "content": replies.DEFAULT_SYSTEM_PROMPT}]
    turns = {}  # turn id -> {"turn", "speaker", "text": the reply so far}
    trimming = set()  # interrupted turns still waiting for their timestamps

    async def send(message: dict):
        await browser.send(json.dumps(message))

    async def speak(request: dict):
        guide = request.get("guide") or next(iter(GUIDES))
        voice_id = request.get("voice_id") or "Dennis"
        key = (guide, voice_id)
        if key not in speakers:
            speakers[key] = GUIDES[guide][2].Speaker(api_key, voice_id, args.model_id, args.tts_url)
        speaker = speakers[key]

        # The next LLM request needs the interrupted reply, as far as it was heard.
        for task in list(trimming):
            await task
        history[0]["content"] = request.get("system_prompt") or replies.DEFAULT_SYSTEM_PROMPT
        history.append({"role": "user", "content": request.get("text", "")})
        source = request.get("reply")
        reply = (replies.live(list(history), api_key, args.llm_model) if source == "live"
                 else replies.scripted(source))

        try:
            turn = await speaker.start_turn()
        except Exception as e:
            await send({"type": "error", "message": f"could not open a TTS context: {e}"})
            return
        record = turns[turn.context_id] = {"turn": turn, "speaker": speaker, "text": ""}
        await send({"type": "turn", "turn": turn.context_id, "guide": guide})

        def event(name: str, **data):
            return send({"type": "event", "turn": turn.context_id, "name": name, **data})

        async def forward_events():
            while True:
                kind, value = await turn.events.get()
                if kind == "audio":
                    await send({"type": "audio", "turn": turn.context_id, "pcm": base64.b64encode(value).decode()})
                elif kind == "synthesis":
                    await event("synthesis", count=value, audio_seconds=round(turn.audio_seconds, 2))
                elif kind == "error":
                    await send({"type": "error", "turn": turn.context_id, "message": value})
                    break
                elif kind == "closed":
                    await event("closed", audio_seconds=round(turn.audio_seconds, 2))
                    break

        forwarder = asyncio.create_task(forward_events())
        try:
            async for token in reply:
                if turn.interrupted:
                    break
                record["text"] += token
                await send({"type": "token", "turn": turn.context_id, "text": token})
                await speaker.send_text(turn, token)
            if not turn.interrupted:
                await event("llm_done")
        except Exception as e:
            await send({"type": "error", "turn": turn.context_id, "message": f"reply failed: {e}"})
        finally:
            await reply.aclose()
            await speaker.end_turn(turn)
        await forwarder

    def remember(record: dict, text: str):
        """Keep the reply in the history as far as the user heard it."""
        if text:
            history.append({"role": "assistant", "content": text})

    async def interrupted(record: dict, heard_seconds: float):
        # Stop the turn first; the trailing timestamps keep arriving.
        await record["speaker"].interrupt(record["turn"])
        heard = await record["turn"].heard_after_timestamps(heard_seconds)
        remember(record, heard)
        await send({"type": "heard", "turn": record["turn"].context_id, "text": heard})

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
            record = turns.pop(request["turn"], None)
            if record is not None:
                task = asyncio.create_task(interrupted(record, request["heard_seconds"]))
                trimming.add(task)
                task.add_done_callback(trimming.discard)
        elif request["type"] == "played":
            # The whole reply played: keep all of it.
            record = turns.pop(request["turn"], None)
            if record is not None:
                remember(record, record["text"])
        elif request["type"] == "reset":
            del history[1:]
            turns.clear()
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
    parser.add_argument("--tts-url", default=whole_turn.WEBSOCKET_URL, help="TTS WebSocket endpoint")
    args = parser.parse_args()

    api_key = os.getenv("INWORLD_API_KEY")
    if not api_key:
        print("Error: set INWORLD_API_KEY in tts/python/.env or with: export INWORLD_API_KEY=your_api_key_here")
        return 1

    options = {
        "guides": {name: {"label": label, "summary": summary} for name, (label, summary, _) in GUIDES.items()},
        "scripts": {name: {"label": s["label"], "prompt": s["prompt"]} for name, s in replies.SCRIPTS.items()},
        "llm_model": args.llm_model,
        "system_prompts": replies.SYSTEM_PROMPTS,
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
