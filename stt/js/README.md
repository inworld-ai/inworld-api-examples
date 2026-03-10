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

### 2. WebSocket (`example_stt_websocket.js`)

Real-time transcription over WebSocket. Input is a **raw LINEAR16 PCM file** (no WAV header). You pass sample rate and channels (or use defaults). Default input: `../tests-data/audio/test-pcm-audio.pcm`. Streaming API supports only LINEAR16; for MP3 use the sync API (`example_stt.js`).

**Usage:**
```bash
npm run stt-websocket
# or
node example_stt_websocket.js [pcm.raw] [sampleRate] [channels]
```
Defaults: `../tests-data/audio/test-pcm-audio.pcm`, `sampleRate` 16000, `channels` 1.

**Output:** [interim] and [FINAL] segments, then full transcript.

### 3. Real-time from microphone (`example_stt_mic.js`)

Real-time transcription from the microphone. Captures live audio (via SoX) and streams to the STT WebSocket. Requires SoX installed (e.g. `brew install sox` on macOS). Press Ctrl+C to stop.

**Usage:**
```bash
npm run stt-mic
# or
node example_stt_mic.js
```

**Output:** [interim] and [FINAL] segments in real time, then full transcript on exit.

## Configuration

- **Sync:** Uses `groq/whisper-large-v3-turbo`; optional `language`, `includeWordTimestamps`, `prompts` (see TranscribeConfig).
- **WebSocket:** Streaming supports only LINEAR16; pass sample rate and channels (or use defaults). For MP3 use sync API.

## API Endpoints

- **Sync:** `https://api.inworld.ai/stt/v1/transcribe`
- **WebSocket:** `wss://api.inworld.ai/stt/v1/transcribe:streamBidirectional`
