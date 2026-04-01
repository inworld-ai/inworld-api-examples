# Twilio + Inworld Realtime Voice Bot

A voice bot that connects phone calls to the [Inworld Realtime API](https://docs.inworld.ai/realtime/overview) for speech-to-speech conversations. One WebSocket to Inworld handles STT + LLM + TTS.

```
Caller ↔ Twilio ↔ WebSocket ↔ Inworld Realtime
         mulaw 8kHz           PCM16 24kHz
```

## Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [ngrok](https://ngrok.com/) account (free tier works)
- [Twilio](https://www.twilio.com/) account with a phone number
- [Inworld](https://www.inworld.ai/) account with a Realtime API key

## Setup

1. **Get your Inworld API key** — sign up at [inworld.ai](https://www.inworld.ai/), go to your workspace, and create an API key for the Realtime API.

2. **Get your Twilio credentials** — from the [Twilio Console](https://console.twilio.com/), grab your Account SID, Auth Token, and phone number.

3. **Set up ngrok** — [install ngrok](https://ngrok.com/download), then reserve a free static domain in the [ngrok dashboard](https://dashboard.ngrok.com/domains).

4. **Configure environment:**
   ```bash
   cp .env.example .env
   # Fill in INWORLD_API_KEY, TWILIO_* credentials, and SERVER_URL (your ngrok URL)
   ```

5. **Install dependencies:**
   ```bash
   npm install
   ```

6. **Configure Twilio webhook** — in the [Twilio Console](https://console.twilio.com/) → Phone Numbers → your number → Voice Configuration, set "A call comes in" to `https://<your-ngrok-domain>/voice` (HTTP POST).

## Run

In two terminals:

```bash
ngrok http 3000 --url=<your-ngrok-domain>
```

```bash
npm run dev
```

Call your Twilio number — the bot will greet you and you can have a conversation.

## How it works

1. Inbound call hits `/voice` → returns TwiML with `<Connect><Stream>`
2. Twilio opens a Media Stream WebSocket to `/media-stream`
3. Server bridges audio between Twilio and Inworld, resampling both directions
4. Barge-in: on speech detection, clears Twilio buffer and cancels Inworld response
