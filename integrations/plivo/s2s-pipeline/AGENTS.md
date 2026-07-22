# Agent Rules — Plivo + Inworld S2S Pipeline (inbound)

Speech-to-speech inbound voice agent over one Inworld Realtime WebSocket. See this folder's
`CLAUDE.md` for the full state machine, message contracts, and file map.

## MUST

- Keep `server.ts` (telephony + Plivo provisioning) and `agent.ts` (pipeline + state machine) separate.
- Define tools in the `TOOLS` array in `agent.ts` and handle each tool name in the `toolCall` listener.
- Keep audio 8kHz μ-law (`g711_ulaw`) end to end — no transcoding.
- Send `playAudio` as `{ media: { contentType: "audio/x-mulaw", sampleRate: 8000, payload } }` in 160-byte (20ms) chunks.
- Gate barge-in on `isSpeaking()` (clear playback + `response.cancel` only while the agent is talking).
- Run `npm run build` (tsc) and test over `ngrok http 3000` against a real Plivo call before claiming a change works.

## MUST NOT

- Commit `.env` / credentials.
- Change the audio format/sample rate, or drop `contentType`/`sampleRate` from `playAudio`.
- Cancel the response on every `speech_started` regardless of state (causes the agent to cut itself off).
- Put pipeline logic in `server.ts` or telephony/provisioning logic in `agent.ts`.

## Plivo provisioning (server.ts)

On startup `configurePlivoWebhooks()` finds/creates the Plivo Application and maps the number to
it (answer/hangup/fallback URLs from `PUBLIC_URL`). Requires `PLIVO_AUTH_ID/TOKEN`,
`PLIVO_PHONE_NUMBER`, `PUBLIC_URL`; it logs and continues (non-fatal) if they're missing.

## Testing

1. `.env`: `INWORLD_API_KEY` (Realtime scope), `PLIVO_AUTH_ID/TOKEN`, `PLIVO_PHONE_NUMBER`, `PUBLIC_URL`
2. `ngrok http 3000` → set `PUBLIC_URL` to the HTTPS URL
3. `npm run dev` → expect `Mapped +<number> → ...` then `Listening on port 3000`
4. Call the number; verify greeting, conversation, barge-in

## Debugging

- No audio / drops mid-response: confirm `playAudio` includes `contentType`+`sampleRate`.
- Call doesn't connect: check the `/answer` webhook is reachable and `PUBLIC_URL` matches ngrok.
- Provisioning failed: verify Plivo creds + that `PLIVO_PHONE_NUMBER` is E.164; check `[provision]` logs.
- No AI response: verify the Inworld key has **Realtime API** scope (see `[inworld]` logs for `HTTP <status>` / `error frame`).
