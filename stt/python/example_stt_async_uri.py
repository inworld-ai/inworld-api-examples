#!/usr/bin/env python3
"""
Example script for Inworld STT asynchronous transcription, sending a URL.

Asynchronous transcription is for recordings too long to wait on. You hand over
a recording, receive a job, and collect the transcript when the job finishes:

    1. POST /stt/v1/transcribe:async        -> an operation naming the job
    2. GET  /lro/v1alpha/{operation name}   -> poll until done
    3. GET  {resultUri}                     -> the transcript document

This script sends no audio at all. It gives the service a URL and the service
fetches the recording itself, which is the cheapest handover when the audio
already lives somewhere reachable such as cloud storage: the bytes never pass
through your process. To send the bytes instead, see example_stt_async_file.py
(whole file in the request) or example_stt_async_stream.py (streamed upload).

The URL must be https, must serve the audio directly, and must be reachable
without your Inworld credentials -- either public, or carrying its own
authorization such as a signed cloud-storage URL. Redirects are refused, so give
the URL that serves the bytes rather than one that points at it. Most convenient
sharing links redirect: file-sharing services, shortened URLs, and console URLs
such as storage.cloud.google.com. The service fetches the audio while your
submit request is still in flight, so a URL it cannot reach is reported as a
failed submit rather than a failed job -- and submitting a large recording this
way takes as long as the fetch does.

Usage:
    python example_stt_async_uri.py [https://host/path/audio.wav]
"""

import os
import sys
import time

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

# A public sample, served directly by Google Cloud Storage with no redirect.
# Replace it with your own URL -- a signed cloud-storage link, for instance.
DEFAULT_AUDIO_URI = "https://storage.googleapis.com/cloud-samples-data/speech/brooklyn_bridge.wav"


def check_api_key():
    """Check if INWORLD_API_KEY environment variable is set."""
    api_key = os.getenv("INWORLD_API_KEY")
    if not api_key:
        print("Error: INWORLD_API_KEY environment variable is not set.")
        print("Please set it with: export INWORLD_API_KEY=your_api_key_here")
        return None
    return api_key


def submit(audio_uri: str, options: dict | None = None, api_key: str = ""):
    """
    Submit an asynchronous transcription job that names the audio by URL.

    Args:
        audio_uri: https URL serving the audio directly (WAV, MP3, FLAC, OGG, etc.)
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

    body = {
        "transcribeConfig": transcribe_config,
        "audioUri": audio_uri,
    }
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Basic {api_key}",
    }

    response = requests.post(
        f"{API_BASE}/stt/v1/transcribe:async", headers=headers, json=body, timeout=REQUEST_TIMEOUT_S
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
    print("Inworld STT Async Transcription - audio named by URL")
    print("=" * 60)

    api_key = check_api_key()
    if not api_key:
        return 1

    audio_uri = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_AUDIO_URI
    if not audio_uri.startswith("https://"):
        print(f"Error: the audio URL must be https: {audio_uri}")
        print("Usage: python example_stt_async_uri.py [https://host/path/audio.wav]")
        print(f"Default: {DEFAULT_AUDIO_URI}")
        return 1

    try:
        print(f"Audio URL: {audio_uri}")
        print("Submitting...")
        start = time.perf_counter()

        operation = submit(audio_uri, {}, api_key)
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
