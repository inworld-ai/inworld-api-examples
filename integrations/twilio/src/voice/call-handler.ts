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

export function handleCallStream(twilioWs: WebSocket): void {
  let streamSid: string | null = null;
  let inworld: InworldRealtimeClient | null = null;
  let outBuffer = Buffer.alloc(0);
  let inBuffer = Buffer.alloc(0);

  function sendToTwilio(payload: Buffer) {
    if (twilioWs.readyState === WebSocket.OPEN && streamSid) {
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
          outBuffer = Buffer.concat([outBuffer, Buffer.from(base64Audio, "base64")]);
          flushOutBuffer();
        });

        inworld.on("audioDone", () => {
          if (outBuffer.length > 0) {
            sendToTwilio(outBuffer);
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
          inBuffer = Buffer.concat([inBuffer, Buffer.from(msg.media.payload, "base64")]);
          while (inBuffer.length >= MIN_CHUNK_BYTES) {
            inworld.sendAudio(inBuffer.subarray(0, MIN_CHUNK_BYTES).toString("base64"));
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
