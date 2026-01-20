#!/usr/bin/env python3
"""
Example script for Inworld TTS streaming synthesis with timestamp data.

This script demonstrates how to synthesize speech using the Inworld TTS streaming API
while retrieving word timestamps, phoneme data, and viseme data.
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
    result = json.loads(json.dumps(response_dict))  # Deep copy
    if "audioContent" in result:
        audio_str = result["audioContent"]
        if len(audio_str) > max_length:
            result["audioContent"] = f"{audio_str[:max_length]}... [truncated, {len(audio_str)} chars total]"
    return result


def print_word_breakdown(word_alignment):
    """Print word breakdown with phonemes and visemes."""
    words = word_alignment.get("words", [])
    start_times = word_alignment.get("wordStartTimeSeconds", [])
    end_times = word_alignment.get("wordEndTimeSeconds", [])
    phonetic_details = word_alignment.get("phoneticDetails", [])

    if not words:
        return

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


def synthesize_stream_with_timestamps(text: str, voice_id: str, model_id: str, api_key: str):
    """
    Synthesize speech with streaming and retrieve timestamp/phoneme/viseme data.

    Args:
        text: Text to synthesize
        voice_id: Voice ID to use
        model_id: Model ID to use
        api_key: API key for authentication

    Yields:
        bytes: Audio chunks

    Also prints timestamp information as it arrives.
    """
    # API streaming endpoint
    url = "https://api.inworld.ai/tts/v1/voice:stream"

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
        print(f"Starting streaming synthesis with timestamps...")
        print(f"   Text: {text}")
        print(f"   Voice ID: {voice_id}")
        print(f"   Model ID: {model_id}")
        print()

        with requests.post(url, headers=headers, json=request_data, stream=True) as response:
            response.raise_for_status()

            chunk_count = 0
            total_audio_size = 0
            first_chunk_time = None
            start_time = time.time()
            all_timestamp_info = []

            print("Receiving audio chunks:")

            for line in response.iter_lines(decode_unicode=True):
                if line.strip():
                    try:
                        chunk_data = json.loads(line)
                        result = chunk_data.get("result")

                        if result:
                            # Log first chunk's full structure (with truncated audio)
                            if chunk_count == 0:
                                print("\n=== First Chunk Response Structure (audio truncated) ===")
                                truncated = truncate_audio_for_logging(result)
                                print(json.dumps(truncated, indent=2))
                                print()

                            # Collect timestamp info if present
                            timestamp_info = result.get("timestampInfo")
                            if timestamp_info:
                                all_timestamp_info.append(timestamp_info)

                            # Process audio
                            if "audioContent" in result:
                                audio_chunk = base64.b64decode(result["audioContent"])
                                chunk_count += 1
                                total_audio_size += len(audio_chunk)

                                # Record time for first chunk
                                if chunk_count == 1:
                                    first_chunk_time = time.time() - start_time
                                    print(f"   Time to first chunk: {first_chunk_time:.2f} seconds")

                                print(f"   Chunk {chunk_count}: {len(audio_chunk)} bytes")
                                yield audio_chunk

                    except json.JSONDecodeError as e:
                        print(f"   JSON decode error: {e}")
                        continue
                    except KeyError as e:
                        print(f"   Missing key in response: {e}")
                        continue

            print(f"\nStreaming completed!")
            print(f"   Total chunks: {chunk_count}")
            print(f"   Total audio size: {total_audio_size} bytes")

            # Print accumulated timestamp information
            if all_timestamp_info:
                print("\n=== Word Breakdown with Phonemes & Visemes ===")
                for timestamp_info in all_timestamp_info:
                    word_alignment = timestamp_info.get("wordAlignment", {})
                    if word_alignment:
                        print_word_breakdown(word_alignment)
                print()
            else:
                print("\nNo timestamp data received in stream")

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
        print(f"Error during streaming synthesis: {e}")
        raise


def save_streaming_audio_to_file(audio_chunks, output_file: str):
    """Save streaming audio chunks to a WAV file."""
    try:
        print(f"Saving audio chunks to: {output_file}")

        # Collect all raw audio data (skip WAV headers from chunks)
        raw_audio_data = bytearray()

        for chunk in audio_chunks:
            # Skip WAV header if present (first 44 bytes)
            if len(chunk) > 44 and chunk[:4] == b'RIFF':
                raw_audio_data.extend(chunk[44:])
            else:
                raw_audio_data.extend(chunk)

        # Save as WAV file
        with wave.open(output_file, "wb") as wf:
            wf.setnchannels(1)  # Mono
            wf.setsampwidth(2)  # 16-bit
            wf.setframerate(48000)
            wf.writeframes(raw_audio_data)

        print(f"Audio saved to: {output_file}")
    except Exception as e:
        print(f"Error saving audio file: {e}")
        raise


def main():
    """Main function to demonstrate streaming TTS synthesis with timestamps."""
    print("Inworld TTS Streaming Timestamps Example")
    print("=" * 45)

    # Check API key
    api_key = check_api_key()
    if not api_key:
        return 1

    # Configuration
    text = "Hello, adventurer! What a beautiful day, isn't it?"
    voice_id = "Dennis"
    model_id = "inworld-tts-1.5-max"
    output_file = "synthesis_stream_timestamps_output.wav"

    try:
        start_time = time.time()
        audio_chunks = list(synthesize_stream_with_timestamps(
            text=text,
            voice_id=voice_id,
            model_id=model_id,
            api_key=api_key
        ))
        synthesis_time = time.time() - start_time

        save_streaming_audio_to_file(audio_chunks, output_file)

        print(f"Total synthesis time: {synthesis_time:.2f} seconds")
        print(f"Streaming synthesis completed successfully! You can play the audio file: {output_file}")

    except Exception as e:
        print(f"\nStreaming synthesis failed: {e}")
        return 1

    return 0


if __name__ == "__main__":
    exit(main())
