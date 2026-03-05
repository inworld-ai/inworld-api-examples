#!/usr/bin/env python3
"""
Example script for Inworld Voice Design using HTTP requests.

Demonstrates how to design a voice from a text description
using the Inworld Voice API. Returns up to three voice previews.
After design, preview audio is saved to files and opened for playback;
you can then choose whether to publish a preview to your library.
"""

import argparse
import base64
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import quote

import requests

# ============================================================================
# CONFIGURATION - Default voice description (must be 30-250 characters)
# ============================================================================
DEFAULT_DESIGN_PROMPT = (
    "A middle-aged male voice with a clear British accent speaking at a steady "
    "pace and with a neutral tone."
)
DEFAULT_SCRIPT = (
    "Hello, this is a sample of my voice. I hope it sounds clear and natural to you."
)

DESIGN_PROMPT_MIN = 30
DESIGN_PROMPT_MAX = 250
SCRIPT_MIN = 1
SCRIPT_RECOMMENDED_MAX = 200

PREVIEW_OUTPUT_DIR = Path(__file__).resolve().parent
PREVIEW_FILE_PREFIX = "design_preview_"

SUPPORTED_LANGUAGES = [
    "EN_US", "ZH_CN", "KO_KR", "JA_JP", "RU_RU", "AUTO",
    "IT_IT", "ES_ES", "PT_BR", "DE_DE", "FR_FR", "AR_SA",
    "PL_PL", "NL_NL",
]


def design_voice(
    design_prompt: str,
    preview_text: str,
    lang_code: str,
    api_key: str,
    number_of_samples: int = 1,
):
    """
    Design a voice using the Inworld Voice API (no audio required).

    Args:
        design_prompt: Voice description (30-250 characters).
        preview_text: Text the voice will speak (50-200 chars recommended).
        lang_code: Language code (e.g., EN_US, ZH_CN).
        api_key: API key for authentication.
        number_of_samples: Number of voice previews to generate (1-3).

    Returns:
        dict: Response containing voice preview(s).
    """
    url = "https://api.inworld.ai/voices/v1/voices:design"

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Basic {api_key}",
    }

    request_data = {
        "voiceDesignConfig": {"numberOfSamples": number_of_samples},
        "designPrompt": design_prompt,
        "langCode": lang_code,
        "previewText": preview_text,
    }

    desc_preview = design_prompt[:60] + "..." if len(design_prompt) > 60 else design_prompt
    text_preview = preview_text[:50] + "..." if len(preview_text) > 50 else preview_text

    print("\nDesigning voice...")
    print(f"  Description: {desc_preview}")
    print(f"  Preview text: {text_preview}")
    print(f"  Language: {lang_code}")
    print(f"  Number of samples: {number_of_samples}")

    response = requests.post(url, headers=headers, json=request_data)
    response.raise_for_status()
    result = response.json()

    print("\nVoice design completed successfully!")

    previews = result.get("previewVoices") or result.get("voice_previews") or result.get("voicePreviews") or []
    if previews:
        print(f"\nVoice previews ({len(previews)}):")
        for i, p in enumerate(previews):
            voice_id = p.get("voiceId") or p.get("voice_id") or p.get("preview_id") or p.get("previewId") or "N/A"
            print(f"  Preview {i + 1}:")
            print(f"    voiceId: {voice_id}")
            audio = p.get("previewAudio") or p.get("preview_audio") or p.get("audio_data") or p.get("audioData")
            if audio:
                print(f"    previewAudio: {len(audio)} chars (base64)")
    if result.get("langCode"):
        print(f"\nlangCode: {result['langCode']}")

    return result


def publish_voice(
    voice_id: str,
    api_key: str,
    display_name: str = None,
    description: str = None,
    tags: list = None,
):
    """Publish a designed voice preview to your library. API: POST /voices/v1/voices/{voiceId}:publish."""
    url = f"https://api.inworld.ai/voices/v1/voices/{quote(voice_id, safe='_')}:publish"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Basic {api_key}",
    }
    payload = {"voiceId": voice_id}
    if display_name:
        payload["displayName"] = display_name
    if description:
        payload["description"] = description
    if tags:
        payload["tags"] = tags
    response = requests.post(url, headers=headers, json=payload)
    response.raise_for_status()
    return response.json()


def save_preview_audio_files(previews: list) -> list:
    """Save preview audio (base64) to WAV files. Return paths saved."""
    saved = []
    for i, p in enumerate(previews):
        b64 = p.get("previewAudio") or p.get("preview_audio") or p.get("audio_data") or p.get("audioData")
        if not b64:
            continue
        path_out = PREVIEW_OUTPUT_DIR / f"{PREVIEW_FILE_PREFIX}{i + 1}.wav"
        path_out.write_bytes(base64.b64decode(b64))
        saved.append(str(path_out))
    return saved


def open_audio_file(file_path: str) -> None:
    """Open an audio file with the system default player."""
    try:
        if sys.platform == "darwin":
            subprocess.run(["open", file_path], check=True, capture_output=True)
        elif sys.platform == "win32":
            subprocess.run(["start", "", file_path], check=True, capture_output=True, shell=True)
        else:
            subprocess.run(["xdg-open", file_path], check=True, capture_output=True)
    except (subprocess.CalledProcessError, FileNotFoundError) as e:
        print(f"  (Could not open player: {e}. Play {file_path} manually.)")


def ask_publish_choice(count: int, default_display_name: str) -> tuple:
    """Ask user whether to publish (Y or n to skip). If Y and multiple previews, ask which one. Returns (choice 0 or 1..count, display_name)."""
    raw = input("\nPublish a voice? (Y or n to skip): ").strip().lower()
    if raw not in ("y", "yes"):
        return 0, ""
    choice = 1
    if count > 1:
        while True:
            num_raw = input(f"Which preview (1-{count})? ").strip()
            try:
                num = int(num_raw)
                if 1 <= num <= count:
                    choice = num
                    break
            except ValueError:
                pass
            print("  Invalid choice.")
    name_prompt = f'Display name for published voice (optional, default: "{default_display_name}")? '
    name_raw = input(name_prompt).strip()
    display_name = name_raw if name_raw else default_display_name
    return choice, display_name


def main():
    """Main function to demonstrate voice design."""
    parser = argparse.ArgumentParser(
        description="Design a voice from a text description using Inworld Voice API (no audio required).",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python example_voice_design_publish.py

  python example_voice_design_publish.py \\
    --description "A warm female voice in her thirties with a slight Southern American accent." \\
    --script "Welcome to our show. Today we have a special guest."
        """,
    )

    parser.add_argument(
        "--description",
        "-d",
        default=DEFAULT_DESIGN_PROMPT,
        help="Voice description (30-250 characters). Include timbre, tone, pitch, accent, gender, age.",
    )
    parser.add_argument(
        "--script",
        "-s",
        "--preview-text",
        dest="preview_text",
        default=DEFAULT_SCRIPT,
        help="Preview text (script the voice will speak; 50-200 chars recommended).",
    )
    parser.add_argument(
        "--lang",
        "-l",
        default="EN_US",
        choices=SUPPORTED_LANGUAGES,
        help="Language code (default: EN_US).",
    )
    parser.add_argument(
        "--samples",
        "-n",
        type=int,
        default=1,
        choices=[1, 2, 3],
        help="Number of voice previews to generate (default: 1).",
    )
    parser.add_argument(
        "--no-interactive",
        action="store_true",
        help="Skip saving/playing preview audio and publish prompt (design only).",
    )
    parser.add_argument(
        "--display-name",
        default="",
        help="Default display name when publishing (optional).",
    )
    parser.add_argument(
        "--publish-description",
        default="",
        help="Description for the published voice (optional).",
    )
    parser.add_argument(
        "--publish-tags",
        nargs="*",
        default=[],
        help="Tags for the published voice (optional).",
    )

    args = parser.parse_args()

    print("Inworld Voice Design Example")
    print("-" * 40)

    api_key = os.getenv("INWORLD_API_KEY")
    if not api_key:
        print("Error: INWORLD_API_KEY environment variable is not set.")
        return 1

    length = len(args.description)
    if length < DESIGN_PROMPT_MIN or length > DESIGN_PROMPT_MAX:
        print(
            f"Error: design_prompt must be between {DESIGN_PROMPT_MIN} and {DESIGN_PROMPT_MAX} "
            f"characters (got {length})."
        )
        return 1

    if not args.preview_text or len(args.preview_text) < SCRIPT_MIN:
        print("Error: preview text (--script) is required and must be at least 1 character.")
        return 1

    if len(args.preview_text) > SCRIPT_RECOMMENDED_MAX:
        print(
            f"Note: Preview text is {len(args.preview_text)} characters. "
            f"50-200 characters is recommended for best results."
        )

    start_time = time.time()

    try:
        result = design_voice(
            design_prompt=args.description,
            preview_text=args.preview_text,
            lang_code=args.lang,
            api_key=api_key,
            number_of_samples=args.samples,
        )
    except requests.exceptions.RequestException as e:
        print(f"HTTP Error: {e}")
        if hasattr(e, "response") and e.response is not None:
            try:
                print(f"Details: {json.dumps(e.response.json(), indent=2)}")
            except Exception:
                print(f"Response: {e.response.text}")
        return 1

    elapsed = time.time() - start_time
    print(f"\nDesign time: {elapsed:.2f}s")

    previews = result.get("previewVoices") or result.get("voice_previews") or result.get("voicePreviews") or []
    if not previews:
        return 0

    interactive = not args.no_interactive and sys.stdin.isatty()
    if not interactive:
        print("\nPreview(s) received. Run interactively (no pipe) to choose whether to publish (and to save/play preview audio).")
        return 0

    saved_paths = save_preview_audio_files(previews)
    if saved_paths:
        print(f"\nPreview audio saved: {', '.join(Path(p).name for p in saved_paths)}")
        print("Opening first preview for playback...")
        open_audio_file(saved_paths[0])

    default_name = args.display_name or "Designed Voice"
    choice, publish_display_name = ask_publish_choice(len(previews), default_name)
    if choice == 0:
        print("Skipped publishing.")
        return 0

    selected = previews[choice - 1]
    voice_id = selected.get("voiceId") or selected.get("voice_id") or selected.get("preview_id") or selected.get("previewId")
    if not voice_id:
        print("Selected preview has no voiceId.")
        return 1

    print(f"\nPublishing voice: {voice_id} (display name: {publish_display_name})...")
    try:
        publish_result = publish_voice(
            voice_id,
            api_key,
            display_name=publish_display_name,
            description=args.publish_description or None,
            tags=args.publish_tags or None,
        )
    except requests.exceptions.RequestException as e:
        print(f"Publish failed: {e}")
        if hasattr(e, "response") and e.response is not None:
            try:
                print(json.dumps(e.response.json(), indent=2))
            except Exception:
                print(e.response.text)
        return 1

    print("Published successfully.")
    v = publish_result.get("voice") or publish_result
    if v.get("voiceId") or v.get("voice_id"):
        print(f"  voiceId: {v.get('voiceId') or v.get('voice_id')}")
    if v.get("displayName"):
        print(f"  displayName: {v['displayName']}")
    if v.get("description"):
        print(f"  description: {v['description']}")
    if v.get("tags"):
        print(f"  tags: {', '.join(v['tags'])}")
    if v.get("langCode"):
        print(f"  langCode: {v['langCode']}")
    if v.get("source"):
        print(f"  source: {v['source']}")
    if v.get("name"):
        print(f"  name: {v['name']}")

    return 0


if __name__ == "__main__":
    exit(main())
