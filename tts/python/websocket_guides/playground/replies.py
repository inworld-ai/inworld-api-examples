"""
Where the playground's agent replies come from.

Scripted replies are replayed as a token stream with an LLM's timing, so every
run sends the same tokens: compare ways of speaking them, and hit the cases
that matter on demand. A live reply streams from a real LLM through the Inworld
Router, which takes the same API key.
"""

import asyncio
import json
import re
import threading

import requests

ROUTER_URL = "https://api.inworld.ai/v1/chat/completions"
DEFAULT_LLM_MODEL = "openai/gpt-4.1-mini"
DEFAULT_SYSTEM_PROMPT = """You are a friendly voice assistant. Everything you write is spoken aloud by a text-to-speech voice, so reply in plain conversational sentences, with no markdown, lists or emoji. Keep replies to a few sentences unless the user asks for more.

Direct the voice with markup where it helps the listener, not in every sentence:
- A delivery instruction in square brackets, written in English, before the words it applies to: [say warmly], [whisper], [say excitedly]. It lasts until the next instruction or [reset].
- A sound: [laugh], [sigh], [breathe].
- A pause: <break time="500ms"/>, up to 10 seconds, and only a few per reply.
- Anything to be read out character by character, such as a code or reference number: <verbatim>AB12C</verbatim>.

Close every tag, and never write [ or < for anything else."""
LIVE_PROMPT_SUGGESTION = "Give me a booking reference, then tell me a very short spooky story."

FIRST_TOKEN_DELAY_S = 0.35
TOKENS_PER_SECOND = 60

# Each script: what the user might say, and the reply. {pause 2.5} stops the
# token stream for that many seconds, the way an LLM does for a tool call.
SCRIPTS = {
    "flight": {
        "label": "Short answer",
        "prompt": "When does my flight leave?",
        "reply": "Your flight to Chicago leaves at 7:45 from gate B12. Boarding starts 30 minutes earlier, "
                 "so try to be at the gate by 7:15. Would you like me to book a taxi to the airport?",
    },
    "recipe": {
        "label": "Long answer (try interrupting)",
        "prompt": "How do I make a simple tomato soup?",
        "reply": "Sure, here's an easy one. Start by warming two tablespoons of olive oil in a large pot over "
                 "medium heat. Add one chopped onion and cook it for about eight minutes, until it's soft and "
                 "golden. Stir in three cloves of garlic and cook for another minute. Then add two cans of "
                 "whole tomatoes with their juice, two cups of vegetable stock, and a pinch of salt. Let it "
                 "simmer for twenty minutes, stirring now and then. When it's done, blend it until smooth, "
                 "taste it, and add a little cream or a drizzle of olive oil. Serve it hot with some toasted "
                 "bread on the side.",
    },
    "markup": {
        "label": "Steering, pauses and verbatim",
        "prompt": "What's my booking reference?",
        "reply": "[say warmly] Welcome back! <break time=\"500ms\"/> Your booking reference is "
                 "<verbatim>KX7Q2</verbatim>. [whisper] And a little secret: the lounge has free cookies. "
                 "[reset] Is there anything else I can help with?",
    },
    "lookup": {
        "label": "LLM pauses mid-sentence",
        "prompt": "Is there a table for two tonight?",
        "reply": "Let me check that for you. It looks like the earliest table for two is {pause 2.5} at 8:30, "
                 "by the window. Shall I book it?",
    },
}

PAUSE_RE = re.compile(r"\{pause ([\d.]+)\}")
TOKEN_RE = re.compile(r"\s*\S{1,4}")  # pieces the size of LLM tokens


async def scripted(name: str):
    """Yield a script's reply as LLM tokens, with an LLM's timing."""
    await asyncio.sleep(FIRST_TOKEN_DELAY_S)
    for i, part in enumerate(PAUSE_RE.split(SCRIPTS[name]["reply"])):
        if i % 2:
            await asyncio.sleep(float(part))
            continue
        for token in TOKEN_RE.findall(part):
            yield token
            await asyncio.sleep(1 / TOKENS_PER_SECOND)


async def live(messages: list[dict], api_key: str, model: str = DEFAULT_LLM_MODEL):
    """Yield a real LLM's reply tokens from the Inworld Router, an
    OpenAI-compatible chat completions API. Stops the request when the
    caller stops reading."""
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()
    stop = threading.Event()

    def stream():
        try:
            with requests.post(ROUTER_URL, headers={"Authorization": f"Basic {api_key}"},
                               json={"model": model, "messages": messages, "stream": True},
                               stream=True, timeout=60) as response:
                response.raise_for_status()
                response.encoding = "utf-8"
                for line in response.iter_lines(decode_unicode=True):
                    if stop.is_set():
                        break
                    if not line.startswith("data:") or line[5:].strip() == "[DONE]":
                        continue
                    for choice in json.loads(line[5:]).get("choices", []):
                        if token := (choice.get("delta") or {}).get("content"):
                            loop.call_soon_threadsafe(queue.put_nowait, token)
        except Exception as e:
            loop.call_soon_threadsafe(queue.put_nowait, e)
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, None)

    threading.Thread(target=stream, daemon=True).start()
    try:
        while (item := await queue.get()) is not None:
            if isinstance(item, Exception):
                raise item
            yield item
    finally:
        stop.set()
