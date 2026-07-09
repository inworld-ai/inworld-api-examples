# Agent Rules — Plivo + Inworld STT-LLM-TTS Pipeline (inbound)

Cascaded STT → Router/LLM → TTS inbound voice agent. See this folder's `CLAUDE.md` for the
pipeline flow, API contracts, and file map.

## MUST

- Keep `server.ts` (telephony + Plivo provisioning) and `agent.ts` (pipeline + state machine) separate.
- Decode caller audio for STT: Plivo μ-law → `ulawToPcm` (LINEAR16). TTS needs no conversion — request
  `audio_encoding:"MULAW"`/`sample_rate_hertz:8000` and Inworld returns Plivo's wire format directly.
- Send `playAudio` as `{ media: { contentType:"audio/x-mulaw", sampleRate:8000, payload } }` in 160-byte (20ms) chunks.
- Stream the LLM and speak TTS **per sentence** — don't block on the full response.
- Barge-in (gated on `isSpeaking()`): `tts.interrupt()` + `activeAbort.abort()` + `clearAudio`.
- Maintain `history` (system/user/assistant) across turns.
- Define tools in the `TOOLS` array and handle each tool name in `handleTurn`.
- `npm run build` (tsc) must pass; verify end-to-end once a scoped key is available.

## MUST NOT

- Commit `.env` / credentials.
- Drop `contentType`/`sampleRate` from `playAudio`, or change the 8kHz Plivo rate.
- Replace per-sentence streaming TTS with a single blocking call at end of turn (kills perceived latency).
- Put pipeline logic in `server.ts` or telephony logic in `agent.ts`.

## API contracts (see CLAUDE.md for the full shape)

- STT: `wss://api.inworld.ai/stt/v1/transcribe:streamBidirectional` — `transcribeConfig` / `audioChunk` / `result.transcription`.
- LLM: `POST /v1/chat/completions` — SSE `choices[0].delta.content` and `delta.tool_calls`; tools come from the `TOOLS` array.
- TTS: `wss://api.inworld.ai/tts/v1/voice:streamBidirectional` — `create` / `send_text{flush_context}` / `close_context`;
  responses carry `result.contextId` and `result.audioChunk.audioContent` (base64 raw μ-law 8 kHz).

## Debugging

- `[stt] HTTP <status>` / `error frame` → scope or config mismatch (8k vs 16k, encoding).
- `[tts] socket error` / `error frame` / `HTTP <status>` → scope, model, or `audio_encoding`/`sample_rate_hertz` mismatch.
- No reply after transcript → Router scope/model, or the 800ms silence timer never fired (no `isFinal`).
- Audio garbled → confirm the TTS `audio_config` is `MULAW`/`8000` (what Plivo expects) and frames are 160 bytes.
