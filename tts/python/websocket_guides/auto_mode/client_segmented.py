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

The splitter below is deliberately small. It knows the sentence-ending
punctuation of widely used scripts, and English abbreviations only. To leave
the splitting to the service, see ../sentence_boundary/sentence_boundary.py.

    python client_segmented.py
"""

import asyncio
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "barge_in"))

import whole_turn  # noqa: E402

# A sentence ends at ".", "!" or "?" followed by whitespace, as in most
# languages written in Latin or Cyrillic script. Chinese and Japanese "。！？",
# Arabic "؟" and Devanagari "।" "॥" need no space after them. Closing quotes,
# brackets and tags such as </lang> go with the sentence they close.
CLOSERS = r"(?:[\"')」』）]|</\w+>)*"
SENTENCE_END = re.compile(rf"[.!?]+{CLOSERS}\s+|[。！？؟।॥]+{CLOSERS}\s*")
# English words whose period doesn't end a sentence.
ABBREVIATIONS = {"mr", "mrs", "ms", "dr", "st", "jr", "sr", "vs", "etc", "e.g", "i.e"}
# Markup a sentence must not be cut inside: [instructions], <verbatim>...</verbatim>
# and <say-as>...</say-as> as a whole, and any other <tag>.
MARKUP = re.compile(r"\[[^\]]*\]|<verbatim>.*?</verbatim>|<say-as\b.*?</say-as>|<[^>]*>", re.IGNORECASE | re.DOTALL)


def split_sentences(text: str) -> tuple[list[str], str]:
    """Split complete sentences off the front of text; return them and the
    unfinished rest. A sentence ends at SENTENCE_END, unless the period follows
    an abbreviation or an initial, is an ellipsis, or sits inside markup."""
    markup = [m.span() for m in MARKUP.finditer(text)]
    # An unclosed tag, or a <verbatim> or <say-as> still waiting for its
    # closing tag, holds back everything from its start.
    covered = markup[-1][1] if markup else 0
    starts = [text.find("[", covered), text.find("<", covered)]
    starts += [a for a, b in markup if re.match(r"<(verbatim|say-as)\b", text[a:b], re.IGNORECASE)
               and not re.search(r"</(verbatim|say-as)>$", text[a:b], re.IGNORECASE)]
    unclosed = min((i for i in starts if i >= 0), default=len(text))
    sentences, start = [], 0
    for m in SENTENCE_END.finditer(text, 0, unclosed):
        if any(a <= m.start() < b for a, b in markup):
            continue
        word = text[start:m.start()].split()[-1:] or [""]
        word = word[0].lstrip("\"'([").lower()
        if m.group().startswith("..") or m.group().startswith(".") and (
                word in ABBREVIATIONS or (len(word) == 1 and word.isalpha())):
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
