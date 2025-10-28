# TTS Model Comparison

Real-time latency comparison tool for streaming text-to-speech services.

## Purpose

Compares TTS models by visualizing their streaming performance, measuring first phoneme latency using voice activity detection and determining the fastest provider for a given text input.

## Supported Services

- Cartesia Sonic-2
- ElevenLabs Multilingual
- Hume
- Inworld (Standard, Max)

## Setup

1. Install dependencies:
```bash
npm install
```

If you don't have FFMPEG, install it (`brew install ffmpeg` on Mac)

2. Create `.env` file with API keys (use .env.sample as a template)

3. Start server:
```bash
npm start
```

4. Open `http://localhost:3000`

## Configuration

### Environment Variables

- `SAVE_AUDIO`: Set to `true` to save audio files after processing for analysis, `false` to delete them (default: `false`)
- `PORT`: Server port (optional - default: `3000`)
- API Keys: API keys for TTS services (optional aside from Inworld)
- Voice IDs: Voice IDs for each provider (optional - will use default voice if not specified)

## Usage

Enter text, click "Generate Speech", and compare real-time latency metrics across all TTS providers.

Audio files are saved to the `audio/` directory. When `SAVE_AUDIO=true`, files are preserved for analysis with naming pattern: `{sessionId}_{model}_{complete|first_chunk}.mp3`.
