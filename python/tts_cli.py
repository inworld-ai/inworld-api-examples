#!/usr/bin/env python3
"""
Inworld AI Text-to-Speech CLI Tool

A simplified TTS testing tool using Python's native argparse.
Supports basic synthesis, streaming, and batch testing with JSON samples.
"""

import argparse
import base64
import json
import os
import statistics
import sys
import time
import wave
from pathlib import Path

import requests


def check_api_key():
    """Check if INWORLD_API_KEY environment variable is set."""
    api_key = os.getenv("INWORLD_API_KEY")
    if not api_key:
        print("Error: INWORLD_API_KEY environment variable is not set.")
        print("Please set it with: export INWORLD_API_KEY=your_api_key_here")
        return None
    return api_key


def synthesize_speech(text: str, voice_id: str, model_id: str, api_key: str, stream: bool = False, 
                     temperature: float = None, timestamp_type: str = None, text_normalization: str = None):
    """
    Synthesize speech from text using Inworld TTS API.
    
    Returns:
        tuple: (audio_data, synthesis_time, timestamp_info) for non-streaming
        tuple: (audio_chunks, synthesis_time, first_chunk_time, timestamp_info) for streaming
    """
    # API endpoint
    url = "https://api.inworld.ai/tts/v1/voice:stream" if stream else "https://api.inworld.ai/tts/v1/voice"
    
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
    
    # Add optional parameters only if explicitly provided
    if temperature is not None:
        request_data["temperature"] = temperature
    
    if timestamp_type is not None:
        # Convert to API format
        if timestamp_type == "word":
            request_data["timestampType"] = "WORD"
        elif timestamp_type == "character":
            request_data["timestampType"] = "CHARACTER"
    
    if text_normalization is not None:
        # Convert to API format
        if text_normalization == "on":
            request_data["applyTextNormalization"] = "ON"
        elif text_normalization == "off":
            request_data["applyTextNormalization"] = "OFF"
    
    start_time = time.time()
    
    try:
        if stream:
            # Streaming synthesis
            audio_chunks = []
            first_chunk_time = None
            timestamp_info = None
            
            with requests.post(url, headers=headers, json=request_data, stream=True) as response:
                response.raise_for_status()
                
                for line in response.iter_lines(decode_unicode=True):
                    if line.strip():
                        try:
                            chunk_data = json.loads(line)
                            result = chunk_data.get("result")
                            if result and "audioContent" in result:
                                audio_chunk = base64.b64decode(result["audioContent"])
                                audio_chunks.append(audio_chunk)
                                
                                # Record time for first chunk
                                if first_chunk_time is None:
                                    first_chunk_time = time.time() - start_time
                                
                                # Collect timestamp info (may be in final chunk)
                                if "timestampInfo" in result:
                                    timestamp_info = result["timestampInfo"]
                                    
                        except (json.JSONDecodeError, KeyError):
                            continue
            
            synthesis_time = time.time() - start_time
            return audio_chunks, synthesis_time, first_chunk_time, timestamp_info
        else:
            # Non-streaming synthesis
            response = requests.post(url, headers=headers, json=request_data)
            response.raise_for_status()
            
            result = response.json()
            audio_data = base64.b64decode(result["audioContent"])
            timestamp_info = result.get("timestampInfo")
            synthesis_time = time.time() - start_time
            
            return audio_data, synthesis_time, timestamp_info
            
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


def save_audio_to_file(audio_data, output_file: str, sample_rate: int = 48000):
    """Save audio data to a WAV file."""
    try:
        # Handle both single audio data and list of chunks
        if isinstance(audio_data, list):
            # Streaming chunks
            raw_audio_data = bytearray()
            for chunk in audio_data:
                # Skip WAV header if present (first 44 bytes)
                if len(chunk) > 44 and chunk[:4] == b'RIFF':
                    raw_audio_data.extend(chunk[44:])
                else:
                    raw_audio_data.extend(chunk)
        else:
            # Single audio data
            raw_audio_data = audio_data[44:] if len(audio_data) > 44 and audio_data[:4] == b'RIFF' else audio_data
        
        with wave.open(output_file, "wb") as wf:
            wf.setnchannels(1)  # Mono
            wf.setsampwidth(2)  # 16-bit
            wf.setframerate(sample_rate)
            wf.writeframes(raw_audio_data)
        
        return len(raw_audio_data)
        
    except Exception as e:
        print(f"Error saving audio file: {e}")
        raise


def load_json_samples(json_file: str):
    """Load text samples from JSON file."""
    try:
        with open(json_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        if 'samples' in data and isinstance(data['samples'], list):
            return data['samples']
        else:
            print(f"Invalid JSON format. Expected 'samples' array in {json_file}")
            return None
            
    except FileNotFoundError:
        print(f"JSON file not found: {json_file}")
        return None
    except json.JSONDecodeError as e:
        print(f"Invalid JSON format in {json_file}: {e}")
        return None
    except Exception as e:
        print(f"Error loading JSON file {json_file}: {e}")
        return None


def display_timestamp_info(timestamp_info, timestamp_type):
    """Display timestamp alignment information."""
    if not timestamp_info or not timestamp_type:
        return
    
    print(f"\n TIMESTAMP INFORMATION:")
    
    if timestamp_type == "word" and "wordAlignment" in timestamp_info:
        word_data = timestamp_info["wordAlignment"]
        words = word_data.get("words", [])
        start_times = word_data.get("wordStartTimeSeconds", [])
        end_times = word_data.get("wordEndTimeSeconds", [])
        
        if words and start_times and end_times and len(words) == len(start_times) == len(end_times):
            print(" Word-level alignment:")
            for word, start_time, end_time in zip(words, start_times, end_times):
                print(f"  '{word}': {start_time:.3f}s - {end_time:.3f}s")
    
    elif timestamp_type == "character" and "characterAlignment" in timestamp_info:
        char_data = timestamp_info["characterAlignment"]
        chars = char_data.get("characters", [])
        start_times = char_data.get("characterStartTimeSeconds", [])
        end_times = char_data.get("characterEndTimeSeconds", [])
        
        if chars and start_times and end_times and len(chars) == len(start_times) == len(end_times):
            print(" Character-level alignment:")
            char_display = []
            for char, start_time, _end_time in zip(chars, start_times, end_times):
                char_display.append(f"'{char}'@{start_time:.2f}s")
            print(f"  {' '.join(char_display)}")


def display_latency_stats(latencies, label="Synthesis"):
    """Display latency statistics."""
    if not latencies:
        return
    
    latencies.sort()
    count = len(latencies)
    mean_latency = statistics.mean(latencies)
    median_latency = statistics.median(latencies)
    min_latency = min(latencies)
    max_latency = max(latencies)
    
    # Calculate percentiles
    p90 = statistics.quantiles(latencies, n=10)[8] if count >= 10 else max_latency
    p95 = statistics.quantiles(latencies, n=20)[18] if count >= 20 else max_latency
    
    print(f"\n {label.upper()} LATENCY STATISTICS:")
    print(f"   Samples: {count}")
    print(f"   Mean: {mean_latency:.3f}s")
    print(f"   Median (p50): {median_latency:.3f}s")
    print(f"  90th percentile (p90): {p90:.3f}s")
    print(f"   95th percentile (p95): {p95:.3f}s")
    print(f"    Min: {min_latency:.3f}s")
    print(f"    Max: {max_latency:.3f}s")


def main():
    """Main CLI function."""
    parser = argparse.ArgumentParser(
        description="Inworld AI Text-to-Speech CLI Tool",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Basic synthesis
  python tts_cli.py --output-file output.wav --text "Hello world"
  
  # Streaming synthesis with timestamp alignment
  python tts_cli.py --output-file output.wav --text "Hello world" --stream --timestamp word
  
  # Custom temperature and text normalization
  python tts_cli.py --output-file output.wav --temperature 0.8 --text-normalization off
  
  # Batch testing with JSON samples
  python tts_cli.py --json-example ../tests-data/tts/tts_marketing_samples.json
  
  # Batch testing with streaming and character-level timestamps
  python tts_cli.py --json-example ../tests-data/tts/tts_marketing_samples.json --stream --timestamp character
  
  # Custom voice and model with all options
  python tts_cli.py --output-file output.wav --voice-id Dennis --model-id inworld-tts-1 --temperature 1.2 --timestamp word --text-normalization on
        """
    )
    
    # Required parameters
    parser.add_argument("--model-id", default="inworld-tts-1", help="Model ID to use (default: inworld-tts-1)")
    parser.add_argument("--voice-id", default="Dennis", help="Voice ID to use (default: Dennis)")
    
    # Text input options
    parser.add_argument("--text", default="Hello, adventurer! What a beautiful day, isn't it?", 
                       help="Text to synthesize")
    parser.add_argument("--json-example", help="JSON file with text samples for batch testing")
    
    # Audio options
    parser.add_argument("--sample-rate", type=int, default=48000, help="Sample rate (default: 48000)")
    parser.add_argument("--stream", action="store_true", help="Use streaming synthesis")
    parser.add_argument("--temperature", type=float, default=None, 
                       help="Sampling temperature (0.0-2.0). Higher values = more random/expressive")
    parser.add_argument("--timestamp", choices=["word", "character"], default=None,
                       help="Enable timestamp alignment: 'word' for word-level, 'character' for character-level")
    parser.add_argument("--text-normalization", choices=["on", "off"], default=None,
                       help="Text normalization: 'on' to expand abbreviations/numbers, 'off' for literal reading")
    
    # Output options
    parser.add_argument("--output-file", help="Output WAV file path")
    
    # Parse arguments
    args = parser.parse_args()
    
    # Check API key
    api_key = check_api_key()
    if not api_key:
        sys.exit(1)
    
    # Determine operation mode
    if args.json_example:
        # Batch testing mode
        print("Inworld TTS Batch Testing")
        print("=" * 40)
        
        samples = load_json_samples(args.json_example)
        if not samples:
            sys.exit(1)
        
        print(f"Loaded {len(samples)} samples from {args.json_example}")
        print(f"Voice: {args.voice_id}")
        print(f" Model: {args.model_id}")
        print(f" Streaming: {args.stream}")
        if args.temperature is not None:
            print(f"  Temperature: {args.temperature}")
        if args.timestamp is not None:
            print(f" Timestamp: {args.timestamp}")
        if args.text_normalization is not None:
            print(f" Text normalization: {args.text_normalization}")
        print()
        
        synthesis_latencies = []
        first_chunk_latencies = []
        
        for i, text in enumerate(samples, 1):
            print(f" Processing sample {i}/{len(samples)}: {text[:50]}{'...' if len(text) > 50 else ''}")
            
            try:
                if args.stream:
                    audio_chunks, synthesis_time, first_chunk_time, timestamp_info = synthesize_speech(
                        text, args.voice_id, args.model_id, api_key, stream=True,
                        temperature=args.temperature, timestamp_type=args.timestamp, 
                        text_normalization=args.text_normalization
                    )
                    synthesis_latencies.append(synthesis_time)
                    if first_chunk_time is not None:
                        first_chunk_latencies.append(first_chunk_time)
                    print(f"   Synthesis: {synthesis_time:.3f}s, First chunk: {first_chunk_time:.3f}s")
                else:
                    audio_data, synthesis_time, timestamp_info = synthesize_speech(
                        text, args.voice_id, args.model_id, api_key, stream=False,
                        temperature=args.temperature, timestamp_type=args.timestamp, 
                        text_normalization=args.text_normalization
                    )
                    synthesis_latencies.append(synthesis_time)
                    print(f"   Synthesis: {synthesis_time:.3f}s")
                    
            except Exception as e:
                print(f"   Failed: {e}")
                continue
        
        # Display statistics
        display_latency_stats(synthesis_latencies, "Synthesis")
        if first_chunk_latencies:
            display_latency_stats(first_chunk_latencies, "First Chunk")
            
    elif args.output_file:
        # Single synthesis mode
        print("Inworld TTS Synthesis")
        print("=" * 30)
        
        print(f" Text: {args.text}")
        print(f"Voice: {args.voice_id}")
        print(f" Model: {args.model_id}")
        print(f" Streaming: {args.stream}")
        if args.temperature is not None:
            print(f"  Temperature: {args.temperature}")
        if args.timestamp is not None:
            print(f" Timestamp: {args.timestamp}")
        if args.text_normalization is not None:
            print(f" Text normalization: {args.text_normalization}")
        print(f"Output: {args.output_file}")
        print()
        
        try:
            if args.stream:
                print("Starting streaming synthesis...")
                audio_chunks, synthesis_time, first_chunk_time, timestamp_info = synthesize_speech(
                    args.text, args.voice_id, args.model_id, api_key, stream=True,
                    temperature=args.temperature, timestamp_type=args.timestamp, 
                    text_normalization=args.text_normalization
                )
                
                audio_bytes = save_audio_to_file(audio_chunks, args.output_file, args.sample_rate)
                audio_duration = audio_bytes / (args.sample_rate * 2)  # 16-bit mono
                
                print(f"Synthesis time: {synthesis_time:.2f}s")
                print(f"Time to first chunk: {first_chunk_time:.2f}s")
                print(f"Audio duration: {audio_duration:.2f}s")
                print(f"Streaming synthesis completed! Audio saved to: {args.output_file}")
                
                # Display timestamp info if available
                display_timestamp_info(timestamp_info, args.timestamp)
            else:
                print("Starting synthesis...")
                audio_data, synthesis_time, timestamp_info = synthesize_speech(
                    args.text, args.voice_id, args.model_id, api_key, stream=False,
                    temperature=args.temperature, timestamp_type=args.timestamp, 
                    text_normalization=args.text_normalization
                )
                
                audio_bytes = save_audio_to_file(audio_data, args.output_file, args.sample_rate)
                audio_duration = audio_bytes / (args.sample_rate * 2)  # 16-bit mono
                
                print(f"Synthesis time: {synthesis_time:.2f}s")
                print(f"Audio duration: {audio_duration:.2f}s")
                print(f"Synthesis completed! Audio saved to: {args.output_file}")
                
                # Display timestamp info if available
                display_timestamp_info(timestamp_info, args.timestamp)
                
        except Exception as e:
            print(f"Synthesis failed: {e}")
            sys.exit(1)
    else:
        # No arguments provided, show help
        parser.print_help()


if __name__ == "__main__":
    main()
