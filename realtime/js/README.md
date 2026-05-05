# Inworld Realtime API — JavaScript Quick-Start Examples

Minimal Node.js examples for the Inworld Realtime API using WebSockets and WebRTC.

## Setup

```bash
npm install
cp .env.example .env
```

Edit `.env` with your credentials from the [Inworld Portal](https://studio.inworld.ai) → API Keys:

| Variable | Description |
|---|---|
| `INWORLD_API_KEY` | Base64-encoded API key (used by `basic` examples) |
| `INWORLD_KEY` | API key ID (used by `jwt` examples to mint tokens) |
| `INWORLD_SECRET` | API key secret (used by `jwt` examples to mint tokens) |
| `INWORLD_WORKSPACE` | Workspace ID prefixed with `workspaces/`, e.g. `workspaces/your_workspace_id` |

## Examples

Each example starts a local server at `http://localhost:3000`.

### Realtime Voice — WebSockets

```bash
npm run websockets:basic   # Basic auth
npm run websockets:jwt     # JWT auth
```

Proxies a browser WebSocket through the server to the Inworld Realtime API. The browser captures mic audio, sends PCM frames, and plays back agent audio and transcript in real time.

### Realtime Voice — WebRTC

```bash
npm run webrtc:basic       # Basic auth
npm run webrtc:jwt         # JWT auth
```

Browser-native WebRTC connection to the Inworld Realtime API. The server provides credentials and ICE servers; the browser handles the peer connection directly.

## Auth Modes

- **Basic** — sends the Base64 API key with the Basic scheme (`Authorization: Basic $INWORLD_API_KEY`). Simple, but keep server-side only.
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
└── .env.example
```
