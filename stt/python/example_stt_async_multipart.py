#!/usr/bin/env python3
"""
Example script for Inworld STT asynchronous transcription with a streamed upload.

Same three steps as example_stt_async.py, but the audio is sent as a
multipart/form-data upload instead of inline base64. Use this for large
recordings: the file is streamed from disk a block at a time, so a two-hour
recording costs one block of memory rather than its own size, and it avoids the
third that base64 encoding adds to the request.

The config part must be sent before the file part. The server reads the form as
a stream, so a config that arrives after the audio is found too late.
"""

import json
import os
import sys
import time
import uuid
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

import requests

from example_stt_async import (
    API_BASE,
    check_api_key,
    download_transcript,
    print_result,
    wait_for_operation,
)

# How much of the file to read at a time while uploading.
UPLOAD_BLOCK_BYTES = 1024 * 1024


def _multipart_body(boundary: str, transcribe_config: dict, audio_path: str, filename: str):
    """
    Yield the multipart body a block at a time, config part first.

    Written by hand rather than with requests' `files=` argument because that
    one builds the whole body in memory, which is exactly what a large upload
    needs to avoid.
    """
    config_part = (
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="transcribeConfig"\r\n'
        "Content-Type: application/json\r\n\r\n"
        f"{json.dumps(transcribe_config)}\r\n"
    )
    yield config_part.encode("utf-8")

    file_header = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
        "Content-Type: application/octet-stream\r\n\r\n"
    )
    yield file_header.encode("utf-8")

    with open(audio_path, "rb") as f:
        while True:
            block = f.read(UPLOAD_BLOCK_BYTES)
            if not block:
                break
            yield block

    yield f"\r\n--{boundary}--\r\n".encode("utf-8")


def submit_multipart(audio_path: str, options: dict | None = None, api_key: str = ""):
    """
    Submit an asynchronous transcription job, streaming the audio file.

    Args:
        audio_path: Path to audio file (WAV, MP3, FLAC, OGG, etc.)
        options: Optional transcribeConfig overrides
        api_key: API key for authentication

    Returns:
        dict: The operation, whose "name" identifies the job
    """
    transcribe_config = {
        "modelId": "inworld/inworld-stt-1",
        "audioEncoding": "AUTO_DETECT",
        "language": "en-US",
    }
    if options:
        transcribe_config.update(options)

    boundary = uuid.uuid4().hex
    headers = {
        "Content-Type": f"multipart/form-data; boundary={boundary}",
        "Authorization": f"Basic {api_key}",
    }
    body = _multipart_body(boundary, transcribe_config, audio_path, os.path.basename(audio_path))

    response = requests.post(f"{API_BASE}/stt/v1/transcribe:async", headers=headers, data=body)
    response.raise_for_status()
    return response.json()


def main():
    print("Inworld STT Asynchronous Transcription Example (streamed upload)")
    print("=" * 64)

    api_key = check_api_key()
    if not api_key:
        return 1

    default_audio_path = Path(__file__).parent.parent / "tests-data" / "audio" / "test-audio.wav"
    audio_path = sys.argv[1] if len(sys.argv) > 1 else str(default_audio_path)
    if not os.path.isfile(audio_path):
        print(f"Error: Audio file not found: {audio_path}")
        print("Usage: python example_stt_async_multipart.py [path/to/audio.wav]")
        print("Default: tests-data/audio/test-audio.wav")
        return 1

    try:
        size_mb = os.path.getsize(audio_path) / (1024 * 1024)
        print(f"Audio file: {audio_path} ({size_mb:.1f} MB)")
        print("Uploading...")
        start = time.perf_counter()

        operation = submit_multipart(audio_path, {}, api_key)
        name = operation["name"]
        print(f"Job submitted: {name}")

        print("Waiting for the job to finish...\n")
        operation = wait_for_operation(name, api_key)
        elapsed = time.perf_counter() - start

        if "error" in operation:
            error = operation["error"]
            print(f"Job failed: {error.get('message')} (code {error.get('code')})")
            return 1

        transcript_doc = download_transcript(operation["response"]["resultUri"])
        print_result(operation, transcript_doc)
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
