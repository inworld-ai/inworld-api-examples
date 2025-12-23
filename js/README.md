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

3. **Set your workspace ID (required for voice cloning):**
   ```bash
   export INWORLD_WORKSPACE=your_workspace_id
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

Demonstrates how to synthesize speech from long text that exceeds the API's 2000 character limit by chunking at sentence boundaries and stitching audio together.

**Features:**
- Automatically chunks text at sentence boundaries (after ~1000 chars)
- Parallel synthesis of all chunks using `Promise.all`
- Stitches audio chunks into a single output file
- Reports splice timestamps for quality verification

**Usage:**
```bash
npm run tts-long
# or
node example_tts_long_input.js
```

**Output:** `synthesis_long_output.wav`

**Input:** Reads from `../tests-data/text/chapter1.txt` (configurable in code)

### 3. Streaming TTS Synthesis (`example_tts_stream.js`)

Demonstrates streaming text-to-speech synthesis for real-time audio generation.

**Usage:**
```bash
npm run tts-stream
# or
node example_tts_stream.js
```

**Output:** `synthesis_stream_output.wav`

### 4. WebSocket TTS Synthesis (`example_websocket.js`)

Demonstrates WebSocket-based TTS synthesis with context management.


**Usage:**
```bash
npm run tts-websocket
# or
node example_websocket.js
```

**Output:** `synthesis_websocket_output.wav`

### 5. Voice Cloning (`example_voice_clone.js`)

Demonstrates how to clone a voice using audio samples via the Inworld Voice API.

**Usage:**
```bash
npm run voice-clone
# or
node example_voice_clone.js --name "My Voice" --audio sample.wav
```

**Options:**
| Option | Description |
|--------|-------------|
| `-n, --name <name>` | Display name for the cloned voice (default: "Cloned Voice Demo") |
| `-a, --audio <files...>` | Path(s) to audio file(s) for cloning (WAV or MP3) |
| `-l, --lang <code>` | Language code (default: EN_US) |
| `-d, --description <text>` | Description of the voice |
| `-t, --tags <tags...>` | Tags for the voice (space-separated) |
| `--transcription <text...>` | Transcription(s) for audio file(s) |
| `--remove-noise` | Enable background noise removal |
| `-h, --help` | Show help message |

**Supported Languages:**
`EN_US`, `ZH_CN`, `KO_KR`, `JA_JP`, `RU_RU`, `AUTO`, `IT_IT`, `ES_ES`, `PT_BR`, `DE_DE`, `FR_FR`, `AR_SA`, `PL_PL`, `NL_NL`

**Example with multiple options:**
```bash
node example_voice_clone.js \
  --name "British Voice" \
  --audio sample1.wav sample2.wav \
  --lang EN_US \
  --description "A warm British accent" \
  --tags british warm \
  --remove-noise
```

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
- **Voice Cloning:** `https://api.inworld.ai/voices/v1/workspaces/{workspace}/voices:clone`

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
