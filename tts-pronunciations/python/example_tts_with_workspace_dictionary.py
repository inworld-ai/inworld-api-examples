#!/usr/bin/env python3
"""Compare speech with existing Portal entries; never create or edit a dictionary."""

import sys
import tempfile
from pathlib import Path

from example_pronunciation_dictionaries import client_from_environment
from example_tts_with_dictionary import decode_audio


def synthesize_workspace_comparison(client, text="The Cat is on the mat."):
    if not text.strip():
        raise ValueError("Synthesis text must not be empty.")
    request = {
        "text": text,
        "voiceId": "Ashley",
        "modelId": "inworld-tts-2",
        "language": "en-US",
        "audioConfig": {"audioEncoding": "MP3"},
        "seed": 101,
    }
    print("Two billable TTS requests; uses existing Portal entries without changing them.")
    endpoint = f"{client.api_base_url}/tts/v1/voice"
    baseline = decode_audio(client._request("POST", endpoint, json=request))
    selected = decode_audio(client._request(
        "POST", endpoint, json={**request, "enable_custom_pronunciation": True}
    ))
    directory = Path(tempfile.mkdtemp(prefix="workspace-pronunciation-"))
    baseline_path = directory / "baseline.mp3"
    selected_path = directory / "with-workspace-dictionary.mp3"
    baseline_path.write_bytes(baseline)
    selected_path.write_bytes(selected)
    print(f"Baseline audio: {baseline_path}")
    print(f"Workspace-dictionary audio: {selected_path}")
    print("If Portal has Cat → /ɹɛd/ for en-US, listen for cat → red in the second file.")
    print("HTTP success is not proof of rewriting: unavailable defaults leave speech unchanged.")
    return directory


def main():
    try:
        with client_from_environment() as client:
            synthesize_workspace_comparison(client)
    except (OSError, RuntimeError, ValueError, KeyError) as error:
        print(f"Workspace pronunciation example failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
