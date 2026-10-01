# WebSocket Usage Guides

Focused guides for the TTS bidirectional WebSocket, `wss://api.inworld.ai/tts/v1/voice:streamBidirectional`. For a first working client, start with [`../example_websocket.py`](../example_websocket.py) or [`../example_tts_low_latency_ws.py`](../example_tts_low_latency_ws.py). The docs describe the same options in [Synthesize Speech (WebSocket)](https://docs.inworld.ai/tts/synthesize-speech-websocket#choose-how-text-is-buffered), and every message in the [API reference](https://docs.inworld.ai/api-reference/ttsAPI/texttospeech/synthesize-speech-websocket).

Read them in order; each builds on the one before and changes only how an agent's reply is sent.

| Guide | What it covers |
|---|---|
| 1. [`barge_in/`](./barge_in/) | The base: one context per agent turn, the whole reply sent at once, barge-in, and keeping the LLM history to what the user heard |
| 2. [`auto_mode/`](./auto_mode/) | Start speaking while the LLM writes: a small client-side sentence splitter, with auto mode deciding when to synthesize |
| 3. [`sentence_boundary/`](./sentence_boundary/) | Send the LLM's tokens as they arrive and let the service find the sentences (Preview) |
| [Playground](#playground) | A local web page to try every guide: type to the agent, hear it, interrupt it |

## Setup

Requires Python 3.10+. From `tts/python/`:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # then set INWORLD_API_KEY
```

With the virtual environment active, run each guide's scripts from its own folder. They read the key from `tts/python/.env`, or from `export INWORLD_API_KEY=...`, which takes precedence. Set `INWORLD_API_BASE_URL` the same way if you don't use `https://api.inworld.ai`.

## Playground

A local web page for every guide: type to the agent, hear its reply, and interrupt it. The server in [`playground/`](./playground/) holds the key and talks to the TTS WebSocket; the page only talks to the server and plays the audio.

```bash
cd playground
python server.py   # then open http://localhost:8766
python server.py --port 8766 --model-id inworld-tts-2 --llm-model openai/gpt-4.1-mini   # the options, with their defaults
```

- **Voice**: any voice ID.
- **Mode**: how the reply is sent, one per guide: [One flush per turn](./barge_in/), [Client-side sentence segmentation](./auto_mode/), or [One token at a time](./sentence_boundary/).
- **Reply**: a scripted reply or a live LLM.
  - *Scripted* replies stream the same tokens every run, with an LLM's timing: a first token after about a third of a second, then 60 tokens a second. They cover a short answer, a long one to interrupt, [markup](#markup-in-replies), and two language tutors: Spanish for English speakers, and Japanese for Chinese speakers.
  - *Live LLM* streams from the Inworld Router's chat completions API with the same API key; `--llm-model` picks the model. Pick an agent, *Voice assistant*, *Spanish tutor* or *Japanese tutor (for Chinese speakers)*, and edit its system prompt in the sidebar. The prompts ask the LLM for [markup](#markup-in-replies).
- **Interrupt**: press Esc, click Interrupt, or send another message. The page stops playback at once and reports how many seconds of the turn it played. The server closes the turn's context and keeps only the words you heard in the LLM history. The reply shows what was heard, with the rest struck through.
- **Replay** plays a reply again, or only what you heard of an interrupted one.
- **Raw** shows a reply exactly as it was sent to TTS, markup included, and **Copy** copies that text, to paste into a request of your own.
- **New chat** clears the LLM history.

The server opens the TTS connection for the chosen mode and voice when the page loads and whenever you change either, so no reply's times include the handshake. Each reply shows when the first LLM token and the first audio arrived, how many syntheses the service ran, and a timeline of the LLM writing, TTS audio arriving and playback, with any interrupt marked. *Events* lists the same moments.

To add a guide, subclass `Speaker` from [`barge_in/whole_turn.py`](./barge_in/whole_turn.py) as the other guides do: set `CREATE` for the context settings, override `send_text(turn, token)` and, if needed, `end_turn(turn)`, and add the module to `GUIDES` in `playground/server.py`.

## Markup in replies

An LLM can direct the voice with markup in its reply, and every mode passes it through:

- [Steering instructions](https://docs.inworld.ai/tts/capabilities/steering) in English, before the words they apply to: `[say slowly and clearly]`, `[whisper]`. An instruction lasts to the end of the reply, or until another replaces it, so the playground's replies place one where the rest of the reply should sound that way. Sounds such as `[laugh]`.
- `<verbatim>KX7Q2</verbatim>` to read a code character by character.
- Language tags: `<lang lang="es-MX">El perro corre.</lang>` speaks the span in Spanish, on the voice's localized prompt for Spanish when it has one. This is what a language tutor needs; pick a voice with a localized prompt for each language. In a turn that mixes languages, tag every part, the learner's language too, so none of it is left to language detection: `<lang lang="en-US">"The dog runs" is</lang> <lang lang="es-MX">El perro corre.</lang>`.

A span can open in one `sendText` and close in a later one: on a context, it lasts until its closing tag. What each mode needs:

- **One flush per turn**: nothing; the reply goes out whole.
- **Client-side sentence segmentation**: cut at sentence ends as usual, never inside a tag. The splitter in [`auto_mode/`](./auto_mode/) holds back an unfinished tag.
- **One token at a time**: nothing; the service holds a tag split across tokens until it closes.

When the user interrupts, the LLM history keeps the markup the user heard along with the words.

## The protocol in brief

- Connect with the header `Authorization: Basic <your API key>`.
- One connection carries one or more contexts. Every message names its `contextId`.
- `create` opens a context: its voice, model, audio format, and whether auto mode decides when to synthesize.
- `sendText` adds text to the context. To synthesize what it has buffered, add `"flushContext": {}` to a `sendText` or send a separate `flushContext`.
- `closeContext` synthesizes anything still buffered, then closes the context.

The service answers with `contextCreated`, then `audioChunk` messages (base64 audio; each PCM chunk starts with a WAV header), a `flushCompleted` after each synthesis, and `contextClosed` last. Every response names its `contextId`. An error arrives as a `status` with a nonzero `code`.

Syntheses on one context run in order and share its conversation history, so the voice's delivery carries from one to the next. Separate contexts are independent.

```json
{"contextId": "turn-1", "create": {"voiceId": "Sarah", "modelId": "inworld-tts-2",
  "audioConfig": {"audioEncoding": "PCM", "sampleRateHertz": 24000}}}
{"contextId": "turn-1", "sendText": {"text": "Hello there. How can I help?", "flushContext": {}}}
{"contextId": "turn-1", "closeContext": {}}
```
