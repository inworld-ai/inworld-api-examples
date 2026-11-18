#!/usr/bin/env python3
"""
Let built-in Reasoning write the steering instruction.

With `synthesisContext.reasoning` set to REASONING_ON, a language model reads
the text before synthesis and writes a short delivery instruction for it, or
none when the text needs no direction. `reasoningContext` tells it what the
text alone can't: the scene, or the character. The response returns the
instruction it applied in `reasoningInstruction`.

This is the easiest way to steer, but it adds a step before the first audio.
It runs on HTTP requests, unary and streaming; the WebSocket doesn't run it.
For a realtime agent, have your own LLM write the tags instead:
example_llm_steering_stream.py.

    python example_reasoning.py
"""

import base64
import json
import os
import sys
import time

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # dotenv is optional; INWORLD_API_KEY can also be set via export

import requests

API_BASE_URL = os.getenv("INWORLD_API_BASE_URL", "https://api.inworld.ai").rstrip("/")
TEXT = "Don't open that door."
REASONING_CONTEXT = "Protagonist in a psychological thriller, alone in the house at night."
PREVIOUS_TEXTS = ["Did you hear that?"]


def build_request(text: str, reasoning_context: str = "", previous_texts=(),
                  voice_id: str = "Dennis", model_id: str = "inworld-tts-2") -> dict:
    synthesis_context = {"reasoning": "REASONING_ON"}
    if reasoning_context:
        synthesis_context["reasoningContext"] = reasoning_context  # at most 600 characters
    if previous_texts:
        synthesis_context["previousRequests"] = [{"text": t} for t in previous_texts]
    return {
        "text": text,
        "voiceId": voice_id,
        "modelId": model_id,  # Reasoning runs on inworld-tts-2 only
        "audioConfig": {"audioEncoding": "MP3"},
        "synthesisContext": synthesis_context,
    }


def headers(api_key: str) -> dict:
    return {"Authorization": f"Basic {api_key}", "Content-Type": "application/json"}


def raise_for_error(response):
    if response.status_code != 200:
        try:
            detail = json.dumps(response.json())
        except ValueError:
            detail = response.text
        raise RuntimeError(f"HTTP {response.status_code}: {detail}")


def synthesize(api_key: str, body: dict) -> tuple[str, bytes]:
    """Unary request: return the applied instruction ("" if none) and the audio."""
    response = requests.post(f"{API_BASE_URL}/tts/v1/voice", headers=headers(api_key), json=body, timeout=60)
    raise_for_error(response)
    data = response.json()
    return data.get("reasoningInstruction", ""), base64.b64decode(data["audioContent"])


def synthesize_stream(api_key: str, body: dict) -> tuple[str, bytes, float]:
    """Streaming request: return the instruction, the audio, and the seconds to
    the first audio. The instruction is on the first message only."""
    start = time.perf_counter()
    instruction, audio, first_audio = "", bytearray(), None
    with requests.post(f"{API_BASE_URL}/tts/v1/voice:stream", headers=headers(api_key), json=body,
                       stream=True, timeout=60) as response:
        raise_for_error(response)
        for line in response.iter_lines(decode_unicode=True):
            if not line:
                continue
            message = json.loads(line)
            if "error" in message:
                raise RuntimeError(json.dumps(message["error"]))
            result = message.get("result") or {}
            instruction = instruction or result.get("reasoningInstruction", "")
            if content := result.get("audioContent"):
                if first_audio is None:
                    first_audio = time.perf_counter() - start
                audio.extend(base64.b64decode(content))  # MP3 chunks concatenate
    return instruction, bytes(audio), first_audio or 0.0


def describe(instruction: str, text: str) -> str:
    if not instruction:
        return "Reasoning wrote no instruction; the text was read as written."
    return (f"Reasoning instruction: [{instruction}]\n"
            f"To keep this delivery, send it inline and leave reasoning unset: [{instruction}] {text}")


def main() -> int:
    api_key = os.getenv("INWORLD_API_KEY")
    if not api_key:
        print("Error: INWORLD_API_KEY environment variable is not set.")
        print("Please set it with: export INWORLD_API_KEY=your_api_key_here")
        return 1
    body = build_request(TEXT, REASONING_CONTEXT, PREVIOUS_TEXTS)
    print(f"Text:    {TEXT}")
    print(f"Context: {REASONING_CONTEXT}\n")
    try:
        print("1. Unary: POST /tts/v1/voice")
        instruction, audio = synthesize(api_key, body)
        with open("reasoning.mp3", "wb") as f:
            f.write(audio)
        print(describe(instruction, TEXT))
        print("Saved reasoning.mp3\n")

        print("2. Streaming: POST /tts/v1/voice:stream")
        instruction, audio, first_audio = synthesize_stream(api_key, body)
        with open("reasoning_stream.mp3", "wb") as f:
            f.write(audio)
        print(describe(instruction, TEXT))
        print(f"First audio after {first_audio * 1000:.0f} ms, Reasoning included")
        print("Saved reasoning_stream.mp3")
    except (requests.RequestException, OSError, RuntimeError, ValueError, KeyError) as e:
        print(f"Error: {e}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
