/**
 * Bridges a Telnyx Media Stream WebSocket to an Inworld Realtime WebSocket.
 *
 * Both Telnyx and Inworld use G.711 μ-law at 8kHz, so audio passes through
 * as-is with no format conversion. We only buffer to ≥50ms chunks.
 */
import WebSocket from "ws";
import { InworldRealtimeClient } from "./inworld-realtime.js";
import { config } from "../config.js";

interface TelnyxMediaMessage {
  event: "start" | "media" | "stop";
  start?: { mediaFormat: { encoding: string; sampleRate: number; channels: number } };
  media?: { payload: string };
}

// 50ms of mulaw 8kHz = 400 bytes (8000 samples/sec × 0.05s × 1 byte/sample)
const MIN_CHUNK_BYTES = 400;

export function handleCallStream(telnyxWs: WebSocket): void {
  let inworld: InworldRealtimeClient | null = null;
  let outBuffer = Buffer.alloc(0);
  let inBuffer = Buffer.alloc(0);

  function sendToTelnyx(payload: Buffer) {
    if (telnyxWs.readyState === WebSocket.OPEN) {
      telnyxWs.send(JSON.stringify({ event: "media", media: { payload: payload.toString("base64") } }));
    }
  }

  function flushOutBuffer() {
    while (outBuffer.length >= MIN_CHUNK_BYTES) {
      sendToTelnyx(outBuffer.subarray(0, MIN_CHUNK_BYTES));
      outBuffer = outBuffer.subarray(MIN_CHUNK_BYTES);
    }
  }

  telnyxWs.on("message", async (data: Buffer) => {
    const msg: TelnyxMediaMessage = JSON.parse(data.toString());

    switch (msg.event) {
      case "start":
        console.log("[call] Stream started");

        inworld = new InworldRealtimeClient();

        inworld.on("audio", (base64Audio) => {
          outBuffer = Buffer.concat([outBuffer, Buffer.from(base64Audio, "base64")]);
          flushOutBuffer();
        });

        inworld.on("audioDone", () => {
          if (outBuffer.length > 0) {
            sendToTelnyx(outBuffer);
            outBuffer = Buffer.alloc(0);
          }
        });

        inworld.on("speechStarted", () => {
          outBuffer = Buffer.alloc(0);
          if (telnyxWs.readyState === WebSocket.OPEN) {
            telnyxWs.send(JSON.stringify({ event: "clear" }));
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

  telnyxWs.on("close", () => {
    inworld?.close();
  });
}
