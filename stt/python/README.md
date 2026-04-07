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

### 2. `example_stt_websocket.py` - Streaming: transcribe from PCM file

Sends raw LINEAR16 PCM from a file over the STT WebSocket. Audio must be 16 kHz, 1 channel. Default input: `tests-data/audio/test-pcm-audio.pcm`.

**Usage:**
```bash
python example_stt_websocket.py
# or
python example_stt_websocket.py [pcm_file]
```

**Output:** [interim] and [FINAL] segments, then full transcript. Ensures all segments (including the last word) are received before closing the stream.

### 3. `example_stt_with_vad_config.py` - Streaming with VAD config

Same as `example_stt_websocket.py` but demonstrates how to configure VAD (Voice Activity Detection) parameters for the `inworld/inworld-stt-1` model: `vad_threshold`, `min_end_of_turn_silence_when_confident`, and `end_of_turn_confidence_threshold`.

**Usage:**
```bash
python example_stt_with_vad_config.py
# or
python example_stt_with_vad_config.py [pcm_file]
```

**Output:** [interim] and [FINAL] segments with custom VAD configuration, then full transcript.

### 4. `example_stt_with_voice_profile.py` - Streaming with voice profile detection

Same as `example_stt_websocket.py` but demonstrates how to enable voice profile detection, which returns speaker voice characteristics (age, gender, emotion, vocal style, accent) alongside transcription results. Configures `voiceProfileConfig` with `enableVoiceProfile` and `topN` parameters.

**Usage:**
```bash
python example_stt_with_voice_profile.py
# or
python example_stt_with_voice_profile.py [pcm_file]
```

**Output:** [interim] and [FINAL] segments with voice profile analysis on final segments, then full transcript.

### 5. `example_stt_mic.py` - Real-time from microphone

Real-time transcription from the microphone. Captures live audio (via sounddevice) and sends it over the STT WebSocket. Requires `pip install sounddevice`. Press Ctrl+C to stop.

**Usage:**
```bash
python example_stt_mic.py
```

**Output:** [interim] and [FINAL] segments in real time, then full transcript on exit.

## Configuration

- **Sync:** Uses `groq/whisper-large-v3`; see [API reference](https://docs.inworld.ai/api-reference/sttAPI/speechtotext/transcribe) for the full request body.
- **WebSocket (file or mic):** Uses STT WebSocket with LINEAR16, 16 kHz, 1 channel. Default model is `inworld/inworld-stt-1`; see [STT overview](https://docs.inworld.ai/stt/overview) for all supported models and the [API reference](https://docs.inworld.ai/api-reference/sttAPI/speechtotext/transcribe-stream-websocket) for the full request body.

## API Endpoints

- **Sync:** `https://api.inworld.ai/stt/v1/transcribe`
- **WebSocket:** `wss://api.inworld.ai/stt/v1/transcribe:streamBidirectional`
