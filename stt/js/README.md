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

### 3. Streaming with VAD config (`example_stt_with_vad_config.js`)

Same as `example_stt_websocket.js` but demonstrates how to configure VAD (Voice Activity Detection) parameters for the `inworld/inworld-stt-1` model: `vadThreshold`, `minEndOfTurnSilenceWhenConfident`, and `endOfTurnConfidenceThreshold`.

**Usage:**
```bash
npm run stt-vad-config
# or
node example_stt_with_vad_config.js [pcm_file]
```

**Output:** [interim] and [FINAL] segments with custom VAD configuration, then full transcript.

### 4. Streaming with voice profile detection (`example_stt_with_voice_profile.js`)

Same as `example_stt_websocket.js` but demonstrates how to enable voice profile detection, which returns speaker voice characteristics (age, gender, emotion, vocal style, accent) alongside transcription results. Configures `voiceProfileConfig` with `enableVoiceProfile` and `topN` parameters.

**Usage:**
```bash
npm run stt-voice-profile
# or
node example_stt_with_voice_profile.js [pcm_file]
```

**Output:** [interim] and [FINAL] segments with voice profile analysis on final segments, then full transcript.

### 5. Real-time from microphone (`example_stt_mic.js`)

Real-time transcription from the microphone. Captures live audio (via SoX) and sends it over the STT WebSocket. Requires SoX installed (e.g. `brew install sox` on macOS). Press Ctrl+C to stop.

**Usage:**
```bash
npm run stt-mic
# or
node example_stt_mic.js
```

**Output:** [interim] and [FINAL] segments in real time, then full transcript on exit.

### 6. Asynchronous transcription, whole file in the request (`example_stt_async_file.js`)

Submits a recording as a job, polls until it finishes, and downloads the transcript. For recordings too long to wait on: meetings, interviews, podcasts. The whole file goes in the request, base64-encoded, which is the simplest handover and the right one for a small file. Default input: `../tests-data/audio/test-audio.wav`.

**Usage:**
```bash
npm run stt-async-file
# or
node example_stt_async_file.js [path/to/audio.wav]
```

**Output:** The job name while it runs, then the transcript, its segments and the billed audio duration.

### 7. Asynchronous transcription, streamed upload (`example_stt_async_stream.js`)

Same job, but the recording is streamed as a `multipart/form-data` upload, read from disk a block at a time. Use it for large files: memory stays flat however long the recording is, and it avoids the third that base64 adds to a request. Default input: `../tests-data/audio/test-audio.wav`.

**Usage:**
```bash
npm run stt-async-stream
# or
node example_stt_async_stream.js [path/to/audio.wav]
```

**Output:** Same as `example_stt_async_file.js`.

### 8. Asynchronous transcription, audio named by URL (`example_stt_async_uri.js`)

Same job, but no audio is sent: the service is given a URL and fetches the recording itself. The cheapest handover when the audio already lives somewhere reachable, such as cloud storage. The URL must be `https`, must serve the audio directly, and must be reachable without your Inworld credentials — redirects are refused. Default input: a public Google Cloud Storage sample.

**Usage:**
```bash
npm run stt-async-uri
# or
node example_stt_async_uri.js [https://host/path/audio.wav]
```

**Output:** Same as `example_stt_async_file.js`.

## Configuration

- **Sync:** Uses `groq/whisper-large-v3`; see [API reference](https://docs.inworld.ai/api-reference/sttAPI/speechtotext/transcribe) for the full request body.
- **WebSocket (file or mic):** Uses STT WebSocket with LINEAR16, 16 kHz, 1 channel. Default model is `inworld/inworld-stt-1`; see [STT overview](https://docs.inworld.ai/stt/overview) for all supported models and the [API reference](https://docs.inworld.ai/api-reference/sttAPI/speechtotext/transcribe-stream-websocket) for the full request body.
- **Async:** Uses `inworld/inworld-stt-1`. Every audio encoding is accepted, including the compressed formats streaming rejects (MP3, FLAC, OGG_OPUS), because the audio is a stored file rather than a live stream. See [Async transcription](https://docs.inworld.ai/stt/async-transcription).

## API Endpoints

- **Sync:** `https://api.inworld.ai/stt/v1/transcribe`
- **WebSocket:** `wss://api.inworld.ai/stt/v1/transcribe:streamBidirectional`
- **Async submit:** `https://api.inworld.ai/stt/v1/transcribe:async`
- **Async poll:** `https://api.inworld.ai/lro/v1alpha/{operation name}`
