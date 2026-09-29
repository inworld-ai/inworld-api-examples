# WebSocket Usage Guides

Focused guides for the TTS bidirectional WebSocket, `wss://api.inworld.ai/tts/v1/voice:streamBidirectional`. For a first working client, start with [`../example_websocket.py`](../example_websocket.py) or [`../example_tts_low_latency_ws.py`](../example_tts_low_latency_ws.py). For the full reference, see [Synthesize Speech (WebSocket)](https://docs.inworld.ai/tts/synthesize-speech-websocket).

| Guide | What it covers |
|---|---|
| [`auto_mode/`](./auto_mode/) | The recommended way to speak an agent's replies: stream the LLM's tokens with sentence-boundary auto mode, one context per turn, barge-in, and keeping the LLM history to what the user heard |
| [`playground/`](./playground/) | A local web page to try the guides: type to the agent, hear it, interrupt it |

## Setup

From `tts/python/`:

```bash
pip install -r requirements.txt
cp .env.example .env   # then set INWORLD_API_KEY
```

Run each guide's scripts from its own folder; they read the key from `tts/python/.env` or from `export INWORLD_API_KEY=...`.

## The protocol in brief

- Connect with the header `Authorization: Basic <your API key>`.
- One connection carries one or more contexts. Every message names its `contextId`.
- `create` opens a context: its voice, model, audio format, and how it takes text (see [`auto_mode/`](./auto_mode/)).
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
