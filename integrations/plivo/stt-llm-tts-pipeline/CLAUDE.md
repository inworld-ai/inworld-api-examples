# Plivo + Inworld STT-LLM-TTS (Cascaded) Pipeline — Voice Agent

Inbound phone voice agent. Three separate Inworld services chained: **STT** (WebSocket) →
**Router/LLM** (streaming HTTP) → **TTS** (WebSocket) → Plivo. Each stage is independently
swappable and observable (vs. the single-socket `s2s-pipeline/`). Audio is μ-law 8 kHz on both
the STT and TTS sockets, so it matches Plivo's wire format with no conversion. Layout:
`inbound/{agent.ts, server.ts, inworld.ts, config.ts, system_prompt.md}` + a shared `utils.ts`.

## Commands

```bash
npm install
npm run dev        # tsx watch inbound/server.ts (SERVER_PORT, default 3000)
npm run build      # tsc -> dist/
npm start          # node dist/inbound/server.js
```

Local testing needs a public tunnel: `ngrok http 3000` → put the HTTPS URL in `PUBLIC_URL`.

## Responsibilities

- **`inbound/server.ts`** — telephony + Plivo provisioning ONLY (`configurePlivoWebhooks`, `/answer`, `/ws`, `/hangup`, `/fallback`). Mirrors the s2s-pipeline server (same structure; hands off to the cascaded agent).
- **`inbound/agent.ts`** — the turn/state machine: STT transcripts → LLM stream → per-sentence TTS → paced playback, plus barge-in and the `end_call` tool.
- **`inbound/inworld.ts`** — the Inworld clients: `InworldSTT` (WebSocket), `streamLLM` (Router SSE), `InworldTTS` (WebSocket).
- **`inbound/config.ts`** — single source of config; validates required env at startup (fail fast).
- **`inbound/system_prompt.md`** — system instructions (override via `SYSTEM_PROMPT`).
- **`utils.ts`** — phone normalization + G.711 μ-law→PCM decode for caller audio (STT wants linear PCM). TTS needs no conversion; it returns μ-law 8 kHz directly.

## Pipeline flow (agent.ts)

1. Plivo `media` (μ-law 8k) → `ulawToPcm` → LINEAR16 PCM → STT `audioChunk`.
2. STT emits `result.transcription.{transcript,isFinal}`; on a final transcript an 800ms silence
   timer debounces end-of-utterance.
3. On fire → `handleTurn`: `tts.beginTurn()`, stream the Router/LLM, split on sentence boundaries,
   and `tts.speak()` each sentence as it completes, then `tts.endTurn()`.
4. TTS streams back μ-law 8 kHz audio chunks that the tx pump paces out to Plivo as 160-byte
   `playAudio` frames. No resample or encode step — Inworld returns Plivo's wire format directly.
5. Any caller speech while `isSpeaking()` → `bargeIn()`: `tts.interrupt()` (abandon the turn's
   TTS context), abort the LLM stream, and `clearAudio`.
6. `history` (system/user/assistant) is maintained across turns.
7. Tools: the Router may return `tool_calls`. `end_call` arms a hangup that fires once the
   farewell audio drains (`armHangup` → tx-pump → `doHangup`).

## API contracts (verified against the repo's own examples + the live API)

- **STT** — `wss://api.inworld.ai/stt/v1/transcribe:streamBidirectional`, `Basic` auth.
  Config `{transcribeConfig:{modelId, audioEncoding:"LINEAR16", sampleRateHertz:8000, numberOfChannels:1, language}}`;
  frames `{audioChunk:{content:<base64 pcm16>}}`; responses `result.transcription.{transcript,isFinal}`.
- **Router/LLM** — `POST https://api.inworld.ai/v1/chat/completions`, SSE, `choices[0].delta.content`
  and `choices[0].delta.tool_calls` (streamed fragments accumulated by index). Tools are defined in the
  `TOOLS` array in `agent.ts` and passed straight through.
- **TTS** — `wss://api.inworld.ai/tts/v1/voice:streamBidirectional`, `Basic` auth. Per turn:
  `{context_id, create:{voice_id, model_id, audio_config:{audio_encoding:"MULAW", sample_rate_hertz:8000}, autoMode:true}}`,
  then `{context_id, send_text:{text}}` per sentence, then `{context_id, close_context:{}}`. `autoMode` lets
  the server control flushing for smoother continuity across sentences, so no per-`send_text` `flush_context`.
  Responses carry `result.contextId` and `result.audioChunk.audioContent` (base64 raw μ-law 8 kHz — no
  header), ending with `result.contextClosed`. Requesting `MULAW`/`8000` means Inworld returns Plivo's
  wire format directly, so there is no conversion in our code.

## Rules

- NEVER commit `.env` / API keys. Key needs **STT + Router + TTS** scopes.
- `playAudio` MUST include `contentType:"audio/x-mulaw"` + `sampleRate:8000`; send 160-byte (20ms) chunks.
- Speak TTS **per sentence** as the LLM streams — don't wait for the full response.
- Barge-in (gated on `isSpeaking()`, which covers the streaming gaps via `ttsBusy`): `tts.interrupt()` +
  `activeAbort.abort()` + `clearAudio`.
- Keep telephony/provisioning in `server.ts`, pipeline in `agent.ts`.

## Env vars

Required: `INWORLD_API_KEY` (STT+Router+TTS), `PUBLIC_URL`, `PLIVO_AUTH_ID`, `PLIVO_AUTH_TOKEN`, `PLIVO_PHONE_NUMBER`.
Optional (override pipeline defaults): `SERVER_PORT`, `VOICE`, `SYSTEM_PROMPT`.

## Verifying a change (needs STT+Router+TTS-scoped key)

1. Fill `.env`; `ngrok http 3000`; `npm run dev` (auto-provisions Plivo).
2. Call the number; confirm greeting, transcription logs (`[turn] user: ...`), a spoken reply, and barge-in.
3. If STT errors: check the `[stt]` logs (`HTTP <status>` / `error frame`). If TTS errors: check the
   `[tts]` logs (`socket error` / `error frame` / `HTTP <status>`) — likely a scope or model mismatch.
