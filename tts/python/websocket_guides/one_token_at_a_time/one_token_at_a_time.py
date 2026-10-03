#!/usr/bin/env python3
"""
Speak an agent's replies with sentence-boundary auto mode (Preview).

Everything else, including barge-in and the LLM history, is the base guide's
(../one_flush_per_turn/one_flush_per_turn.py). What changes: the context is created with
`autoModeStrategy: SENTENCE_BOUNDARY`, and each LLM token is sent as it
arrives. The service finds the sentences, so the client needs no splitter.

    python one_token_at_a_time.py
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "one_flush_per_turn"))

import one_flush_per_turn  # noqa: E402


class Speaker(one_flush_per_turn.Speaker):
    CREATE = {"autoMode": True, "autoModeStrategy": "SENTENCE_BOUNDARY"}

    async def send_text(self, turn: one_flush_per_turn.Turn, token: str):
        """Send each LLM token as it arrives."""
        await self._send_text(turn, token)


if __name__ == "__main__":
    exit(asyncio.run(one_flush_per_turn.speak_one_reply(Speaker, "one_token_at_a_time.wav")))
