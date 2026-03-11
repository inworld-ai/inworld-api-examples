> First time? See [integrations setup](../../../README.md) to initialize submodules.

# TTS TTFB Benchmarks — LiveKit Agents (JavaScript)

Measures time-to-first-byte (TTFB) for TTS providers via LiveKit Agents JS SDK.
Compares Inworld, ElevenLabs, and Cartesia across HTTP and WebSocket transports.

## Setup

```bash
# Build agents-js monorepo (need to re-run after source changes)
cd integrations/livekit/js/agents-js
pnpm install && pnpm build

# Install benchmark dependencies
cd integrations/livekit/js/benchmarks
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

As a result, **JS WebSocket TTFB will appear ~300ms higher than Python WebSocket TTFB**
for the same provider with the default benchmark text and 50ms token delay. Two factors
contribute:

1. **TTFB timer start**: JS starts the timer at `pushText()`, Python starts when the
   sentence is dispatched to the provider.
2. **Sentence tokenizer**: The JS `basic.SentenceTokenizer` has a `minSentenceLength`
   of 20 characters, so short sentences like "Hello!" (6 chars) are merged with the
   next sentence. The Python `blingfire.SentenceTokenizer` splits at punctuation
   regardless of length. With the default benchmark text, the JS tokenizer waits for
   all tokens (~300ms at 50ms/token) before yielding a single sentence, while Python
   splits "Hello!" immediately.

HTTP TTFB is unaffected and comparable across both SDKs.
