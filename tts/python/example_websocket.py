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
from typing import AsyncGenerator

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # dotenv is optional; INWORLD_API_KEY can also be set via export

import websockets
from websockets.exceptions import ConnectionClosedError, WebSocketException


def check_api_key():
    """Check if INWORLD_API_KEY environment variable is set."""
    api_key = os.getenv("INWORLD_API_KEY")
    if not api_key:
        print("Error: INWORLD_API_KEY environment variable is not set.")
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
    OGG_OPUS audio bytes as they arrive.
    """
    uri = websocket_url
    headers = {"Authorization": f"Basic {api_key}"}

    try:
        print(f" Connecting to WebSocket: {uri}")
        start_time = time.time()
        websocket = await websockets.connect(uri, additional_headers=headers)

        async with websocket:
            print("WebSocket connection established")
            print(f"Connection established in {time.time() - start_time:.2f} seconds")

            # Send the sequence of context-aware requests
            for req in requests:
                await websocket.send(json.dumps(req))

            print("Receiving audio chunks:")
            chunk_count = 0
            total_audio_size = 0
            first_chunk_time = None
            last_chunk_time = None
            chunk_latencies = []
            recv_start = time.time()

            async for message in websocket:
                try:
                    response = json.loads(message)

                    # Handle server errors
                    if "error" in response:
                        error_msg = response["error"].get("message", "Unknown error")
                        print(f"Server error: {error_msg}")
                        break

                    result = response.get("result")
                    if not result:
                        # Non-result informational message
                        if response.get("done"):
                            print("Synthesis completed (done=true)")
                            break
                        continue

                    # Check for context close confirmation
                    if "contextClosed" in result:
                        print("Context closed confirmation received")
                        break

                    # Status updates
                    if "status" in result:
                        print(f"Status: {result['status']}")

                    # Audio chunk (new protocol)
                    if "audioChunk" in result:
                        audio_chunk_obj = result["audioChunk"]
                        # Some servers may return either nested audioContent or top-level
                        b64_content = audio_chunk_obj.get("audioContent") or result.get("audioContent")
                        if b64_content:
                            audio_bytes = base64.b64decode(b64_content)
                            now = time.time()
                            chunk_count += 1
                            total_audio_size += len(audio_bytes)
                            if chunk_count == 1:
                                first_chunk_time = now - recv_start
                                print(f"   Time to first chunk: {first_chunk_time:.2f} seconds")
                                print(f"   Chunk {chunk_count}: {len(audio_bytes)} bytes")
                            else:
                                inter_chunk = (now - last_chunk_time) * 1000
                                chunk_latencies.append(inter_chunk)
                                print(f"   Chunk {chunk_count}: {len(audio_bytes)} bytes  (inter-chunk: {inter_chunk:.1f} ms)")
                            last_chunk_time = now
                            yield audio_bytes

                        # Optional timestamp info
                        ts_info = audio_chunk_obj.get("timestampInfo")
                        if ts_info is not None:
                            # Print a compact summary (count if list, else dict keys)
                            if isinstance(ts_info, list):
                                print(f"    Timestamps: {len(ts_info)} entries")
                            elif isinstance(ts_info, dict):
                                print(f"    Timestamp fields: {', '.join(ts_info.keys())}")

                except json.JSONDecodeError as e:
                    print(f"   JSON decode error: {e}")
                    continue
                except KeyError as e:
                    print(f"   Missing key in response: {e}")
                    continue

            print(f"\nStream finished. Total chunks: {chunk_count}, total bytes: {total_audio_size}")
            if chunk_latencies:
                avg_latency = sum(chunk_latencies) / len(chunk_latencies)
                min_latency = min(chunk_latencies)
                max_latency = max(chunk_latencies)
                print(f"Inter-chunk latency — avg: {avg_latency:.1f} ms, min: {min_latency:.1f} ms, max: {max_latency:.1f} ms")

    except ConnectionClosedError as e:
        print(f"WebSocket connection closed unexpectedly: {e}")
        raise
    except WebSocketException as e:
        print(f"WebSocket error: {e}")
        raise
    except Exception as e:
        print(f"Error during WebSocket synthesis: {e}")
        raise


async def save_websocket_audio_to_file(audio_chunks_generator, output_file: str):
    """Save WebSocket audio chunks to an OGG file."""
    try:
        print(f"Saving audio chunks to: {output_file}")

        audio_data = bytearray()
        chunk_count = 0

        async for chunk in audio_chunks_generator:
            chunk_count += 1
            audio_data.extend(chunk)

        with open(output_file, "wb") as f:
            f.write(audio_data)

        print(f"Audio saved successfully! Processed {chunk_count} chunks")

    except Exception as e:
        print(f"Error saving audio file: {e}")
        raise


async def synthesize_and_save_with_context(api_key: str, requests: list, output_file: str):
    """Synthesize speech via WebSocket multi-request flow and save to WAV file."""
    audio_generator = stream_tts_with_context(api_key=api_key, requests=requests)
    await save_websocket_audio_to_file(audio_generator, output_file)


def create_websocket_requests(context_id: str, voice_id: str, model_id: str, text: str,
                              timestamp_type: str = None, auto_mode: bool = False):
    """Create the sequence of WebSocket requests for synthesis."""
    create_request = {
        "context_id": context_id,
        "create": {
            "voice_id": voice_id,
            "model_id": model_id,
            "audio_config": {
                "audio_encoding": "OGG_OPUS",
                "sample_rate_hertz": 24000,
                "bit_rate": 32000
            },
        },
    }
    
    if timestamp_type is not None:
        if timestamp_type == "word":
            create_request["create"]["timestampType"] = "WORD"
        elif timestamp_type == "character":
            create_request["create"]["timestampType"] = "CHARACTER"

    if auto_mode:
        create_request["create"]["autoMode"] = True

    send_text_payload = {"text": text}
    if not auto_mode:
        send_text_payload["flush_context"] = {}

    return [
        create_request,
        {
            "context_id": context_id,
            "send_text": send_text_payload
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
  python example_websocket.py --model-id inworld-tts-1.5-mini --timestamp character
        """
    )
    
    parser.add_argument("--model-id", default="inworld-tts-1.5-mini", 
                       help="Model ID to use (default: inworld-tts-1.5-mini)")
    parser.add_argument("--timestamp", choices=["word", "character"], default=None,
                       help="Enable timestamp alignment: 'word' for word-level, 'character' for character-level")
    parser.add_argument("--voice-id", default="Ashley",
                       help="Voice ID to use (default: Ashley)")
    parser.add_argument("--text", default="Hello, adventurer! What a beautiful day, isn't it?...",
                       help="Text to synthesize")
    parser.add_argument("--auto-mode", action="store_true",
                       help=(
                           "Enable auto mode: server controls flushing for optimal latency/quality balance.\n"
                           "Manual flushing is not needed if this is enabled but full sentences/phrases\n"
                           "are expected in each send_text request."
                       ))
    parser.add_argument("--output-file", default="synthesis_websocket_output.ogg",
                       help="Output OGG file path (default: synthesis_websocket_output.ogg)")
    
    args = parser.parse_args()
    
    print("Inworld TTS WebSocket Synthesis (Context Flow) Example")
    print("=" * 50)
    
    print(f" Text: {args.text}")
    print(f"Voice: {args.voice_id}")
    print(f" Model: {args.model_id}")
    if args.timestamp is not None:
        print(f" Timestamp: {args.timestamp}")
    if args.auto_mode:
        print(f"  Auto mode: enabled")
    print(f"Output: {args.output_file}")
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
        timestamp_type=args.timestamp,
        auto_mode=args.auto_mode
    )
    
    try:
        start_time = time.time()
        
        await synthesize_and_save_with_context(
            api_key=api_key,
            requests=requests,
            output_file=args.output_file
        )
        
        total_time = time.time() - start_time
        print(f"Total synthesis time: {total_time:.2f} seconds")
        print(f"WebSocket synthesis completed successfully! Audio file saved: {args.output_file}")
        
    except Exception as e:
        print(f"\nWebSocket synthesis failed: {e}")
        return 1
    
    return 0


if __name__ == "__main__":    
    exit(asyncio.run(main()))
