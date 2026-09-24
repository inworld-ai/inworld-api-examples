/**
 * Bridges a Twilio Media Stream WebSocket to an Inworld Realtime WebSocket.
 *
 * Both Twilio and Inworld use G.711 μ-law at 8kHz, so audio passes through
 * as-is with no format conversion. We only buffer to ≥50ms chunks.
 */
import WebSocket from "ws";
import { InworldRealtimeClient } from "./inworld-realtime.js";
import { config } from "../config.js";

interface TwilioMediaMessage {
  event: "connected" | "start" | "media" | "stop" | "mark";
  streamSid?: string;
  start?: { streamSid: string; callSid: string };
  media?: { payload: string };
}

// 50ms of mulaw 8kHz = 400 bytes (8000 samples/sec × 0.05s × 1 byte/sample)
const MIN_CHUNK_BYTES = 400;

// Peak level (16-bit PCM) above which an inbound chunk counts as caller voice.
// Only used to time latency from the caller's real end of speech.
const VOICE_PEAK_THRESHOLD = 1000;

function mulawToLinear(byte: number): number {
  const u = ~byte & 0xff;
  const magnitude = (((u & 0x0f) << 3) + 0x84) << ((u & 0x70) >> 4);
  return u & 0x80 ? 0x84 - magnitude : magnitude - 0x84;
}

function hasVoice(chunk: Buffer): boolean {
  for (const byte of chunk) {
    if (Math.abs(mulawToLinear(byte)) > VOICE_PEAK_THRESHOLD) return true;
  }
  return false;
}

export function handleCallStream(twilioWs: WebSocket): void {
  let streamSid: string | null = null;
  let inworld: InworldRealtimeClient | null = null;
  let outBuffer = Buffer.alloc(0);
  let inBuffer = Buffer.alloc(0);

  // Latency tracking, relative to the last inbound chunk that contained voice.
  // Inworld's speech_stopped fires only once turn detection commits the turn,
  // so it cannot measure how long turn detection itself took.
  let lastVoiceAt: number | null = null;
  // Inworld sends audio faster than real time, so a response is often "done"
  // while Twilio is still playing it. Estimate when playback actually ends.
  let playbackEndsAt = 0;
  let firstAudioLogged = false;
  let responseAudioBytes = 0;

  function sinceVoice(): string {
    return lastVoiceAt === null ? "n/a" : `+${Date.now() - lastVoiceAt}ms`;
  }

  function sendToTwilio(payload: Buffer) {
    if (twilioWs.readyState === WebSocket.OPEN && streamSid) {
      // mulaw 8kHz is 1 byte per sample, so bytes / 8 = milliseconds of audio.
      playbackEndsAt = Math.max(playbackEndsAt, Date.now()) + payload.length / 8;
      twilioWs.send(JSON.stringify({ event: "media", streamSid, media: { payload: payload.toString("base64") } }));
    }
  }

  function flushOutBuffer() {
    while (outBuffer.length >= MIN_CHUNK_BYTES) {
      sendToTwilio(outBuffer.subarray(0, MIN_CHUNK_BYTES));
      outBuffer = outBuffer.subarray(MIN_CHUNK_BYTES);
    }
  }

  twilioWs.on("message", async (data: Buffer) => {
    const msg: TwilioMediaMessage = JSON.parse(data.toString());

    switch (msg.event) {
      case "start":
        streamSid = msg.start!.streamSid;
        console.log(`[call] Stream started (call: ${msg.start!.callSid})`);

        inworld = new InworldRealtimeClient();

        inworld.on("audio", (base64Audio) => {
          const audio = Buffer.from(base64Audio, "base64");
          if (!firstAudioLogged) {
            firstAudioLogged = true;
            console.log(`[latency] First bot audio: ${sinceVoice()} after caller stopped talking`);
          }
          responseAudioBytes += audio.length;
          outBuffer = Buffer.concat([outBuffer, audio]);
          flushOutBuffer();
        });

        inworld.on("audioDone", () => {
          if (outBuffer.length > 0) {
            sendToTwilio(outBuffer);
            outBuffer = Buffer.alloc(0);
          }
        });

        // Barge-in: stop local playback. Inworld cancels the in-flight response
        // itself because the session sets turn_detection.interrupt_response.
        inworld.on("speechStarted", () => {
          const unplayedMs = Math.round(playbackEndsAt - Date.now());
          if (unplayedMs > 0) {
            console.log(`[call] Caller interrupted the bot, clearing ~${unplayedMs}ms of unplayed audio`);
          }
          playbackEndsAt = 0;
          outBuffer = Buffer.alloc(0);
          if (twilioWs.readyState === WebSocket.OPEN && streamSid) {
            twilioWs.send(JSON.stringify({ event: "clear", streamSid }));
          }
        });

        inworld.on("speechStopped", () => {
          console.log(`[latency] Turn end detected: ${sinceVoice()} after caller stopped talking`);
        });

        inworld.on("transcript", (text) => console.log(`[call] User: ${text}`));

        inworld.on("responseCreated", (responseId) => {
          firstAudioLogged = false;
          responseAudioBytes = 0;
          console.log(`[latency] Response ${responseId} created: ${sinceVoice()} after caller stopped talking`);
        });

        inworld.on("responseDone", (responseId, status, transcript) => {
          const audioMs = Math.round(responseAudioBytes / 8);
          console.log(`[call] Bot (${status}, ${audioMs}ms audio, response ${responseId}): ${transcript}`);
        });

        inworld.on("error", (err) => console.error(`[call] Inworld error: ${err.message}`));
        inworld.on("closed", () => console.log("[call] Inworld closed"));

        try {
          await inworld.connect(config.systemPrompt);
        } catch (err) {
          console.error("[call] Failed to connect to Inworld:", err);
        }
        break;

      case "media":
        if (inworld && msg.media) {
          inBuffer = Buffer.concat([inBuffer, Buffer.from(msg.media.payload, "base64")]);
          while (inBuffer.length >= MIN_CHUNK_BYTES) {
            const chunk = inBuffer.subarray(0, MIN_CHUNK_BYTES);
            if (hasVoice(chunk)) lastVoiceAt = Date.now();
            inworld.sendAudio(chunk.toString("base64"));
            inBuffer = inBuffer.subarray(MIN_CHUNK_BYTES);
          }
        }
        break;

      case "stop":
        console.log("[call] Stream stopped");
        inworld?.close();
        inworld = null;
        break;
    }
  });

  twilioWs.on("close", () => {
    inworld?.close();
  });
}
