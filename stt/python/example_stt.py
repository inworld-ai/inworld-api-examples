#!/usr/bin/env python3
"""
Example script for Inworld STT synchronous transcription using HTTP.

This script demonstrates how to transcribe a complete audio file in a single
POST request. Supports WAV and other formats via AUTO_DETECT or explicit encoding.
"""

import base64
import os
import sys
import time
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

import requests

API_BASE = "https://api.inworld.ai"


def check_api_key():
    """Check if INWORLD_API_KEY environment variable is set."""
    api_key = os.getenv("INWORLD_API_KEY")
    if not api_key:
        print("Error: INWORLD_API_KEY environment variable is not set.")
        print("Please set it with: export INWORLD_API_KEY=your_api_key_here")
        return None
    return api_key


def transcribe(audio_path: str, options: dict | None = None, api_key: str = ""):
    """
    Transcribe audio using Inworld STT API (synchronous).

    Args:
        audio_path: Path to audio file (WAV, MP3, etc.)
        options: Optional transcribeConfig overrides
        api_key: API key for authentication

    Returns:
        dict: Response with transcription and usage
    """
    url = f"{API_BASE}/stt/v1/transcribe"
    with open(audio_path, "rb") as f:
        content_b64 = base64.b64encode(f.read()).decode("utf-8")

    transcribe_config = {
        "modelId": "groq/whisper-large-v3-turbo",
        "audioEncoding": "AUTO_DETECT",
        "language": "en-US",
    }
    if options:
        transcribe_config.update(options)

    body = {
        "transcribeConfig": transcribe_config,
        "audioData": {"content": content_b64},
    }
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Basic {api_key}",
    }

    response = requests.post(url, headers=headers, json=body)
    response.raise_for_status()
    return response.json()


def main():
    print("Inworld STT Synchronous Transcription Example")
    print("=" * 50)

    api_key = check_api_key()
    if not api_key:
        return 1

    default_audio_path = Path(__file__).parent.parent / "tests-data" / "audio" / "test-audio.wav"
    audio_path = sys.argv[1] if len(sys.argv) > 1 else str(default_audio_path)
    if not os.path.isfile(audio_path):
        print(f"Error: Audio file not found: {audio_path}")
        print("Usage: python example_stt.py [path/to/audio.wav]")
        print("Default: tests-data/audio/test-audio.wav")
        return 1

    try:
        print(f"Audio file: {audio_path}")
        print("Transcribing...\n")
        start = time.perf_counter()
        result = transcribe(audio_path, {}, api_key)
        elapsed = time.perf_counter() - start

        transcription = result.get("transcription") or {}
        transcript = transcription.get("transcript", "")
        word_timestamps = transcription.get("wordTimestamps") or []
        usage = result.get("usage") or {}

        print("Transcript:")
        print(transcript or "(empty)")
        if word_timestamps:
            print("\nWord timestamps:")
            for w in word_timestamps:
                print(f"  {w.get('startTimeMs')}-{w.get('endTimeMs')} ms: \"{w.get('word')}\" (confidence: {w.get('confidence')})")
        if usage.get("transcribedAudioMs") is not None:
            print(f"\nTranscribed audio: {usage['transcribedAudioMs']} ms")
        if usage.get("modelId"):
            print(f"Model: {usage['modelId']}")
        print(f"\nDone in {elapsed:.2f} s.")
    except requests.exceptions.RequestException as e:
        print(f"Transcription failed: {e}")
        if hasattr(e, "response") and e.response is not None:
            try:
                print(e.response.json())
            except Exception:
                print(e.response.text)
        return 1
    except Exception as e:
        print(f"Transcription failed: {e}")
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
