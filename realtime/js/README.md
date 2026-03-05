# Inworld Realtime API — Quick-Start Examples

Minimal Node.js examples for the Inworld Realtime and TTS APIs using WebSockets, WebRTC, and REST.

## Setup

```bash
npm install
cp .env.example .env
```

Edit `.env` with your credentials from the [Inworld Portal](https://studio.inworld.ai) → API Keys:

| Variable | Description |
|---|---|
| `INWORLD_API_KEY` | Base64-encoded API key (used by `basic` and `bearer` examples) |
| `INWORLD_KEY` | API key ID (used by `jwt` examples to mint tokens) |
| `INWORLD_SECRET` | API key secret (used by `jwt` examples to mint tokens) |
| `INWORLD_WORKSPACE` | Workspace resource name, e.g. `workspaces/my-workspace` |

## Examples

Each example starts a local server at `http://localhost:3000`.

### Realtime Voice — WebSockets

```bash
npm run websockets:basic   # Basic auth
npm run websockets:bearer  # Bearer auth (Base64 key)
npm run websockets:jwt     # JWT auth
```

Proxies a browser WebSocket through the server to the Inworld Realtime API. The browser captures mic audio, sends PCM frames, and plays back agent audio and transcript in real time.

### Realtime Voice — WebRTC

```bash
npm run webrtc:basic       # Basic auth
npm run webrtc:bearer      # Bearer auth (Base64 key)
npm run webrtc:jwt         # JWT auth
```

Browser-native WebRTC connection to the Inworld Realtime API. The server provides credentials and ICE servers; the browser handles the peer connection directly.

### Text-to-Speech

```bash
npm run tts:basic          # Basic auth
npm run tts:bearer         # Bearer auth (Base64 key)
npm run tts:jwt            # JWT auth
```

Streams synthesized audio from the Inworld TTS API. Type text, pick a voice and model, and hear it played back with streaming chunk stats.

## Auth Modes

- **Basic** — sends the Base64 API key with the Basic scheme (`Authorization: Basic $INWORLD_API_KEY`). Simple, but don't expose this in client-side code.
- **Bearer** — sends the same Base64 API key with the Bearer scheme (`Authorization: Bearer $INWORLD_API_KEY`). Same key, different header format.
- **JWT** — the server mints a short-lived token using `INWORLD_KEY` + `INWORLD_SECRET`, then uses it with `Authorization: Bearer $JWT`. Safer for client-facing apps.

## Project Structure

```
├── jwt/mint-jwt.js          # JWT minting helper
├── websockets/
│   ├── basic/               # WS + Basic auth
│   └── jwt/                 # WS + JWT auth
├── webrtc/
│   ├── basic/               # WebRTC + Basic auth
│   └── jwt/                 # WebRTC + JWT auth
├── tts/
│   ├── basic/               # TTS + Basic auth
│   └── jwt/                 # TTS + JWT auth
└── .env.example
```
