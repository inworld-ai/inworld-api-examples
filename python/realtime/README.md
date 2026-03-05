# Inworld Realtime API — Python Quick-Start

Minimal Python examples for the Inworld Realtime and TTS APIs using WebSockets, WebRTC, and REST.

## Setup

```bash
pip install -r requirements.txt
cp .env.example .env
```

Edit `.env` with your credentials from the [Inworld Portal](https://studio.inworld.ai) > API Keys:

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
python websockets/basic/server.py          # Basic auth
AUTH_TYPE=bearer python websockets/basic/server.py  # Bearer auth
python websockets/jwt/server.py            # JWT auth
```

### Realtime Voice — WebRTC

```bash
python webrtc/basic/server.py              # Basic auth
AUTH_TYPE=bearer python webrtc/basic/server.py      # Bearer auth
python webrtc/jwt/server.py                # JWT auth
```

### Text-to-Speech

```bash
python tts/basic/server.py                 # Basic auth
AUTH_TYPE=bearer python tts/basic/server.py         # Bearer auth
python tts/jwt/server.py                   # JWT auth
```

## Project Structure

```
├── jwt/mint_jwt.py          # JWT minting helper
├── websockets/
│   ├── basic/               # WS + Basic auth
│   └── jwt/                 # WS + JWT auth
├── webrtc/
│   ├── basic/               # WebRTC + Basic auth
│   └── jwt/                 # WebRTC + JWT auth
├── tts/
│   ├── basic/               # TTS + Basic auth
│   └── jwt/                 # TTS + JWT auth
├── requirements.txt
└── .env.example
```
