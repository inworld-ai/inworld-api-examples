#!/usr/bin/env python3
"""
Example script for Inworld STT transcription from the microphone.

This script demonstrates how to capture live microphone input and stream it
to the STT WebSocket API for real-time transcription.
"""

import asyncio
import base64
import json
import os
import signal
import sys
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

import sounddevice as sd
import websockets

API_BASE = "https://api.inworld.ai"
SAMPLE_RATE = 16000
CHANNELS = 1
CHUNK_DURATION_MS = 100
END_OF_AUDIO_DELAY_MS = 350
CLOSE_GRACE_MS = 2500

# ~100 ms of samples per block (16-bit = 2 bytes per sample)
BLOCK_SIZE = int(SAMPLE_RATE * CHUNK_DURATION_MS / 1000)


def check_api_key():
    """Check if INWORLD_API_KEY environment variable is set."""
    api_key = os.getenv("INWORLD_API_KEY")
    if not api_key:
        print("Error: INWORLD_API_KEY environment variable is not set.")
        print("Please set it with: export INWORLD_API_KEY=your_api_key_here")
        return None
    return api_key


async def stream_mic_to_stt(
    api_key: str,
    model_id: str = "assemblyai/universal-streaming-multilingual",
    language: str | None = None,
):
    """Stream microphone PCM to STT WebSocket. Returns list of final transcript segments."""
    ws_url = API_BASE.replace("https://", "wss://").replace("http://", "ws://")
    ws_url += "/stt/v1/transcribe:streamBidirectional"

    final_texts = []
    last_partial = ""
    loop = asyncio.get_running_loop()
    audio_queue = asyncio.Queue(maxsize=10)  # bounded to limit memory; drop if consumer is slow
    stop_requested = asyncio.Event()
    stream = None

    def _enqueue_chunk(chunk: bytes) -> None:
        """Enqueue audio on the asyncio thread (called via call_soon_threadsafe)."""
        try:
            audio_queue.put_nowait(chunk)
        except asyncio.QueueFull:
            pass  # drop chunk to avoid blocking the audio thread

    def audio_callback(indata, frame_count, time_info, status):
        if status:
            print("Sounddevice:", status, file=sys.stderr)
        if indata is None or len(indata) == 0:
            return
        chunk = indata.tobytes() if hasattr(indata, "tobytes") else bytes(indata)
        if not chunk:
            return
        loop.call_soon_threadsafe(_enqueue_chunk, chunk)

    def request_stop():
        stop_requested.set()

    try:
        loop.add_signal_handler(signal.SIGINT, request_stop)
        loop.add_signal_handler(signal.SIGTERM, request_stop)
    except (NotImplementedError, RuntimeError, ValueError, OSError):
        # add_signal_handler not supported (e.g. Windows); fall back to signal.signal where possible
        try:
            signal.signal(signal.SIGINT, lambda *_: request_stop())
            signal.signal(signal.SIGTERM, lambda *_: request_stop())
        except (ValueError, OSError, RuntimeError):
            pass  # signal handling not available

    transcribe_config = {
        "modelId": model_id,
        "audioEncoding": "LINEAR16",
        "sampleRateHertz": SAMPLE_RATE,
        "numberOfChannels": CHANNELS,
    }
    if language:
        transcribe_config["language"] = language

    async with websockets.connect(
        ws_url,
        additional_headers={"Authorization": f"Basic {api_key}"},
    ) as ws:
        await ws.send(json.dumps({"transcribeConfig": transcribe_config}))

        async def send_audio():
            nonlocal stream
            try:
                stream = sd.RawInputStream(
                    samplerate=SAMPLE_RATE,
                    channels=CHANNELS,
                    dtype="int16",
                    blocksize=BLOCK_SIZE,
                    callback=audio_callback,
                )
                stream.start()
            except Exception as e:
                print(f"Microphone error: {e}", file=sys.stderr)
                stop_requested.set()
                return

            try:
                while not stop_requested.is_set():
                    try:
                        chunk = await asyncio.wait_for(audio_queue.get(), timeout=0.2)
                        await ws.send(json.dumps({
                            "audioChunk": {"content": base64.b64encode(chunk).decode("utf-8")},
                        }))
                    except asyncio.TimeoutError:
                        continue
                    except asyncio.CancelledError:
                        break

                # Flush remaining queued audio
                while not audio_queue.empty():
                    try:
                        chunk = audio_queue.get_nowait()
                        await ws.send(json.dumps({
                            "audioChunk": {"content": base64.b64encode(chunk).decode("utf-8")},
                        }))
                    except asyncio.QueueEmpty:
                        break
            finally:
                if stream is not None:
                    try:
                        stream.stop()
                        stream.close()
                    except Exception:
                        pass

            await asyncio.sleep(END_OF_AUDIO_DELAY_MS / 1000)
            await ws.send(json.dumps({"endTurn": {}}))
            await ws.send(json.dumps({"closeStream": {}}))
            await asyncio.sleep(CLOSE_GRACE_MS / 1000)
            try:
                await ws.close()
            except Exception:
                pass

        send_task = asyncio.create_task(send_audio())

        try:
            async for raw in ws:
                msg = json.loads(raw)
                transcription = msg.get("result", {}).get("transcription")
                if transcription is None:
                    continue
                text = transcription.get("transcript", "")
                is_final = transcription.get("isFinal", False)
                if text:
                    label = "[FINAL]" if is_final else "[interim]"
                    print(f"{label} {text}")
                    if is_final:
                        final_texts.append(text)
                        last_partial = ""
                    else:
                        last_partial = text
        except websockets.ConnectionClosed:
            pass

        await send_task

    if last_partial.strip():
        final_texts.append(last_partial.strip())
    return final_texts


def main():
    print("Inworld STT: real-time transcription from microphone")
    print("=" * 50)
    print("Speak into your microphone. Press Ctrl+C to stop.\n")

    api_key = check_api_key()
    if not api_key:
        return 1

    try:
        final_texts = asyncio.run(stream_mic_to_stt(api_key))
        print("\nFull transcript:", " ".join(final_texts).strip() or "(none)")
    except KeyboardInterrupt:
        print("\nStopped.")
        return 0
    except Exception as e:
        print(f"Error: {e}")
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
