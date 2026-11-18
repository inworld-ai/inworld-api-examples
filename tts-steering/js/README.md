# Steering examples in JavaScript

See the [shared guide](../README.md) for which approach to use and what each example shows.

## Setup

Requires Node.js 20+ and an Inworld API key. Run from this directory:

```bash
npm ci
cp .env.example .env
# Edit .env: set INWORLD_API_KEY.
```

You can export these variables instead; environment variables take precedence over `.env`. Do not commit your key. These are server-side Node.js examples, not browser code.

## Tags from your own LLM, over the WebSocket

```bash
npm run stream
node example_llm_steering_stream.js "My flight got cancelled and I'm stuck overnight."
```

The LLM gets [`steering_system_prompt.md`](../steering_system_prompt.md) as part of its system prompt. Its reply prints as it streams, tags included, and each sentence goes to TTS as soon as it is complete. The script prints the time to the first LLM token, the first sentence sent and the first audio, and saves `llm_steering_stream.wav`. The LLM is the Inworld Router, with the same key; set `LLM_BASE_URL`, `LLM_API_KEY` and `LLM_MODEL` in `.env` to use another OpenAI-compatible provider. Each run is one LLM request and one billable synthesis.

## Built-in Reasoning

```bash
npm run reasoning
```

Synthesizes one line with `reasoning: REASONING_ON` and a `reasoningContext`, first unary and then streaming. It prints the `reasoningInstruction` each response returned, the text to send to keep that delivery, and the streaming request's time to first audio, and saves `reasoning.mp3` and `reasoning_stream.mp3`. Two billable syntheses.

## Offline tests

```bash
npm test
```

These cover the tag-safe sentence buffer, the LLM request and stream parsing, the WebSocket messages, and the Reasoning requests and responses, with fakes. They do not call Inworld or an LLM.
