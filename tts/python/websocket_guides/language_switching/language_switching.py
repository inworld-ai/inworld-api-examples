#!/usr/bin/env python3
"""
Speak a language tutor's turn that switches languages, over the TTS WebSocket.

Your LLM marks the language being taught with <l2>...</l2>. Everything else is
the learner's language, which you may also mark with <l1>...</l1>:

    Great job! "The dog runs" is <l2>El perro corre.</l2> Listen for the
    rolled r in <l2>perro</l2>, "dog".

Ask it to write Japanese in kana, never kanji: kanji have several readings,
and the same characters read as Chinese. Kana has one reading, and always
reads as Japanese.

Every mode opens one context with no `language`, so the service detects the
language of each synthesis, and strips the <l1>/<l2> tags before sending:

- one: the whole turn as one flush. One language is detected for all of it,
  and one voice prompt speaks it. On a voice cloned from a clip in both
  languages, that prompt has both accents.
- per-language: a flush at every switch, so the language of each flush is
  detected on its own. On a voice with localized prompts, each flush is spoken
  on the prompt of its language when per-language prompt switching is enabled
  for your workspace. This works for a flush detection can place: kana,
  Hangul, or a sentence in its own spelling. A single Spanish word reads as
  English, and a word or two of Chinese characters takes the language of the
  turn so far.
- instructions: a flush at every switch, as in per-language, with each flush
  opening with an inline instruction such as [in pure Spanish]. Each flush gets
  its own detected language and prompt, and the instruction steers its
  delivery, which helps most where detection places the flush on the other
  language's prompt, as it does a single word. Detection ignores the
  instruction.
- sentence: the turn streamed in small pieces, the way an LLM's tokens arrive,
  with sentence-boundary auto mode. The service starts a synthesis at every
  sentence end, and detects the language of each; while one runs, it batches
  the sentences that arrive, and a batch is spoken in one language.

All syntheses on one context share its history, so the delivery carries from
one to the next. Audio is requested as raw PCM and written to a WAV file.
"""

import argparse
import asyncio
import base64
import json
import os
import re
import time
import wave
from dataclasses import dataclass, field

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # dotenv is optional; INWORLD_API_KEY can also be set via export

import websockets

WEBSOCKET_URL = "wss://api.inworld.ai/tts/v1/voice:streamBidirectional"
SAMPLE_RATE_HZ = 24000
CONTEXT_ID = "turn"
MODES = ("one", "per-language", "instructions", "sentence")
DEFAULT_INSTRUCTION = "in pure {language}"
TOKEN_DELAY_S = 0.02  # sentence mode sends a piece this often, like an LLM's tokens

DEFAULT_TEXT = (
    'Great job! In Spanish, "the dog runs" is <l2>El perro corre.</l2> '
    'Listen for the rolled r in <l2>perro</l2>, "dog", '
    'and the single tap in <l2>pero</l2>, "but".'
)

TAG_RE = re.compile(r"</?(l1|l2)>", re.IGNORECASE)
# Punctuation right after a switch ends the segment before it.
CLOSING_PUNCTUATION = ".,!?;:…)]}\"'»」』）。、！？"


@dataclass
class Segment:
    language: str  # "l1" or "l2"
    text: str  # as written in the turn, whitespace included


@dataclass
class Synthesis:
    """One synthesis the service ran; each ends with a flushCompleted."""
    text: str = ""  # what was flushed; empty in sentence mode, where the service cuts
    language: str = ""  # "l1" or "l2" for a per-language flush
    pcm: bytearray = field(default_factory=bytearray)
    first_audio_s: float | None = None  # seconds after the turn's first message


def speakable(text: str) -> bool:
    return any(ch.isalnum() for ch in text)


def split_turn(turn: str) -> list[Segment]:
    """Split a turn at its <l1>/<l2> tags into segments of one language each.

    Text outside the tags is l1. A piece joins the segment before it when it
    is in the same language or has nothing to speak (only spaces or
    punctuation), so every segment has something to speak and each segment
    boundary is a language switch.
    """
    segments: list[Segment] = []
    language, pos = "l1", 0
    for match in [*TAG_RE.finditer(turn), None]:
        piece = turn[pos:match.start() if match else len(turn)]
        if segments and language != segments[-1].language:
            closing = len(piece) - len(piece.lstrip(CLOSING_PUNCTUATION))
            segments[-1].text += piece[:closing]
            piece = piece[closing:]
        if not piece:
            pass
        elif segments and (language == segments[-1].language or not speakable(piece)):
            segments[-1].text += piece
        elif segments and not speakable(segments[-1].text):
            segments[-1] = Segment(language, segments[-1].text + piece)
        else:
            segments.append(Segment(language, piece))
        if match:
            language = "l1" if match.group(0).startswith("</") else match.group(1).lower()
            pos = match.end()
    return [seg for seg in segments if speakable(seg.text)]


def plain_text(turn: str) -> str:
    return " ".join(TAG_RE.sub("", turn).split())


def messages_for(mode: str, turn: str, names: dict[str, str] | None = None,
                 instruction: str = DEFAULT_INSTRUCTION) -> list[Synthesis]:
    """What to send for a mode: one entry per message, in order.

    In the flush modes each message is flushed, so each is one synthesis. In
    sentence mode the messages are token-sized pieces sent without a flush.
    names maps "l1" and "l2" to language names for instructions.
    """
    if mode == "per-language":
        return [Synthesis(" ".join(seg.text.split()), seg.language) for seg in split_turn(turn)]
    if mode == "instructions":
        names = names or {"l1": "English", "l2": "Spanish"}
        return [Synthesis(f"[{instruction.format(language=names[seg.language])}] {' '.join(seg.text.split())}",
                          seg.language) for seg in split_turn(turn)]
    text = plain_text(turn)
    if not speakable(text):
        return []
    if mode == "sentence":
        return [Synthesis(piece) for piece in re.findall(r"\s*\S{1,4}", text)]
    return [Synthesis(text)]


def strip_wav_header(audio: bytes) -> bytes:
    """Return the PCM samples of a chunk, dropping a RIFF/WAV header if present."""
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


async def synthesize(api_key: str, messages: list[Synthesis], voice_id: str, model_id: str = "inworld-tts-2",
                     url: str = WEBSOCKET_URL, sentence_mode: bool = False) -> list[Synthesis]:
    """Send the messages on one context and return the syntheses the service ran.

    Without sentence_mode, auto mode is off and every message carries a flush,
    so the syntheses are the messages, in order. With it, the messages are
    sent as a stream and the service decides where each synthesis starts.
    """
    headers = {"Authorization": f"Basic {api_key}"}
    create = {
        "voice_id": voice_id,
        "model_id": model_id,
        "audio_config": {"audio_encoding": "PCM", "sample_rate_hertz": SAMPLE_RATE_HZ},
    }
    if sentence_mode:
        create.update({"auto_mode": True, "auto_mode_strategy": "SENTENCE_BOUNDARY"})
    syntheses = [] if sentence_mode else messages
    async with websockets.connect(url, additional_headers=headers, max_size=None) as ws:
        # No `language`: the service detects it for every synthesis.
        await ws.send(json.dumps({"context_id": CONTEXT_ID, "create": create}))

        async def send_all():
            for message in messages:
                send_text = {"text": message.text}
                if not sentence_mode:
                    send_text["flush_context"] = {}
                await ws.send(json.dumps({"context_id": CONTEXT_ID, "send_text": send_text}))
                if sentence_mode:
                    await asyncio.sleep(TOKEN_DELAY_S)
            # Closing releases any text still held, and contextClosed comes last.
            await ws.send(json.dumps({"context_id": CONTEXT_ID, "close_context": {}}))

        start = time.time()
        sender = asyncio.create_task(send_all())
        # Syntheses on one context run in order, each ending with a
        # flushCompleted, so a chunk belongs to the first one not yet completed.
        completed = 0
        try:
            async for raw in ws:
                response = json.loads(raw)
                result = response.get("result", response)
                status = result.get("status") or {}
                if "error" in response or status.get("code"):
                    raise RuntimeError((response.get("error") or status).get("message", "unknown error"))
                if "audioChunk" in result:
                    pcm = strip_wav_header(base64.b64decode(result["audioChunk"].get("audioContent", "")))
                    if completed == len(syntheses):
                        syntheses.append(Synthesis())
                    current = syntheses[min(completed, len(syntheses) - 1)]
                    if current.first_audio_s is None:
                        current.first_audio_s = time.time() - start
                    current.pcm.extend(pcm)  # hand to your audio device here
                elif "flushCompleted" in result:
                    completed += 1
                elif "contextClosed" in result:
                    break
        finally:
            sender.cancel()
            await asyncio.gather(sender, return_exceptions=True)
    return [s for s in syntheses if s.pcm]


def write_wav(path: str, pcm: bytes):
    with wave.open(path, "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(SAMPLE_RATE_HZ)
        f.writeframes(pcm)


async def main():
    parser = argparse.ArgumentParser(
        description="Speak a language tutor's turn that switches languages, over the Inworld TTS WebSocket",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # One flush, on a voice cloned from a clip in both languages
  python language_switching.py --voice-id <your bilingual voice ID>

  # A flush at every switch, on a voice with localized prompts
  python language_switching.py --mode per-language --voice-id Jason

  # A flush at every switch, each opening with an instruction
  python language_switching.py --mode instructions --voice-id Jason --languages English,Spanish

  # Streamed like an LLM's tokens, with sentence-boundary auto mode
  python language_switching.py --mode sentence --voice-id Jason
        """,
    )
    parser.add_argument("--text", default=DEFAULT_TEXT,
                        help="Tutor turn, with the taught language in <l2>...</l2>")
    parser.add_argument("--mode", choices=MODES, default="one", help="How to send the turn (default: one)")
    parser.add_argument("--languages", default="English,Spanish",
                        help="Names of the l1 and l2 languages, for instructions (default: English,Spanish)")
    parser.add_argument("--instruction", default=DEFAULT_INSTRUCTION,
                        help=f"Instruction opening every flush, with {{language}} (default: {DEFAULT_INSTRUCTION!r})")
    parser.add_argument("--voice-id", default="Jason", help="Voice ID (default: Jason)")
    parser.add_argument("--model-id", default="inworld-tts-2", help="Model ID (default: inworld-tts-2)")
    parser.add_argument("--url", default=WEBSOCKET_URL, help="WebSocket endpoint")
    parser.add_argument("--output-file", default="language_switching.wav",
                        help="Output WAV path (default: language_switching.wav)")
    args = parser.parse_args()

    api_key = os.getenv("INWORLD_API_KEY")
    if not api_key:
        print("Error: INWORLD_API_KEY environment variable is not set.")
        print("Please set it with: export INWORLD_API_KEY=your_api_key_here")
        return 1

    l1, l2 = (name.strip() for name in args.languages.split(",", 1))
    messages = messages_for(args.mode, args.text, {"l1": l1, "l2": l2}, args.instruction)
    if not messages:
        print("Error: nothing to synthesize.")
        return 1
    print(f"Voice {args.voice_id}, mode {args.mode}, {len(messages)} message(s)")

    try:
        start = time.time()
        syntheses = await synthesize(api_key, messages, args.voice_id, args.model_id, args.url,
                                     sentence_mode=args.mode == "sentence")
    except Exception as e:
        print(f"\nSynthesis failed: {e}")
        return 1
    for i, s in enumerate(syntheses):
        label = f"[{s.language}] {s.text}" if s.text else "(cut by the service)"
        print(f"  #{i} {len(s.pcm) / 2 / SAMPLE_RATE_HZ:5.2f}s  first audio {s.first_audio_s * 1000:5.0f} ms  {label}")
    pcm = b"".join(s.pcm for s in syntheses)
    write_wav(args.output_file, pcm)
    print(f"\nWrote {len(pcm) / 2 / SAMPLE_RATE_HZ:.1f}s of audio to {args.output_file} in {time.time() - start:.2f}s")
    return 0


if __name__ == "__main__":
    exit(asyncio.run(main()))
