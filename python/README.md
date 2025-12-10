# Inworld AI Text-to-Speech Python Examples

This directory contains Python examples demonstrating how to use the Inworld AI Text-to-Speech (TTS) API with different approaches and protocols.

## 📋 Prerequisites

- Python 3.7 or higher
- Inworld AI API key

## 🚀 Quick Start

1. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

2. **Set your API key:**
   ```bash
   export INWORLD_API_KEY=your_api_key_here
   ```

3. **Run an example:**
   ```bash
   python example_tts.py
   ```

## 📁 Available Examples

### 1. `example_tts.py` - Basic HTTP Synthesis
**Purpose:** Simple synchronous TTS synthesis using HTTP requests.

**Features:**
- Single HTTP request/response
- Complete audio returned at once
- Basic error handling
- WAV file output

**Usage:**
```bash
python example_tts.py
```

**Best for:** Simple use cases where you need complete audio files.

---

### 2. `example_tts_stream.py` - HTTP Streaming Synthesis
**Purpose:** Streaming TTS synthesis using HTTP with chunked responses.

**Features:**
- Real-time audio chunk streaming
- Lower latency than basic synthesis
- Progress tracking (time to first chunk)
- Chunk-by-chunk processing

**Usage:**
```bash
python example_tts_stream.py
```

**Best for:** Applications requiring lower latency and real-time audio processing.

---

### 3. `example_websocket.py` - WebSocket Synthesis
**Purpose:** Real-time TTS synthesis using WebSocket connections.

**Features:**
- Persistent WebSocket connection
- Lowest latency streaming
- Real-time bidirectional communication
- Word-level timestamps support
- Automatic fallback for different websockets library versions

**Usage:**
```bash
python example_websocket.py
```

**Best for:** Interactive applications, real-time conversations, and applications requiring persistent connections.

---

### 4. `tts_cli.py` - Command Line Interface
**Purpose:** Comprehensive CLI tool for TTS testing and batch processing.

**Features:**
- Command-line interface with argparse
- Support for all synthesis methods (basic, streaming, WebSocket)
- Batch testing with JSON sample files
- Performance benchmarking
- Advanced configuration options (temperature, timestamps, normalization)
- Statistics and timing analysis

**Usage:**
```bash
# Basic synthesis
python tts_cli.py --text "Hello world" --voice Dennis

# Streaming synthesis
python tts_cli.py --text "Hello world" --voice Dennis --stream

# Batch testing
python tts_cli.py --batch ../tests-data/tts/tts_small_samples.json

# Advanced options
python tts_cli.py --text "Hello world" --voice Dennis --temperature 0.8 --timestamps --normalize
```

**Best for:** Testing, development, batch processing, and performance analysis.

---

### 5. `example_voice_clone.py` - Voice Cloning
**Purpose:** Clone a voice using audio samples via the Inworld Voice API.

**Features:**
- Clone voices from WAV or MP3 audio samples
- Support for multiple audio samples
- Optional transcriptions for better quality
- Background noise removal option
- Tag and description support

**Setup:**
```bash
export INWORLD_API_KEY=your_api_key_here
export INWORLD_WORKSPACE=your_workspace_id
```

**Usage:**
```bash
# Basic usage with default audio
python example_voice_clone.py --name "My Voice"

# With custom audio file
python example_voice_clone.py --name "My Voice" --audio sample.wav

# Advanced usage
python example_voice_clone.py \
  --name "British Voice" \
  --audio sample1.wav sample2.wav \
  --lang EN_US \
  --description "A warm British accent" \
  --tags british warm \
  --remove-noise
```

**Options:**
| Option | Description |
|--------|-------------|
| `--name <name>` | Display name for the cloned voice (default: "Cloned Voice Demo") |
| `--audio <files...>` | Path(s) to audio file(s) for cloning (WAV or MP3) |
| `--lang <code>` | Language code (default: EN_US) |
| `--description <text>` | Description of the voice |
| `--tags <tags...>` | Tags for the voice (space-separated) |
| `--transcription <text...>` | Transcription(s) for audio file(s) |
| `--remove-noise` | Enable background noise removal |

**Supported Languages:**
`EN_US`, `ZH_CN`, `KO_KR`, `JA_JP`, `RU_RU`, `AUTO`, `IT_IT`, `ES_ES`, `PT_BR`, `DE_DE`, `FR_FR`, `AR_SA`, `PL_PL`, `NL_NL`

**Best for:** Creating custom voices from voice recordings.

## 🔧 Configuration Options

All examples support the following configuration through code modification:

- **Voice ID:** Choose from available voices (default: "Dennis")
- **Model ID:** TTS model to use (default: "inworld-tts-1")
- **Audio Format:** LINEAR16, 48kHz (configurable in code)
- **Output File:** Customize output filename and location
- **Temperature:** Control voice variation (0.0-1.0)
- **Timestamps:** Get word-level timing information
- **Text Normalization:** Control how text is processed
- **Batch Processing:** Process multiple texts from JSON files


## 📝 Sample JSON Format

For batch testing with `tts_cli.py`, use this JSON format:

```json
{
  "samples": [
    {
      "text": "Hello, world!",
      "voice_id": "Dennis",
      "expected_duration": 2.0
    },
    {
      "text": "How are you today?",
      "voice_id": "Alice",
      "expected_duration": 3.0
    }
  ]
}
```

## 🌐 API docs

- **HTTP Basic:** `https://docs.inworld.ai/api-reference/ttsAPI/texttospeech/synthesize-speech`
- **HTTP Streaming:** `https://docs.inworld.ai/api-reference/ttsAPI/texttospeech/synthesize-speech-stream`
- **WebSocket:** `https://docs.inworld.ai/api-reference/ttsAPI/texttospeech/synthesize-speech-websocket`



## 📄 License

These examples are provided as-is for demonstration purposes. Please refer to Inworld AI's terms of service for API usage guidelines.
