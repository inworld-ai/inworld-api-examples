#!/usr/bin/env python3
"""
Example script for Inworld Voice Cloning using HTTP requests.

Demonstrates how to clone a voice by sending audio samples to the Inworld Voice API.
"""

import argparse
import base64
import json
import os
import time
from pathlib import Path

import requests

# ============================================================================
# CONFIGURATION - Modify this path to use your own audio file
# ============================================================================
DEFAULT_AUDIO_PATH = Path(__file__).parent.parent / "tests-data" / "audio" / "english_british_1.wav"


def load_audio_file(audio_path: str) -> bytes:
    """Load audio data from a WAV or MP3 file."""
    with open(audio_path, 'rb') as f:
        return f.read()


def clone_voice(
    workspace: str,
    display_name: str,
    audio_paths: list[str],
    lang_code: str,
    api_key: str,
    description: str = None,
    tags: list[str] = None,
    transcriptions: list[str] = None,
    remove_background_noise: bool = False
):
    """
    Clone a voice using the Inworld Voice API.
    
    Args:
        workspace: Workspace ID (without 'workspaces/' prefix)
        display_name: Human-readable name for the voice
        audio_paths: List of paths to audio files (WAV or MP3)
        lang_code: Language code (e.g., EN_US, ZH_CN, JA_JP)
        api_key: API key for authentication
        description: Optional description of the voice
        tags: Optional list of tags for filtering/discovery
        transcriptions: Optional list of transcriptions aligned with audio files
        remove_background_noise: Whether to apply noise removal
        
    Returns:
        dict: Response containing the cloned voice details
    """
    url = f"https://api.inworld.ai/voices/v1/workspaces/{workspace}/voices:clone"
    
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Basic {api_key}"
    }
    
    voice_samples = []
    for i, audio_path in enumerate(audio_paths):
        print(f"  Loading: {audio_path}")
        audio_data = load_audio_file(audio_path)
        audio_b64 = base64.b64encode(audio_data).decode('utf-8')
        
        sample = {"audioData": audio_b64}
        if transcriptions and i < len(transcriptions):
            sample["transcription"] = transcriptions[i]
        
        voice_samples.append(sample)
        print(f"    Size: {len(audio_data):,} bytes")
    
    request_data = {
        "displayName": display_name,
        "langCode": lang_code,
        "voiceSamples": voice_samples
    }
    
    if description:
        request_data["description"] = description
    if tags:
        request_data["tags"] = tags
    if remove_background_noise:
        request_data["audioProcessingConfig"] = {"removeBackgroundNoise": True}
    
    print(f"\nCloning voice...")
    print(f"  Display Name: {display_name}")
    print(f"  Language: {lang_code}")
    print(f"  Samples: {len(voice_samples)}")
    if description:
        print(f"  Description: {description}")
    if tags:
        print(f"  Tags: {', '.join(tags)}")
    if remove_background_noise:
        print(f"  Noise removal: enabled")
    
    response = requests.post(url, headers=headers, json=request_data)
    response.raise_for_status()
    result = response.json()
    
    print(f"\nVoice cloned successfully!")
    
    voice = result.get("voice", {})
    if voice:
        print(f"\nVoice Details:")
        print(f"  Name: {voice.get('name', 'N/A')}")
        print(f"  Voice ID: {voice.get('voiceId', 'N/A')}")
        print(f"  Display Name: {voice.get('displayName', 'N/A')}")
        print(f"  Language: {voice.get('langCode', 'N/A')}")
        if voice.get('description'):
            print(f"  Description: {voice.get('description')}")
        if voice.get('tags'):
            print(f"  Tags: {', '.join(voice.get('tags'))}")
    
    validated_samples = result.get("audioSamplesValidated", [])
    if validated_samples:
        print(f"\nSample Validation:")
        for i, sample in enumerate(validated_samples):
            print(f"\n  Sample {i + 1}:")
            if sample.get('transcription'):
                print(f"    Transcription: {sample.get('transcription')}")
            if sample.get('langCode'):
                print(f"    Detected Language: {sample.get('langCode')}")
            
            for warning in sample.get('warnings', []):
                print(f"    Warning: {warning.get('text', 'Unknown warning')}")
            for error in sample.get('errors', []):
                print(f"    Error: {error.get('text', 'Unknown error')}")
            
            if not sample.get('warnings') and not sample.get('errors'):
                print(f"    Status: OK")
    
    return result


def main():
    """Main function to demonstrate voice cloning."""
    parser = argparse.ArgumentParser(
        description="Clone a voice using Inworld Voice API",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python example_voice_clone.py --name "My Voice" --audio sample.wav

  python example_voice_clone.py \\
    --name "British Voice" \\
    --audio sample1.wav sample2.wav \\
    --lang EN_US \\
    --description "A warm British accent" \\
    --tags british warm \\
    --remove-noise
        """
    )
    
    parser.add_argument("--name", default="Cloned Voice Demo", help="Display name for the cloned voice")
    parser.add_argument("--audio", nargs="+", help="Path(s) to audio file(s) for cloning (WAV or MP3)")
    parser.add_argument("--lang", default="EN_US",
        choices=["EN_US", "ZH_CN", "KO_KR", "JA_JP", "RU_RU", "AUTO",
                 "IT_IT", "ES_ES", "PT_BR", "DE_DE", "FR_FR", "AR_SA",
                 "PL_PL", "NL_NL"],
        help="Language code (default: EN_US)")
    parser.add_argument("--description", help="Description of the voice")
    parser.add_argument("--tags", nargs="*", help="Tags for the voice (space-separated)")
    parser.add_argument("--transcription", nargs="*", help="Transcription(s) for audio file(s)")
    parser.add_argument("--remove-noise", action="store_true", help="Enable background noise removal")
    
    args = parser.parse_args()
    
    print("Inworld Voice Cloning Example")
    print("-" * 40)
    
    api_key = os.getenv("INWORLD_API_KEY")
    if not api_key:
        print("Error: INWORLD_API_KEY environment variable is not set.")
        return 1
    
    workspace = os.getenv("INWORLD_WORKSPACE")
    if not workspace:
        print("Error: INWORLD_WORKSPACE environment variable is not set.")
        return 1
    
    audio_paths = args.audio
    if not audio_paths:
        if DEFAULT_AUDIO_PATH.exists():
            audio_paths = [str(DEFAULT_AUDIO_PATH)]
            print(f"Using default audio: {DEFAULT_AUDIO_PATH}")
        else:
            print("Error: No audio file specified and default not found.")
            return 1
    
    start_time = time.time()
    
    try:
        result = clone_voice(
            workspace=workspace,
            display_name=args.name,
            audio_paths=audio_paths,
            lang_code=args.lang,
            api_key=api_key,
            description=args.description,
            tags=args.tags,
            transcriptions=args.transcription,
            remove_background_noise=args.remove_noise
        )
    except requests.exceptions.RequestException as e:
        print(f"HTTP Error: {e}")
        if hasattr(e, 'response') and e.response is not None:
            try:
                print(f"Details: {json.dumps(e.response.json(), indent=2)}")
            except:
                print(f"Response: {e.response.text}")
        return 1
    
    clone_time = time.time() - start_time
    print(f"\nClone time: {clone_time:.2f}s")
    
    voice = result.get("voice", {})
    if voice.get("voiceId"):
        print(f"\nUse this voice_id in TTS calls: {voice['voiceId']}")
    
    return 0


if __name__ == "__main__":
    exit(main())
