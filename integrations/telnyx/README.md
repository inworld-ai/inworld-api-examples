# Telnyx + Inworld Realtime Voice Agent

A voice agent that connects phone calls to the [Inworld Realtime API](https://docs.inworld.ai/realtime/overview) for speech-to-speech conversations. One WebSocket to Inworld handles STT + LLM + TTS.

```
Caller ↔ Telnyx ↔ WebSocket ↔ Inworld Realtime
             PCMU 8kHz (passthrough)
```

## Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [ngrok](https://ngrok.com/) account (free tier works)
- [Telnyx](https://telnyx.com/) account (**upgraded** — free-tier accounts cannot make or receive calls)
- [Inworld](https://www.inworld.ai/) account with a Realtime API key

## Setup

1. **Get your Inworld API key** — sign up at [inworld.ai](https://www.inworld.ai/), go to your workspace, and create an API key for the Realtime API.

2. **Set up Telnyx:**
   1. Sign up at [telnyx.com](https://telnyx.com/).
   2. **Upgrade your account** — free-tier (starter) accounts cannot place or receive phone calls. Go to [Account Settings](https://portal.telnyx.com/#/app/account/general) and complete identity verification to upgrade.
   3. Get an API key from the [API Keys](https://portal.telnyx.com/#/app/api-keys) page.
   4. Buy a phone number with Voice capability under **Numbers** → **Buy Numbers**.
   5. Create a Voice API Application under **Voice** → **Programmable Voice**:
      - Set the **Webhook URL** to `https://<your-ngrok-domain>/webhook`
   6. Assign your phone number to the Voice API Application:
      - Go to **Numbers** → **Manage Numbers** → click your number → **Voice** tab
      - Under **Routing**, select your Voice API Application from the **SIP Connection/Application** dropdown

3. **Set up ngrok** — [install ngrok](https://ngrok.com/download), then reserve a free static domain in the [ngrok dashboard](https://dashboard.ngrok.com/domains).

4. **Configure environment:**
   ```bash
   cp .env.example .env
   # Fill in TELNYX_API_KEY, INWORLD_API_KEY, and SERVER_URL (your ngrok URL)
   ```

5. **Install dependencies:**
   ```bash
   npm install
   ```

## Run

In two terminals:

```bash
ngrok http 3000 --url=<your-ngrok-domain>
```

```bash
npm run dev
```

Call your Telnyx number — the bot will greet you and you can have a conversation.

## How it works

1. Inbound call hits `/webhook` with a `call.initiated` event
2. Server answers the call via Telnyx Call Control API with bidirectional media streaming
3. Telnyx opens a Media Stream WebSocket to `/media-stream`
4. Server passes PCMU audio between Telnyx and Inworld (no format conversion needed)
5. Barge-in: on speech detection, clears Telnyx buffer and cancels Inworld response
