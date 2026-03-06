<div align="center">

![Inworld AI](assets/cover.jpg)

# Inworld API Examples

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Documentation](https://img.shields.io/badge/Docs-docs.inworld.ai-blue)](https://docs.inworld.ai/api-reference/introduction)

</div>

This repository contains examples to help you get started with the [Inworld APIs](https://docs.inworld.ai/api-reference/introduction). 
These examples are short snippets that demonstrate best-practices in using Inworld and accelerating your development process.


## Prerequisites

| | Requirement |
|---|---|
| **Python** | 3.7+ |
| **Node.js** | 18+ |
| **API key** | [Get one at inworld.ai](https://platform.inworld.ai/api-keys) |


## Repository Structure

```
inworld-api-examples/
├── tts/                             # Text-to-speech examples
│   ├── python/                      # Basic synthesis, HTTP streaming, WebSocket streaming,
│   │                                # word/phoneme timestamps, long-text chunking,
│   │                                # low-latency benchmarks, voice cloning, voice design,
│   │                                # and a batch-testing CLI (tts_cli.py)
│   ├── js/                          # Basic synthesis, HTTP streaming, WebSocket streaming,
│   │                                # word/phoneme timestamps, long-text chunking,
│   │                                # low-latency benchmarks, voice cloning, voice design
│   │   └── tts_latency_comparison/  # Interactive web app: compare TTS latency across providers
│   └── tests-data/                  # Shared sample audio and text fixtures
│
└── realtime/                        # Real-time voice agent examples
    ├── python/                      # WebSocket & WebRTC servers, basic and JWT auth
    │   ├── websockets/
    │   └── webrtc/
    └── js/                          # WebSocket & WebRTC servers, basic and JWT auth
        ├── websockets/
        └── webrtc/
```

Each subdirectory has its own `README.md` with setup instructions and usage examples.
