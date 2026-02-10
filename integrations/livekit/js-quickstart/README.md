# Inworld TTS JS Quickstart

Quickstart agent for testing Inworld TTS with [LiveKit Agents (JS)](../agents-js/).

## Setup

### 1. Set up LiveKit Cloud (free tier available)

1. Go to https://cloud.livekit.io and create a free account
2. Create a new project
3. Go to Settings -> API keys
4. Create new API key

### 2. Create your `.env` file

```bash
cp .env-example .env
```

Add your credentials:

```bash
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your-api-key
LIVEKIT_API_SECRET=your-api-secret
OPENAI_API_KEY=your-openai-key
ASSEMBLYAI_API_KEY=your-assemblyai-key
INWORLD_API_KEY=your-inworld-key
```

### 3. Install and build the agents-js monorepo

From the repository root:

```bash
cd integrations/livekit/agents-js
pnpm install
pnpm build
```

### 4. Install quickstart dependencies

```bash
cd ../js-quickstart
pnpm install
```

### 5. Download required models (first time only)

```bash
pnpm download
```

### 6. Start the agent

```bash
pnpm start
```

Or with debug logging:

```bash
pnpm start:debug
```

### 7. Connect via Frontend

Go to https://agents-playground.livekit.io, select your project, and click "Connect".

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `LIVEKIT_URL` | Yes | Your LiveKit Cloud WebSocket URL |
| `LIVEKIT_API_KEY` | Yes | LiveKit API key |
| `LIVEKIT_API_SECRET` | Yes | LiveKit API secret |
| `ASSEMBLYAI_API_KEY` | Yes | AssemblyAI API key for STT |
| `OPENAI_API_KEY` | Yes | OpenAI API key for LLM |
| `INWORLD_API_KEY` | Yes | Inworld API key for TTS |
| `INWORLD_BASE_URL` | No | Custom HTTP endpoint |
| `INWORLD_WS_URL` | No | Custom WebSocket endpoint |
| `INWORLD_VOICE` | No | Voice name (default: `Alex`) |

## Testing Against Dev/Staging API

Add to your `.env`:

```bash
INWORLD_BASE_URL=https://api.dev.inworld.ai/
INWORLD_WS_URL=wss://api.dev.inworld.ai/
```
