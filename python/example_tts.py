#!/usr/bin/env python3
"""
Example script for Inworld TTS synthesis using HTTP requests.

This script demonstrates how to synthesize speech from text using the Inworld TTS API
with synchronous (non-streaming) requests.
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


def synthesize_speech(text: str, voice_id: str, model_id: str, api_key: str):
    """
    Synthesize speech from text using Inworld TTS API.
    
    Args:
        text: Text to synthesize
        voice_id: Voice ID to use
        model_id: Model ID to use
        api_key: API key for authentication
        
    Returns:
        bytes: Audio data
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
        }
    }
    
    try:
        print(f"Synthesizing speech...")
        print(f"   Text: {text}")
        print(f"   Voice ID: {voice_id}")
        print(f"   Model ID: {model_id}")
        
        response = requests.post(url, headers=headers, json=request_data)
        response.raise_for_status()
        
        result = response.json()
        audio_data = base64.b64decode(result["audioContent"])
        
        print(f"Synthesis successful! Audio size: {len(audio_data)} bytes")
        return audio_data
        
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
    """Main function to demonstrate TTS synthesis."""
    print("Inworld TTS Synthesis Example")
    print("=" * 40)
    
    # Check API key
    api_key = check_api_key()
    if not api_key:
        return 1
    
    # Configuration
    text = "Hello, adventurer! What a beautiful day, isn't it?"
    voice_id = "Dennis"
    model_id = "inworld-tts-1.5-mini"
    output_file = "synthesis_output.wav"
    
    try:
        start_time = time.time()
        audio_data = synthesize_speech(
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
