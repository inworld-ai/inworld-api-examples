# Twilio ConversationRelay + Inworld AI Voice

This guide explains how to power phone calls with Inworld's AI voice using Twilio's ConversationRelay. A single streaming request to Inworld's Router API returns both LLM text and synthesized audio, giving you a complete voice AI agent with minimal server-side complexity.

## Prerequisites

Before getting started, make sure you have:

- A **Twilio account** with a phone number configured for Voice. If you are new to ConversationRelay, follow the [ConversationRelay onboarding guide](https://www.twilio.com/docs/voice/twiml/connect/conversationrelay).
- An **Inworld API key** from your [Inworld workspace](https://www.inworld.ai/).
- **Node.js 20+** installed.
- **ngrok** installed for local development ([download here](https://ngrok.com/)).
- Your public `wss://` URL ready for use (ngrok provides this when tunneling).

## Twilio Setup

When a call comes in, Twilio needs TwiML instructions to hand the call off to ConversationRelay. The simplest TwiML looks like this:

```xml
<Response>
  <Connect>
    <ConversationRelay
      url="wss://your-ngrok-domain.ngrok-free.app/conversation"
      transcriptionProvider="Deepgram"
      interruptible="true"
      dtmfDetection="true"
    />
  </Connect>
</Response>
```

This integration generates TwiML automatically via the `/voice` webhook endpoint, so you do not need to write TwiML by hand. However, if you want to customize the call experience, ConversationRelay supports additional attributes for language, voice hints, and more. See the full [ConversationRelay TwiML reference](https://www.twilio.com/docs/voice/twiml/connect/conversationrelay).

## Assigning TwiML to a Phone Number

1. Go to the [Twilio Console](https://console.twilio.com/) and navigate to **Phone Numbers** > **Manage** > **Active Numbers**.
2. Select the phone number you want to use.
3. Under **Voice Configuration**, set **"A call comes in"** to **Webhook**.
4. Enter your server URL: `https://your-ngrok-domain.ngrok-free.app/voice`
5. Set the method to **HTTP POST**.
6. Click **Save configuration**.

## Running the Server

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` with your credentials (see the [Configuration](#configuration) table below for all options):

```
INWORLD_API_KEY=your-inworld-api-key
SERVER_URL=https://your-ngrok-domain.ngrok-free.app
```

### 3. Start the development server

```bash
npm run dev
```

### 4. Start ngrok (in a separate terminal)

```bash
ngrok http 3000 --url=your-ngrok-domain.ngrok-free.app
```

The server will log:

```
[server] Listening on port 3000
[server] Voice webhook: https://your-ngrok-domain.ngrok-free.app/voice
```

## Placing a Test Call

Call your Twilio phone number from any phone. Your AI voice assistant should pick up immediately, speak a welcome greeting, and respond to your questions in real time via Inworld.

## How It Works

```
                                       +-----------------+
Phone Call  <-->  Twilio               |  This Server    |     Inworld Router API
                  ConversationRelay    |                 |     (LLM + TTS combined)
                  - STT (Deepgram)  <--+--> WebSocket <--+--->  POST /v1/chat/completions
                  - Plays audio URLs   |    Handler      |     stream=true, audio={...}
                                       |                 |
                                       |  HTTP /audio/:id|
                                       +-----------------+
```

Inworld's Router API combines LLM inference and text-to-speech in a single streaming request. The server sends conversation messages to `https://api.inworld.ai/v1/chat/completions` with an `audio` configuration block, and receives an SSE stream containing both text deltas and base64-encoded PCM audio chunks.

### Streaming for Low Latency

Inworld's optimized chunking engine segments audio at natural sentence boundaries. As each audio segment completes in the stream, the server immediately wraps it in a WAV header, stores it at a temporary HTTP URL, and sends a `play` message to ConversationRelay. This means the caller hears the first sentence of a response before the LLM has finished generating the rest.

### Interruption Handling

When the caller speaks over the bot, ConversationRelay sends an `interrupt` message. The server immediately aborts the in-flight Inworld stream using an `AbortController`, stopping both LLM generation and TTS synthesis. Any partial response already spoken is preserved in conversation history so context is not lost.

### Multi-Turn Conversations

The server maintains full conversation history (system prompt plus all user and assistant turns) per WebSocket session. Each new user prompt is sent to Inworld with the complete history, giving the LLM full context for coherent multi-turn dialogue.

### Audio Pipeline

1. Inworld streams base64-encoded PCM audio (48kHz, 16-bit, mono) alongside text.
2. The server accumulates PCM chunks per sentence segment.
3. Each completed segment is wrapped in a WAV header and stored in memory with a unique ID.
4. A `play` message with the audio URL is sent to ConversationRelay.
5. ConversationRelay fetches the WAV file via HTTP and plays it to the caller.
6. Audio clips auto-expire from memory after 60 seconds.

## Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `INWORLD_API_KEY` | Yes | -- | Inworld API key (used for Basic auth to the Router API) |
| `SERVER_URL` | Yes | -- | Public URL of this server (e.g., your ngrok domain) |
| `PORT` | No | `3000` | Port the HTTP/WebSocket server listens on |
| `SYSTEM_PROMPT` | No | Generic assistant prompt | System instructions sent to the LLM |
| `INWORLD_MODEL` | No | `openai/gpt-4.1-mini` | LLM model or Inworld router name |
| `TTS_VOICE` | No | `Clive` | Inworld TTS voice name |
| `TTS_MODEL` | No | `inworld-tts-1.5-max` | Inworld TTS model (`inworld-tts-1.5-max` or `inworld-tts-1.5-mini`) |
| `TRANSCRIPTION_PROVIDER` | No | `Deepgram` | Speech-to-text provider used by ConversationRelay |
| `WELCOME_GREETING` | No | Generic greeting | Message spoken when the call connects |

## Custom Parameters and Agent Handoff

### Passing Custom Parameters

You can pass custom data into the WebSocket session using `<Parameter>` elements in your TwiML:

```xml
<Response>
  <Connect>
    <ConversationRelay url="wss://your-server/conversation" interruptible="true">
      <Parameter name="customerName" value="Jane Doe" />
      <Parameter name="accountId" value="12345" />
    </ConversationRelay>
  </Connect>
</Response>
```

These parameters arrive in the `setup` message when the WebSocket connection opens, allowing your server to personalize the conversation based on caller context.

### Agent Handoff

To transfer a call to a human agent, send an `end` message from the server with `handoffData`. ConversationRelay will close the WebSocket and pass the handoff data back to Twilio, where you can route it using a Studio Flow or webhook:

```json
{
  "type": "end",
  "handoffData": "{\"reason\": \"customer_request\", \"department\": \"billing\", \"summary\": \"Caller wants to discuss an invoice.\"}"
}
```

The `handoffData` field is a JSON string that you define. Twilio makes it available in subsequent TwiML or Studio Flow steps so you can route the call to the appropriate agent queue with full context.

## Further Reading and Troubleshooting

- [ConversationRelay TwiML Reference](https://www.twilio.com/docs/voice/twiml/connect/conversationrelay) -- configuration attributes, parameter passing, and advanced options.
- [ConversationRelay WebSocket Protocol](https://www.twilio.com/docs/voice/conversationrelay/websocket-messages) -- full specification of incoming and outgoing WebSocket message types.
- [Twilio Studio](https://www.twilio.com/docs/studio) -- build no-code voice flows with a visual editor and connect them to ConversationRelay.
- [Inworld Router API Documentation](https://docs.inworld.ai) -- LLM routing, TTS models, and voice options.

For issues troubleshooting call setup or audio playback, consult the [Twilio ConversationRelay documentation](https://www.twilio.com/docs/voice/twiml/connect/conversationrelay) or open a support ticket with Twilio. For questions about the Inworld Router API, visit [docs.inworld.ai](https://docs.inworld.ai).
