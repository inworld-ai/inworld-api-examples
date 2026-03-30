#!/usr/bin/env python3
"""
Example script for Inworld STT WebSocket transcription with VAD configuration.

Sends raw LINEAR16 PCM over the STT WebSocket. Audio must be 16 kHz, 1 channel.
Default input: tests-data/audio/test-pcm-audio.pcm.
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

# Default VAD configuration values for the inworld/inworld-stt-1 model.
DEFAULT_VAD_THRESHOLD = 0.15
DEFAULT_MIN_END_OF_TURN_SILENCE_WHEN_CONFIDENT = 300
DEFAULT_END_OF_TURN_CONFIDENCE_THRESHOLD = 0.4


def check_api_key():
    """Check if INWORLD_API_KEY environment variable is set."""
    api_key = os.getenv("INWORLD_API_KEY")
    if not api_key:
        print("Error: INWORLD_API_KEY environment variable is not set.")
        print("Please set it with: export INWORLD_API_KEY=your_api_key_here")
        return None
    return api_key


async def stream_transcribe(
    pcm_path: str,
    sample_rate: int,
    channels: int,
    api_key: str,
    model_id: str = "inworld/inworld-stt-1",
    vad_threshold: float = DEFAULT_VAD_THRESHOLD,
    min_end_of_turn_silence_when_confident: int = DEFAULT_MIN_END_OF_TURN_SILENCE_WHEN_CONFIDENT,
    end_of_turn_confidence_threshold: float = DEFAULT_END_OF_TURN_CONFIDENCE_THRESHOLD,
):
    """
    Stream transcribe raw PCM over WebSocket with VAD configuration.

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

    async with websockets.connect(ws_url, extra_headers=headers) as ws:
        await ws.send(json.dumps({
            "transcribeConfig": {
                "modelId": model_id,
                "audioEncoding": "LINEAR16",
                "sampleRateHertz": sample_rate,
                "numberOfChannels": channels,
                "language": "en-US",
                "endOfTurnConfidenceThreshold": end_of_turn_confidence_threshold,
                "inworldSttV1Config": {
                    "vadThreshold": vad_threshold,
                    "minEndOfTurnSilenceWhenConfident": min_end_of_turn_silence_when_confident,
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
    print("Inworld STT WebSocket Transcription with VAD Config Example")
    print("=" * 50)

    api_key = check_api_key()
    if not api_key:
        return 1

    default_pcm = Path(__file__).resolve().parent.parent / "tests-data" / "audio" / "test-pcm-audio.pcm"
    pcm_path = Path(sys.argv[1]) if len(sys.argv) > 1 else default_pcm
    sample_rate = DEFAULT_SAMPLE_RATE
    channels = DEFAULT_CHANNELS

    vad_threshold = DEFAULT_VAD_THRESHOLD
    min_end_of_turn_silence_when_confident = DEFAULT_MIN_END_OF_TURN_SILENCE_WHEN_CONFIDENT
    end_of_turn_confidence_threshold = DEFAULT_END_OF_TURN_CONFIDENCE_THRESHOLD

    pcm_path = pcm_path.resolve()
    if not pcm_path.exists():
        print(f"Error: PCM file not found: {pcm_path}")
        print("Usage: python example_stt_with_vad_config.py [pcm_file]")
        print(f"  Default: {default_pcm} (16 kHz, 1 channel)")
        return 1

    try:
        print(f"PCM file: {pcm_path}")
        print(f"Sample rate: {sample_rate} Hz, Channels: {channels}")
        print(f"VAD config: vad_threshold={vad_threshold}, "
              f"min_end_of_turn_silence_when_confident={min_end_of_turn_silence_when_confident}ms, "
              f"end_of_turn_confidence_threshold={end_of_turn_confidence_threshold}\n")
        final_texts = asyncio.run(stream_transcribe(
            str(pcm_path), sample_rate, channels, api_key,
            vad_threshold=vad_threshold,
            min_end_of_turn_silence_when_confident=min_end_of_turn_silence_when_confident,
            end_of_turn_confidence_threshold=end_of_turn_confidence_threshold,
        ))
        print("\nFull transcript:", " ".join(final_texts).strip() or "(none)")
    except Exception as err:
        print(f"WebSocket transcription failed: {err}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
