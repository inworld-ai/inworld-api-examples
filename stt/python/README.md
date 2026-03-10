# Inworld STT API Examples - Python

This directory contains Python examples for the Inworld Speech-to-Text (STT) v1 API.

## Prerequisites

- Python 3.10 or higher
- Inworld API key

## Quick Start

1. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

2. **Set your API key:**
   ```bash
   cp .env.example .env
   # Edit .env and set INWORLD_API_KEY=your_api_key_here
   ```
   Or: `export INWORLD_API_KEY=your_api_key_here`

3. **Run an example:**
   ```bash
   python example_stt.py
   ```
   Default input is `../tests-data/audio/test-audio.wav`; pass a path to use another file.

## Examples

### 1. `example_stt.py` - Synchronous transcription (HTTP)

Transcribes a complete audio file in one POST request. Supports WAV and other formats (auto-detect). Default input: `tests-data/audio/test-audio.wav`.

**Usage:**
```bash
python example_stt.py
# or
python example_stt.py [path/to/audio.wav]
```

**Output:** Transcript and optional word timestamps printed to the console.

### 2. `example_stt_websocket.py` - WebSocket (LINEAR16 PCM)

Real-time transcription over WebSocket. Input is a **raw LINEAR16 PCM file** (no WAV header). You pass sample rate and channels (or use defaults). Default input: `tests-data/audio/test-pcm-audio.pcm`. Streaming API supports only LINEAR16; for MP3 use the sync API (`example_stt.py`).

**Usage:**
```bash
python example_stt_websocket.py
# or
python example_stt_websocket.py [pcm.raw] [sample_rate] [channels]
```
Defaults: `tests-data/audio/test-pcm-audio.pcm`, `sample_rate` 16000, `channels` 1.

**Output:** [interim] and [FINAL] segments, then full transcript.

### 3. `example_stt_mic.py` - Real-time from microphone

Real-time transcription from the microphone. Captures live audio (via sounddevice) and streams to the STT WebSocket. Requires `pip install sounddevice`. Press Ctrl+C to stop.

**Usage:**
```bash
python example_stt_mic.py
```

**Output:** [interim] and [FINAL] segments in real time, then full transcript on exit.

## Configuration

- **Sync:** Same as JS: `groq/whisper-large-v3-turbo`, optional `language`, `includeWordTimestamps`, `prompts`.
- **WebSocket:** Streaming supports only LINEAR16; pass sample rate and channels (or use defaults). For MP3 use sync API.

## API Endpoints

- **Sync:** `https://api.inworld.ai/stt/v1/transcribe`
- **WebSocket:** `wss://api.inworld.ai/stt/v1/transcribe:streamBidirectional`
