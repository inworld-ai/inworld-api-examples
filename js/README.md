# Inworld TTS API Examples - JavaScript/Node.js

This directory contains JavaScript/Node.js examples demonstrating how to use the Inworld Text-to-Speech (TTS) API.

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

### 2. Streaming TTS Synthesis (`example_tts_stream.js`)

Demonstrates streaming text-to-speech synthesis for real-time audio generation.

**Usage:**
```bash
npm run tts-stream
# or
node example_tts_stream.js
```

**Output:** `synthesis_stream_output.wav`

### 3. WebSocket TTS Synthesis (`example_websocket.js`)

Demonstrates WebSocket-based TTS synthesis with context management.


**Usage:**
```bash
npm run tts-websocket
# or
node example_websocket.js
```

**Output:** `synthesis_websocket_output.wav`

## Configuration

All examples use the following default configuration:

```javascript
const config = {
    text: "Hello, adventurer! What a beautiful day, isn't it?",
    voiceId: "Dennis", // or "Ashley" for WebSocket example
    modelId: "inworld-tts-1",
    audioConfig: {
        audioEncoding: "LINEAR16",
        sampleRateHertz: 48000
    }
};
```

You can modify these values in each example file to test different voices, models, or text content.

## API Endpoints

- **Basic TTS:** `https://api.inworld.ai/tts/v1/voice`
- **Streaming TTS:** `https://api.inworld.ai/tts/v1/voice:stream`
- **WebSocket TTS:** `wss://api.inworld.ai/tts/v1/voice:streamBidirectional`

## Audio Output

All examples generate WAV files with the following specifications:
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

- **axios** (^1.6.0): HTTP client for REST API calls
- **ws** (^8.14.0): WebSocket client for real-time streaming


## Support

For issues and questions:
- Check the [Inworld AI Documentation](https://docs.inworld.ai/)
- Review the API reference for TTS endpoints
- Examine the error messages and response details provided by each example
