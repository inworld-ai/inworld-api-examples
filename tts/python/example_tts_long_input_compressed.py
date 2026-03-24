#!/usr/bin/env python3
"""
Example script for Inworld TTS synthesis with long text input (MP3 compressed).

This script demonstrates how to synthesize speech from long text by:
1. Chunking text at natural boundaries (paragraphs → newlines → sentences)
2. Processing chunks through the TTS API with controlled concurrency
3. Merging segment outputs with ffmpeg so duration/playback are correct.
"""

import base64
import os
import re
import subprocess
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # dotenv is optional; INWORLD_API_KEY can also be set via export

import requests

# Configuration
INPUT_FILE_PATH = "../tests-data/text/chapter1.txt"  # Path to input text file (relative to this script)
MIN_CHUNK_SIZE = 500    # Minimum characters before looking for break point
MAX_CHUNK_SIZE = 1600   # Maximum chunk size (API limit is 2000)
MAX_CONCURRENT_REQUESTS = 2   # Limit parallel requests to avoid RPS limits
MAX_RETRIES = 3         # Maximum retries for rate limit errors
RETRY_BASE_DELAY = 1.0  # Base delay for exponential backoff (seconds)
CHARS_PER_SECOND = 12.0 # Approx speaking rate; used to convert <break> durations to equivalent char counts
CJK_CHAR_WEIGHT = 3.0   # CJK chars produce ~3x more audio than Latin chars

# Audio configuration for MP3
SAMPLE_RATE = 48000


@dataclass
class TextChunk:
    """Represents a chunk of text with its position in the original text."""
    text: str
    start_char: int
    end_char: int


@dataclass
class SynthesisConfig:
    """Configuration for TTS synthesis."""
    voice_id: str
    model_id: str
    api_key: str
    audio_encoding: str = "MP3"


def check_api_key() -> Optional[str]:
    """Check if INWORLD_API_KEY environment variable is set."""
    api_key = os.getenv("INWORLD_API_KEY")
    if not api_key:
        print("Error: INWORLD_API_KEY environment variable is not set.")
        print("Please set it with: export INWORLD_API_KEY=your_api_key_here")
        return None
    return api_key


def _count_cjk(text: str) -> int:
    """Count CJK characters (Chinese, Japanese Kanji/Kana, Korean Hangul)."""
    return sum(1 for c in text if '\u4e00' <= c <= '\u9fff'
               or '\u3040' <= c <= '\u30ff' or '\uac00' <= c <= '\ud7af')


def estimate_effective_length(text: str, chars_per_second: float = CHARS_PER_SECOND) -> int:
    """Return text length with SSML <break> durations and CJK weight factored in.

    Without this, chunks stuffed with <break time="Xs"/> tags look short in chars
    but produce huge audio, potentially exceeding API response size limits. CJK characters also
    produce ~3x more audio per character than Latin text.
    """
    break_pattern = re.compile(r'<break\s+time="([\d.]+)(m?s)"\s*/?>', re.IGNORECASE)

    total_break_seconds = 0.0
    for m in break_pattern.finditer(text):
        try:
            val = float(m.group(1))
            total_break_seconds += val / 1000 if m.group(2).lower() == 'ms' else val
        except ValueError:
            pass

    text_without_breaks = re.sub(r'<break\s[^>]*/?>',  '', text, flags=re.IGNORECASE)
    cjk_count = _count_cjk(text_without_breaks)
    raw_length = (len(text_without_breaks) - cjk_count) + int(cjk_count * CJK_CHAR_WEIGHT)

    return raw_length + int(total_break_seconds * chars_per_second)


def find_break_point(text: str, min_pos: int, max_pos: int, chunk_index: int) -> int:
    """
    Find the best break point in text, prioritizing:
    1. Paragraph breaks (\\n\\n)
    2. Line breaks (\\n)
    3. Sentence endings (.!?)
    4. Last space (fallback)
    
    Args:
        text: Text to search for break point
        min_pos: Minimum position to start looking
        max_pos: Maximum position to look
        chunk_index: Current chunk index for logging
        
    Returns:
        Position of best break point
    """
    search_text = text[:max_pos]
    
    # 1. Try paragraph breaks (\n\n) after min_pos
    search_start = min_pos
    while True:
        idx = search_text.find('\n\n', search_start)
        if idx == -1 or idx >= max_pos:
            break
        if idx >= min_pos:
            print(f"  Chunk {chunk_index + 1}: Found paragraph break at position {idx + 2}")
            return idx + 2  # Include the paragraph break
        search_start = idx + 1
    
    # 2. Try single line breaks (\n) after min_pos
    search_start = min_pos
    while True:
        idx = search_text.find('\n', search_start)
        if idx == -1 or idx >= max_pos:
            break
        if idx >= min_pos:
            print(f"  Chunk {chunk_index + 1}: Found line break at position {idx + 1}")
            return idx + 1
        search_start = idx + 1
    
    # 3. Try sentence endings after min_pos
    sentence_end_pattern = re.compile(r'[.!?]["\'"\'"]?\s+|[.!?]["\'"\'"]?$')
    for match in sentence_end_pattern.finditer(search_text):
        if match.start() >= min_pos:
            print(f"  Chunk {chunk_index + 1}: Found sentence break at position {match.end()}")
            return match.end()
    
    # 4. Fall back to any sentence end before max_pos
    last_sentence_end = -1
    for match in sentence_end_pattern.finditer(search_text):
        last_sentence_end = match.end()
    if last_sentence_end > 0:
        print(f"  Chunk {chunk_index + 1}: Found sentence break (fallback) at position {last_sentence_end}")
        return last_sentence_end
    
    # 5. Last resort: break at last space
    space_index = search_text.rfind(' ')
    break_pos = space_index + 1 if space_index > 0 else max_pos
    print(f"  Chunk {chunk_index + 1}: Found space break (fallback) at position {break_pos}")
    return break_pos


def chunk_text(text: str) -> list[TextChunk]:
    """
    Chunk text into segments at natural boundaries.
    Prioritizes paragraph breaks, then line breaks, then sentence endings.
    
    Args:
        text: The full text to chunk
        
    Returns:
        List of TextChunk objects with text and positions
    """
    chunks = []
    current_position = 0
    
    while current_position < len(text):
        remaining_text = text[current_position:]
        
        # If remaining text fits within the effective budget, take it all
        if estimate_effective_length(remaining_text) <= MAX_CHUNK_SIZE:
            chunk_content = remaining_text.strip()
            if chunk_content:
                chunks.append(TextChunk(
                    text=chunk_content,
                    start_char=current_position,
                    end_char=len(text)
                ))
            break
        
        # Shrink search window when <break> tags inflate effective length
        candidate = remaining_text[:MAX_CHUNK_SIZE]
        eff_len = estimate_effective_length(candidate)
        if eff_len > MAX_CHUNK_SIZE:
            scale = MAX_CHUNK_SIZE / eff_len
            effective_max = max(1, int(len(candidate) * scale))
            effective_min = max(1, int(MIN_CHUNK_SIZE * scale))
        else:
            effective_max = MAX_CHUNK_SIZE
            effective_min = MIN_CHUNK_SIZE

        chunk_end = find_break_point(remaining_text, effective_min, effective_max, len(chunks))
        
        chunk_content = remaining_text[:chunk_end].strip()
        if chunk_content:
            chunks.append(TextChunk(
                text=chunk_content,
                start_char=current_position,
                end_char=current_position + chunk_end
            ))
        
        current_position += chunk_end
    
    return chunks


def synthesize_speech(
    text: str,
    config: SynthesisConfig,
    chunk_index: int,
    total_chunks: int
) -> bytes:
    """
    Synthesize speech from text using Inworld TTS API with retry logic.
    
    Args:
        text: Text to synthesize
        config: Synthesis configuration
        chunk_index: Index of this chunk (for logging)
        total_chunks: Total number of chunks (for logging)
        
    Returns:
        bytes: Audio data
    """
    url = "https://api.inworld.ai/tts/v1/voice"
    
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Basic {config.api_key}"
    }
    
    request_data = {
        "text": text,
        "voice_id": config.voice_id,
        "model_id": config.model_id,
        "audio_config": {
            "audio_encoding": config.audio_encoding,
            "sample_rate_hertz": SAMPLE_RATE
        }
    }
    
    for attempt in range(MAX_RETRIES):
        try:
            print(f"[{chunk_index + 1}/{total_chunks}] Synthesizing chunk ({len(text)} chars)...")
            
            response = requests.post(url, headers=headers, json=request_data)
            response.raise_for_status()
            
            result = response.json()
            audio_data = base64.b64decode(result["audioContent"])
            
            print(f"[{chunk_index + 1}/{total_chunks}] Done - {len(audio_data)} bytes")
            return audio_data
            
        except requests.exceptions.RequestException as e:
            is_rate_limit = hasattr(e, 'response') and e.response is not None and e.response.status_code == 429
            is_last_attempt = attempt == MAX_RETRIES - 1
            
            if is_rate_limit and not is_last_attempt:
                delay = RETRY_BASE_DELAY * (2 ** attempt)
                print(f"[{chunk_index + 1}/{total_chunks}] Rate limited, retrying in {delay:.1f}s...")
                time.sleep(delay)
                continue
            
            print(f"Error for chunk {chunk_index + 1}: {e}")
            if hasattr(e, 'response') and e.response is not None:
                try:
                    error_detail = e.response.json()
                    print(f"   Error details: {error_detail}")
                except Exception:
                    print(f"   Response text: {e.response.text}")
            raise
    
    # Should not reach here, but just in case
    raise RuntimeError(f"Failed to synthesize chunk {chunk_index + 1} after {MAX_RETRIES} attempts")


def synthesize_chunk_wrapper(args: tuple) -> tuple[int, bytes]:
    """Wrapper function for parallel synthesis."""
    chunk, config, index, total = args
    return index, synthesize_speech(chunk.text, config, index, total)


def synthesize_all_chunks(
    chunks: list[TextChunk],
    config: SynthesisConfig
) -> list[bytes]:
    """
    Process chunks with controlled concurrency.
    
    Args:
        chunks: Text chunks to process
        config: Synthesis configuration
        
    Returns:
        Audio buffers in order
    """
    synthesis_args = [
        (chunk, config, i, len(chunks))
        for i, chunk in enumerate(chunks)
    ]
    
    audio_buffers = [None] * len(chunks)
    
    with ThreadPoolExecutor(max_workers=MAX_CONCURRENT_REQUESTS) as executor:
        futures = {
            executor.submit(synthesize_chunk_wrapper, args): args[2]
            for args in synthesis_args
        }
        
        for future in as_completed(futures):
            index, audio_data = future.result()
            audio_buffers[index] = audio_data
    
    return audio_buffers


def combine_audio_buffers(audio_buffers: list[bytes]) -> bytes:
    """
    Combine multiple MP3 audio buffers into one by raw concatenation.
    Note: Each API response is a complete MP3 file (with its own header/duration). Raw concat
    produces a file that players and duration tools interpret as only the first segment,
    so the reported duration/playback metadata may be incorrect.

    Prefer merge_mp3_segments_with_ffmpeg() when ffmpeg is available, as it produces a single
    MP3 with correct duration and playback. This function is intended as a fallback when ffmpeg
    is not available or cannot be used.
    """
    return b''.join(audio_buffers)


def merge_mp3_segments_with_ffmpeg(audio_buffers: list[bytes], output_file: str) -> bool:
    """
    Merge multiple MP3 buffers into one file with correct duration using ffmpeg.
    Each non-streaming API response is a full MP3; raw concat makes duration/show length wrong.
    Returns True if merged with ffmpeg, False if ffmpeg unavailable (caller should fall back).
    """
    tmp_dir = tempfile.mkdtemp(prefix="inworld-tts-long-")
    try:
        list_path = os.path.join(tmp_dir, "list.txt")
        seg_paths = []
        for i, buf in enumerate(audio_buffers):
            seg_path = os.path.join(tmp_dir, f"seg_{i}.mp3")
            with open(seg_path, "wb") as f:
                f.write(buf)
            seg_paths.append(seg_path)
        with open(list_path, "w") as f:
            for p in seg_paths:
                escaped_p = p.replace("'", "'\\''")
                f.write(f"file '{escaped_p}'\n")
        result = subprocess.run(
            ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", list_path, "-c", "copy", output_file],
            capture_output=True,
            timeout=120,
        )
        if result.returncode == 0:
            return True
        return False
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False
    except Exception:
        return False
    finally:
        try:
            for f in os.listdir(tmp_dir):
                os.unlink(os.path.join(tmp_dir, f))
            os.rmdir(tmp_dir)
        except OSError:
            pass


def save_audio_to_file(audio_data: bytes, output_file: str):
    """Save MP3 audio to file."""
    with open(output_file, 'wb') as f:
        f.write(audio_data)
    print(f"Audio saved to: {output_file}")


def read_input_text(input_file: Path) -> Optional[str]:
    """Read input text from file."""
    try:
        text = input_file.read_text(encoding="utf-8")
        print(f"Loaded: {input_file} ({len(text)} chars)")
        return text
    except Exception as e:
        print(f"Error reading input file: {e}")
        return None


def main():
    """Main function - high-level orchestration only."""
    print("Inworld TTS Long Text Synthesis (MP3 Compressed)\n")
    
    # Setup
    api_key = check_api_key()
    if not api_key:
        return 1
    
    # Configuration - modify these for your use case
    voice_id = "Edward"
    model_id = "inworld-tts-1.5-max"  # max model for non-streaming: higher quality
    output_file = "synthesis_long_output.mp3"
    
    script_dir = Path(__file__).parent
    input_file = script_dir / INPUT_FILE_PATH
    
    config = SynthesisConfig(
        voice_id=voice_id,
        model_id=model_id,
        api_key=api_key,
        audio_encoding="MP3"
    )
    
    # Read input text
    text = read_input_text(input_file)
    if not text:
        return 1
    
    # Split into chunks
    chunks = chunk_text(text)
    print(f"Split into {len(chunks)} chunks (min: {MIN_CHUNK_SIZE}, max: {MAX_CHUNK_SIZE} chars)\n")
    
    try:
        start_time = time.time()
        
        # Synthesize all chunks
        print(f"Synthesizing with {MAX_CONCURRENT_REQUESTS} concurrent requests...\n")
        audio_buffers = synthesize_all_chunks(chunks, config)
        
        # Merge audio (ffmpeg gives correct duration; raw concat would show first segment only)
        print("\nMerging audio...")
        merged_with_ffmpeg = merge_mp3_segments_with_ffmpeg(audio_buffers, output_file)
        if not merged_with_ffmpeg:
            print("   (ffmpeg unavailable or failed; saving raw concatenation — duration may show as first segment only)")
            combined_audio = combine_audio_buffers(audio_buffers)
            save_audio_to_file(combined_audio, output_file)
        else:
            print(f"Audio saved to: {output_file}")
        
        # Report
        file_size_kb = os.path.getsize(output_file) / 1024
        elapsed = time.time() - start_time
        print(f"Output size: {file_size_kb:.1f} KB")
        print(f"Completed in {elapsed:.2f}s")
        
    except Exception as e:
        print(f"\nSynthesis failed: {e}")
        return 1
    
    return 0


if __name__ == "__main__":
    exit(main())

