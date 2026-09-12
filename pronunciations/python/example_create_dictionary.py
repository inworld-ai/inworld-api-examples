#!/usr/bin/env python3
"""Create and retain a five-entry dictionary for the synthesis example."""

import json
import sys
from pathlib import Path
from uuid import uuid4

from example_pronunciation_dictionaries import (
    client_from_environment,
    print_result,
    require_etag,
)

SAMPLE_PATH = Path(__file__).resolve().parent.parent / "sample-dictionary.json"


def create_sample_dictionary(client, sample_path=SAMPLE_PATH):
    with sample_path.open(encoding="utf-8") as source:
        sample = json.load(source)
    display_name = f"{sample['displayName'][:31]} {uuid4().hex}"
    print(f"Creating dictionary with displayName: {display_name}")
    try:
        dictionary = client.create_dictionary(display_name, sample["pronunciations"])
        client._resource_url(dictionary["name"])
        require_etag(dictionary)
    except (RuntimeError, ValueError, KeyError):
        print(
            f"Inspect the dictionary list for displayName {display_name!r} before "
            "rerunning; create may have committed. Do not automatically retry.",
            file=sys.stderr,
        )
        raise
    print_result("Created dictionary (retained for synthesis)", dictionary)
    print(f"\nSet PRONUNCIATION_DICTIONARY_NAME={dictionary['name']}")
    return dictionary


def main():
    try:
        with client_from_environment() as client:
            create_sample_dictionary(client)
    except (OSError, RuntimeError, ValueError, KeyError) as error:
        print(f"Create dictionary example failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
