# k-ID + Inworld Integration

## What This Is

A sample app: k-ID age verification gate in front of an Inworld Realtime voice agent. React frontend, Express backend, TypeScript throughout.

## Project Structure

```
server/
  index.ts           Express server, WebSocket upgrade handler
  config.ts          Environment variable loading
  kid-routes.ts      /api/kid/* routes — proxies to k-ID API
  inworld-proxy.ts   /ws WebSocket relay between browser and Inworld
client/
  main.tsx           React entry
  App.tsx            Screen state machine: age-gate -> verification -> approved/denied
  App.css            All styles (greyscale palette)
  components/
    AgeGate.tsx          Name, DOB, jurisdiction form
    KidVerification.tsx  k-ID E2E widget in iframe + postMessage listener
    RealtimeChat.tsx     Inworld voice chat (AudioWorklet capture, scheduled playback)
```

## Running

```bash
npm install
cp .env.example .env   # Fill in K_ID_API_KEY and INWORLD_API_KEY
npm run dev            # Starts Express (3000) + Vite (5173)
```

Open http://localhost:5173. The Vite dev server proxies `/api` and `/ws` to Express.

## Prerequisites

- **Node.js 18+**
- **Inworld API key**: Sign up at https://platform.inworld.ai -> API Keys -> copy the Basic (Base64) key
- **k-ID API key**: Sign up at https://portal.k-id.com -> create a Product in Compliance Studio -> generate an API key. Use `K_ID_API_URL=https://game-api.test.k-id.com` for test mode.

## Key Technical Details

### k-ID Integration

- Server calls `POST /api/v1/widget/generate-e2e-url` with jurisdiction + age/DOB
- Response is a URL embedded in an iframe (the k-ID CDK widget)
- Widget handles age gate, data notices, verification, and parental consent automatically
- PostMessages from `*.k-id.com` origins carry `{ data: { sessionId, challengeId } }`
- Session status checked via `GET /api/v1/session/get?sessionId=...`
- Auth: `Authorization: Bearer <api-key>` on all k-ID requests

### Inworld Integration

- Express handles WebSocket upgrade at `/ws` using `noServer` mode
- Browser connects to `/ws`, server relays to `wss://api.inworld.ai/api/v1/realtime/session`
- Auth header (`Basic <key>`) applied server-side only
- Audio: 24kHz mono PCM16, captured via AudioWorklet, sent as base64
- Playback: base64 -> Float32 -> AudioBuffer, scheduled via `AudioContext.currentTime`
- Agent transcript uses audio transcript events only (not text deltas) to avoid duplication
- User speech shows "..." animation until final transcription arrives

### Build

```bash
npm run build    # Vite builds React to dist/client/, tsc compiles server to dist/server/
npm start        # Express serves the built React app + API + WebSocket
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `K_ID_API_KEY` | Yes | From k-ID Compliance Studio |
| `K_ID_API_URL` | No | Default: `https://game-api.test.k-id.com` |
| `INWORLD_API_KEY` | Yes | Inworld Basic (Base64) key |
| `PORT` | No | Default: 3000 |
| `SYSTEM_PROMPT` | No | Voice agent system prompt |
| `INWORLD_MODEL` | No | Default: `openai/gpt-4o-mini` |
| `TTS_VOICE` | No | Default: `Clive` |
