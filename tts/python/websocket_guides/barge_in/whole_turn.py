#!/usr/bin/env python3
"""
Speak an agent's replies over the TTS WebSocket, with barge-in.

- One WebSocket connection for the whole conversation.
- One context per agent turn, with auto mode off, and one flush per turn: the
  whole reply in one `sendText` with `flushContext` once the LLM has finished,
  then `closeContext`. `contextClosed` arrives after the turn's last audio.
- Barge-in: stop playback at once, then close the context and drop the rest
  of its audio. Synthesis runs faster than playback, so most of an interrupted
  reply has usually been synthesized already; stopping the player is what the
  user hears.
- Word timestamps tell you what the user actually heard, so the reply you keep
  in the LLM's history can end there.

The other guides reuse this class and change only how the reply is sent:
../auto_mode/client_segmented.py and ../sentence_boundary/sentence_boundary.py.

Run it through the playground (see ../README.md), or on its own to speak
one reply into a WAV file:

    python whole_turn.py
"""

import asyncio
import base64
import json
import os
import re
import wave
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
        self.closing = False  # closeContext sent, or the context ended
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
        return self.sent[:end].strip()

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

    def __init__(self, api_key: str, voice_id: str = "Dennis", model_id: str = "inworld-tts-2",
                 url: str = WEBSOCKET_URL):
        self.api_key, self.voice_id, self.model_id, self.url = api_key, voice_id, model_id, url
        self._ws = None
        self._reader = None
        self._turns: dict[str, Turn] = {}
        self._count = 0

    async def start_turn(self) -> Turn:
        """Open a context for the next agent turn."""
        if self._ws is None or self._reader.done():
            self._ws = await websockets.connect(
                self.url, additional_headers={"Authorization": f"Basic {self.api_key}"}, max_size=None)
            self._reader = asyncio.create_task(self._read())
        self._count += 1
        turn = Turn(f"turn-{self._count}")
        self._turns[turn.context_id] = turn
        # No need to wait for contextCreated: the service handles messages in order.
        await self._send(turn, {"create": {
            "voiceId": self.voice_id,
            "modelId": self.model_id,
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
        """Barge-in. Stop your player first; this closes the context without
        sending anything more, and drops whatever audio it still sends."""
        turn.interrupted = True
        await self._close(turn)

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


async def speak_one_reply(speaker_class, output_file: str):
    """Stream one simulated LLM reply through speaker_class into a WAV file."""
    api_key = os.getenv("INWORLD_API_KEY")
    if not api_key:
        print("Error: set INWORLD_API_KEY, for example with: export INWORLD_API_KEY=your_api_key_here")
        return 1
    reply = ("Sure, I can help with that. Your flight to Chicago leaves at 7:45 from gate B12, "
             "and boarding starts 30 minutes earlier. Would you like me to book a taxi?")
    tokens = re.findall(r"\s*\S{1,4}", reply)  # pieces the size of LLM tokens

    speaker = speaker_class(api_key)
    turn = await speaker.start_turn()

    async def stream_llm():
        for token in tokens:
            await speaker.send_text(turn, token)
            await asyncio.sleep(0.02)
        await speaker.end_turn(turn)

    pcm = bytearray()
    sender = asyncio.create_task(stream_llm())
    while True:
        kind, value = await turn.events.get()
        if kind == "audio":
            pcm.extend(value)  # hand to your audio player here
        elif kind == "synthesis":
            print(f"synthesis {value} complete, {turn.audio_seconds:.1f}s of audio so far")
        elif kind == "error":
            print(f"error: {value}")
            sender.cancel()
            await speaker.close()
            return 1
        elif kind == "closed":
            break
    await sender
    await speaker.close()

    with wave.open(output_file, "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(SAMPLE_RATE_HZ)
        f.writeframes(pcm)
    print(f"Wrote {len(pcm) / 2 / SAMPLE_RATE_HZ:.1f}s of audio to {output_file}")
    print(f"Heard through the first 3 seconds: {turn.heard(3.0)!r}")
    return 0


if __name__ == "__main__":
    exit(asyncio.run(speak_one_reply(Speaker, "whole_turn.wav")))
