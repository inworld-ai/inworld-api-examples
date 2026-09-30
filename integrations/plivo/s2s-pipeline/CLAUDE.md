# Plivo + Inworld S2S Pipeline (Realtime API) — Voice Agent

Inbound phone voice agent. One WebSocket to the **Inworld Realtime API** handles STT + LLM +
TTS (speech-to-speech). Audio is G.711 μ-law @ 8kHz on both the Plivo and Inworld legs, so it
passes through with no transcoding. Layout: `inbound/{agent.ts, server.ts, inworld.ts, config.ts, system_prompt.md}`
+ a shared `utils.ts`.

## Commands

```bash
npm install
npm run dev        # tsx watch inbound/server.ts (SERVER_PORT, default 3000)
npm run build      # tsc -> dist/
npm start          # node dist/inbound/server.js
```

Local testing needs a public tunnel: `ngrok http 3000` → put the HTTPS URL in `PUBLIC_URL`.

## Responsibilities (do not mix these)

- **`inbound/server.ts`** — telephony + Plivo setup ONLY: startup provisioning
  (`configurePlivoWebhooks`: find/create the Plivo Application, map the number), and the
  `/answer`, `/ws`, `/hangup`, `/fallback`, `/` routes.
- **`inbound/agent.ts`** — call state machine: bridges Plivo audio to the Inworld client, paces
  audio back, and handles barge-in + the `end_call` hangup.
- **`inbound/inworld.ts`** — the Inworld Realtime client (an `EventEmitter`): owns the WebSocket and
  session config; emits `audio`/`speechStarted`/`toolCall`/… events that `agent.ts` listens to.
- **`inbound/config.ts`** — single source of config; validates required env at startup (fail fast).
- **`inbound/system_prompt.md`** — system instructions (loaded by `agent.ts`; override via `SYSTEM_PROMPT`).
- **`utils.ts`** — shared helpers (phone normalization; audio conversion lives here in pipelines that need it — S2S doesn't).

## Rules

- NEVER commit `.env` / API keys. The Inworld key needs the **Realtime API** scope.
- NEVER change the sample rate from 8kHz μ-law (`g711_ulaw`). No transcoding on this pipeline.
- `playAudio` MUST be `{ media: { contentType: "audio/x-mulaw", sampleRate: 8000, payload } }` —
  omitting contentType/sampleRate causes intermittent mid-response audio loss on Plivo.
- Send audio in **160-byte (20ms) chunks** (`PLIVO_CHUNK_SIZE` in `agent.ts`).
- Barge-in is gated on `isSpeaking()`: only clear playback / cancel when the agent is actually
  talking. Do not interrupt on every `speech_started`.

## State machine (agent.ts)

`idle → connecting → greeting → listening ⇄ speaking` (barge-in returns speaking→listening).
- `responseGenerating=true` on first `response.output_audio.delta`, `false` on `response.done`;
  `isSpeaking()` stays true until the queued audio (`outBuffer`) finishes draining to Plivo.
- Three logical streams: plivo_rx (`onPlivoMessage`), inworld_rx (the `InworldRealtime` events), plivo_tx (the paced `sendChunk` pump).

## Message contracts

**Plivo WS** (`/ws`): receive `start`/`media`/`stop`; send `playAudio`, `clearAudio`.
**Inworld Realtime** (`wss://api.inworld.ai/api/v1/realtime/session`, `Basic` auth): send
`session.update`, `input_audio_buffer.append`, `response.create`, `response.cancel`,
`conversation.item.create` (incl. `function_call_output` for tool results); receive `session.created/updated`,
`response.output_audio.delta/done`, `response.done`, `response.function_call_arguments.done` (tool call →
drives `end_call`), `input_audio_buffer.speech_started`, `...input_audio_transcription.completed`, `error`.

## Tools

Tools are defined in the `TOOLS` array in `agent.ts` and passed into `session.update`. `end_call` is the
sample tool. On `response.function_call_arguments.done` the agent returns a
`function_call_output`, lets the model speak a goodbye, then hangs up via the server-provided callback once the
farewell drains (with an absolute backstop).

## Env vars

Required: `INWORLD_API_KEY`, `PUBLIC_URL`, `PLIVO_AUTH_ID`, `PLIVO_AUTH_TOKEN`,
`PLIVO_PHONE_NUMBER` (for auto-provisioning).
Optional (override pipeline defaults): `SERVER_PORT` (3000), `VOICE`, `SYSTEM_PROMPT`.

## Verifying a change

1. Fill `.env` (incl. `PLIVO_PHONE_NUMBER` + `PUBLIC_URL`); `ngrok http 3000`.
2. `npm run dev` — expect provisioning logs (`Mapped +<number> → ...`) then `Listening on port 3000`.
3. Call the number; confirm greeting, a turn, and that talking over the agent cuts its audio.

## Barge-in

Uses Inworld's server-side `speech_started` gated on `isSpeaking()`. A client-side VAD (e.g.
Silero) on the inbound audio can be added for finer interruption control.
