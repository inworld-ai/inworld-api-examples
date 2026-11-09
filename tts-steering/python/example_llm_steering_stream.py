#!/usr/bin/env python3
"""
Speak an LLM's reply with the steering tags it wrote, over the TTS WebSocket.

The LLM that already writes your agent's reply also directs how it is spoken:
../steering_system_prompt.md, added to its system prompt, asks it to put a
steering tag such as [barely containing excitement] before the words it applies
to. The tags travel inside the reply text, so steering adds no request and no
latency. Built-in Reasoning (example_reasoning.py) instead runs its own LLM
call before synthesis, and is not available on the WebSocket.

As the LLM streams, the client cuts its tokens into sentences and sends each
one as soon as it is complete, so the first sentence is spoken while the LLM
is still writing the rest. A sentence is never cut inside a [tag], so a tag
that arrives split across tokens reaches TTS whole.

The LLM is the Inworld Router's OpenAI-compatible chat completions API, with
the same INWORLD_API_KEY. To use another OpenAI-compatible provider, set
LLM_BASE_URL, LLM_API_KEY and LLM_MODEL.

    python example_llm_steering_stream.py
    python example_llm_steering_stream.py "I just got the job!"
"""

import asyncio
import base64
import json
import os
import re
import sys
import threading
import time
import wave
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # dotenv is optional; INWORLD_API_KEY can also be set via export

import requests
import websockets

PROMPT_FILE = Path(__file__).resolve().parent.parent / "steering_system_prompt.md"
API_BASE_URL = os.getenv("INWORLD_API_BASE_URL", "https://api.inworld.ai").rstrip("/")
TTS_WS_URL = re.sub(r"^http", "ws", API_BASE_URL) + "/tts/v1/voice:streamBidirectional"
LLM_BASE_URL = os.getenv("LLM_BASE_URL", API_BASE_URL + "/v1").rstrip("/")
LLM_MODEL = os.getenv("LLM_MODEL", "openai/gpt-4.1-mini")
VOICE_ID = "Sarah"
MODEL_ID = "inworld-tts-2"  # steering instructions work on inworld-tts-2 only
SAMPLE_RATE_HZ = 24000
OUTPUT_FILE = "llm_steering_stream.wav"

# A sentence ends at ".", "!" or "?" followed by whitespace, or at Chinese and
# Japanese "。！？" once the next character arrives. Closing quotes and
# brackets go with the sentence they close.
CLOSERS = "\"')」』）"
SENTENCE_END = re.compile(rf"[.!?]+[{CLOSERS}]*\s+|[。！？]+[{CLOSERS}]*(?=[^{CLOSERS}])")
ABBREVIATIONS = {"mr", "mrs", "ms", "dr", "st", "jr", "sr", "vs", "etc", "e.g", "i.e"}
TAG = re.compile(r"\[[^\]]*\]")


class SentenceBuffer:
    """Collect streamed text and hand back complete sentences, never cutting
    inside a [tag]. Everything pushed comes back out exactly once, in order."""

    def __init__(self):
        self.pending = ""

    def push(self, text: str) -> list[str]:
        """Add text; return the sentences it completed."""
        self.pending += text
        tags = [m.span() for m in TAG.finditer(self.pending)]
        # An unclosed "[" holds back everything from where it starts.
        unclosed = self.pending.find("[", tags[-1][1] if tags else 0)
        limit = len(self.pending) if unclosed < 0 else unclosed
        sentences, start = [], 0
        for m in SENTENCE_END.finditer(self.pending, 0, limit):
            if any(a <= m.start() < b for a, b in tags):
                continue
            word = (self.pending[start:m.start()].split() or [""])[-1].lstrip("\"'(").lower()
            if m.group().startswith("..") or m.group().startswith(".") and (
                    word in ABBREVIATIONS or (len(word) == 1 and word.isalpha())):
                continue  # an ellipsis, abbreviation or initial
            sentences.append(self.pending[start:m.end()])
            start = m.end()
        self.pending = self.pending[start:]
        return sentences

    def flush(self) -> str:
        """Return whatever is left once the stream has ended."""
        rest, self.pending = self.pending, ""
        return rest


def load_system_prompt(persona: str = "You are a helpful voice assistant. Keep replies to two or three sentences.") -> str:
    """Your agent's own system prompt, followed by the steering addendum."""
    return persona + "\n\n" + PROMPT_FILE.read_text(encoding="utf-8").strip()


def llm_request(user_message: str, system_prompt: str, model: str = LLM_MODEL) -> dict:
    return {
        "model": model,
        "stream": True,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
    }


def llm_headers(inworld_api_key: str) -> dict:
    """The Inworld Router takes the Inworld key as Basic auth; other
    OpenAI-compatible providers take their own key as a Bearer token."""
    if os.getenv("LLM_API_KEY"):
        return {"Authorization": f"Bearer {os.environ['LLM_API_KEY']}"}
    return {"Authorization": f"Basic {inworld_api_key}"}


def parse_sse_line(line: str) -> str:
    """Return the text a chat completions stream line carries, or ""."""
    if not line.startswith("data:") or line[5:].strip() == "[DONE]":
        return ""
    data = json.loads(line[5:])
    return "".join((choice.get("delta") or {}).get("content") or "" for choice in data.get("choices", []))


async def stream_llm(user_message: str, api_key: str):
    """Yield the LLM's reply as it streams. requests runs in a thread, so the
    event loop keeps sending text and receiving audio meanwhile."""
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()

    def run():
        try:
            with requests.post(LLM_BASE_URL + "/chat/completions", headers=llm_headers(api_key),
                               json=llm_request(user_message, load_system_prompt()),
                               stream=True, timeout=60) as response:
                response.raise_for_status()
                response.encoding = "utf-8"
                for line in response.iter_lines(decode_unicode=True):
                    if token := parse_sse_line(line or ""):
                        loop.call_soon_threadsafe(queue.put_nowait, token)
        except (requests.RequestException, ValueError) as e:
            loop.call_soon_threadsafe(queue.put_nowait, e)
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, None)

    threading.Thread(target=run, daemon=True).start()
    while (item := await queue.get()) is not None:
        if isinstance(item, Exception):
            raise item
        yield item


async def forward_reply(tokens, send, context_id: str, on_sentence=lambda s: None):
    """Send each complete sentence of the streamed reply, tags included, then
    close the context, which synthesizes anything left."""
    buffer = SentenceBuffer()
    async for token in tokens:
        print(token, end="", flush=True)
        for sentence in buffer.push(token):
            on_sentence(sentence)
            await send({"contextId": context_id, "sendText": {"text": sentence, "flushContext": {}}})
    if rest := buffer.flush():
        on_sentence(rest)
        await send({"contextId": context_id, "sendText": {"text": rest, "flushContext": {}}})
    await send({"contextId": context_id, "closeContext": {}})


def strip_wav_header(audio: bytes) -> bytes:
    """Return the PCM samples of a chunk, dropping its RIFF/WAV header."""
    if audio[:4] != b"RIFF" or audio[8:12] != b"WAVE":
        return audio
    pos = 12
    while pos + 8 <= len(audio):
        size = int.from_bytes(audio[pos + 4:pos + 8], "little")
        if audio[pos:pos + 4] == b"data":
            return audio[pos + 8:]
        pos += 8 + size
    return b""


async def speak(user_message: str, api_key: str) -> int:
    context_id = "steering-turn-1"
    times = {}
    pcm = bytearray()

    def first(name):
        times.setdefault(name, time.perf_counter() - start)

    async with websockets.connect(TTS_WS_URL, additional_headers={"Authorization": f"Basic {api_key}"},
                                  max_size=None) as ws:
        start = time.perf_counter()
        # Create the context before the LLM's first token arrives, without
        # waiting for the acknowledgment. Auto mode synthesizes each sentence
        # at once and batches sentences that arrive while it is busy.
        await ws.send(json.dumps({"contextId": context_id, "create": {
            "voiceId": VOICE_ID,
            "modelId": MODEL_ID,
            "autoMode": True,
            "audioConfig": {"audioEncoding": "PCM", "sampleRateHertz": SAMPLE_RATE_HZ},
        }}))

        async def receive():
            async for message in ws:
                response = json.loads(message)
                result = response.get("result") or {}
                error = response.get("error") or result.get("status") or {}
                if "error" in response or error.get("code"):
                    raise RuntimeError(error.get("message", "TTS error"))
                if content := (result.get("audioChunk") or {}).get("audioContent"):
                    first("audio")
                    pcm.extend(strip_wav_header(base64.b64decode(content)))
                if "contextClosed" in result:
                    return

        async def tokens():
            async for token in stream_llm(user_message, api_key):
                first("token")
                yield token

        receiver = asyncio.create_task(receive())
        print("Reply: ", end="")
        try:
            await forward_reply(tokens(), lambda m: ws.send(json.dumps(m)), context_id,
                                on_sentence=lambda s: first("sentence"))
            await receiver
        finally:
            receiver.cancel()
        print("\n")

    for name, label in [("token", "First LLM token"), ("sentence", "First sentence sent"),
                        ("audio", "First audio")]:
        if name in times:
            print(f"{label + ':':21}{times[name] * 1000:7.0f} ms")
    with wave.open(OUTPUT_FILE, "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(SAMPLE_RATE_HZ)
        f.writeframes(pcm)
    print(f"Wrote {len(pcm) / 2 / SAMPLE_RATE_HZ:.1f}s of audio to {OUTPUT_FILE}")
    return 0


def main() -> int:
    api_key = os.getenv("INWORLD_API_KEY")
    if not api_key:
        print("Error: INWORLD_API_KEY environment variable is not set.")
        print("Please set it with: export INWORLD_API_KEY=your_api_key_here")
        return 1
    user_message = " ".join(sys.argv[1:]) or "I finally passed my driving test on the third try!"
    print(f"User: {user_message}")
    print(f"LLM: {LLM_MODEL} at {LLM_BASE_URL}")
    print(f"TTS: {MODEL_ID}, voice {VOICE_ID}\n")
    try:
        return asyncio.run(speak(user_message, api_key))
    except (requests.RequestException, websockets.WebSocketException, OSError, RuntimeError, ValueError) as e:
        print(f"\nError: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
