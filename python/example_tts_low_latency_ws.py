#!/usr/bin/env python3
"""
Example script for low-latency TTS synthesis using WebSocket.

This script demonstrates how to achieve the lowest possible time-to-first-byte (TTFB)
with WebSocket by pre-establishing the connection and audio context before timing.

Key technique: Connect and create the audio context ahead of time, then measure
only from text submission to first audio chunk arrival.
"""

import asyncio
import base64
import json
import os
import re
import time

import websockets
from websockets.exceptions import WebSocketException


def split_sentences(text):
    """Split text into sentences using common end-of-sentence markers across languages.
    Handles: . ! ? 。 ！ ？ । ؟ ۔"""
    parts = re.findall(r'[^.!?。！？।؟۔]*[.!?。！？।؟۔]+[\s]*', text)
    sentences = [s.strip() for s in parts if s.strip()]
    matched_len = sum(len(p) for p in parts)
    remaining = text[matched_len:].strip()
    if remaining:
        sentences.append(remaining)
    return sentences


def check_api_key():
    """Check if INWORLD_API_KEY environment variable is set."""
    api_key = os.getenv("INWORLD_API_KEY")
    if not api_key:
        print("Error: INWORLD_API_KEY environment variable is not set.")
        print("Please set it with: export INWORLD_API_KEY=your_api_key_here")
        return None
    return api_key


async def websocket_tts(api_key, text, voice_id, model_id):
    """
    Measure low-latency TTS using WebSocket with pre-established context.

    Connects and creates the audio context before starting the timer,
    then measures TTFB from text submission to first audio chunk.

    Args:
        api_key: API key for authentication
        text: Text to synthesize
        voice_id: Voice ID to use
        model_id: Model ID to use

    Returns:
        dict: Latency metrics (ttfb, total_time, audio_bytes) or None on error
    """
    url = "wss://api.inworld.ai/tts/v1/voice:streamBidirectional"
    headers = {"Authorization": f"Basic {api_key}"}
    context_id = "ctx-latency-test"

    try:
        async with websockets.connect(url, additional_headers=headers) as ws:
            # Create context (not timed - this is setup)
            create_msg = {
                "context_id": context_id,
                "create": {
                    "voice_id": voice_id,
                    "model_id": model_id,
                    "audio_config": {
                        "audio_encoding": "OGG_OPUS",
                        "sample_rate_hertz": 24000,
                        "bit_rate": 32000
                    }
                }
            }
            await ws.send(json.dumps(create_msg))

            # Wait for context creation confirmation
            while True:
                msg = await ws.recv()
                data = json.loads(msg)
                if "error" in data:
                    print(f"WebSocket error: {data['error']}")
                    return None
                result = data.get("result", {})
                if "contextCreated" in result:
                    break

            # Start timer - context is ready, measure synthesis latency only
            start_time = time.time()

            # Send text sentence-by-sentence, flushing each for lowest TTFB
            sentences = split_sentences(text)
            for sentence in sentences:
                text_msg = {
                    "context_id": context_id,
                    "send_text": {
                        "text": sentence,
                        "flush_context": {}
                    }
                }
                await ws.send(json.dumps(text_msg))

            close_msg = {"context_id": context_id, "close_context": {}}
            await ws.send(json.dumps(close_msg))

            # Receive audio chunks
            ttfb = None
            total_audio_bytes = 0

            async for message in ws:
                data = json.loads(message)

                if "error" in data:
                    print(f"WebSocket error: {data['error']}")
                    break

                result = data.get("result")
                if not result:
                    if data.get("done"):
                        break
                    continue

                if "contextClosed" in result:
                    break

                if "audioChunk" in result:
                    audio_chunk = result["audioChunk"]
                    b64_content = audio_chunk.get("audioContent")
                    if b64_content:
                        if ttfb is None:
                            ttfb = time.time() - start_time
                        audio_bytes = base64.b64decode(b64_content)
                        total_audio_bytes += len(audio_bytes)

            total_time = time.time() - start_time
            return {"ttfb": ttfb, "total_time": total_time, "audio_bytes": total_audio_bytes}

    except WebSocketException as e:
        print(f"WebSocket error: {e}")
        return None
    except Exception as e:
        print(f"Error during WebSocket synthesis: {e}")
        return None


async def main():
    """Main function to demonstrate low-latency WebSocket TTS."""
    print("Inworld TTS Low-Latency WebSocket")
    print("=" * 45)

    # Check API key
    api_key = check_api_key()
    if not api_key:
        return 1

    # Configuration
    text = "Life moves pretty fast. Look around once in a while, or you might miss it."
    voice_id = "Dennis"
    model_id = "inworld-tts-1.5-mini"

    print(f"   Text: \"{text}\"")
    print(f"  Voice: {voice_id}")
    print(f"  Model: {model_id}")
    print(f"\nConnecting and creating context, then generating audio...\n")

    try:
        result = await websocket_tts(api_key, text, voice_id, model_id)

        if result:
            print(f"TTFB:         {result['ttfb']*1000:.1f} ms")
            print(f"Total time:   {result['total_time']*1000:.1f} ms")
            print(f"Audio bytes:  {result['audio_bytes']}")
        else:
            print("Synthesis failed.")
            return 1

    except Exception as e:
        print(f"\nLatency test failed: {e}")
        return 1

    return 0


if __name__ == "__main__":
    exit(asyncio.run(main()))
