# Inworld TTS API Examples - JavaScript/Node.js

This directory contains JavaScript/Node.js examples demonstrating how to use the Inworld Text-to-Speech (TTS) and Voice APIs.

## Prerequisites

- Node.js 18.0.0 or higher (recommended: 24.7.0 as specified in `.tool-versions`)
- npm or yarn package manager
- Inworld API key

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set your API key:**
   ```bash
   export INWORLD_API_KEY=your_api_key_here
   ```

## Examples

### 1. Basic TTS Synthesis (`example_tts.js`)

Demonstrates synchronous text-to-speech synthesis using HTTP requests.

**Usage:**
```bash
npm run tts
# or
node example_tts.js
```

**Output:** `synthesis_output.wav`

### 2. Long Text TTS Synthesis (`example_tts_long_input.js`)

Synthesizes long text by chunking at natural boundaries. Outputs WAV with splice point timestamps and customizable silence between chunks for quality control.

**Usage:**
```bash
npm run tts-long
# or
node example_tts_long_input.js
```

**Output:** `synthesis_long_output.wav`

### 3. Long Text TTS Synthesis - Compressed (`example_tts_long_input_compressed.js`)

Same chunking as above but outputs MP3 for smaller file sizes. No splice point reporting.

**Usage:**
```bash
node example_tts_long_input_compressed.js
```

**Output:** `synthesis_long_output.mp3`

### 4. Streaming TTS Synthesis (`example_tts_stream.js`)

Demonstrates streaming text-to-speech synthesis for real-time audio generation.

**Usage:**
```bash
npm run tts-stream
# or
node example_tts_stream.js
```

**Output:** `synthesis_stream_output.mp3`

### 5. TTS with Timestamps (`example_tts_timestamps.js`)

Demonstrates text-to-speech synthesis with word-level timestamps, phoneme data, and viseme data for lip-sync applications.

**Usage:**
```bash
node example_tts_timestamps.js
```

**Output:** `synthesis_timestamps_output.wav`

**Response includes:**
- Word-level timing (start/end times for each word)
- Phoneme data with timing
- Viseme symbols for lip-sync animation

### 6. Streaming TTS with Timestamps (`example_tts_stream_timestamps.js`)

Demonstrates streaming text-to-speech synthesis with word-level timestamps accumulated across chunks.

**Usage:**
```bash
node example_tts_stream_timestamps.js
```

**Output:** `synthesis_stream_timestamps_output.mp3`

### 7. Low-Latency HTTP Streaming (`example_tts_low_latency_http.js`)

Achieves the lowest TTFB with HTTP streaming by warming up the TCP+TLS connection before timing synthesis.

**Usage:**
```bash
npm run tts-low-latency-http
# or
node example_tts_low_latency_http.js
```

**Output:** TTFB (ms), total time (ms), and audio bytes.

### 8. Low-Latency WebSocket (`example_tts_low_latency_ws.js`)

Achieves the lowest TTFB with WebSocket by pre-establishing the connection and audio context before timing synthesis.

**Usage:**
```bash
npm run tts-low-latency-ws
# or
node example_tts_low_latency_ws.js
```

**Output:** TTFB (ms), total time (ms), and audio bytes.

## Configuration

All examples use the following default configuration:

```javascript
const config = {
    text: "Hello, adventurer! What a beautiful day, isn't it?",
    voiceId: "Dennis", // or "Ashley" for WebSocket example
    modelId: "inworld-tts-1.5-max", // timestamp examples use "inworld-tts-1.5-max"
    audioConfig: {
        audioEncoding: "LINEAR16",  // use "MP3" for streaming examples (example_tts_stream.js, example_tts_stream_timestamps.js)
        sampleRateHertz: 48000
    },
    timestamp_type: "WORD" // optional: enables word timestamps, phonemes, and visemes
};
```

You can modify these values in each example file to test different voices, models, or text content.

## API Endpoints

- **Basic TTS:** `https://api.inworld.ai/tts/v1/voice`
- **Streaming TTS:** `https://api.inworld.ai/tts/v1/voice:stream`
- **WebSocket TTS:** `wss://api.inworld.ai/tts/v1/voice:streamBidirectional`

## Audio Output

- **Streaming examples** (`example_tts_stream.js`, `example_tts_stream_timestamps.js`): Output **MP3** (as configured by `audio_encoding: 'MP3'`).
- **Other examples:** Generate WAV with:
  - **Format:** WAV (RIFF)
  - **Encoding:** LINEAR16 (PCM)
  - **Sample Rate:** 48,000 Hz
  - **Channels:** 1 (Mono)
  - **Bit Depth:** 16-bit

## Error Handling

Each example includes comprehensive error handling for:
- Missing API keys
- Network connectivity issues
- API response errors
- File I/O operations
- WebSocket connection problems

## Performance Metrics

The examples provide timing information:
- **Connection time** (WebSocket only)
- **Time to first audio chunk**
- **Total synthesis time**
- **Audio chunk statistics**

## Dependencies

- **ws** (^8.14.0): WebSocket client for real-time streaming


## Support

For issues and questions:
- Check the [Inworld AI Documentation](https://docs.inworld.ai/)
- Review the API reference for TTS endpoints
- Examine the error messages and response details provided by each example
