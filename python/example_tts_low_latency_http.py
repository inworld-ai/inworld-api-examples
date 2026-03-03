#!/usr/bin/env python3
"""
Example script for low-latency TTS synthesis using HTTP streaming.

This script demonstrates how to achieve the lowest possible time-to-first-byte (TTFB)
with HTTP streaming by warming up the connection before timing synthesis.

Key technique: Use a persistent session to pre-establish the TCP+TLS connection
with a small warmup request, then measure only the synthesis latency.
"""

import base64
import json
import os
import time

import requests


def check_api_key():
    """Check if INWORLD_API_KEY environment variable is set."""
    api_key = os.getenv("INWORLD_API_KEY")
    if not api_key:
        print("Error: INWORLD_API_KEY environment variable is not set.")
        print("Please set it with: export INWORLD_API_KEY=your_api_key_here")
        return None
    return api_key


def http_streaming_tts(api_key, text, voice_id, model_id):
    """
    Measure low-latency TTS using HTTP streaming with connection warmup.

    Uses a persistent session to pre-establish the TCP+TLS connection,
    then measures TTFB from the actual synthesis request only.

    Args:
        api_key: API key for authentication
        text: Text to synthesize
        voice_id: Voice ID to use
        model_id: Model ID to use

    Returns:
        dict: Latency metrics (ttfb, total_time, audio_bytes) or None on error
    """
    url = "https://api.inworld.ai/tts/v1/voice:stream"

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Basic {api_key}"
    }

    request_data = {
        "text": text,
        "voice_id": voice_id,
        "model_id": model_id,
        "audio_config": {
            "audio_encoding": "OGG_OPUS",
            "sample_rate_hertz": 24000,
            "bit_rate": 32000
        }
    }

    # Use a session for connection reuse (TCP+TLS keepalive)
    session = requests.Session()
    session.headers.update(headers)

    try:
        # Warmup: establish TCP+TLS connection before timing
        warmup_data = {
            "text": "hi",
            "voice_id": voice_id,
            "model_id": model_id,
            "audio_config": {
                "audio_encoding": "OGG_OPUS",
                "sample_rate_hertz": 24000,
                "bit_rate": 32000
            }
        }

        # Non-streaming so the full response is read and the connection
        # is returned to the pool for reuse by the timed request.
        session.post(url, json=warmup_data)

        # Start timer - connection already established
        start_time = time.time()
        ttfb = None
        total_audio_bytes = 0

        with session.post(url, json=request_data, stream=True) as response:
            response.raise_for_status()

            for line in response.iter_lines(decode_unicode=True):
                if line.strip():
                    try:
                        chunk_data = json.loads(line)
                        result = chunk_data.get("result")
                        if result and "audioContent" in result:
                            audio_chunk = base64.b64decode(result["audioContent"])
                            if ttfb is None:
                                ttfb = time.time() - start_time
                            total_audio_bytes += len(audio_chunk)
                    except json.JSONDecodeError:
                        continue

        total_time = time.time() - start_time
        return {"ttfb": ttfb, "total_time": total_time, "audio_bytes": total_audio_bytes}

    except requests.exceptions.RequestException as e:
        print(f"HTTP Error: {e}")
        if hasattr(e, 'response') and e.response is not None:
            try:
                error_detail = e.response.json()
                print(f"   Error details: {error_detail}")
            except:
                print(f"   Response text: {e.response.text}")
        return None
    finally:
        session.close()


def main():
    """Main function to demonstrate low-latency HTTP streaming TTS."""
    print("Inworld TTS Low-Latency HTTP Streaming")
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
    print(f"\nWarming up connection, then generating audio...\n")

    try:
        result = http_streaming_tts(api_key, text, voice_id, model_id)

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
    exit(main())
