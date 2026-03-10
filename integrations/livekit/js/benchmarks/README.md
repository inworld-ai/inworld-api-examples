> First time? See [integrations setup](../../../README.md) to initialize submodules.

# TTS TTFB Benchmarks — LiveKit Agents (JavaScript)

Measures time-to-first-byte (TTFB) for TTS providers via LiveKit Agents JS SDK.
Compares Inworld, ElevenLabs, and Cartesia across HTTP and WebSocket transports.

## Setup

```bash
# Build agents-js monorepo (needed once)
cd integrations/livekit/js/agents-js
pnpm install
pnpm build

# Install benchmark dependencies
cd ../benchmarks
pnpm install
```

Copy the example env file and fill in your API keys:

```bash
cp .env.example .env
# edit .env with your keys
```

## Usage

```bash
# HTTP benchmark
npx tsx benchmark_http_ttfb.ts --services inworld
npx tsx benchmark_http_ttfb.ts --services inworld -n 10

# WebSocket benchmark
npx tsx benchmark_websocket_ttfb.ts --services inworld
npx tsx benchmark_websocket_ttfb.ts --services all --token-delay 50

```

## CLI Options

| Flag                 | HTTP | WS  | Default | Description                                        |
| -------------------- | ---- | --- | ------- | -------------------------------------------------- |
| `--text`             | yes  | yes | *       | Custom text to synthesize                          |
| `-n` / `--iterations`| yes  | yes | 5       | Number of timed iterations                         |
| `--services`         | yes  | yes | all     | Comma-separated: inworld,elevenlabs,cartesia       |
| `--no-save-audio`    | yes  | yes | off     | Skip saving WAV output files                       |
| `--debug`            | yes  | yes | off     | Enable debug logging                               |
| `--warmup`           | yes  | yes | 1       | Warmup iterations before timing                    |
| `--token-delay`      | —    | yes | 50ms    | Delay between simulated LLM tokens                 |

\* Default text: 2 sentences

## Note on WebSocket TTFB measurement

The LiveKit agents-js framework starts the TTFB timer on the first `pushText()` call,
not when the complete sentence is sent to the TTS provider. This means the WS TTFB
metric includes token aggregation time (waiting for sentence boundary) in addition to
the actual API latency. The LiveKit Python SDK does not have this behavior — it starts
the timer when the sentence is dispatched to the provider.

As a result, **JS WebSocket TTFB will appear ~200ms higher than Python WebSocket TTFB**
for the same provider. This is a framework measurement difference, not an actual latency
difference. HTTP TTFB is unaffected and comparable across both SDKs.
