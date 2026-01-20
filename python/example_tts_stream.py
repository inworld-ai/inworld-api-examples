#!/usr/bin/env python3
"""
Example script for Inworld TTS streaming synthesis using HTTP requests.

This script demonstrates how to synthesize speech from text using the Inworld TTS API
with streaming requests, receiving audio chunks in real-time.
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
        print("❌ Error: INWORLD_API_KEY environment variable is not set.")
        print("Please set it with: export INWORLD_API_KEY=your_api_key_here")
        return None
    return api_key


def synthesize_speech_stream(text: str, voice_id: str, model_id: str, api_key: str):
    """
    Synthesize speech from text using Inworld TTS API with streaming.
    
    Args:
        text: Text to synthesize
        voice_id: Voice ID to use
        model_id: Model ID to use
        api_key: API key for authentication
        
    Yields:
        bytes: Audio chunks
    """
    # API endpoint
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
        }
    }
    
    try:
        print(f"🎤 Starting streaming synthesis...")
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
            
            print("📡 Receiving audio chunks:")
            
            for line in response.iter_lines(decode_unicode=True):
                if line.strip():
                    try:
                        chunk_data = json.loads(line)
                        result = chunk_data.get("result")
                        if result and "audioContent" in result:
                            audio_chunk = base64.b64decode(result["audioContent"])
                            chunk_count += 1
                            total_audio_size += len(audio_chunk)
                            
                            # Record time for first chunk
                            if chunk_count == 1:
                                first_chunk_time = time.time() - start_time
                                print(f"   ⏱️  Time to first chunk: {first_chunk_time:.2f} seconds")
                            
                            print(f"   📦 Chunk {chunk_count}: {len(audio_chunk)} bytes")
                            yield audio_chunk
                            
                    except json.JSONDecodeError as e:
                        print(f"   ⚠️  JSON decode error: {e}")
                        continue
                    except KeyError as e:
                        print(f"   ⚠️  Missing key in response: {e}")
                        continue
            
            print(f"\n✅ Streaming completed!")
            print(f"   Total chunks: {chunk_count}")
            print(f"   Total audio size: {total_audio_size} bytes")
            
    except requests.exceptions.RequestException as e:
        print(f"❌ HTTP Error: {e}")
        if hasattr(e, 'response') and e.response is not None:
            try:
                error_detail = e.response.json()
                print(f"   Error details: {error_detail}")
            except:
                print(f"   Response text: {e.response.text}")
        raise
    except Exception as e:
        print(f"❌ Error during streaming synthesis: {e}")
        raise


def save_streaming_audio_to_file(audio_chunks, output_file: str):
    """Save streaming audio chunks to a WAV file."""
    try:
        print(f"💾 Saving audio chunks to: {output_file}")
        
        # Collect all raw audio data (skip WAV headers from chunks)
        raw_audio_data = bytearray()
        
        for i, chunk in enumerate(audio_chunks):
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
    except Exception as e:
        print(f"❌ Error saving audio file: {e}")
        raise


def main():
    """Main function to demonstrate streaming TTS synthesis."""
    print("🎵 Inworld TTS Streaming Synthesis Example")
    print("=" * 45)
    
    # Check API key
    api_key = check_api_key()
    if not api_key:
        return 1
    
    # Configuration
    text = "Hello, adventurer! What a beautiful day, isn't it?"
    voice_id = "Dennis"
    model_id = "inworld-tts-1"
    output_file = "synthesis_stream_output.wav"
    
    try:
        audio_chunks = list(synthesize_speech_stream(
            text=text,
            voice_id=voice_id,
            model_id=model_id,
            api_key=api_key
        ))
        save_streaming_audio_to_file(audio_chunks, output_file)
        print(f"🎉 Streaming synthesis completed successfully! You can play the audio file: {output_file}")
        
    except Exception as e:
        print(f"\n❌ Streaming synthesis failed: {e}")
        return 1
    
    return 0


if __name__ == "__main__":
    exit(main())
