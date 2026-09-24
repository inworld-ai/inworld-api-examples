# Twilio + Inworld Realtime Voice Agent

A voice agent that connects phone calls to the [Inworld Realtime API](https://docs.inworld.ai/realtime/overview) for speech-to-speech conversations. One WebSocket to Inworld handles STT + LLM + TTS.

```
Caller ↔ Twilio ↔ WebSocket ↔ Inworld Realtime
              mulaw 8kHz (passthrough)
```

## Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [ngrok](https://ngrok.com/) account (free tier works; it includes one static dev domain)
- [Twilio](https://www.twilio.com/) account with a phone number
- [Inworld](https://www.inworld.ai/) account

## Setup

1. **Get your Inworld API key** — in the [Inworld Portal](https://portal.inworld.ai/), open your workspace and create an API key. Choose type **Realtime-only** (this example only calls the Realtime API), then copy the **Base64** credential; it is sent as `Authorization: Basic <key>`.

2. **Get a Twilio phone number** — sign up at [twilio.com](https://www.twilio.com/) and buy a phone number with Voice capability.

3. **Set up ngrok** — [install ngrok](https://ngrok.com/download) (for example `brew install ngrok`), then add your [authtoken](https://dashboard.ngrok.com/get-started/your-authtoken):
   ```bash
   ngrok config add-authtoken <your-authtoken>
   ```
   Free accounts get one static **dev domain**, listed under [Domains](https://dashboard.ngrok.com/domains) (for example `your-name.ngrok-free.dev`). Use it so the Twilio webhook URL stays the same between restarts.

4. **Configure environment:**
   ```bash
   cp .env.example .env
   # Fill in INWORLD_API_KEY and SERVER_URL=https://<your-ngrok-domain> (no trailing /voice)
   ```

5. **(Optional) Choose a different LLM** — by default the example uses DeepSeek V4.1 Flash hosted by Inworld (`inworld/models/deepseek-v4.1-flash`). To change it, set `LLM_MODEL` in `.env` to another model from the [Inworld models list](https://inworld.ai/models) (Inworld-hosted models use `inworld/models/<model>`; third-party models use `provider/model`, for example `openai/gpt-4.1-mini`). For fallbacks or A/B tests, create a [router](https://docs.inworld.ai/router/introduction) in the [Inworld Portal](https://portal.inworld.ai) and set `LLM_MODEL=inworld/<your-router-id>`; leave the router's prompt template and model settings empty, since the system prompt comes from `SYSTEM_PROMPT`.

6. **Install dependencies:**
   ```bash
   npm install
   ```

7. **Configure Twilio webhook** — in the [Twilio Console](https://console.twilio.com/), open **Phone Numbers → Manage → Active numbers** and select your number. Under **Configuration details → Voice and emergency address**, click **Edit configuration details**. In **Handling for incoming calls**, set the primary method to **Webhook**, the URL to `https://<your-ngrok-domain>/voice`, and the HTTP format to **POST**, then save.

## Run

In two terminals:

```bash
ngrok http 3000 --url=<your-ngrok-domain>
```

```bash
npm run dev
```

Call your Twilio number — the bot will greet you and you can have a conversation. Watch the server output to follow each turn (see [Logs](#logs)).

## How it works

1. Inbound call hits `/voice` → returns TwiML with `<Connect><Stream>`
2. Twilio opens a Media Stream WebSocket to `/media-stream`
3. Server passes mulaw audio between Twilio and Inworld (no format conversion needed)
4. Inworld transcribes the caller with Inworld STT (`inworld/inworld-stt-1`), detects end of turn with semantic VAD (`eagerness: "medium"`), and responds using the LLM set by `LLM_MODEL` (default: DeepSeek V4.1 Flash hosted by Inworld, `inworld/models/deepseek-v4.1-flash`) and Inworld TTS (`inworld-tts-2`)
5. Barge-in: on speech detection, the server clears Twilio's playback buffer. Inworld cancels the in-flight response itself because the session sets `interrupt_response: true`

## Logs

Each turn is logged so you can follow the conversation and see where latency comes from:

```
[latency] Turn end detected: +1314ms after caller stopped talking
[call] User: What's the weather in Seattle?
[latency] Response <id> created: +1316ms after caller stopped talking
[latency] First bot audio: +2378ms after caller stopped talking
[call] Bot (completed, 10760ms audio, response <id>): ...
[call] Caller interrupted the bot, clearing ~7196ms of unplayed audio
```

- Times are measured from the last inbound audio chunk that contained caller voice, not from Inworld's `speech_stopped` event, which fires only once turn detection commits the turn.
- `Turn end detected` is the time turn detection took. The gap between that and `First bot audio` is LLM + TTS time.
- `Bot (cancelled, ...)` means the response was interrupted, usually because the caller kept talking after a mid-sentence pause.
- Latency is measured at the server and does not include the phone network in either direction.
