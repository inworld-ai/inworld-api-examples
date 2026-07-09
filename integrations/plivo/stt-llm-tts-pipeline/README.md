# Plivo Integration (Cascaded STT + LLM + TTS)

Connect phone calls to Inworld using a cascaded pipeline over Plivo audio streaming.

Plivo's `<Stream>` element forwards live call audio to your server over a WebSocket. Unlike the single-socket [Realtime pipeline](../s2s-pipeline/), this example wires up three separate Inworld services — Speech-to-Text, the Router/LLM, and Text-to-Speech — so each stage is independently swappable and observable. The trade-off is more moving parts and higher latency.

## Prerequisites

- Node.js v18 or later
- ngrok account with a reserved static domain (the free tier is sufficient)
- Plivo account with a phone number that has Voice capability
- Inworld account with an API key scoped for **STT, Router, and TTS**

## Setup

**1. Clone the example repo**

Clone the examples repo and change into the Plivo cascaded integration directory:

```bash
git clone https://github.com/inworld-ai/inworld-api-examples.git
cd inworld-api-examples/integrations/plivo/stt-llm-tts-pipeline
```

The remaining steps are run from this directory.

**2. Get your Inworld API key**

Sign in to the [Inworld Portal](https://platform.inworld.ai/), open your workspace, and create an API key with access to the **STT, Router, and TTS** APIs.

**3. Get a Plivo phone number**

In the [Plivo Console](https://cx.plivo.com/), buy a phone number with Voice capability and copy your Auth ID and Auth Token from the dashboard.

**4. Reserve an ngrok static domain**

Install ngrok and reserve a free static domain in the ngrok dashboard. A static domain matters here because the Plivo webhook URL needs to stay stable between restarts.

**5. Configure environment**

Copy the example env file and fill in the values:

```bash
cp .env.example .env
```

Set these in `.env`:

```bash
INWORLD_API_KEY=your_inworld_api_key
PUBLIC_URL=https://your-ngrok-domain.ngrok-free.app
PLIVO_AUTH_ID=your_plivo_auth_id
PLIVO_AUTH_TOKEN=your_plivo_auth_token
PLIVO_PHONE_NUMBER=+14155551234
```

The Plivo Auth ID/Token and phone number let the server **auto-provision Plivo on startup** — it creates (or updates) the Plivo Application and points your number's voice webhook at this server, so a fresh number works without any manual console setup.

**6. Install and run**

Install dependencies:

```bash
npm install
```

Then start ngrok and the dev server in two separate terminals:

```bash
ngrok http 3000 --url=your-ngrok-domain.ngrok-free.app
```

```bash
npm run dev
```

**7. Point your Plivo number at the webhook**

On startup the server **auto-configures Plivo** — it creates (or updates) a Plivo Application pointing at this server's webhooks and maps `PLIVO_PHONE_NUMBER` to it, so there's nothing to do in the console. To configure it manually instead, leave `PLIVO_PHONE_NUMBER` unset and, in the Plivo Console under Phone Numbers → your number → Voice, set the **Answer URL** to `https://your-ngrok-domain.ngrok-free.app/answer` with HTTP POST.

> ngrok is only needed for local development so Plivo can reach a server running on your machine.

## How it works

- An inbound call hits `/answer`, and the server responds with Plivo XML instructing Plivo to open a bidirectional audio stream.
- Plivo opens a WebSocket to `/ws` and begins forwarding call audio.
- The server decodes the caller's μ-law audio to PCM and streams it to Inworld STT over a WebSocket; final transcripts drive each turn.
- Each transcript is sent to the Inworld Router/LLM with the full conversation history. The reply streams back and is synthesized sentence by sentence with Inworld TTS over a WebSocket, which returns μ-law 8 kHz audio that plays to the caller with no conversion.
- On detected user speech, the server cancels the in-flight LLM work, abandons the current TTS turn, and clears Plivo's audio buffer so barge-in feels natural.

```xml
<Response>
  <Stream bidirectional="true" keepCallAlive="true" contentType="audio/x-mulaw;rate=8000">
    wss://your-ngrok-domain.ngrok-free.app/ws
  </Stream>
</Response>
```

## Example implementation

- [Plivo + Inworld cascaded (STT + LLM + TTS) integration example](https://github.com/sarveshpatil-plivo/inworld-api-examples/tree/plivo-inworld-services/integrations/plivo/stt-llm-tts-pipeline) — a complete Node.js reference implementation that bridges Plivo audio streaming to Inworld STT, the Router/LLM, and TTS.

## Further Reading

- [Plivo Audio Streaming — the `<Stream>` element](https://www.plivo.com/docs/voice-agents/audio-streaming/xml/stream) — how to start a bidirectional audio stream from a call, and the attributes used above (`bidirectional`, `keepCallAlive`, `contentType`).
- [Plivo Audio Streaming — protocol & events reference](https://www.plivo.com/docs/voice-agents/audio-streaming/concepts/audio-streaming-reference) — the WebSocket messages exchanged with your server (`start`, `media`, `dtmf`, `playAudio`, `clearAudio`, `checkpoint`).
- [Inworld STT, Router (LLM), and TTS](https://docs.inworld.ai) — the three Inworld services this cascaded pipeline wires together.
- [Realtime (single-socket) example](../s2s-pipeline/) — the all-in-one speech-to-speech alternative to this cascaded setup.
