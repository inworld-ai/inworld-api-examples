"""
Where the playground's agent replies come from.

Scripted replies are replayed as a token stream with an LLM's timing, so every
run sends the same tokens: compare ways of speaking them, and hit the cases
that matter on demand. A live reply streams from a real LLM through the Inworld
Router, which takes the same API key.
"""

import asyncio
import json
import os
import re
import threading

import requests

ROUTER_URL = os.getenv("INWORLD_API_BASE_URL", "https://api.inworld.ai").rstrip("/") + "/v1/chat/completions"
DEFAULT_LLM_MODEL = "openai/gpt-4.1-mini"
ASSISTANT_PROMPT = """You are a friendly voice assistant. Everything you write is spoken aloud by a text-to-speech voice, so reply in plain conversational sentences, with no markdown, lists or emoji. Keep replies to a few sentences unless the user asks for more.

Direct the voice with markup where it helps the listener, not in every sentence:
- A delivery instruction in square brackets, written in English, before the words it applies to: [say warmly], [whisper], [say excitedly]. It lasts until the next instruction or [reset].
- A sound: [laugh], [sigh], [breathe].
- A pause: <break time="500ms"/>, up to 10 seconds, and only a few per reply.
- Anything to be read out character by character, such as a code or reference number: <verbatim>AB12C</verbatim>.

Close every tag, and never write [ or < for anything else."""
TUTOR_PROMPT = """You are a friendly Spanish tutor for an English speaker. Everything you write is spoken aloud by a text-to-speech voice, so reply in plain conversational sentences, with no markdown, lists or emoji. Teach one thing at a time, keep each reply short, and end by asking the learner to try.

Mark every Spanish word or phrase, however short, with a language tag: <lang xml:lang="es-ES">El perro corre.</lang> Everything outside a tag is spoken in English.

Direct the voice with markup where it helps a learner:
- [say slowly and clearly] before a phrase the learner should repeat, then [reset] after it. Write instructions in English, before the words they apply to.
- <break time="800ms"/> after a phrase, to leave the learner time to repeat it.
- [say warmly] or [say encouragingly] when you praise or correct.

Close every tag, and never write [ or < for anything else."""
SYSTEM_PROMPTS = {
    "assistant": {"label": "Voice assistant", "prompt": ASSISTANT_PROMPT,
                  "suggestion": "Give me a booking reference, then tell me a very short spooky story."},
    "tutor": {"label": "Spanish tutor", "prompt": TUTOR_PROMPT,
              "suggestion": "How do I order a coffee in Spanish?"},
}
DEFAULT_SYSTEM_PROMPT = ASSISTANT_PROMPT

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
    "tutor_es": {
        "label": "Spanish tutor: rolled r",
        "prompt": "How do I say \"the dog runs\" in Spanish?",
        "reply": "[say warmly] Great question! \"The dog runs\" is "
                 "<lang xml:lang=\"es-ES\">[say slowly and clearly] El perro corre.</lang> "
                 "<break time=\"800ms\"/> [reset] Listen to the rolled r in <lang xml:lang=\"es-ES\">perro</lang>, "
                 "and compare it with the single tap in <lang xml:lang=\"es-ES\">pero</lang>, which means \"but\". "
                 "<break time=\"500ms\"/> [say encouragingly] Now you try: <lang xml:lang=\"es-ES\">El perro corre.</lang>",
    },
    "tutor_ja": {
        "label": "Japanese tutor: thank you",
        "prompt": "How do I say thank you in Japanese?",
        "reply": "[say cheerfully] In Japanese, \"thank you\" is <lang xml:lang=\"ja-JP\">ありがとうございます。</lang> "
                 "<break time=\"600ms\"/> [say slowly and clearly] Once more: "
                 "<lang xml:lang=\"ja-JP\">ありがとう、ございます。</lang> [reset] With friends, the short "
                 "<lang xml:lang=\"ja-JP\">ありがとう</lang> is fine. <break time=\"800ms\"/> Your turn!",
    },
    "tutor_fr": {
        "label": "French tutor: ordering a coffee",
        "prompt": "Help me order a coffee in French.",
        "reply": "Sure! Walk up to the counter and say "
                 "<lang xml:lang=\"fr-FR\">[say slowly and clearly] Bonjour. Je voudrais un café, s'il vous plaît.</lang> "
                 "<break time=\"800ms\"/> [reset] [whisper] A little tip: the barista will like it if you add "
                 "<lang xml:lang=\"fr-FR\">merci beaucoup</lang> at the end. [reset] Want to try it?",
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
