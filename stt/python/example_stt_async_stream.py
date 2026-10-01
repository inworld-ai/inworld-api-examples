#!/usr/bin/env python3
"""
Example script for Inworld STT asynchronous transcription, streaming the upload.

Asynchronous transcription is for recordings too long to wait on. You hand over
a recording, receive a job, and collect the transcript when the job finishes:

    1. POST /stt/v1/transcribe:async        -> an operation naming the job
    2. GET  /lro/v1alpha/{operation name}   -> poll until done
    3. GET  {resultUri}                     -> the transcript document

This script streams the recording as a multipart/form-data upload, reading it
from disk a block at a time. It is the right way to hand over a large file:
memory stays flat however long the recording is, and it avoids the third that
base64 encoding adds to a request. For a small file
example_stt_async_file.py is simpler; when the audio already lives somewhere
reachable, example_stt_async_uri.py sends a URL instead of the bytes.

The config part must be sent before the file part. The server reads the form as
a stream, so a config arriving after the audio is found too late.

Usage:
    python example_stt_async_stream.py [path/to/audio.wav]
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

API_BASE = "https://api.inworld.ai"

# How long to keep polling, and how long to wait between polls. A job takes
# roughly as long as a fraction of the recording, so a long file needs a larger
# budget than this default.
POLL_INTERVAL_S = 3
POLL_TIMEOUT_S = 600

# Bound every request. requests applies no timeout by default, so a stalled
# connection would hang forever and the polling deadline would never be
# consulted. The pair is (connect, read) and each applies to one socket
# operation rather than to the whole transfer, so it does not cut short a large
# upload or download that is still making progress.
REQUEST_TIMEOUT_S = (10, 60)

# How much of the file to read at a time while uploading.
UPLOAD_BLOCK_BYTES = 1024 * 1024


def check_api_key():
    """Check if INWORLD_API_KEY environment variable is set."""
    api_key = os.getenv("INWORLD_API_KEY")
    if not api_key:
        print("Error: INWORLD_API_KEY environment variable is not set.")
        print("Please set it with: export INWORLD_API_KEY=your_api_key_here")
        return None
    return api_key


def multipart_body(boundary: str, transcribe_config: dict, audio_path: str):
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
        f'Content-Disposition: form-data; name="file"; filename="{os.path.basename(audio_path)}"\r\n'
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


def submit(audio_path: str, options: dict | None = None, api_key: str = ""):
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
        # Asynchronous transcription accepts every encoding, including the
        # compressed ones streaming rejects, because the audio is a stored file.
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
    body = multipart_body(boundary, transcribe_config, audio_path)

    response = requests.post(
        f"{API_BASE}/stt/v1/transcribe:async", headers=headers, data=body, timeout=REQUEST_TIMEOUT_S
    )
    response.raise_for_status()
    return response.json()


def wait_for_operation(name: str, api_key: str, timeout_s: int = POLL_TIMEOUT_S):
    """
    Poll an operation until it finishes.

    Args:
        name: Operation name returned by submit()
        api_key: API key for authentication
        timeout_s: Give up after this many seconds

    Returns:
        dict: The finished operation, carrying either "response" or "error"
    """
    headers = {"Authorization": f"Basic {api_key}"}
    connect_timeout, read_timeout = REQUEST_TIMEOUT_S
    deadline = time.monotonic() + timeout_s

    while True:
        # Checked before each request, and used to bound it: a deadline
        # consulted only between requests cannot stop a poll that stalls inside
        # one.
        remaining_s = deadline - time.monotonic()
        if remaining_s <= 0:
            raise TimeoutError(f"job did not finish within {timeout_s} s")

        response = requests.get(
            f"{API_BASE}/lro/v1alpha/{name}",
            headers=headers,
            timeout=(min(connect_timeout, remaining_s), min(read_timeout, remaining_s)),
        )
        response.raise_for_status()

        operation = response.json()
        if operation.get("done"):
            return operation
        time.sleep(POLL_INTERVAL_S)


def download_transcript(result_uri: str):
    """
    Download the transcript document. The link is signed, so it carries its own
    authorization and must not be sent with the API key.
    """
    response = requests.get(result_uri, timeout=REQUEST_TIMEOUT_S)
    response.raise_for_status()
    return response.json()


def print_result(operation: dict, transcript_doc: dict):
    """Print the transcript, its segments and what the job billed."""
    print("Transcript:")
    print(transcript_doc.get("transcript") or "(empty)")

    segments = transcript_doc.get("segments") or []
    if segments:
        print(f"\nSegments ({len(segments)}):")
        for segment in segments:
            # Durations are int64, which JSON carries as strings.
            start_ms = int(segment.get("startTimeMs") or 0)
            end_ms = int(segment.get("endTimeMs") or 0)
            print(f"  {start_ms}-{end_ms} ms: {segment.get('transcript', '')}")

    if transcript_doc.get("language"):
        print(f"\nLanguage: {transcript_doc['language']}")

    usage = transcript_doc.get("usage") or {}
    if usage.get("transcribedAudioMs") is not None:
        print(f"Transcribed audio: {usage['transcribedAudioMs']} ms")
    if usage.get("modelId"):
        print(f"Model: {usage['modelId']}")

    expire_time = (operation.get("response") or {}).get("expireTime")
    if expire_time:
        print(f"\nResult link expires at {expire_time}. Keep your own copy to read it later.")


def main():
    print("Inworld STT Async Transcription - streamed upload")
    print("=" * 60)

    api_key = check_api_key()
    if not api_key:
        return 1

    default_audio_path = Path(__file__).parent.parent / "tests-data" / "audio" / "test-audio.wav"
    audio_path = sys.argv[1] if len(sys.argv) > 1 else str(default_audio_path)
    if not os.path.isfile(audio_path):
        print(f"Error: Audio file not found: {audio_path}")
        print("Usage: python example_stt_async_stream.py [path/to/audio.wav]")
        print("Default: tests-data/audio/test-audio.wav")
        return 1

    try:
        size_mb = os.path.getsize(audio_path) / (1024 * 1024)
        print(f"Audio file: {audio_path} ({size_mb:.1f} MB)")
        print("Uploading...")
        start = time.perf_counter()

        operation = submit(audio_path, {}, api_key)
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
