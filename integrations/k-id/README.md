# k-ID + Inworld Realtime Demo

Age-verified voice conversations. Users verify their age through [k-ID](https://k-id.com), then talk to an AI voice agent powered by [Inworld's Realtime API](https://docs.inworld.ai/realtime/overview).

## Flow

1. User enters their name, date of birth, and location
2. k-ID verifies age and handles parental consent if needed
3. Once approved, user starts a real-time voice conversation with an AI agent

## Requirements

- **Node.js 18+**
- **Inworld account** with a Realtime API key
- **k-ID account** with a product configured in Compliance Studio

## Getting Your API Keys

### Inworld

1. Sign up at [platform.inworld.ai](https://platform.inworld.ai)
2. Go to **API Keys** and generate a new key
3. Copy the **Basic (Base64)** key

### k-ID

1. Sign up at [portal.k-id.com](https://portal.k-id.com)
2. Create a **Product** in Compliance Studio
3. Generate an **API key** for your product
4. For development, use the **test environment** (`game-api.test.k-id.com`)

## Setup

```bash
npm install
cp .env.example .env
```

Edit `.env` with your keys:

```
K_ID_API_KEY=your_kid_api_key
INWORLD_API_KEY=your_inworld_base64_key
```

## Run

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

This starts an Express API server (port 3000) and a Vite dev server (port 5173) that proxies API requests to it.

## Production

```bash
npm run build
npm start
```

Express serves the built React app from `dist/client/` on port 3000.

## Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `K_ID_API_KEY` | Yes | | k-ID API key |
| `K_ID_API_URL` | No | `https://game-api.test.k-id.com` | k-ID API URL (`game-api.k-id.com` for production) |
| `INWORLD_API_KEY` | Yes | | Inworld Basic (Base64) API key |
| `PORT` | No | `3000` | Express server port |
| `SYSTEM_PROMPT` | No | Friendly assistant | Voice agent instructions |
| `INWORLD_MODEL` | No | `openai/gpt-4o-mini` | LLM model |
| `TTS_VOICE` | No | `Clive` | Text-to-speech voice |

## Architecture

```
Browser (React + Vite)        Express Server              External APIs
──────────────────────        ──────────────              ─────────────
AgeGate form            POST /api/kid/start-session   ->  k-ID E2E widget API
KidVerification iframe  <-   (returns widget URL)     <-  k-ID CDK
RealtimeChat audio      /ws  (WebSocket proxy)        ->  Inworld Realtime API
```

API keys stay server-side. The browser never sees them.

## Links

- [k-ID Docs](https://docs.k-id.com) | [k-ID Dev Explorer](https://github.com/kidentify/k-id-dev-explorer)
- [Inworld Realtime Docs](https://docs.inworld.ai/realtime/overview) | [WebSocket Quickstart](https://docs.inworld.ai/realtime/quickstart-websocket)
