#!/usr/bin/env python3
"""
Example script for Inworld TTS synthesis with long text input.

This script demonstrates how to synthesize speech from long text by:
1. Chunking text at sentence boundaries (after ~1000 characters)
2. Processing each chunk through the TTS API in parallel
3. Stitching all audio outputs together
4. Reporting splice points with timestamps for quality checking
"""

import base64
import os
import re
import time
import wave
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path

import requests

# Configuration
MIN_CHUNK_SIZE = 1000  # Minimum characters before looking for sentence end
MAX_CHUNK_SIZE = 1900  # Maximum chunk size (API limit is 2000)
SAMPLE_RATE = 48000
BITS_PER_SAMPLE = 16
CHANNELS = 1


@dataclass
class TextChunk:
    """Represents a chunk of text with its position in the original text."""
    text: str
    start_char: int
    end_char: int


@dataclass
class SplicePoint:
    """Represents a splice point in the combined audio."""
    splice_index: int
    timestamp: float
    formatted_time: str
    chunk_start_char: int
    chunk_end_char: int
    text_preview: str


def check_api_key():
    """Check if INWORLD_API_KEY environment variable is set."""
    api_key = os.getenv("INWORLD_API_KEY")
    if not api_key:
        print("Error: INWORLD_API_KEY environment variable is not set.")
        print("Please set it with: export INWORLD_API_KEY=your_api_key_here")
        return None
    return api_key


def chunk_text(text: str) -> list[TextChunk]:
    """
    Chunk text into segments at sentence boundaries.
    After MIN_CHUNK_SIZE characters, looks for sentence-ending punctuation.
    
    Args:
        text: The full text to chunk
        
    Returns:
        List of TextChunk objects with text and positions
    """
    chunks = []
    current_position = 0
    
    # Regex for sentence-ending punctuation
    sentence_end_pattern = re.compile(r"[.!?][\"'\"']?\s+|[.!?][\"'\"']?$")
    
    while current_position < len(text):
        remaining_text = text[current_position:]
        
        # If remaining text is short enough, take it all
        if len(remaining_text) <= MAX_CHUNK_SIZE:
            chunk_text = remaining_text.strip()
            if chunk_text:
                chunks.append(TextChunk(
                    text=chunk_text,
                    start_char=current_position,
                    end_char=len(text)
                ))
            break
        
        # Look for sentence end after MIN_CHUNK_SIZE
        search_text = remaining_text[:MAX_CHUNK_SIZE]
        chunk_end = -1
        
        # Find all sentence endings in the search range after MIN_CHUNK_SIZE
        matches = list(sentence_end_pattern.finditer(search_text))
        valid_matches = [m for m in matches if m.end() >= MIN_CHUNK_SIZE]
        
        if valid_matches:
            # Use the first sentence end after MIN_CHUNK_SIZE
            chunk_end = valid_matches[0].end()
        elif matches:
            # Use the last sentence end before MAX_CHUNK_SIZE
            chunk_end = matches[-1].end()
        else:
            # No sentence end found, break at last space
            space_index = search_text.rfind(' ')
            chunk_end = space_index + 1 if space_index > 0 else MAX_CHUNK_SIZE
        
        chunk_text = remaining_text[:chunk_end].strip()
        if chunk_text:
            chunks.append(TextChunk(
                text=chunk_text,
                start_char=current_position,
                end_char=current_position + chunk_end
            ))
        
        current_position += chunk_end
    
    return chunks


def synthesize_speech(
    text: str, 
    voice_id: str, 
    model_id: str, 
    api_key: str,
    chunk_index: int,
    total_chunks: int
) -> bytes:
    """
    Synthesize speech from text using Inworld TTS API.
    
    Args:
        text: Text to synthesize
        voice_id: Voice ID to use
        model_id: Model ID to use
        api_key: API key for authentication
        chunk_index: Index of this chunk (for logging)
        total_chunks: Total number of chunks (for logging)
        
    Returns:
        bytes: Audio data
    """
    url = "https://api.inworld.ai/tts/v1/voice"
    
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Basic {api_key}"
    }
    
    request_data = {
        "text": text,
        "voice_id": voice_id,
        "model_id": model_id,
        "audio_config": {
            "audio_encoding": "LINEAR16",
            "sample_rate_hertz": SAMPLE_RATE
        }
    }
    
    try:
        print(f"[{chunk_index + 1}/{total_chunks}] Synthesizing chunk ({len(text)} chars)...")
        print(f"   Preview: \"{text[:60]}...\"")
        
        response = requests.post(url, headers=headers, json=request_data)
        response.raise_for_status()
        
        result = response.json()
        audio_data = base64.b64decode(result["audioContent"])
        
        print(f"   Done: {len(audio_data)} bytes")
        return audio_data
        
    except requests.exceptions.RequestException as e:
        print(f"HTTP Error for chunk {chunk_index + 1}: {e}")
        if hasattr(e, 'response') and e.response is not None:
            try:
                error_detail = e.response.json()
                print(f"   Error details: {error_detail}")
            except:
                print(f"   Response text: {e.response.text}")
        raise


def extract_raw_audio(audio_data: bytes) -> bytes:
    """Extract raw audio data from buffer (skip WAV header if present)."""
    if len(audio_data) > 44 and audio_data[:4] == b'RIFF':
        return audio_data[44:]
    return audio_data


def calculate_duration(raw_audio: bytes) -> float:
    """Calculate audio duration from raw PCM data."""
    bytes_per_second = SAMPLE_RATE * (BITS_PER_SAMPLE // 8) * CHANNELS
    return len(raw_audio) / bytes_per_second


def format_time(seconds: float) -> str:
    """Format seconds as MM:SS.mmm"""
    mins = int(seconds // 60)
    secs = seconds % 60
    return f"{mins}:{secs:06.3f}"


def combine_audio_buffers(
    audio_buffers: list[bytes], 
    chunks: list[TextChunk]
) -> tuple[bytes, list[SplicePoint], float]:
    """
    Combine multiple audio buffers and create splice report.
    
    Args:
        audio_buffers: List of audio data buffers
        chunks: Original text chunks with positions
        
    Returns:
        Tuple of (combined_audio, splice_points, total_duration)
    """
    splice_points = []
    current_time = 0.0
    raw_buffers = []
    
    for index, buffer in enumerate(audio_buffers):
        raw_audio = extract_raw_audio(buffer)
        duration = calculate_duration(raw_audio)
        
        if index > 0:
            splice_points.append(SplicePoint(
                splice_index=index,
                timestamp=current_time,
                formatted_time=format_time(current_time),
                chunk_start_char=chunks[index].start_char,
                chunk_end_char=chunks[index].end_char,
                text_preview=chunks[index].text[:50] + "..."
            ))
        
        current_time += duration
        raw_buffers.append(raw_audio)
    
    combined_audio = b''.join(raw_buffers)
    return combined_audio, splice_points, current_time


def save_audio_to_file(audio_data: bytes, output_file: str):
    """Save combined audio to WAV file."""
    with wave.open(output_file, "wb") as wf:
        wf.setnchannels(CHANNELS)
        wf.setsampwidth(BITS_PER_SAMPLE // 8)
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(audio_data)
    
    print(f"Audio saved to: {output_file}")


def print_splice_report(splice_points: list[SplicePoint], total_duration: float):
    """Print splice report for quality checking."""
    print("\nSPLICE REPORT - Check these timestamps for voice quality:")
    print("=" * 70)
    
    if not splice_points:
        print("   No splices - text was short enough for single request")
        return
    
    print(f"   Total splices: {len(splice_points)}")
    print(f"   Total duration: {format_time(total_duration)}\n")
    
    for idx, point in enumerate(splice_points):
        print(f"   Splice #{idx + 1}:")
        print(f"      Timestamp: {point.formatted_time}")
        print(f"      Character position: {point.chunk_start_char}")
        print(f"      Text: \"{point.text_preview}\"")
        print()
    
    print("   Tip: Listen to timestamps above to verify consistent voice quality")
    print("=" * 70)


def synthesize_chunk_wrapper(args):
    """Wrapper function for parallel synthesis."""
    chunk, voice_id, model_id, api_key, index, total = args
    return index, synthesize_speech(chunk.text, voice_id, model_id, api_key, index, total)


def main():
    """Main function to demonstrate long text TTS synthesis."""
    print("Inworld TTS Long Text Synthesis Example")
    print("=" * 50)
    
    # Check API key
    api_key = check_api_key()
    if not api_key:
        return 1
    
    # Configuration
    voice_id = "Edward"
    model_id = "inworld-tts-1-max"
    output_file = "synthesis_long_output.wav"
    
    # Read input text file
    script_dir = Path(__file__).parent
    input_file = script_dir / ".." / "tests-data" / "text" / "chapter1.txt"
    
    try:
        text = input_file.read_text(encoding="utf-8")
        print(f"Loaded text file: {input_file}")
        print(f"   Total characters: {len(text)}")
    except Exception as e:
        print(f"Error reading input file: {e}")
        return 1
    
    # Chunk the text
    print(f"\nChunking text (min {MIN_CHUNK_SIZE} chars, max {MAX_CHUNK_SIZE} chars per chunk)...")
    chunks = chunk_text(text)
    print(f"   Created {len(chunks)} chunks\n")
    
    # Display chunk info
    for i, chunk in enumerate(chunks):
        print(f"   Chunk {i + 1}: {len(chunk.text)} chars (positions {chunk.start_char}-{chunk.end_char})")
    print()
    
    try:
        start_time = time.time()
        
        # Synthesize all chunks in parallel
        print("Starting parallel TTS synthesis for all chunks...\n")
        
        # Prepare arguments for parallel execution
        synthesis_args = [
            (chunk, voice_id, model_id, api_key, i, len(chunks))
            for i, chunk in enumerate(chunks)
        ]
        
        # Use ThreadPoolExecutor for parallel requests
        audio_buffers = [None] * len(chunks)
        with ThreadPoolExecutor(max_workers=len(chunks)) as executor:
            futures = {
                executor.submit(synthesize_chunk_wrapper, args): args[4]  # args[4] is index
                for args in synthesis_args
            }
            
            for future in as_completed(futures):
                index, audio_data = future.result()
                audio_buffers[index] = audio_data
        
        # Combine audio (buffers are in correct order)
        print("\nCombining audio chunks...")
        combined_audio, splice_points, total_duration = combine_audio_buffers(audio_buffers, chunks)
        
        # Save to file
        save_audio_to_file(combined_audio, output_file)
        
        synthesis_time = time.time() - start_time
        
        # Print splice report
        print_splice_report(splice_points, total_duration)
        
        print(f"\nTotal synthesis time: {synthesis_time:.2f} seconds")
        print(f"Synthesis completed! Output file: {output_file}")
        print(f"   Audio duration: {format_time(total_duration)}")
        
    except Exception as e:
        print(f"\nSynthesis failed: {e}")
        return 1
    
    return 0


if __name__ == "__main__":
    exit(main())

