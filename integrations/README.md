# Integrations

Inworld TTS plugins and examples for voice agent frameworks.

## First-Time Setup

```bash
git submodule update --init --recursive
```

Then follow the setup instructions in each directory below.

## LiveKit

### Python

| | |
|---|---|
| [Quickstart](livekit/python/quickstart/README.md) | Voice agent using Inworld TTS with LiveKit Agents (Python) |
| [Benchmarks](livekit/python/benchmarks/README.md) | HTTP & WebSocket TTFB benchmarks vs ElevenLabs, Cartesia |

### JS/TypeScript

| | |
|---|---|
| [Quickstart](livekit/js/quickstart/README.md) | Voice agent using Inworld TTS with LiveKit Agents (JS) |
| [Benchmarks](livekit/js/benchmarks/README.md) | HTTP & WebSocket TTFB benchmarks vs ElevenLabs, Cartesia |

## Pipecat

| | |
|---|---|
| [Quickstart](pipecat/pipecat-quickstart/README.md) | Voice bot using Inworld TTS with Pipecat |
| [Benchmarks](pipecat/benchmarks/README.md) | HTTP & WebSocket TTFB benchmarks vs ElevenLabs, Cartesia |

## AI Agent Guides

If you're using an AI coding assistant, these files provide full context for automated testing and development:

- **Cursor**: [`.cursor/rules/integrations.mdc`](../.cursor/rules/integrations.mdc) — auto-activates when working in this directory
- **Claude Code**: [`CLAUDE.md`](CLAUDE.md) — sanity check commands, directory structure, expected results

Agents can run all benchmarks and verify quickstarts — just make sure `.env` files with valid API keys exist in each directory first (copy from `.env.example`).