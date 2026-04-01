/**
 * Bridges a Twilio Media Stream WebSocket to an Inworld Realtime WebSocket.
 *
 * Audio pipeline:
 *   Twilio (mulaw 8kHz) → decode + resample → PCM16 24kHz → Inworld
 *   Inworld (PCM16 24kHz) → resample + encode → mulaw 8kHz → Twilio
 *
 * Both directions buffer to ≥50ms chunks before sending.
 */
import WebSocket from "ws";
import { InworldRealtimeClient } from "./inworld-realtime.js";
import { twilioToInworld, inworldToTwilio } from "./audio-bridge.js";
import { config } from "../config.js";

interface TwilioMediaMessage {
  event: "connected" | "start" | "media" | "stop" | "mark";
  streamSid?: string;
  start?: { streamSid: string; callSid: string };
  media?: { payload: string };
}

// 50ms minimum chunk sizes
const MIN_MULAW_BYTES = 400;   // 8000 Hz × 0.05s × 1 byte/sample
const MIN_PCM16_BYTES = 2400;  // 24000 Hz × 0.05s × 2 bytes/sample

export function handleCallStream(twilioWs: WebSocket): void {
  let streamSid: string | null = null;
  let inworld: InworldRealtimeClient | null = null;
  let outBuffer = Buffer.alloc(0);  // mulaw to Twilio
  let inBuffer = Buffer.alloc(0);   // PCM16 to Inworld

  function sendToTwilio(payload: string) {
    if (twilioWs.readyState === WebSocket.OPEN && streamSid) {
      twilioWs.send(JSON.stringify({ event: "media", streamSid, media: { payload } }));
    }
  }

  function flushOutBuffer() {
    while (outBuffer.length >= MIN_MULAW_BYTES) {
      sendToTwilio(outBuffer.subarray(0, MIN_MULAW_BYTES).toString("base64"));
      outBuffer = outBuffer.subarray(MIN_MULAW_BYTES);
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
          outBuffer = Buffer.concat([outBuffer, Buffer.from(inworldToTwilio(base64Audio), "base64")]);
          flushOutBuffer();
        });

        inworld.on("audioDone", () => {
          if (outBuffer.length > 0) {
            sendToTwilio(outBuffer.toString("base64"));
            outBuffer = Buffer.alloc(0);
          }
        });

        inworld.on("speechStarted", () => {
          outBuffer = Buffer.alloc(0);
          if (twilioWs.readyState === WebSocket.OPEN && streamSid) {
            twilioWs.send(JSON.stringify({ event: "clear", streamSid }));
          }
          inworld?.cancelResponse();
        });

        inworld.on("transcript", (text) => console.log(`[call] User: ${text}`));
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
          inBuffer = Buffer.concat([inBuffer, Buffer.from(twilioToInworld(msg.media.payload), "base64")]);
          while (inBuffer.length >= MIN_PCM16_BYTES) {
            inworld.sendAudio(inBuffer.subarray(0, MIN_PCM16_BYTES).toString("base64"));
            inBuffer = inBuffer.subarray(MIN_PCM16_BYTES);
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
