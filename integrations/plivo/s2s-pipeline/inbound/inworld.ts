// Inworld Realtime (speech-to-speech) client — one WebSocket does STT + LLM + TTS (μ-law 8 kHz).
import WebSocket from "ws";
import { EventEmitter } from "node:events";
import { config } from "./config.js";

const REALTIME_URL = "wss://api.inworld.ai/api/v1/realtime/session";

interface RealtimeEvents {
  ready: () => void;
  audio: (audioB64: string) => void;
  responseDone: () => void;
  userTranscript: (text: string) => void;
  speechStarted: () => void;
  toolCall: (callId: string, name: string, args: string) => void;
  error: (err: Error) => void;
  closed: () => void;
}

export declare interface InworldRealtime {
  on<K extends keyof RealtimeEvents>(event: K, listener: RealtimeEvents[K]): this;
  emit<K extends keyof RealtimeEvents>(event: K, ...args: Parameters<RealtimeEvents[K]>): boolean;
}

export class InworldRealtime extends EventEmitter {
  private ws: WebSocket | null = null;

  constructor(
    private readonly sessionId: string,
    private readonly instructions: string,
    private readonly tools: object[],
  ) { super(); }

  connect(): void {
    const ws = new WebSocket(`${REALTIME_URL}?key=${this.sessionId}&protocol=realtime`, {
      headers: { Authorization: `Basic ${config.inworldApiKey}` },
    });
    this.ws = ws;
    ws.on("message", (d: Buffer) => this.onMessage(d));
    ws.on("error", (e) => { console.error(`[inworld] socket error: ${(e as Error).message}`); this.emit("closed"); });
    ws.on("close", () => this.emit("closed"));
    ws.on("unexpected-response", (_req, res) => {
      let body = "";
      res.on("data", (c: Buffer) => (body += c.toString()));
      res.on("end", () => { console.error(`[inworld] HTTP ${res.statusCode}: ${body}`); this.emit("closed"); });
      res.on("error", () => this.emit("closed"));
    });
  }

  appendAudio(audioB64: string): void { this.send({ type: "input_audio_buffer.append", audio: audioB64 }); }

  greet(): void {
    this.send({
      type: "conversation.item.create",
      item: { type: "message", role: "user", content: [{ type: "input_text", text: "The call just connected. Greet the caller." }] },
    });
    this.send({ type: "response.create" });
  }

  cancelResponse(): void { this.send({ type: "response.cancel" }); }

  sendToolResult(callId: string, output: object): void {
    this.send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: callId, output: JSON.stringify(output) } });
    this.send({ type: "response.create" });
  }

  close(): void { try { this.ws?.close(); } catch { } }

  private onMessage(data: Buffer): void {
    let m: Record<string, unknown>;
    try { m = JSON.parse(data.toString()); } catch { return; }
    switch (m.type) {
      case "session.created": this.send(this.sessionUpdate()); break;
      case "session.updated": this.emit("ready"); break;
      case "response.audio.delta":
      case "response.output_audio.delta": this.emit("audio", m.delta as string); break;
      case "response.done": this.emit("responseDone"); break;
      case "response.function_call_arguments.done":
        this.emit("toolCall", m.call_id as string, m.name as string, m.arguments as string); break;
      case "input_audio_buffer.speech_started": this.emit("speechStarted"); break;
      case "conversation.item.input_audio_transcription.completed":
        if (m.transcript) this.emit("userTranscript", m.transcript as string); break;
      case "error": {
        const message = (m.error as { message?: string } | undefined)?.message;
        this.emit("error", new Error(message || "Inworld Realtime error"));
        break;
      }
    }
  }

  private sessionUpdate(): object {
    return {
      type: "session.update",
      session: {
        type: "realtime",
        model: config.llmModel,
        instructions: this.instructions,
        output_modalities: ["audio", "text"],
        tools: this.tools,
        tool_choice: "auto",
        audio: {
          input: {
            format: "g711_ulaw",
            transcription: { model: config.sttModel },
            turn_detection: { type: "semantic_vad", eagerness: config.vadEagerness, create_response: true, interrupt_response: true },
          },
          output: { format: "g711_ulaw", model: config.ttsModel, voice: config.voice },
        },
      },
    };
  }

  private send(msg: object): void { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg)); }
}
