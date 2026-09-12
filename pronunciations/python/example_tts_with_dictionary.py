#!/usr/bin/env python3
"""Compare baseline audio with synthesis using an existing named dictionary."""

import base64
import binascii
import sys
import tempfile
from pathlib import Path

from example_pronunciation_dictionaries import (
    client_from_environment,
    require_environment_variable,
)

TEXT_PATH = Path(__file__).resolve().parent.parent / "sample-text.txt"


def decode_audio(response):
    encoded = response.get("audioContent")
    if not isinstance(encoded, str) or not encoded:
        raise RuntimeError("TTS response omitted nonempty audioContent.")
    try:
        audio = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error):
        raise RuntimeError("TTS returned invalid base64 audioContent.") from None
    if not audio:
        raise RuntimeError("TTS returned empty audio.")
    return audio


def synthesize_comparison(client, dictionary_name, text_path=TEXT_PATH):
    # Verify access before spending either synthesis request; never mutate this resource.
    dictionary = client.get_dictionary(dictionary_name)
    if dictionary.get("name") != dictionary_name:
        raise RuntimeError("GET returned an unexpected dictionary name.")
    text = text_path.read_text(encoding="utf-8").strip()
    if not text:
        raise ValueError("The sample synthesis text is empty.")
    request = {
        "text": text,
        "voiceId": "Ashley",
        "modelId": "inworld-tts-2",
        "language": "en-US",
        "audioConfig": {"audioEncoding": "MP3"},
        "seed": 101,
    }
    output_directory = Path(tempfile.mkdtemp(prefix="inworld-pronunciations-"))
    for filename, selected in (("baseline.mp3", False), ("with-dictionary.mp3", True)):
        body = dict(request)
        if selected:
            body["pronunciationDictionarySettings"] = {
                "dictionaries": [{"dictionary": dictionary_name}]
            }
        audio = decode_audio(
            client._request("POST", f"{client.api_base_url}/tts/v1/voice", json=body)
        )
        output_path = output_directory / filename
        output_path.write_bytes(audio)
        print(f"Saved {output_path}")
    print("Dictionary retained; this example does not update or delete it.")
    return output_directory


def main():
    try:
        with client_from_environment() as client:
            dictionary_name = require_environment_variable(
                "PRONUNCIATION_DICTIONARY_NAME"
            )
            synthesize_comparison(client, dictionary_name)
    except (OSError, RuntimeError, ValueError, KeyError) as error:
        print(f"TTS dictionary example failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
