# Inworld AI Text-to-Speech Python Examples

This directory contains Python examples demonstrating how to use the Inworld AI Text-to-Speech (TTS) API with different approaches and protocols.

## Prerequisites

- Python 3.7 or higher
- Inworld AI API key

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
   Or via shell export:
   ```bash
   export INWORLD_API_KEY=your_api_key_here
   ```

3. **Run an example:**
   ```bash
   python example_tts.py
   ```

## Available Examples

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

### 2. `example_tts_long_input.py` - Long Text Synthesis
Synthesizes long text by chunking at natural boundaries. Outputs WAV with splice point timestamps and customizable silence between chunks for quality control.

**Usage:**
```bash
python example_tts_long_input.py
```

---

### 3. `example_tts_long_input_compressed.py` - Long Text Synthesis (MP3)
Same chunking as above but outputs MP3 for smaller file sizes. No splice point reporting.

**Usage:**
```bash
python example_tts_long_input_compressed.py
```

---

### 4. `example_tts_stream.py` - HTTP Streaming Synthesis
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

**Output:** `synthesis_stream_output.mp3`

**Best for:** Applications requiring lower latency and real-time audio processing.

---

### 5. `example_tts_timestamps.py` - Synthesis with Timestamps
**Purpose:** TTS synthesis with word-level timestamps, phoneme data, and viseme data.

**Features:**
- Word timing information (start/end times)
- Phoneme-level breakdown for each word
- Viseme data for lip-sync applications
- Full response logging for debugging

**Usage:**
```bash
python example_tts_timestamps.py
```

**Best for:** Lip-sync, animation, karaoke-style applications, or debugging TTS output.

---

### 6. `example_tts_stream_timestamps.py` - Streaming with Timestamps
**Purpose:** Streaming TTS synthesis with timestamp, phoneme, and viseme data.

**Features:**
- Combines streaming audio with timestamp data
- Real-time audio chunks
- Word/phoneme/viseme breakdown after stream completes

**Usage:**
```bash
python example_tts_stream_timestamps.py
```

**Output:** `synthesis_stream_timestamps_output.mp3`

**Best for:** Real-time applications needing both low latency and timing data.

---

### 7. `example_tts_low_latency_http.py` - Low-Latency HTTP Streaming
**Purpose:** Achieve the lowest TTFB with HTTP streaming using connection warmup.

**Features:**
- Persistent session to pre-establish TCP+TLS before timing
- Measures TTFB and total synthesis time on a warm connection
- Reports latency in milliseconds

**Usage:**
```bash
python example_tts_low_latency_http.py
```

**Best for:** Low-latency HTTP integration, benchmarking streaming TTFB.

---

### 8. `example_tts_low_latency_ws.py` - Low-Latency WebSocket
**Purpose:** Achieve the lowest TTFB with WebSocket using context pre-creation.

**Features:**
- Pre-establishes WebSocket connection and audio context before timing
- Measures TTFB from text submission to first audio chunk only
- Sends text with flush and close for immediate synthesis

**Usage:**
```bash
python example_tts_low_latency_ws.py
```

**Best for:** Low-latency WebSocket integration, real-time voice applications.

---

### 9. `tts_cli.py` - Command Line Interface
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
python tts_cli.py --output-file output.wav --text "Hello world"

# Streaming synthesis with timestamp alignment
python tts_cli.py --output-file output.wav --text "Hello world" --stream --timestamp word

# Custom temperature and text normalization
python tts_cli.py --output-file output.wav --temperature 0.8 --text-normalization off

# Batch testing with JSON samples
python tts_cli.py --json-example ../tests-data/tts/tts_marketing_samples.json

# Batch testing with streaming and character-level timestamps
python tts_cli.py --json-example ../tests-data/tts/tts_marketing_samples.json --stream --timestamp character

# Custom voice and model with all options
python tts_cli.py --output-file output.wav --voice-id Dennis --model-id inworld-tts-1.5-max --temperature 1.2 --timestamp word --text-normalization on
```

**Best for:** Testing, development, batch processing, and performance analysis.

---

### 10. `example_voice_clone.py` - Voice Cloning
**Purpose:** Clone a voice using audio samples via the Inworld Voice API.

**Features:**
- Clone voices from WAV or MP3 audio samples
- Support for multiple audio samples and optional transcriptions
- Background noise removal and tag/description support
- Returns voice details and validated sample info

**Usage:**
```bash
python example_voice_clone.py
```

**Best for:** Creating custom voices from existing voice recordings.

---

### 11. `example_voice_design_publish.py` - Voice Design & Publish
**Purpose:** Design a voice from a text description (no audio required), then optionally publish a preview to your library.

**Features:**
- No audio files required; uses a text description and preview script
- Voice description 30–250 characters; script 50–200 chars recommended
- Saves preview audio to `design_preview_1.wav` (etc.) and opens for playback
- Interactive prompt to publish (Y or n) with optional display name, description, tags

**Usage:**
```bash
python example_voice_design_publish.py
```

**Best for:** Creating custom voices without audio samples; use Publish Voice to save a preview to your library.


## Configuration Options

All examples support the following configuration through code modification:

- **Voice ID:** Choose from available voices (default: "Dennis")
- **Model ID:** TTS model to use (default: "inworld-tts-1.5-max")
- **Audio Format:** LINEAR16, 48kHz for non-streaming; streaming examples (`example_tts_stream.py`, `example_tts_stream_timestamps.py`) use MP3
- **Output File:** Customize output filename and location
- **Temperature:** Control voice variation (0.0-1.0)
- **Timestamps:** Get word-level timing information
- **Text Normalization:** Control how text is processed
- **Batch Processing:** Process multiple texts from JSON files


## Sample JSON Format

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

## API docs

- **HTTP Basic:** `https://docs.inworld.ai/api-reference/ttsAPI/texttospeech/synthesize-speech`
- **HTTP Streaming:** `https://docs.inworld.ai/api-reference/ttsAPI/texttospeech/synthesize-speech-stream`
- **WebSocket:** `https://docs.inworld.ai/api-reference/ttsAPI/texttospeech/synthesize-speech-websocket`



## License

These examples are provided as-is for demonstration purposes. Please refer to Inworld AI's terms of service for API usage guidelines.
