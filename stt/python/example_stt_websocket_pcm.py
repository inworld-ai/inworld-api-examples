#!/usr/bin/env python3
"""
Example script for Inworld STT streaming transcription using WebSocket with raw PCM input.

This script demonstrates how to stream raw LINEAR16 PCM from a file to the STT
WebSocket API. For WAV input use example_stt_websocket.py instead.
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
END_OF_AUDIO_DELAY_MS = 350  # After last chunk before endTurn/closeStream (fixes missing last word).
CLOSE_GRACE_MS = 2500
DEFAULT_SAMPLE_RATE = 16000
DEFAULT_CHANNELS = 1


def check_api_key():
    """Check if INWORLD_API_KEY environment variable is set."""
    api_key = os.getenv("INWORLD_API_KEY")
    if not api_key:
        print("Error: INWORLD_API_KEY environment variable is not set.")
        print("Please set it with: export INWORLD_API_KEY=your_api_key_here")
        return None
    return api_key


async def stream_transcribe_pcm(
    pcm_path: str,
    sample_rate: int,
    channels: int,
    api_key: str,
    model_id: str = "assemblyai/universal-streaming-english",
):
    """Stream transcribe raw PCM file over WebSocket."""
    with open(pcm_path, "rb") as f:
        pcm_data = f.read()

    ws_url = API_BASE.replace("https://", "wss://").replace("http://", "ws://")
    ws_url += "/stt/v1/transcribe:streamBidirectional"

    final_texts = []
    last_partial = ""

    async with websockets.connect(
        ws_url,
        additional_headers={"Authorization": f"Basic {api_key}"},
    ) as ws:
        await ws.send(json.dumps({
            "transcribeConfig": {
                "modelId": model_id,
                "audioEncoding": "LINEAR16",
                "sampleRateHertz": sample_rate,
                "numberOfChannels": channels,
            }
        }))

        bytes_per_sample = 2 * channels
        chunk_size = int(CHUNK_DURATION_MS * (sample_rate / 1000) * bytes_per_sample)

        async def send_audio():
            for offset in range(0, len(pcm_data), chunk_size):
                chunk = pcm_data[offset : offset + chunk_size]
                await ws.send(json.dumps({
                    "audioChunk": {
                        "content": base64.b64encode(chunk).decode("utf-8"),
                    }
                }))
                await asyncio.sleep(CHUNK_DURATION_MS / 1000)
            await asyncio.sleep(END_OF_AUDIO_DELAY_MS / 1000)
            await ws.send(json.dumps({"endTurn": {}}))
            await ws.send(json.dumps({"closeStream": {}}))
            await asyncio.sleep(CLOSE_GRACE_MS / 1000)
            await ws.close()

        send_task = asyncio.create_task(send_audio())

        try:
            async for raw in ws:
                msg = json.loads(raw)
                transcription = msg.get("result", {}).get("transcription")
                if transcription is None:
                    continue
                text = transcription.get("transcript", "")
                is_final = transcription.get("isFinal", False)
                if text:
                    label = "[FINAL]" if is_final else "[interim]"
                    print(f"{label} {text}")
                    if is_final:
                        final_texts.append(text)
                        last_partial = ""
                    else:
                        last_partial = text
        except websockets.ConnectionClosed:
            pass

        await send_task

    if last_partial.strip():
        final_texts.append(last_partial.strip())
    return final_texts


def main():
    print("Inworld STT WebSocket Transcription Example (raw PCM)")
    print("=" * 50)

    api_key = check_api_key()
    if not api_key:
        return 1

    default_pcm_path = Path(__file__).parent.parent / "tests-data" / "audio" / "test-pcm-audio.pcm"
    pcm_path = sys.argv[1] if len(sys.argv) > 1 else str(default_pcm_path)
    sample_rate = int(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_SAMPLE_RATE
    channels = int(sys.argv[3]) if len(sys.argv) > 3 else DEFAULT_CHANNELS

    if not os.path.isfile(pcm_path):
        print(f"Error: PCM file not found: {pcm_path}")
        print("Usage: python example_stt_websocket_pcm.py [pcm.raw] [sample_rate] [channels]")
        print("  Default: tests-data/audio/test-pcm-audio.pcm, 16000 Hz, 1 channel")
        return 1

    try:
        print(f"PCM file: {pcm_path}")
        print(f"Sample rate: {sample_rate} Hz, Channels: {channels}\n")
        final_texts = asyncio.run(stream_transcribe_pcm(pcm_path, sample_rate, channels, api_key))
        print("\nFull transcript:", " ".join(final_texts).strip() or "(none)")
    except Exception as e:
        print(f"WebSocket transcription failed: {e}")
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
