# Inworld STT API Examples - JavaScript/Node.js

This directory contains JavaScript/Node.js examples for the Inworld Speech-to-Text (STT) v1 API.

## Prerequisites

- Node.js 20.0.0 or higher
- npm or yarn
- Inworld API key

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set your API key:**
   ```bash
   cp .env.example .env
   # Edit .env and set INWORLD_API_KEY=your_api_key_here
   ```
   Or:
   ```bash
   export INWORLD_API_KEY=your_api_key_here
   ```

## Examples

### 1. Synchronous transcription (`example_stt.js`)

Transcribes a complete audio file in one HTTP POST request. Supports WAV and other formats (auto-detect from file or use `AUTO_DETECT`). Default input: `../tests-data/audio/test-audio.wav`.

**Usage:**
```bash
npm run stt
# or
node example_stt.js [path/to/audio.wav]
```

**Output:** Prints the transcript and optional word timestamps to the console.

### 2. Streaming: transcribe from PCM file (`example_stt_websocket.js`)

Sends raw LINEAR16 PCM from a file over the STT WebSocket. Audio must be 16 kHz, 1 channel. Default input: `../tests-data/audio/test-pcm-audio.pcm`.

**Usage:**
```bash
npm run stt-stream
# or
node example_stt_websocket.js [pcm_file]
```

**Output:** [interim] and [FINAL] segments, then full transcript. Ensures all segments (including the last word) are received before closing the stream.

### 3. Real-time from microphone (`example_stt_mic.js`)

Real-time transcription from the microphone. Captures live audio (via SoX) and sends it over the STT WebSocket. Requires SoX installed (e.g. `brew install sox` on macOS). Press Ctrl+C to stop.

**Usage:**
```bash
npm run stt-mic
# or
node example_stt_mic.js
```

**Output:** [interim] and [FINAL] segments in real time, then full transcript on exit.

## Configuration

- **Sync:** Uses `groq/whisper-large-v3`; see [API reference](https://docs.inworld.ai/api-reference/sttAPI/speechtotext/transcribe) for the full request body.
- **WebSocket (file or mic):** Uses STT WebSocket with LINEAR16, 16 kHz, 1 channel. Default model is `inworld/inworld-stt-1`; see [STT overview](https://docs.inworld.ai/stt/overview) for all supported models and the [API reference](https://docs.inworld.ai/api-reference/sttAPI/speechtotext/transcribe-stream-websocket) for the full request body.

## API Endpoints

- **Sync:** `https://api.inworld.ai/stt/v1/transcribe`
- **WebSocket:** `wss://api.inworld.ai/stt/v1/transcribe:streamBidirectional`
