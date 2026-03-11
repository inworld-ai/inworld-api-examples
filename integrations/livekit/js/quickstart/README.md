> First time? See [integrations setup](../../../README.md) to initialize submodules.

# LiveKit Quickstart — Inworld TTS (JavaScript)

Voice AI agent using LiveKit Agents JS with AssemblyAI (STT), OpenAI (LLM), and Inworld (TTS).

## Prerequisites

- [LiveKit Cloud](https://cloud.livekit.io) account (free tier available)
- Create a project and get `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` from Settings → API keys

## Setup

```bash
# Build agents-js monorepo (need to re-run after source changes)
cd integrations/livekit/js/agents-js
pnpm install && pnpm build

# Install quickstart dependencies
cd integrations/livekit/js/quickstart
cp .env.example .env
# edit .env with your keys
pnpm install
```

## Run

```bash
# Download models (first time only)
pnpm download

# Start the agent
pnpm start
```

Then go to https://agents-playground.livekit.io, select your project, and click **Connect**.

## API Keys

| Variable | Required | Description |
|----------|----------|-------------|
| `LIVEKIT_URL` | Yes | LiveKit Cloud WebSocket URL |
| `LIVEKIT_API_KEY` | Yes | LiveKit API key |
| `LIVEKIT_API_SECRET` | Yes | LiveKit API secret |
| `ASSEMBLYAI_API_KEY` | Yes | [AssemblyAI](https://www.assemblyai.com/dashboard/signup) (STT) |
| `OPENAI_API_KEY` | Yes | [OpenAI](https://auth.openai.com/create-account) (LLM) |
| `INWORLD_API_KEY` | Yes | [Inworld](https://inworld.ai) (TTS) |
| `INWORLD_VOICE` | No | Voice name (default: `Alex`) |
| `INWORLD_BASE_URL` | No | Custom HTTP endpoint |
| `INWORLD_WS_URL` | No | Custom WebSocket endpoint |
