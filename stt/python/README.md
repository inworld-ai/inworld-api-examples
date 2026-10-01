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

### 6. `example_stt_async_file.py` - Asynchronous transcription, whole file in the request

Submits a recording as a job, polls until it finishes, and downloads the transcript. For recordings too long to wait on: meetings, interviews, podcasts. The whole file goes in the request, base64-encoded, which is the simplest handover and the right one for a small file. Default input: `tests-data/audio/test-audio.wav`.

**Usage:**
```bash
python example_stt_async_file.py
# or
python example_stt_async_file.py [path/to/audio.wav]
```

**Output:** The job name while it runs, then the transcript, its segments and the billed audio duration.

### 7. `example_stt_async_stream.py` - Asynchronous transcription, streamed upload

Same job, but the recording is streamed as a `multipart/form-data` upload, read from disk a block at a time. Use it for large files: memory stays flat however long the recording is, and it avoids the third that base64 adds to a request. Default input: `tests-data/audio/test-audio.wav`.

**Usage:**
```bash
python example_stt_async_stream.py
# or
python example_stt_async_stream.py [path/to/audio.wav]
```

**Output:** Same as `example_stt_async_file.py`.

### 8. `example_stt_async_uri.py` - Asynchronous transcription, audio named by URL

Same job, but no audio is sent: the service is given a URL and fetches the recording itself. The cheapest handover when the audio already lives somewhere reachable, such as cloud storage. The URL must be `https`, must serve the audio directly, and must be reachable without your Inworld credentials — redirects are refused. Default input: a public Google Cloud Storage sample.

**Usage:**
```bash
python example_stt_async_uri.py
# or
python example_stt_async_uri.py [https://host/path/audio.wav]
```

**Output:** Same as `example_stt_async_file.py`.

## Configuration

- **Sync:** Uses `groq/whisper-large-v3`; see [API reference](https://docs.inworld.ai/api-reference/sttAPI/speechtotext/transcribe) for the full request body.
- **WebSocket (file or mic):** Uses STT WebSocket with LINEAR16, 16 kHz, 1 channel. Default model is `inworld/inworld-stt-1`; see [STT overview](https://docs.inworld.ai/stt/overview) for all supported models and the [API reference](https://docs.inworld.ai/api-reference/sttAPI/speechtotext/transcribe-stream-websocket) for the full request body.
- **Async:** Uses `inworld/inworld-stt-1`. Every audio encoding is accepted, including the compressed formats streaming rejects (MP3, FLAC, OGG_OPUS), because the audio is a stored file rather than a live stream. See [Async transcription](https://docs.inworld.ai/stt/async-transcription).

## API Endpoints

- **Sync:** `https://api.inworld.ai/stt/v1/transcribe`
- **WebSocket:** `wss://api.inworld.ai/stt/v1/transcribe:streamBidirectional`
- **Async submit:** `https://api.inworld.ai/stt/v1/transcribe:async`
- **Async poll:** `https://api.inworld.ai/lro/v1alpha/{operation name}`
