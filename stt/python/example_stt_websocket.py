#!/usr/bin/env python3
"""
Example script for Inworld STT streaming transcription using WebSocket.

This script demonstrates how to stream audio from a WAV file to the STT
WebSocket API for real-time transcription. For raw PCM input use example_stt_websocket_pcm.py.
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
# Delay after last audio chunk before endTurn/closeStream so the server can process trailing samples (fixes missing last word).
END_OF_AUDIO_DELAY_MS = 350
CLOSE_GRACE_MS = 2500


def check_api_key():
    """Check if INWORLD_API_KEY environment variable is set."""
    api_key = os.getenv("INWORLD_API_KEY")
    if not api_key:
        print("Error: INWORLD_API_KEY environment variable is not set.")
        print("Please set it with: export INWORLD_API_KEY=your_api_key_here")
        return None
    return api_key


async def stream_transcribe(wav_path: str, api_key: str, model_id: str = "assemblyai/universal-streaming-english"):
    """Stream transcribe a WAV file over WebSocket. Same flow as JS: grace close, lastPartial."""
    import wave
    with wave.open(wav_path, "rb") as wf:
        sample_rate = wf.getframerate()
        channels = wf.getnchannels()
        sample_width = wf.getsampwidth()
        pcm_data = wf.readframes(wf.getnframes())

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

        bytes_per_sample = sample_width * channels
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
    print("Inworld STT WebSocket Transcription Example (from WAV)")
    print("=" * 50)

    api_key = check_api_key()
    if not api_key:
        return 1

    default_audio_path = Path(__file__).parent.parent / "tests-data" / "audio" / "test-audio.wav"
    audio_path = sys.argv[1] if len(sys.argv) > 1 else str(default_audio_path)
    if not os.path.isfile(audio_path):
        print(f"Error: WAV file not found: {audio_path}")
        print("Usage: python example_stt_websocket.py [path/to/audio.wav]")
        print("Default: tests-data/audio/test-audio.wav")
        return 1

    try:
        print(f"Audio file: {audio_path}\n")
        final_texts = asyncio.run(stream_transcribe(audio_path, api_key))
        print("\nFull transcript:", " ".join(final_texts).strip() or "(none)")
    except Exception as e:
        print(f"WebSocket transcription failed: {e}")
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
