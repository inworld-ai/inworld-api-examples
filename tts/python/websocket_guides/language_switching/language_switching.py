#!/usr/bin/env python3
"""
Speak a language tutor's turn that switches languages, over the TTS WebSocket.

Your LLM marks the language being taught with <l2>...</l2>. Everything else is
the learner's language, which you may also mark with <l1>...</l1>:

    Great job! "The dog runs" is <l2>El perro corre.</l2> Listen for the
    rolled r in <l2>/ˈpe.ro/</l2>, "dog".

Ask it to spell the taught language so that its pronunciation is certain:
kana, never kanji, for Japanese; pinyin with tone marks for Chinese; IPA
between slashes for Spanish words and short phrases. Kanji have several
readings, the same characters read differently in Chinese and Japanese, and a
Spanish word can be read as English. The voice speaks the sounds such a
spelling gives it, whichever language the service detects.

There are two ways to send a turn, and this client does both the same way: it
opens one context with no `language`, so the service detects the language of
every flush, and with auto mode off, so each flush is synthesized as sent.

- One flush: the tags are stripped and the whole turn is one flush, so one
  language is detected for all of it and one voice prompt speaks it. On a
  voice cloned from a clip in both languages, that prompt has both accents.
- Per-language flushes: the turn is flushed at every switch, and the language
  of each flush is detected on its own. On a voice with localized prompts,
  each flush is spoken on the prompt of its language when per-language prompt
  switching is enabled for your workspace, and all of them share the
  context's history, so the delivery carries across the switches. This works
  only for a flush that detection can place: kana, Hangul, or a sentence
  spelled in its own language. IPA reads as no language, so the flush takes
  the language of the turn so far; pinyin never reads as Chinese.

Audio is requested as raw PCM and written to a WAV file.
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

DEFAULT_TEXT = (
    'Great job! In Spanish, "the dog runs" is <l2>El perro corre.</l2> '
    'Listen for the rolled r in <l2>/ˈpe.ro/</l2>, "dog", '
    'and the single tap in <l2>/ˈpe.ɾo/</l2>, "but".'
)

TAG_RE = re.compile(r"</?(l1|l2)>", re.IGNORECASE)
# Punctuation right after a switch ends the segment before it.
CLOSING_PUNCTUATION = ".,!?;:…)]}\"'»」』）。、！？"


@dataclass
class Segment:
    language: str  # "l1" or "l2"
    text: str  # as written in the turn, whitespace included


@dataclass
class Flush:
    text: str
    language: str = ""  # "l1" or "l2" for a per-language flush
    pcm: bytearray = field(default_factory=bytearray)
    sent_at: float = 0.0
    first_audio_at: float | None = None


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


def one_flush(turn: str) -> list[Flush]:
    """The whole turn, tags stripped, as a single flush."""
    text = " ".join(TAG_RE.sub("", turn).split())
    return [Flush(text)] if speakable(text) else []


def per_language_flushes(turn: str) -> list[Flush]:
    """One flush per segment, so every language switch is a flush boundary."""
    return [Flush(" ".join(seg.text.split()), seg.language) for seg in split_turn(turn)]


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


async def synthesize(api_key: str, flushes: list[Flush], voice_id: str,
                     model_id: str = "inworld-tts-2", url: str = WEBSOCKET_URL) -> bytes:
    """Send the flushes on one context and return the turn's audio.

    Each flush's own audio is collected on it as well.
    """
    headers = {"Authorization": f"Basic {api_key}"}
    output = bytearray()
    async with websockets.connect(url, additional_headers=headers, max_size=None) as ws:
        # No `language`: the service detects it for every flush.
        # No `auto_mode`: every flush is synthesized exactly as sent.
        await ws.send(json.dumps({
            "context_id": CONTEXT_ID,
            "create": {
                "voice_id": voice_id,
                "model_id": model_id,
                "audio_config": {"audio_encoding": "PCM", "sample_rate_hertz": SAMPLE_RATE_HZ},
            },
        }))
        for flush in flushes:
            flush.sent_at = time.time()
            await ws.send(json.dumps({
                "context_id": CONTEXT_ID,
                "send_text": {"text": flush.text, "flush_context": {}},
            }))
        # Closing waits for every flush to be spoken; contextClosed comes last.
        await ws.send(json.dumps({"context_id": CONTEXT_ID, "close_context": {}}))

        # Flushes on one context are synthesized in order, each ending with a
        # flushCompleted, so a chunk belongs to the first flush not yet completed.
        completed = 0
        async for message in ws:
            response = json.loads(message)
            result = response.get("result", response)
            status = result.get("status") or {}
            if "error" in response or status.get("code"):
                raise RuntimeError((response.get("error") or status).get("message", "unknown error"))
            if "audioChunk" in result:
                pcm = strip_wav_header(base64.b64decode(result["audioChunk"].get("audioContent", "")))
                flush = flushes[min(completed, len(flushes) - 1)]
                if flush.first_audio_at is None:
                    flush.first_audio_at = time.time()
                flush.pcm.extend(pcm)
                output.extend(pcm)  # hand to your audio device here
            elif "flushCompleted" in result:
                completed += 1
            elif "contextClosed" in result:
                break
    return bytes(output)


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
  # One flush per language, on a voice with localized prompts
  python language_switching.py --per-language --voice-id Jason

  # One flush, on a voice cloned from a clip in both languages
  python language_switching.py --voice-id <your bilingual voice ID>

  # Your own turn
  python language_switching.py --per-language --voice-id Jason \\
      --text 'In Japanese, "thank you" is <l2>ありがとうございます。</l2> Say it back to me.'
        """,
    )
    parser.add_argument("--text", default=DEFAULT_TEXT,
                        help="Tutor turn, with the taught language in <l2>...</l2>")
    parser.add_argument("--per-language", action="store_true",
                        help="Flush at every language switch instead of sending the turn as one flush")
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

    flushes = per_language_flushes(args.text) if args.per_language else one_flush(args.text)
    if not flushes:
        print("Error: nothing to synthesize.")
        return 1
    print(f"Voice {args.voice_id}, {len(flushes)} flush(es):")
    for flush in flushes:
        print(f"  [{flush.language or 'turn'}] {flush.text}")

    try:
        start = time.time()
        pcm = await synthesize(api_key, flushes, args.voice_id, args.model_id, args.url)
    except Exception as e:
        print(f"\nSynthesis failed: {e}")
        return 1
    write_wav(args.output_file, pcm)
    print(f"\nWrote {len(pcm) / 2 / SAMPLE_RATE_HZ:.1f}s of audio to {args.output_file} "
          f"in {time.time() - start:.2f}s")
    return 0


if __name__ == "__main__":
    exit(asyncio.run(main()))
