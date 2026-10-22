#!/usr/bin/env python3
"""Standalone flight demo shared by the three WebSocket guide entry points."""

import asyncio
import os
import re
import wave

from base import SAMPLE_RATE_HZ


async def speak_one_reply(speaker_class, output_file: str):
    """Stream one simulated LLM reply through speaker_class into a WAV file."""
    api_key = os.getenv("INWORLD_API_KEY")
    if not api_key:
        print("Error: set INWORLD_API_KEY, for example with: export INWORLD_API_KEY=your_api_key_here")
        return 1
    reply = ("Sure, I can help with that. Your flight to Chicago leaves at 7:45 from gate B12, "
             "and boarding starts 30 minutes earlier. Would you like me to book a taxi?")
    tokens = re.findall(r"\s*\S{1,4}", reply)  # pieces the size of LLM tokens

    speaker = speaker_class(api_key)
    await speaker.connect()
    previous_texts = [
        "Let me check the details of your flight to Chicago.",
        "What time does it leave, and when should I be at the gate?",
    ]
    turn = await speaker.start_turn(previous_texts=previous_texts)

    async def stream_llm():
        for token in tokens:
            await speaker.send_text(turn, token)
            await asyncio.sleep(0.02)
        await speaker.end_turn(turn)

    pcm = bytearray()
    sender = asyncio.create_task(stream_llm())
    while True:
        kind, value = await turn.events.get()
        if kind == "audio":
            pcm.extend(value)  # hand to your audio player here
        elif kind == "synthesis":
            print(f"synthesis {value} complete, {turn.audio_seconds:.1f}s of audio so far")
        elif kind == "error":
            print(f"error: {value}")
            sender.cancel()
            await speaker.close()
            return 1
        elif kind == "closed":
            break
    await sender
    await speaker.close()

    with wave.open(output_file, "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(SAMPLE_RATE_HZ)
        f.writeframes(pcm)
    print(f"Wrote {len(pcm) / 2 / SAMPLE_RATE_HZ:.1f}s of audio to {output_file}")
    print(f"Heard through the first 3 seconds: {turn.heard(3.0)!r}")
    return 0
