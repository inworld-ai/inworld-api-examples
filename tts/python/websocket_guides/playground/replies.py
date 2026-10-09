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
- A delivery instruction in square brackets, written in English, before the words it applies to: [say warmly], [whisper], [say excitedly]. It lasts to the end of the reply, or until another instruction replaces it, so use one where the rest of the reply should sound that way.
- A sound: [laugh], [sigh], [breathe].
- Anything to be read out character by character, such as a code or reference number: <verbatim>AB12C</verbatim>.
- Language tags, when a reply mixes languages, around every part, English included, however short the other language's part: a greeting, a dish or a quote. Each part is spoken in its tag's language: <lang lang="en-US">Before a meal in France, people say</lang> <lang lang="fr-FR">Bon appétit !</lang> Keep the switches few rather than alternating languages word by word, never tag punctuation on its own, and never put two tags of the same language next to each other: keep that text in one tag."""
TUTOR_PROMPT = """You are a friendly Spanish tutor for an English speaker. Everything you write is spoken aloud by a text-to-speech voice, so reply in plain conversational sentences, with no markdown, lists or emoji. Teach one thing at a time, keep each reply short, and end it with a phrase for the learner to repeat.

Explain in English, and wrap everything you write in a language tag, leaving nothing outside one. Every Spanish word or phrase gets its own Spanish tag, even in the middle of an English sentence or a quote: <lang lang="en-US">You can say<break time="200ms" /></lang> <lang lang="es-MX">Quisiera un café,<break time="200ms" /></lang> <lang lang="en-US">which means "I would like a coffee."</lang> For tutoring, add <break time="200ms" /> at the end of a language span before switching to a foreign word or back to its explanation. Close every language span within its sentence. Keep the switches few: teach one word or phrase per sentence rather than alternating languages word by word, never tag punctuation on its own, and never put two tags of the same language next to each other: keep that text in one tag."""
TUTOR_JA_PROMPT = """You are a friendly Japanese tutor for a Chinese speaker. Everything you write is spoken aloud by a text-to-speech voice, so reply in plain conversational sentences, with no markdown, lists or emoji. Teach one thing at a time, keep each reply short, and end it with a phrase for the learner to repeat.

Explain in Simplified Chinese, and wrap everything you write in a language tag, leaving nothing outside one. Every Japanese word or phrase gets its own Japanese tag, every time it appears, even in the middle of a Chinese sentence or inside quotation marks: <lang lang="zh-CN">「我想去东京」用日语说是<break time="200ms" /></lang><lang lang="ja-JP">東京に行きたいです。</lang> A Chinese tag holds only Chinese: when you mention the word again in the explanation, either write the Chinese word or close the Chinese tag and put the Japanese word in a Japanese tag. For tutoring, add <break time="200ms" /> at the end of a language span before switching to a foreign word or back to its explanation. Close every language span within its sentence. Keep the switches few: teach one word or phrase per sentence rather than alternating languages word by word, never tag punctuation on its own, and never put two tags of the same language next to each other: keep that text in one tag.

Write Japanese as it is normally written, kanji included. The learner hears the reading, because the tag makes the voice read the kanji in Japanese, so never write a reading out in hiragana, katakana or romaji, in parentheses or otherwise."""
SYSTEM_PROMPTS = {
    "assistant": {"label": "Voice assistant", "prompt": ASSISTANT_PROMPT,
                  "suggestion": "Give me a booking reference, then tell me how to wish someone a good meal in Italian."},
    "tutor": {"label": "Spanish tutor", "prompt": TUTOR_PROMPT,
              "suggestion": "How do I order a coffee in Spanish?"},
    "tutor_ja": {"label": "Japanese tutor (for Chinese speakers)", "prompt": TUTOR_JA_PROMPT,
                 "suggestion": "「我想去东京」用日语怎么说？"},
}
DEFAULT_SYSTEM_PROMPT = ASSISTANT_PROMPT

FIRST_TOKEN_DELAY_S = 0.35
TOKENS_PER_SECOND = 60

# Each script: what the user might say, and the reply.
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
        "label": "Steering and verbatim",
        "prompt": "What's my booking reference?",
        "reply": "Welcome back! Your booking reference is <verbatim>KX7Q2</verbatim>, and you're all set "
                 "for tonight. [whisper] And a little secret: the lounge has free cookies.",
    },

    "tutor_es": {
        "label": "Spanish for English speakers",
        "prompt": 'How do I say "the dog runs" in Spanish?',
        "reply": '<lang lang="en-US">"The dog runs" is<break time="200ms" /></lang> '
                 '<lang lang="es-MX">El perro corre.</lang> '
                 '<lang lang="en-US">Listen to the rolled r in<break time="200ms" /></lang> '
                 '<lang lang="es-MX">perro<break time="200ms" /></lang>'
                 '<lang lang="en-US">, and compare it with the single tap in<break time="200ms" /></lang> '
                 '<lang lang="es-MX">pero<break time="200ms" /></lang>'
                 '<lang lang="en-US">, which means "but".</lang> '
                 '<lang lang="en-US">Now say it with me:<break time="200ms" /></lang> '
                 '<lang lang="es-MX">[say slowly and clearly] El perro corre.</lang>',
    },
    "tutor_ja": {
        "label": "Japanese for Chinese speakers",
        "prompt": "「日本大学」用日语怎么读？",
        "reply": '<lang lang="zh-CN">「日本大学」用日语读作<break time="200ms" /></lang>'
                 '<lang lang="ja-JP">日本大学<break time="200ms" /></lang>'
                 '<lang lang="zh-CN">，同样的汉字，日语的读法和中文不一样。</lang>'
                 '<lang lang="zh-CN">跟我一起说：<break time="200ms" /></lang>'
                 '<lang lang="ja-JP">[say slowly and clearly] 日本大学。</lang>',
    },
}

TOKEN_RE = re.compile(r"\s*\S{1,4}")  # pieces the size of LLM tokens


async def scripted(reply: str):
    """Yield a scripted reply as LLM tokens, with an LLM's timing."""
    await asyncio.sleep(FIRST_TOKEN_DELAY_S)
    for token in TOKEN_RE.findall(reply):
        yield token
        await asyncio.sleep(1 / TOKENS_PER_SECOND)


async def live(messages: list[dict], api_key: str, model: str = DEFAULT_LLM_MODEL):
    """Yield a real LLM's reply tokens from the Inworld Router, an
    OpenAI-compatible chat completions API. Stops the request when the
    caller stops reading."""
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()
    stop = threading.Event()
    open_response = []

    def stream():
        try:
            with requests.post(ROUTER_URL, headers={"Authorization": f"Basic {api_key}"},
                               json={"model": model, "messages": messages, "stream": True},
                               stream=True, timeout=60) as response:
                open_response.append(response)
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
        for response in open_response:
            response.close()  # ends the request now, even while the LLM is silent
