# WebSocket Usage Guides

Focused guides for the TTS bidirectional WebSocket, `wss://api.inworld.ai/tts/v1/voice:streamBidirectional`. For a first working client, start with [`../example_websocket.py`](../example_websocket.py) or [`../example_tts_low_latency_ws.py`](../example_tts_low_latency_ws.py). For the full reference, see [Synthesize Speech (WebSocket)](https://docs.inworld.ai/tts/synthesize-speech-websocket).

Read them in order; each builds on the one before and changes only how an agent's reply is sent.

| Guide | What it covers |
|---|---|
| 1. [`barge_in/`](./barge_in/) | The base: one context per agent turn, the whole reply sent at once, barge-in, and keeping the LLM history to what the user heard |
| 2. [`auto_mode/`](./auto_mode/) | Start speaking while the LLM writes: a small client-side English sentence splitter, with auto mode deciding when to synthesize |
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

With the virtual environment active, run each guide's scripts from its own folder. They read the key from `tts/python/.env`, or from `export INWORLD_API_KEY=...`, which takes precedence.

## Playground

A local web page for every guide: type to the agent, hear its reply, and interrupt it. The server in [`playground/`](./playground/) holds the key and talks to the TTS WebSocket; the page only talks to the server and plays the audio.

```bash
cd playground
python server.py   # then open http://localhost:8766
python server.py --port 8766 --model-id inworld-tts-2 --llm-model openai/gpt-4.1-mini   # the options, with their defaults
```

- **Guide**: which client speaks the replies: [Whole turn](./barge_in/), [Client sentences](./auto_mode/), or [Sentence boundary](./sentence_boundary/).
- **Reply**: a live LLM or a scripted reply.
  - *Live LLM* streams from the Inworld Router's chat completions API with the same API key; `--llm-model` picks the model. Edit the system prompt in the sidebar. The default asks the LLM to use [steering instructions](https://docs.inworld.ai/tts/capabilities/steering) such as `[say warmly]`, sounds such as `[laugh]`, pauses (`<break time="500ms"/>`), and `<verbatim>` for codes.
  - *Scripted* replies stream the same tokens every run, with an LLM's timing: a first token after about a third of a second, then 60 tokens a second. One uses steering, a pause and verbatim; one pauses mid-sentence, the way an LLM does for a tool call.
- **Voice**: any voice ID.
- **Interrupt**: press Esc, click Interrupt, or send another message. The page stops playback at once and reports how many seconds of the turn it played. The server closes the turn's context and keeps only the words you heard in the LLM history. The reply shows what was heard, with the rest struck through.
- **New chat** clears the LLM history.

Each reply shows when the first LLM token and the first audio arrived, how many syntheses the service ran, and a timeline of the LLM writing, TTS audio arriving and playback, with any interrupt marked. *Events* lists the same moments.

To add a guide, subclass `Speaker` from [`barge_in/whole_turn.py`](./barge_in/whole_turn.py) as the other guides do: set `CREATE` for the context settings, override `send_text(turn, token)` and, if needed, `end_turn(turn)`, and add the module to `GUIDES` in `playground/server.py`.

## The protocol in brief

- Connect with the header `Authorization: Basic <your API key>`.
- One connection carries one or more contexts. Every message names its `contextId`.
- `create` opens a context: its voice, model, audio format, and whether auto mode decides when to synthesize.
- `sendText` adds text to the context. To synthesize what it has buffered, add `"flushContext": {}` to a `sendText` or send a separate `flushContext`.
- `closeContext` synthesizes anything still buffered, then closes the context.

The service answers with `contextCreated`, then `audioChunk` messages (base64 audio; each PCM chunk starts with a WAV header), a `flushCompleted` after each synthesis, and `contextClosed` last. Every response names its `contextId`. An error arrives as a `status` with a nonzero `code`.

Syntheses on one context run in order and share its conversation history, so the voice's delivery carries from one to the next. Separate contexts are independent.

```json
{"contextId": "turn-1", "create": {"voiceId": "Dennis", "modelId": "inworld-tts-2",
  "audioConfig": {"audioEncoding": "PCM", "sampleRateHertz": 24000}}}
{"contextId": "turn-1", "sendText": {"text": "Hello there. How can I help?", "flushContext": {}}}
{"contextId": "turn-1", "closeContext": {}}
```
