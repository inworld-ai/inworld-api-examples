#!/usr/bin/env python3
"""
Switch languages within an agent's turn, with language tags.

A language tutor's reply mixes the learner's language with the one being
taught. Tag every part with its language and send the reply as it is:

    <lang lang="en-US">"The dog runs" is</lang> <lang lang="es-MX">El perro corre.</lang>

The service speaks each span in its language, on the voice's localized prompt
for that language when it has one, and the context's history carries the
delivery across the switches. Tags pass through every guide's mode unchanged,
so this guide has no WebSocket client of its own. It speaks a tagged turn
through the base guide's speaker (../base/base.py), which sends the reply as
one flush, or the streaming-tokens one (../streaming_tokens/streaming_tokens.py),
which sends it token by token with sentence-boundary auto mode.

For comparison, it also sends the turn the two ways a client could before the
tags: with the tags stripped, so the service detects one language for the whole
turn, and with the tags stripped and a flush at every switch, so it detects
one per flush.

    python language_switching.py
    python language_switching.py --mode sentence
    python language_switching.py --mode no-tags
"""

import argparse
import asyncio
import os
import re
import sys
import time
import wave
from dataclasses import dataclass, field
from pathlib import Path

GUIDES = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(GUIDES / "base"))
sys.path.insert(0, str(GUIDES / "streaming_tokens"))

import base  # noqa: E402
import streaming_tokens  # noqa: E402

DEFAULT_TEXT = (
    '<lang lang="en-US">Great job! "The dog runs" is</lang> <lang lang="es-MX">El perro corre.</lang> '
    '<lang lang="en-US">Listen for the rolled r in</lang> <lang lang="es-MX">perro</lang>'
    '<lang lang="en-US">, and the single tap in</lang> <lang lang="es-MX">pero</lang>'
    '<lang lang="en-US">, which means "but".</lang>'
)

# <lang lang="es-MX">, <lang xml:lang='es-MX'> or </lang>. Tags are flat: an
# opening tag switches language wherever it stands, and a closing tag returns
# to untagged text.
LANG_TAG_RE = re.compile(r"<lang\s+(?:xml:)?lang\s*=\s*[\"']?([A-Za-z0-9-]+)[\"']?\s*>|</lang\s*>", re.IGNORECASE)


def strip_tags(text: str) -> str:
    return " ".join(LANG_TAG_RE.sub("", text).split())


def speakable(text: str) -> bool:
    return any(ch.isalnum() for ch in text)


def split_spans(text: str) -> list[tuple[str, str]]:
    """The turn as (language, text) spans with the tags removed; the language
    is "" for untagged text. A piece with nothing to speak, or in the language
    of the span before it, joins that span."""
    spans: list[tuple[str, str]] = []
    language, pos = "", 0
    for match in [*LANG_TAG_RE.finditer(text), None]:
        piece = text[pos:match.start() if match else len(text)]
        if piece and spans and (language == spans[-1][0] or not speakable(piece)):
            spans[-1] = (spans[-1][0], spans[-1][1] + piece)
        elif piece and spans and not speakable(spans[-1][1]):
            spans[-1] = (language, spans[-1][1] + piece)
        elif piece:
            spans.append((language, piece))
        if match:
            language, pos = match.group(1) or "", match.end()
    return [(lang, " ".join(piece.split())) for lang, piece in spans if speakable(piece)]


class NoTags(base.Speaker):
    """Before language tags: the whole turn as one flush, tags stripped. The
    service detects one language for all of it."""

    async def end_turn(self, turn: base.Turn):
        turn.pending = strip_tags(turn.pending)
        await super().end_turn(turn)


class PerLanguageFlushes(base.Speaker):
    """Before language tags: tags stripped, and a flush at every switch. The
    service detects the language of each flush on its own."""

    async def end_turn(self, turn: base.Turn):
        if turn.closing:
            return
        for _, text in split_spans(turn.pending):
            await self._send_text(turn, text, flush=True)
        turn.pending = ""
        await self._close(turn)


MODES = {
    "tags": base.Speaker,  # the tagged turn as one flush
    "sentence": streaming_tokens.Speaker,  # the tagged turn token by token
    "no-tags": NoTags,
    "per-language": PerLanguageFlushes,
}


@dataclass
class Synthesis:
    """One synthesis the service ran; each ends with a flushCompleted."""
    pcm: bytearray = field(default_factory=bytearray)
    first_audio_s: float | None = None  # seconds after the reply's first token


async def speak(mode: str, text: str, api_key: str, voice_id: str, model_id: str = "inworld-tts-2",
                url: str = base.WEBSOCKET_URL) -> list[Synthesis]:
    """Stream text through the mode's speaker, the way an LLM's tokens arrive,
    and return the audio of each synthesis the service ran."""
    speaker = MODES[mode](api_key, voice_id, model_id, url)
    await speaker.connect()
    turn = await speaker.start_turn()
    start = time.time()

    async def stream_llm():
        for token in re.findall(r"\s*\S{1,4}", text):  # pieces the size of LLM tokens
            await speaker.send_text(turn, token)
            await asyncio.sleep(0.02)
        await speaker.end_turn(turn)

    sender = asyncio.create_task(stream_llm())
    syntheses = [Synthesis()]
    try:
        while True:
            kind, value = await turn.events.get()
            if kind == "audio":
                if syntheses[-1].first_audio_s is None:
                    syntheses[-1].first_audio_s = time.time() - start
                syntheses[-1].pcm.extend(value)  # hand to your audio player here
            elif kind == "synthesis":
                syntheses.append(Synthesis())
            elif kind == "error":
                raise RuntimeError(value)
            elif kind == "closed":
                break
        await sender
    finally:
        sender.cancel()
        await speaker.close()
    return [s for s in syntheses if s.pcm]


async def main():
    parser = argparse.ArgumentParser(
        description="Speak a turn that switches languages, with language tags, over the Inworld TTS WebSocket")
    parser.add_argument("--text", default=DEFAULT_TEXT, help="The turn, with every part in a <lang> tag")
    parser.add_argument("--mode", choices=list(MODES), default="tags",
                        help="tags: one flush; sentence: token by token with sentence-boundary auto mode; "
                             "no-tags and per-language: the tags stripped, for comparison (default: tags)")
    parser.add_argument("--voice-id", default="Sarah",
                        help="Voice ID; pick one with a localized prompt for each language (default: Sarah)")
    parser.add_argument("--model-id", default="inworld-tts-2", help="Model ID (default: inworld-tts-2)")
    parser.add_argument("--output-file", default="language_switching.wav",
                        help="Output WAV path (default: language_switching.wav)")
    args = parser.parse_args()

    api_key = os.getenv("INWORLD_API_KEY")
    if not api_key:
        print("Error: set INWORLD_API_KEY, for example with: export INWORLD_API_KEY=your_api_key_here")
        return 1
    try:
        syntheses = await speak(args.mode, args.text, api_key, args.voice_id, args.model_id)
    except Exception as e:
        print(f"Synthesis failed: {e}")
        return 1
    for i, s in enumerate(syntheses):
        print(f"synthesis {i}: {len(s.pcm) / 2 / base.SAMPLE_RATE_HZ:.2f}s, "
              f"first audio after {s.first_audio_s * 1000:.0f} ms")
    with wave.open(args.output_file, "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(base.SAMPLE_RATE_HZ)
        f.writeframes(b"".join(s.pcm for s in syntheses))
    print(f"Wrote {args.output_file}")
    return 0


if __name__ == "__main__":
    exit(asyncio.run(main()))
