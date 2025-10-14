#!/usr/bin/env python3
"""
Example script for Inworld TTS synthesis using WebSocket connections.

This script demonstrates how to synthesize speech from text using the Inworld TTS API
with WebSocket connections for real-time streaming audio synthesis.
"""

import argparse
import asyncio
import base64
import json
import os
import time
import wave
from typing import AsyncGenerator, Optional

import websockets
from websockets.exceptions import ConnectionClosedError, WebSocketException


def check_api_key():
    """Check if INWORLD_API_KEY environment variable is set."""
    api_key = os.getenv("INWORLD_API_KEY")
    if not api_key:
        print("❌ Error: INWORLD_API_KEY environment variable is not set.")
        print("Please set it with: export INWORLD_API_KEY=your_api_key_here")
        return None
    return api_key


async def stream_tts_with_context(
    api_key: str,
    requests: list,
    websocket_url: str = "wss://api.inworld.ai/tts/v1/voice:streamBidirectional"
) -> AsyncGenerator[bytes, None]:
    """
    Stream TTS audio using multi-request context flow over WebSocket.
    Sends a sequence of messages (create/send_text/close_context) and yields
    LINEAR16 audio bytes as they arrive.
    """
    uri = websocket_url
    headers = {"Authorization": f"Basic {api_key}"}

    try:
        print(f"🔌 Connecting to WebSocket: {uri}")
        start_time = time.time()
        websocket = await websockets.connect(uri, additional_headers=headers)

        async with websocket:
            print("✅ WebSocket connection established")
            print(f"⏱️  Connection established in {time.time() - start_time:.2f} seconds")

            # Send the sequence of context-aware requests
            for req in requests:
                await websocket.send(json.dumps(req))

            print("📡 Receiving audio chunks:")
            chunk_count = 0
            total_audio_size = 0
            first_chunk_time = None
            recv_start = time.time()

            async for message in websocket:
                try:
                    response = json.loads(message)

                    # Handle server errors
                    if "error" in response:
                        error_msg = response["error"].get("message", "Unknown error")
                        print(f"❌ Server error: {error_msg}")
                        break

                    result = response.get("result")
                    if not result:
                        # Non-result informational message
                        if response.get("done"):
                            print("✅ Synthesis completed (done=true)")
                            break
                        continue

                    # Check for context close confirmation
                    if "contextClosed" in result:
                        print("✅ Context closed confirmation received")
                        break

                    # Status updates
                    if "status" in result:
                        print(f"ℹ️  Status: {result['status']}")

                    # Audio chunk (new protocol)
                    if "audioChunk" in result:
                        audio_chunk_obj = result["audioChunk"]
                        # Some servers may return either nested audioContent or top-level
                        b64_content = audio_chunk_obj.get("audioContent") or result.get("audioContent")
                        if b64_content:
                            audio_bytes = base64.b64decode(b64_content)
                            chunk_count += 1
                            total_audio_size += len(audio_bytes)
                            if chunk_count == 1:
                                first_chunk_time = time.time() - recv_start
                                print(f"   ⏱️  Time to first chunk: {first_chunk_time:.2f} seconds")
                            print(f"   📦 Chunk {chunk_count}: {len(audio_bytes)} bytes")
                            yield audio_bytes

                        # Optional timestamp info
                        ts_info = audio_chunk_obj.get("timestampInfo")
                        if ts_info is not None:
                            # Print a compact summary (count if list, else dict keys)
                            if isinstance(ts_info, list):
                                print(f"   🕒 Timestamps: {len(ts_info)} entries")
                            elif isinstance(ts_info, dict):
                                print(f"   🕒 Timestamp fields: {', '.join(ts_info.keys())}")

                except json.JSONDecodeError as e:
                    print(f"   ⚠️  JSON decode error: {e}")
                    continue
                except KeyError as e:
                    print(f"   ⚠️  Missing key in response: {e}")
                    continue

            print(f"\n✅ Stream finished. Total chunks: {chunk_count}, total bytes: {total_audio_size}")

    except ConnectionClosedError as e:
        print(f"❌ WebSocket connection closed unexpectedly: {e}")
        raise
    except WebSocketException as e:
        print(f"❌ WebSocket error: {e}")
        raise
    except Exception as e:
        print(f"❌ Error during WebSocket synthesis: {e}")
        raise


async def save_websocket_audio_to_file(audio_chunks_generator, output_file: str):
    """Save WebSocket audio chunks to a WAV file."""
    try:
        print(f"💾 Saving audio chunks to: {output_file}")
        
        # Collect all raw audio data (skip WAV headers from chunks)
        raw_audio_data = bytearray()
        chunk_count = 0
        
        async for chunk in audio_chunks_generator:
            chunk_count += 1
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
        
        print(f"✅ Audio saved successfully! Processed {chunk_count} chunks")
        
    except Exception as e:
        print(f"❌ Error saving audio file: {e}")
        raise


async def synthesize_and_save_with_context(api_key: str, requests: list, output_file: str):
    """Synthesize speech via WebSocket multi-request flow and save to WAV file."""
    audio_generator = stream_tts_with_context(api_key=api_key, requests=requests)
    await save_websocket_audio_to_file(audio_generator, output_file)


def create_websocket_requests(context_id: str, voice_id: str, model_id: str, text: str, timestamp_type: str = None):
    """Create the sequence of WebSocket requests for synthesis."""
    # Prepare create context request
    create_request = {
        "context_id": context_id,
        "create": {
            "voice_id": voice_id,
            "model_id": model_id,
            "buffer_char_threshold": 50,
            "audio_config": {
                "audio_encoding": "LINEAR16",
                "sample_rate_hertz": 48000
            },
        },
    }
    
    # Add timestamp type if specified
    if timestamp_type is not None:
        if timestamp_type == "word":
            create_request["create"]["timestampType"] = "WORD"
        elif timestamp_type == "character":
            create_request["create"]["timestampType"] = "CHARACTER"
    
    return [
        create_request,
        {
            "context_id": context_id,
            "send_text": {
                "text": text,
                "flush_context": {}
            }
        },
        {
            "context_id": context_id,
            "close_context": {}
        }
    ]


async def main():
    """Main function to demonstrate WebSocket TTS synthesis."""
    # Parse command line arguments
    parser = argparse.ArgumentParser(
        description="Inworld TTS WebSocket Synthesis Example",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Basic WebSocket synthesis with default model
  python example_websocket.py
  
  # WebSocket synthesis with word-level timestamps
  python example_websocket.py --timestamp word
  
  # WebSocket synthesis with custom model and character timestamps
  python example_websocket.py --model-id inworld-tts-1 --timestamp character
        """
    )
    
    parser.add_argument("--model-id", default="inworld-tts-1", 
                       help="Model ID to use (default: inworld-tts-1)")
    parser.add_argument("--timestamp", choices=["word", "character"], default=None,
                       help="Enable timestamp alignment: 'word' for word-level, 'character' for character-level")
    parser.add_argument("--voice-id", default="Ashley",
                       help="Voice ID to use (default: Ashley)")
    parser.add_argument("--text", default="Hello, adventurer! What a beautiful day, isn't it?...",
                       help="Text to synthesize")
    parser.add_argument("--output-file", default="synthesis_websocket_output.wav",
                       help="Output WAV file path (default: synthesis_websocket_output.wav)")
    
    args = parser.parse_args()
    
    print("🎵 Inworld TTS WebSocket Synthesis (Context Flow) Example")
    print("=" * 50)
    
    print(f"📝 Text: {args.text}")
    print(f"🎤 Voice: {args.voice_id}")
    print(f"🤖 Model: {args.model_id}")
    if args.timestamp is not None:
        print(f"⏰ Timestamp: {args.timestamp}")
    print(f"📁 Output: {args.output_file}")
    print()
    
    # Check API key
    api_key = check_api_key()
    if not api_key:
        return 1
    
    # Create requests with parsed arguments
    requests = create_websocket_requests(
        context_id="ctx-1",
        voice_id=args.voice_id,
        model_id=args.model_id,
        text=args.text,
        timestamp_type=args.timestamp
    )
    
    try:
        start_time = time.time()
        
        await synthesize_and_save_with_context(
            api_key=api_key,
            requests=requests,
            output_file=args.output_file
        )
        
        total_time = time.time() - start_time
        print(f"⏱️  Total synthesis time: {total_time:.2f} seconds")
        print(f"🎉 WebSocket synthesis completed successfully! Audio file saved: {args.output_file}")
        
    except Exception as e:
        print(f"\n❌ WebSocket synthesis failed: {e}")
        return 1
    
    return 0


if __name__ == "__main__":    
    exit(asyncio.run(main()))
