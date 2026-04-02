/**
 * Inworld Realtime API WebSocket client.
 * Docs: https://docs.inworld.ai/realtime/quickstart-websocket
 */
import WebSocket from "ws";
import { EventEmitter } from "node:events";
import { config } from "../config.js";

interface InworldRealtimeEvents {
  connected: (sessionId: string) => void;
  audio: (base64Audio: string) => void;
  audioDone: () => void;
  speechStarted: () => void;
  transcript: (text: string) => void;
  error: (error: Error) => void;
  closed: () => void;
}

export declare interface InworldRealtimeClient {
  on<K extends keyof InworldRealtimeEvents>(event: K, listener: InworldRealtimeEvents[K]): this;
  emit<K extends keyof InworldRealtimeEvents>(event: K, ...args: Parameters<InworldRealtimeEvents[K]>): boolean;
}

export class InworldRealtimeClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private instructions: string = "";

  async connect(instructions: string): Promise<void> {
    this.instructions = instructions;
    const url = `wss://api.inworld.ai/api/v1/realtime/session?key=voice-${Date.now()}&protocol=realtime`;

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url, {
        headers: { Authorization: `Basic ${config.inworldApiKey}` },
      });

      this.ws.on("open", () => resolve());

      this.ws.on("message", (data: Buffer) => {
        try {
          this.handleMessage(JSON.parse(data.toString()));
        } catch {
          // ignore non-JSON frames
        }
      });

      this.ws.on("error", (err) => {
        this.emit("error", err as Error);
        reject(err);
      });

      this.ws.on("close", () => this.emit("closed"));

      this.ws.on("unexpected-response", (_req, res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => { body += chunk.toString(); });
        res.on("end", () => reject(new Error(`Inworld HTTP ${res.statusCode}: ${body}`)));
      });
    });
  }

  sendAudio(base64Audio: string): void {
    this.send({ type: "input_audio_buffer.append", audio: base64Audio });
  }

  cancelResponse(): void {
    this.send({ type: "response.cancel" });
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }

  private send(msg: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private handleMessage(msg: any): void {
    switch (msg.type) {
      case "session.created":
        console.log("[inworld] Session created, sending config");
        this.send({
          type: "session.update",
          session: {
            type: "realtime",
            model: "openai/gpt-4.1-mini",
            instructions: this.instructions,
            output_modalities: ["audio", "text"],
            audio: {
              input: {
                format: "g711_ulaw",
                transcription: { model: "assemblyai/universal-streaming-multilingual" },
                turn_detection: {
                  type: "semantic_vad",
                  eagerness: "auto",
                  create_response: true,
                  interrupt_response: true,
                },
              },
              output: {
                format: "g711_ulaw",
                model: "inworld-tts-1.5-max",
                voice: "Sarah",
              },
            },
          },
        });
        this.emit("connected", msg.session?.id);
        break;

      case "session.updated":
        console.log("[inworld] Session configured, triggering greeting");
        this.send({
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Hi there!" }],
          },
        });
        this.send({ type: "response.create" });
        break;

      case "response.output_audio.delta":
        this.emit("audio", msg.delta);
        break;

      case "response.output_audio.done":
        this.emit("audioDone");
        break;

      case "input_audio_buffer.speech_started":
        this.emit("speechStarted");
        break;

      case "conversation.item.input_audio_transcription.completed":
        if (msg.transcript) this.emit("transcript", msg.transcript);
        break;

      case "error":
        console.error("[inworld] Error:", msg.error?.message);
        this.emit("error", new Error(msg.error?.message || "Inworld Realtime error"));
        break;
    }
  }
}
