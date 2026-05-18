> First time? See [integrations setup](../../../README.md) to initialize submodules.

# TTS TTFB Benchmarks — LiveKit Agents (Python)

Measures time-to-first-byte (TTFB) for TTS providers via LiveKit Agents Python SDK.
Compares Inworld, ElevenLabs, Cartesia, and MiniMax across HTTP and WebSocket transports.

## Setup

```bash
cd integrations/livekit/python/benchmarks
uv sync
```

Copy the example env file and fill in your API keys:

```bash
cp .env.example .env
# edit .env with your keys
```

## Usage

```bash
# HTTP benchmark
uv run python benchmark_http_ttfb.py --services inworld
uv run python benchmark_http_ttfb.py --services inworld -n 10

# WebSocket benchmark
uv run python benchmark_websocket_ttfb.py --services inworld
uv run python benchmark_websocket_ttfb.py --services all --token-delay 50

```

## CLI Options

| Flag                 | HTTP | WS  | Default | Description                                        |
| -------------------- | ---- | --- | ------- | -------------------------------------------------- |
| `--text`             | yes  | yes | *       | Custom text to synthesize                          |
| `-n` / `--iterations`| yes  | yes | 5       | Number of timed iterations                         |
| `--services`         | yes  | yes | all     | inworld,elevenlabs,cartesia,minimax (or 'all') |
| `--no-save-audio`    | yes  | yes | off     | Skip saving WAV output files                       |
| `--debug`            | yes  | yes | off     | Enable debug logging                               |
| `--warmup`           | yes  | yes | 1       | Warmup iterations before timing                    |
| `--token-delay`      | —    | yes | 50ms    | Delay between simulated LLM tokens                 |

\* Default text: 2 sentences
