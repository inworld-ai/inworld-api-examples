# Inworld TTS API Examples

| Directory | Description |
|---|---|
| [`python/`](python/) | Text-to-speech synthesis examples in Python (HTTP, streaming, WebSocket, timestamps, low-latency, voice cloning, CLI) |
| [`js/`](js/) | Text-to-speech synthesis examples in JavaScript/Node.js (HTTP, streaming, WebSocket, timestamps, low-latency, voice cloning) |
| [`tests-data/`](tests-data/) | Sample audio, text, and JSON files used by the examples |

See each subdirectory's README for setup and usage.

## TTS example options: when to use which

For real-time use cases, minimizing latency is critical. Inworld offers three ways to synthesize speech; choose based on your latency and integration needs:

| Option | Description | When to use | Examples (Python & JavaScript) |
|--------|-------------|-------------|--------------------------------|
| **Non-streaming HTTP** | Single request → full audio in one response. | Batch or file generation; when you don't need to start playback before the full clip is ready. | `example_tts`, `example_tts_timestamps`, `example_tts_long_input`, `example_tts_long_input_compressed` |
| **HTTP streaming** | Chunked response; you can start playback as soon as the first chunk arrives. | Real-time when you prefer HTTP (e.g. request/response, proxies). Lower latency than non-streaming. | `example_tts_stream`, `example_tts_stream_timestamps`, `example_tts_low_latency_http` |
| **WebSocket streaming** | Persistent connection; audio chunks stream over the same connection. | **Lowest latency**; best for real-time voice apps, agents, and interactive use. Requires managing connection lifecycle, context state, and error handling. | `example_tts_low_latency_ws`, `example_websocket` |

In general: **WebSocket** has the lowest time-to-first-byte (TTFB), **HTTP streaming** is next, and **non-streaming HTTP** is highest latency but good to get started. For more on latency and best practices, see [Generating speech – Latency](https://docs.inworld.ai/docs/tts/best-practices/generating-speech#latency).

## **[TTS Latency Comparison](js/tts_latency_comparison/)**

Interactive web app that measures and visualizes first-phoneme latency across Inworld, ElevenLabs, Cartesia, and Hume in real time.
