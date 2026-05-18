> First time? See [integrations setup](../../README.md) to initialize submodules.

# Pipecat Quickstart — Inworld TTS

Voice AI bot using Pipecat with AssemblyAI (STT), OpenAI (LLM), and Inworld (TTS).

Based on [pipecat-quickstart](https://github.com/pipecat-ai/pipecat-quickstart).

## Setup

```bash
cd integrations/pipecat/pipecat-quickstart
cp .env.example .env
# edit .env with your API keys
uv sync
```

## Run

```bash
uv run bot.py
```

Open http://localhost:7860 and click **Connect**.

> First run may take ~20 seconds as Pipecat downloads required models.

## API Keys

| Variable | Service |
|----------|---------|
| `ASSEMBLYAI_API_KEY` | [AssemblyAI](https://www.assemblyai.com/dashboard/signup) (STT) |
| `OPENAI_API_KEY` | [OpenAI](https://auth.openai.com/create-account) (LLM) |
| `INWORLD_API_KEY` | [Inworld](https://inworld.ai) (TTS) |
