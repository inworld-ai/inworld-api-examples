# Twilio ConversationRelay + Inworld LLM + TTS

Twilio ConversationRelay voice bot powered by Inworld's combined LLM+TTS endpoint. Twilio handles STT (Deepgram); this server handles LLM and TTS via Inworld, sending audio back as `play` messages.

## Architecture

```
Caller <-> Twilio ConversationRelay <-> This Server <-> Inworld Router API
           (STT: Deepgram)              (LLM + TTS)    POST /v1/chat/completions
                                        play messages    (stream w/ audio param)
                                        with audio URLs
```

## File structure

```
src/
  index.ts                       # Express + WebSocket server + GET /audio/:id
  config.ts                      # Env vars (ttsVoice, ttsModel, etc.)
  server/twiml.ts                # POST /voice -> TwiML (no ttsProvider/voice)
  conversation/
    session-handler.ts           # ConversationRelay WebSocket handler
    inworld-llm.ts               # Inworld Router streaming client (LLM+TTS combined)
    audio-store.ts               # In-memory audio store + WAV wrapping
```

## Running

```bash
cp .env.example .env   # fill in credentials
npm install
npm run dev            # starts on PORT (default 3000)
```

In a separate terminal:
```bash
ngrok http 3000 --url=<your-ngrok-domain>
```

## Twilio configuration

1. Go to https://console.twilio.com -> Phone Numbers -> your number
2. Under Voice Configuration, set "A call comes in" webhook to:
   `https://<your-ngrok-domain>/voice` (HTTP POST)
3. Call the number

## Env vars

- `INWORLD_API_KEY` -- Inworld API key (Basic auth for Router API)
- `SERVER_URL` -- your public ngrok URL (e.g. `https://example.ngrok-free.app`)
- `PORT` -- server port (default 3000)
- `SYSTEM_PROMPT` -- system instructions for the voice assistant
- `INWORLD_MODEL` -- model or router name (default: `openai/gpt-4.1-mini`)
- `TTS_VOICE` -- Inworld TTS voice name (default: `Clive`)
- `TTS_MODEL` -- Inworld TTS model (default: `inworld-tts-1.5-max`)
- `TRANSCRIPTION_PROVIDER` -- STT provider (default: `Deepgram`)
- `WELCOME_GREETING` -- greeting spoken when the call connects

## Key details

- TTS is handled server-side via Inworld (not Twilio's built-in TTS)
- Combined LLM+TTS: single streaming request returns text + audio
- Audio segments (PCM 48kHz 16-bit mono) are wrapped as WAV and served via GET /audio/:id
- ConversationRelay `play` messages point to audio URLs on this server
- TwiML does NOT set ttsProvider, voice, or welcomeGreeting (we handle all of that)
- Streaming: audio segments arrive at sentence boundaries for low-latency playback
- Interruption: AbortController cancels in-flight streams when caller barges in
- Multi-turn: conversation history maintained per WebSocket session

## ConversationRelay protocol

Incoming messages: `setup`, `prompt`, `interrupt`, `dtmf`, `error`
Outgoing messages: `play` (with audio URL)
