# Pronunciation dictionaries with Python

Create a five-entry dictionary, then use it in a separate TTS example. See the [shared guide](../README.md) for the sample's intentional Cat → red override, request behavior, and cleanup.

## Setup

Requires Python 3.10+, a Standard API key with **Voices Write** access, and its workspace ID. Run from this directory:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env: set INWORLD_API_KEY and INWORLD_WORKSPACE_ID.
# Set INWORLD_API_BASE_URL if not using https://api.inworld.ai.
```

You can export these variables instead; environment variables take precedence over `.env`. Do not commit your key.

## 1. Create a dictionary

```bash
python example_create_dictionary.py
```

This reads all five entries from [sample-dictionary.json](../sample-dictionary.json), creates one uniquely named dictionary, and prints its returned name and ETag. **It does not delete the dictionary.** You can edit the shared JSON before running it to use your own entries.

## 2. Use it with TTS

Copy the full `name` from step 1 into `PRONUNCIATION_DICTIONARY_NAME` in `.env`, or export it:

```bash
export PRONUNCIATION_DICTIONARY_NAME='workspaces/my-workspace/pronunciationDictionaries/{dictionary_id}'
# Replace the entire example value with the server-returned name.
python example_tts_with_dictionary.py
```

The script synthesizes the same text with and without selection, saves `baseline.mp3` and `with-dictionary.mp3` to a fresh temporary directory, and prints their paths. It uses `inworld-tts-2`, voice `Ashley`, and `en-US`. Listen for Cat becoming red. The dictionary is read-only in this example; it remains available for reuse.

When finished, follow [explicit cleanup](../README.md#delete-the-retained-sample-when-finished).

## Use your Portal workspace dictionary instead

Follow the [workspace-default setup](../README.md#use-the-workspace-dictionary-saved-in-portal), then run:

```bash
python example_tts_with_workspace_dictionary.py
```

This compares ordinary synthesis with `enable_custom_pronunciation: true`.
It does not use `PRONUNCIATION_DICTIONARY_NAME` or change saved entries.
Both requests are billable; listen to both files to verify the replacement.

## Optional: complete CRUD lifecycle

```bash
python example_pronunciation_dictionaries.py
```

This creates its own temporary dictionary, lists and gets it, replaces its name and entries with an explicit `updateMask`, then deletes it using a current ETag. It does not use or delete `PRONUNCIATION_DICTIONARY_NAME`. See [update and cleanup safety](../README.md#update-and-cleanup-safety).

## Offline tests

```bash
python -m unittest discover -s . -p 'test_*.py'
```

These tests exercise request construction, audio decoding, resource ownership, and error handling with fake HTTP responses. They do not call Inworld or prove deployment availability.
