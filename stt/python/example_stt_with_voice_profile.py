#!/usr/bin/env python3
"""
Example script for Inworld STT WebSocket transcription with voice profile detection.

Streams raw LINEAR16 PCM over the STT WebSocket and receives transcription results
along with speaker voice characteristics (age, gender, emotion, vocal style, accent).
Audio must be 16 kHz, 1 channel. Default input: tests-data/audio/test-pcm-audio.pcm.
"""

import asyncio
import base64
import json
import os
import sys
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

import websockets

API_BASE = "https://api.inworld.ai"
CHUNK_DURATION_MS = 100
END_OF_AUDIO_DELAY_MS = 350
SILENCE_BEFORE_CLOSE_MS = 1500
CLOSE_GRACE_MS = 2500
DEFAULT_SAMPLE_RATE = 16000
DEFAULT_CHANNELS = 1

# Default voice profile configuration.
DEFAULT_VOICE_PROFILE_TOP_N = 5


def check_api_key():
    """Check if INWORLD_API_KEY environment variable is set."""
    api_key = os.getenv("INWORLD_API_KEY")
    if not api_key:
        print("Error: INWORLD_API_KEY environment variable is not set.")
        print("Please set it with: export INWORLD_API_KEY=your_api_key_here")
        return None
    return api_key


def format_voice_profile(voice_profile):
    """Format voice profile data for display."""
    lines = []
    categories = [
        ("Age", "age"),
        ("Gender", "gender"),
        ("Emotion", "emotion"),
        ("Vocal Style", "vocalStyle"),
        ("Accent", "accent"),
    ]
    for display_name, key in categories:
        labels = voice_profile.get(key, [])
        if labels:
            items = ", ".join(
                f"{l['label']} ({l['confidence']:.2f})" for l in labels
            )
            lines.append(f"  {display_name}: {items}")
    return "\n".join(lines) if lines else "  (no data)"


async def stream_transcribe(
    pcm_path: str,
    sample_rate: int,
    channels: int,
    api_key: str,
    model_id: str = "inworld/inworld-stt-1",
    voice_profile_top_n: int = DEFAULT_VOICE_PROFILE_TOP_N,
):
    """
    Stream transcribe raw PCM over WebSocket with voice profile detection.

    Returns:
        list[str]: Final transcript segments (and any trailing partial).
    """
    pcm = Path(pcm_path).read_bytes()
    ws_url = API_BASE.replace("https://", "wss://").replace("http://", "ws://")
    ws_url += "/stt/v1/transcribe:streamBidirectional"
    headers = {"Authorization": f"Basic {api_key}"}

    final_texts = []
    last_partial = ""
    audio_complete = False
    silence_task = None

    def check_close():
        nonlocal silence_task
        if not audio_complete:
            return
        if silence_task and not silence_task.done():
            silence_task.cancel()
        silence_task = asyncio.create_task(_close_after_silence())

    async def _close_after_silence():
        try:
            await asyncio.sleep(SILENCE_BEFORE_CLOSE_MS / 1000.0)
            try:
                await ws.send(json.dumps({"closeStream": {}}))
                await asyncio.sleep(CLOSE_GRACE_MS / 1000.0)
                await ws.close()
            except (websockets.exceptions.ConnectionClosed, OSError, RuntimeError):
                pass  # already closed or closing
        except asyncio.CancelledError:
            pass

    async with websockets.connect(ws_url, additional_headers=headers) as ws:
        await ws.send(json.dumps({
            "transcribeConfig": {
                "modelId": model_id,
                "audioEncoding": "LINEAR16",
                "sampleRateHertz": sample_rate,
                "numberOfChannels": channels,
                "language": "en-US",
                "voiceProfileConfig": {
                    "enableVoiceProfile": True,
                    "topN": voice_profile_top_n,
                },
            }
        }))

        bytes_per_sample = 2 * channels
        chunk_size = int((CHUNK_DURATION_MS / 1000) * sample_rate * bytes_per_sample)

        async def send_audio():
            nonlocal audio_complete
            for i in range(0, len(pcm), chunk_size):
                chunk = pcm[i : i + chunk_size]
                if not chunk:
                    break
                await ws.send(json.dumps({
                    "audioChunk": {"content": base64.b64encode(chunk).decode()}
                }))
                await asyncio.sleep(CHUNK_DURATION_MS / 1000.0)
            await asyncio.sleep(END_OF_AUDIO_DELAY_MS / 1000.0)
            audio_complete = True
            await ws.send(json.dumps({"endTurn": {}}))
            check_close()

        send_task = asyncio.create_task(send_audio())

        try:
            while True:
                try:
                    raw = await ws.recv()
                except websockets.exceptions.ConnectionClosed:
                    break

                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                t = msg.get("result", {}).get("transcription", {})
                if not t:
                    continue
                text = t.get("transcript", "")
                is_final = t.get("isFinal", False)
                label = "[FINAL]" if is_final else "[interim]"
                if text:
                    print(f"{label} {text}")
                    if is_final:
                        final_texts.append(text)
                        last_partial = ""
                    else:
                        last_partial = text

                voice_profile = t.get("voiceProfile")
                if voice_profile and is_final:
                    print(f"Voice profile:\n{format_voice_profile(voice_profile)}")

                if audio_complete:
                    check_close()
        except asyncio.CancelledError:
            pass
        finally:
            await send_task

    if last_partial.strip():
        final_texts.append(last_partial.strip())
    return final_texts


def main():
    print("Inworld STT WebSocket Transcription with Voice Profile Example")
    print("=" * 60)

    api_key = check_api_key()
    if not api_key:
        return 1

    default_pcm = Path(__file__).resolve().parent.parent / "tests-data" / "audio" / "test-pcm-audio.pcm"
    pcm_path = Path(sys.argv[1]) if len(sys.argv) > 1 else default_pcm
    sample_rate = DEFAULT_SAMPLE_RATE
    channels = DEFAULT_CHANNELS

    voice_profile_top_n = DEFAULT_VOICE_PROFILE_TOP_N

    pcm_path = pcm_path.resolve()
    if not pcm_path.exists():
        print(f"Error: PCM file not found: {pcm_path}")
        print("Usage: python example_stt_with_voice_profile.py [pcm_file]")
        print(f"  Default: {default_pcm} (16 kHz, 1 channel)")
        return 1

    try:
        print(f"PCM file: {pcm_path}")
        print(f"Sample rate: {sample_rate} Hz, Channels: {channels}")
        print(f"Voice profile: enabled, topN={voice_profile_top_n}\n")
        final_texts = asyncio.run(stream_transcribe(
            str(pcm_path), sample_rate, channels, api_key,
            voice_profile_top_n=voice_profile_top_n,
        ))
        print("\nFull transcript:", " ".join(final_texts).strip() or "(none)")
    except Exception as err:
        print(f"WebSocket transcription failed: {err}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
