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
   python example_stt_sync.py
   ```
   Default input is `../tests-data/audio/test-audio.wav`; pass a path to use another file.

## Examples

### 1. `example_stt_sync.py` - Synchronous transcription (HTTP)

Transcribes a complete audio file in one POST request. Supports WAV and other formats (auto-detect). Default input: `tests-data/audio/test-audio.wav`.

**Usage:**
```bash
python example_stt_sync.py
# or
python example_stt_sync.py [path/to/audio.wav]
```

**Output:** Transcript and optional word timestamps printed to the console.

### 2. `example_stt_websocket.py` - WebSocket from WAV — non–raw-PCM input

Real-time transcription over WebSocket. Reads a WAV file, extracts LINEAR16 PCM, and streams it. Same flow and settings as the JS example (grace close, lastPartial). Default input: `tests-data/audio/test-audio.wav`.

**Usage:**
```bash
python example_stt_websocket.py
# or
python example_stt_websocket.py [path/to/audio.wav]
```

**Output:** [interim] and [FINAL] segments, then full transcript.

### 3. `example_stt_websocket_pcm.py` - WebSocket from raw PCM

Same WebSocket API, but input is a **raw LINEAR16 PCM file** (no WAV header). Default input: `tests-data/audio/test-pcm-audio.pcm`.

**Usage:**
```bash
python example_stt_websocket_pcm.py
# or
python example_stt_websocket_pcm.py [pcm.raw] [sample_rate] [channels]
```
Defaults: `tests-data/audio/test-pcm-audio.pcm`, `sample_rate` 16000, `channels` 1.

**Output:** Same as WebSocket (WAV): [interim], [FINAL], then full transcript.

### 4. `example_stt_mic.py` - Real-time from microphone

Real-time transcription from the microphone. Captures live audio (via sounddevice) and streams to the STT WebSocket. Requires `pip install sounddevice`. Press Ctrl+C to stop.

**Usage:**
```bash
python example_stt_mic.py
```

**Output:** [interim] and [FINAL] segments in real time, then full transcript on exit.

## Configuration

- **Sync:** Same as JS: `groq/whisper-large-v3-turbo`, optional `language`, `includeWordTimestamps`, `prompts`.
- **WebSocket:** Same as JS: `assemblyai/universal-streaming-english`; audio sent as `LINEAR16`. WAV example reads sample rate/channels from file; PCM example requires them as arguments.

## API Endpoints

- **Sync:** `https://api.inworld.ai/stt/v1/transcribe`
- **WebSocket:** `wss://api.inworld.ai/stt/v1/transcribe:streamBidirectional`
