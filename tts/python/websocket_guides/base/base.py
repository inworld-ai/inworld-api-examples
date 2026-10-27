#!/usr/bin/env python3
"""
Speak an agent's replies over the TTS WebSocket, with barge-in.

- One WebSocket connection for the whole conversation, opened before the user
  says anything, so its handshake never delays a reply.
- One context per agent turn, with auto mode off, and one flush per turn: the
  whole reply in one `sendText` with `flushContext` once the LLM has finished,
  then `closeContext`. `contextClosed` arrives after the turn's last audio.
- Barge-in: stop playback at once, then cancel the context. The service stops
  synthesizing and drops the reply's text it has not spoken; drop the audio it
  already generated, which still arrives.
- Word timestamps tell you what the user actually heard, so the reply you keep
  in the LLM's history can end there.

The other guides reuse this class and change only how the reply is sent:
../client_segmentation/client_segmentation.py and ../streaming_tokens/streaming_tokens.py.

Run it through the playground (see ../README.md), or on its own to speak
one reply into a WAV file:

    python base.py
"""

import asyncio
import base64
import json
import os
import re
import uuid
from dataclasses import dataclass

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # dotenv is optional; INWORLD_API_KEY can also be set via export

import websockets

# INWORLD_API_BASE_URL selects another endpoint, such as a regional one.
API_BASE_URL = os.getenv("INWORLD_API_BASE_URL", "https://api.inworld.ai").rstrip("/")
WEBSOCKET_URL = re.sub(r"^http", "ws", API_BASE_URL) + "/tts/v1/voice:streamBidirectional"
SAMPLE_RATE_HZ = 24000


@dataclass
class Word:
    text: str
    start: float  # seconds from the start of the turn's audio
    end: float


class Turn:
    """One agent reply, on its own context.

    `events` yields ("audio", pcm_bytes), and ("synthesis", count) after each
    synthesis the service completes. The last event is ("closed", None) once
    the context is closed, or ("error", message).
    """

    def __init__(self, context_id: str):
        self.context_id = context_id
        self.events: asyncio.Queue = asyncio.Queue()
        self.words: list[Word] = []
        self.audio_seconds = 0.0  # audio received so far
        self.syntheses = 0
        self.interrupted = False
        self.closing = False  # closeContext or cancelContext sent, or the context ended
        self.finished = False  # no more responses will arrive
        self.pending = ""  # reply text not sent yet
        self.sent = ""  # reply text sent so far
        # Word timestamps count from the start of each synthesis; this is
        # where the current one starts in the turn's audio.
        self._synthesis_start = 0.0

    def heard(self, seconds: float) -> str:
        """The start of the reply, as sent, up to the last word that finished
        playing in the first `seconds` of the turn's audio. Timestamp words are
        pieces of the text you sent, so each one is found in it in turn."""
        end = 0
        for w in self.words:
            if w.end > seconds:
                break
            piece = w.text.strip()
            at = self.sent.find(piece, end) if piece else -1
            if at >= 0:
                end = at + len(piece)
        # Markup at the very end opens something not heard yet: <verbatim>, [whisper].
        return re.sub(r"(\s*(<[^/>][^>]*>|\[[^\]]*\]))+\s*$", "", self.sent[:end]).strip()

    async def heard_after_timestamps(self, seconds: float, timeout: float = 2.0) -> str:
        """heard(seconds), once timestamps cover that much audio. With the ASYNC
        transport they trail the audio, so wait for them briefly."""
        deadline = asyncio.get_running_loop().time() + timeout
        while not self.finished and asyncio.get_running_loop().time() < deadline:
            if self.words and self.words[-1].end >= seconds:
                break
            await asyncio.sleep(0.05)
        return self.heard(seconds)


class Speaker:
    """Speaks one conversation's agent turns over one WebSocket connection."""

    # Extra `create` settings; the other guides set auto mode here.
    CREATE: dict = {}

    def __init__(self, api_key: str, voice_id: str = "Sarah", model_id: str = "inworld-tts-2",
                 url: str = WEBSOCKET_URL):
        self.api_key, self.voice_id, self.model_id, self.url = api_key, voice_id, model_id, url
        self._ws = None
        self._reader = None
        self._connecting = asyncio.Lock()
        self._turns: dict[str, Turn] = {}

    async def connect(self):
        """Open the connection, or reopen a dropped one. Call it before the
        conversation starts: the TCP, TLS and WebSocket handshakes take a
        round trip or more, which the first reply shouldn't wait for."""
        async with self._connecting:
            if self._ws is None or self._reader.done():
                self._ws = await websockets.connect(
                    self.url, additional_headers={"Authorization": f"Basic {self.api_key}"}, max_size=None)
                self._reader = asyncio.create_task(self._read())

    async def start_turn(self, voice_id: str | None = None,
                         previous_texts: list[str] | None = None) -> Turn:
        """Open a context for the next agent turn, in voice_id or the
        speaker's voice. Seed it with earlier conversation text, in order."""
        voice_id = voice_id or self.voice_id
        await self.connect()  # returns at once when already connected
        turn = Turn(f"turn-{uuid.uuid4().hex[:12]}")  # unique across connections
        self._turns[turn.context_id] = turn
        # No need to wait for contextCreated: the service handles messages in order.
        await self._send(turn, {"create": {
            "voiceId": voice_id,
            "modelId": self.model_id,
            "synthesisContext": {
                "previousRequests": [{"text": text} for text in (previous_texts or [])],
            },
            "audioConfig": {"audioEncoding": "PCM", "sampleRateHertz": SAMPLE_RATE_HZ},
            "timestampType": "WORD",
            # Audio first, timestamps in trailing messages: the lowest latency.
            "timestampTransportStrategy": "ASYNC",
            **self.CREATE,
        }})
        return turn

    async def send_text(self, turn: Turn, token: str):
        """Take an LLM token as it arrives. Here it is only collected: the
        reply goes out whole when the turn ends."""
        turn.pending += token

    async def end_turn(self, turn: Turn):
        """The reply is complete: flush what is left of it and close the
        context. A sendText carries up to 2,000 characters."""
        if turn.closing:
            return
        if turn.pending.strip():
            await self._send_text(turn, turn.pending, flush=True)
        turn.pending = ""
        await self._close(turn)

    async def interrupt(self, turn: Turn):
        """Barge-in. Stop your player first; this cancels the context, even one
        already closing, and drops whatever audio it still sends."""
        cancel = not (turn.interrupted or turn.finished)
        turn.interrupted = turn.closing = True
        if cancel:
            await self._send(turn, {"cancelContext": {}})

    async def close(self):
        if self._ws is not None:
            await self._ws.close()

    async def _send_text(self, turn: Turn, text: str, flush: bool = False):
        if not turn.closing:
            turn.sent += text
            message = {"text": text, "flushContext": {}} if flush else {"text": text}
            await self._send(turn, {"sendText": message})

    async def _close(self, turn: Turn):
        if not turn.closing:
            turn.closing = True
            await self._send(turn, {"closeContext": {}})

    async def _send(self, turn: Turn, payload: dict):
        await self._ws.send(json.dumps({"contextId": turn.context_id, **payload}))

    def _finish(self, turn: Turn, event: tuple):
        turn.closing = True  # nothing more to send on this context
        turn.finished = True
        self._turns.pop(turn.context_id, None)
        turn.events.put_nowait(event)

    async def _read(self):
        """Route every response to the turn whose context it names. An error
        ends its turn; a dropped connection ends them all."""
        try:
            async for message in self._ws:
                response = json.loads(message)
                result = response.get("result", response)
                context_id = result.get("contextId")
                turn = self._turns.get(context_id)
                status = result.get("status") or {}
                if "error" in response or status.get("code"):
                    # An error that names no context applies to all of them.
                    error = (response.get("error") or status).get("message", "unknown error")
                    for t in [turn] if turn else [] if context_id else list(self._turns.values()):
                        self._finish(t, ("error", error))
                    continue
                if turn is None:
                    continue  # an interrupted turn's context, already finished
                if "audioChunk" in result:
                    chunk = result["audioChunk"]
                    words = (chunk.get("timestampInfo") or {}).get("wordAlignment") or {}
                    for text, start, end in zip(words.get("words", []), words.get("wordStartTimeSeconds", []),
                                                words.get("wordEndTimeSeconds", [])):
                        turn.words.append(Word(text, turn._synthesis_start + start, turn._synthesis_start + end))
                    if chunk.get("audioContent"):
                        pcm = strip_wav_header(base64.b64decode(chunk["audioContent"]))
                        turn.audio_seconds += len(pcm) / 2 / SAMPLE_RATE_HZ
                        if not turn.interrupted:
                            turn.events.put_nowait(("audio", pcm))
                elif "flushCompleted" in result:
                    turn.syntheses += 1
                    turn._synthesis_start = turn.audio_seconds
                    turn.events.put_nowait(("synthesis", turn.syntheses))
                elif "contextClosed" in result:
                    self._finish(turn, ("closed", None))
        finally:
            for turn in list(self._turns.values()):
                self._finish(turn, ("error", "connection closed"))


def strip_wav_header(audio: bytes) -> bytes:
    """Return the PCM samples of a chunk, dropping its RIFF/WAV header."""
    if audio[:4] != b"RIFF" or audio[8:12] != b"WAVE":
        return audio
    pos = 12
    while pos + 8 <= len(audio):
        chunk_id = audio[pos:pos + 4]
        chunk_size = int.from_bytes(audio[pos + 4:pos + 8], "little")
        if chunk_id == b"data":
            return audio[pos + 8:]
        pos += 8 + chunk_size
    return b""


if __name__ == "__main__":
    from demo import speak_one_reply

    exit(asyncio.run(speak_one_reply(Speaker, "base.wav")))
