# Inworld Realtime API — Python Quick-Start Examples

Minimal Python examples for the Inworld Realtime API using WebSockets and WebRTC.

## Setup

```bash
pip install -r requirements.txt
cp .env.example .env
```

Edit `.env` with your credentials from the [Inworld Portal](https://studio.inworld.ai) > API Keys:

| Variable | Description |
|---|---|
| `INWORLD_API_KEY` | Base64-encoded API key (used by `basic` examples) |
| `INWORLD_KEY` | API key ID (used by `jwt` examples to mint tokens) |
| `INWORLD_SECRET` | API key secret (used by `jwt` examples to mint tokens) |
| `INWORLD_WORKSPACE` | Workspace resource name, e.g. `workspaces/my-workspace` |

## Examples

Each example starts a local server at `http://localhost:3000`.

### Realtime Voice — WebSockets

```bash
python websockets/basic/server.py          # Basic auth
python websockets/jwt/server.py            # JWT auth
```

### Realtime Voice — WebRTC

```bash
python webrtc/basic/server.py              # Basic auth
python webrtc/jwt/server.py                # JWT auth
```

## Project Structure

```
├── auth/mint_jwt.py         # JWT minting helper
├── websockets/
│   ├── basic/               # WS + Basic auth
│   └── jwt/                 # WS + JWT auth
├── webrtc/
│   ├── basic/               # WebRTC + Basic auth
│   └── jwt/                 # WebRTC + JWT auth
├── requirements.txt
└── .env.example
```
