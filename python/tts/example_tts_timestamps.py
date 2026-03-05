#!/usr/bin/env python3
"""
Example script for Inworld TTS synthesis with timestamp, phoneme, and viseme data.

This script demonstrates how to retrieve detailed timing information from the
Inworld TTS dev API, including word timestamps, phoneme data, and viseme data.
"""

import base64
import json
import os
import time
import wave

import requests


def check_api_key():
    """Check if INWORLD_API_KEY environment variable is set."""
    api_key = os.getenv("INWORLD_API_KEY")
    if not api_key:
        print("Error: INWORLD_API_KEY environment variable is not set.")
        print("Please set it with: export INWORLD_API_KEY=your_api_key_here")
        return None
    return api_key


def truncate_audio_for_logging(response_dict, max_length=100):
    """
    Create a copy of the response dict with truncated audio content for readable logging.

    Args:
        response_dict: The API response dictionary
        max_length: Maximum length for the audio content string

    Returns:
        dict: Copy of response with truncated audioContent
    """
    result = response_dict.copy()
    if "audioContent" in result:
        audio_str = result["audioContent"]
        if len(audio_str) > max_length:
            result["audioContent"] = f"{audio_str[:max_length]}... [truncated, {len(audio_str)} chars total]"
    return result


def synthesize_with_timestamps(text: str, voice_id: str, model_id: str, api_key: str):
    """
    Synthesize speech from text and retrieve timestamp/phoneme/viseme data.

    Args:
        text: Text to synthesize
        voice_id: Voice ID to use
        model_id: Model ID to use
        api_key: API key for authentication

    Returns:
        tuple: (audio_data bytes, response dict)
    """
    # API endpoint
    url = "https://api.inworld.ai/tts/v1/voice"

    # Set up headers
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Basic {api_key}"
    }

    # Request data
    request_data = {
        "text": text,
        "voice_id": voice_id,
        "model_id": model_id,
        "audio_config": {
            "audio_encoding": "LINEAR16",
            "sample_rate_hertz": 48000
        },
        "timestamp_type": "WORD"
    }

    try:
        print(f"Synthesizing speech with timestamps...")
        print(f"   Text: {text}")
        print(f"   Voice ID: {voice_id}")
        print(f"   Model ID: {model_id}")
        print()

        response = requests.post(url, headers=headers, json=request_data)
        response.raise_for_status()

        result = response.json()

        # Log full response with truncated audio
        print("=== Full API Response (audio truncated) ===")
        truncated_result = truncate_audio_for_logging(result)
        print(json.dumps(truncated_result, indent=2))
        print()

        # Extract and display word/phoneme/viseme data
        print("=== Word Breakdown with Phonemes & Visemes ===")
        timestamp_info = result.get("timestampInfo", {})
        word_alignment = timestamp_info.get("wordAlignment", {})

        words = word_alignment.get("words", [])
        start_times = word_alignment.get("wordStartTimeSeconds", [])
        end_times = word_alignment.get("wordEndTimeSeconds", [])
        phonetic_details = word_alignment.get("phoneticDetails", [])

        if words:
            # Build a lookup from wordIndex to phonetic details
            phonetics_by_word = {p["wordIndex"]: p for p in phonetic_details}

            for i, word in enumerate(words):
                start = start_times[i] if i < len(start_times) else 0
                end = end_times[i] if i < len(end_times) else 0
                print(f'\n"{word}" ({start:.2f}s - {end:.2f}s)')

                # Get phonetic details for this word
                phonetic = phonetics_by_word.get(i, {})
                phones = phonetic.get("phones", [])

                if phones:
                    print("  Phonemes:")
                    for phone in phones:
                        symbol = phone.get("phoneSymbol", "")
                        phone_start = phone.get("startTimeSeconds", 0)
                        duration = phone.get("durationSeconds", 0)
                        viseme = phone.get("visemeSymbol", "")
                        print(f'    /{symbol}/ at {phone_start:.2f}s ({duration:.3f}s) -> viseme: {viseme}')
        else:
            print("No timestamp data in response")
        print()

        # Decode audio
        audio_data = base64.b64decode(result["audioContent"])
        print(f"Synthesis successful! Audio size: {len(audio_data)} bytes")

        return audio_data, result

    except requests.exceptions.RequestException as e:
        print(f"HTTP Error: {e}")
        if hasattr(e, 'response') and e.response is not None:
            try:
                error_detail = e.response.json()
                print(f"   Error details: {error_detail}")
            except:
                print(f"   Response text: {e.response.text}")
        raise
    except Exception as e:
        print(f"Error during synthesis: {e}")
        raise


def save_audio_to_file(audio_data: bytes, output_file: str):
    """Save audio data to a WAV file."""
    try:
        # Skip WAV header if present (first 44 bytes)
        raw_audio = audio_data[44:] if len(audio_data) > 44 and audio_data[:4] == b'RIFF' else audio_data

        with wave.open(output_file, "wb") as wf:
            wf.setnchannels(1)  # Mono
            wf.setsampwidth(2)  # 16-bit
            wf.setframerate(48000)
            wf.writeframes(raw_audio)

        print(f"Audio saved to: {output_file}")

    except Exception as e:
        print(f"Error saving audio file: {e}")
        raise


def main():
    """Main function to demonstrate TTS synthesis with timestamps."""
    print("Inworld TTS Timestamps Example")
    print("=" * 40)

    # Check API key
    api_key = check_api_key()
    if not api_key:
        return 1

    # Configuration
    text = "Hello, adventurer! What a beautiful day, isn't it?"
    voice_id = "Dennis"
    model_id = "inworld-tts-1.5-max"
    output_file = "synthesis_timestamps_output.wav"

    try:
        start_time = time.time()
        audio_data, _ = synthesize_with_timestamps(
            text=text,
            voice_id=voice_id,
            model_id=model_id,
            api_key=api_key
        )
        synthesis_time = time.time() - start_time

        save_audio_to_file(audio_data, output_file)

        print(f"Synthesis time: {synthesis_time:.2f} seconds")
        print(f"Synthesis completed successfully! You can play the audio file: {output_file}")

    except Exception as e:
        print(f"\nSynthesis failed: {e}")
        return 1

    return 0


if __name__ == "__main__":
    exit(main())
