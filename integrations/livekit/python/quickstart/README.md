> First time? See [integrations setup](../../../README.md) to initialize submodules.

# LiveKit Quickstart — Inworld TTS (Python)

Voice AI agent using LiveKit Agents with AssemblyAI (STT), OpenAI (LLM), and Inworld (TTS).

## Prerequisites

- [LiveKit Cloud](https://cloud.livekit.io) account (free tier available)
- Create a project and get `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` from Settings → API keys

## Setup

```bash
cd integrations/livekit/python/quickstart
cp .env.example .env
# edit .env with your keys
uv sync
```

## Run

```bash
# Download models (first time only)
uv run python test_inworld_voice_agent.py download-files

# Start the agent
uv run python test_inworld_voice_agent.py dev
```

Then go to https://agents-playground.livekit.io, select your project, and click **Connect**.

## API Keys

| Variable | Service |
|----------|---------|
| `LIVEKIT_URL` | LiveKit Cloud WebSocket URL |
| `LIVEKIT_API_KEY` | LiveKit API key |
| `LIVEKIT_API_SECRET` | LiveKit API secret |
| `ASSEMBLYAI_API_KEY` | [AssemblyAI](https://www.assemblyai.com/dashboard/signup) (STT) |
| `OPENAI_API_KEY` | [OpenAI](https://auth.openai.com/create-account) (LLM) |
| `INWORLD_API_KEY` | [Inworld](https://inworld.ai) (TTS) |
