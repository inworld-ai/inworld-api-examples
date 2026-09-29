#!/usr/bin/env python3
"""
Speak an agent's replies sentence by sentence with auto mode.

Everything else, including barge-in and the LLM history, is the base guide's
(../barge_in/whole_turn.py). Two things change:

- The context is created with `autoMode: true`. Its default strategy,
  CLIENT_SEGMENTED, expects complete sentences or phrases and decides when to
  synthesize them.
- The client cuts the LLM's tokens into sentences as they arrive and sends each
  one as soon as it is complete, so the first sentence is spoken while the LLM
  is still writing the rest.

The splitter below is deliberately small and handles English only. For other
languages, or to skip client-side splitting, see
../sentence_boundary/sentence_boundary.py.

    python client_segmented.py
"""

import asyncio
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "barge_in"))

import whole_turn  # noqa: E402

# ".", "!" or "?", then any closing quotes or brackets, then whitespace.
SENTENCE_END = re.compile(r"[.!?]+[\"')\]]*\s+")
# Words whose period doesn't end a sentence.
ABBREVIATIONS = {"mr", "mrs", "ms", "dr", "st", "jr", "sr", "vs", "etc", "e.g", "i.e"}


def split_sentences(text: str) -> tuple[list[str], str]:
    """Split complete English sentences off the front of text; return them and
    the unfinished rest. A sentence ends at ".", "!" or "?" followed by
    whitespace, unless the period follows an abbreviation or an initial."""
    sentences, start = [], 0
    for m in SENTENCE_END.finditer(text):
        word = text[start:m.start()].split()[-1:] or [""]
        word = word[0].lstrip("\"'([").lower()
        if m.group().startswith(".") and (word in ABBREVIATIONS or (len(word) == 1 and word.isalpha())):
            continue
        sentences.append(text[start:m.end()])
        start = m.end()
    return sentences, text[start:]


class Speaker(whole_turn.Speaker):
    CREATE = {"autoMode": True}  # CLIENT_SEGMENTED, the default strategy

    async def send_text(self, turn: whole_turn.Turn, token: str):
        """Send each sentence as soon as it is complete. The rest of the
        reply goes out when the turn ends."""
        sentences, turn.pending = split_sentences(turn.pending + token)
        for sentence in sentences:
            await self._send_text(turn, sentence)


if __name__ == "__main__":
    exit(asyncio.run(whole_turn.speak_one_reply(Speaker, "client_segmented.wav")))
