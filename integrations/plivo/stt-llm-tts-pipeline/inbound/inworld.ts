// Inworld cascaded clients — STT and TTS over WebSocket, Router/LLM over OpenAI-compatible SSE.
// Audio is μ-law 8 kHz on both ends, so it flows to and from Plivo with no conversion.
import WebSocket from "ws";
import { EventEmitter } from "node:events";
import { ulawToPcm } from "../utils.js";

const STT_URL = "wss://api.inworld.ai/stt/v1/transcribe:streamBidirectional";
const LLM_URL = "https://api.inworld.ai/v1/chat/completions";
const TTS_URL = "wss://api.inworld.ai/tts/v1/voice:streamBidirectional";

export interface InworldConfig {
  apiKey: string;
  llmModel: string;
  sttModel: string;
  ttsModel: string;
  voice: string;
  plivoRate: number;
  language: string;
}

export interface Message { role: "system" | "user" | "assistant"; content: string }
export type LlmChunk = { type: "text"; text: string } | { type: "tool_call"; id: string; name: string; args: string };

const auth = (cfg: InworldConfig) => `Basic ${cfg.apiKey}`;

interface SttEvents {
  ready: () => void;
  transcript: (text: string, isFinal: boolean) => void;
  closed: () => void;
}
export declare interface InworldSTT {
  on<K extends keyof SttEvents>(event: K, listener: SttEvents[K]): this;
  emit<K extends keyof SttEvents>(event: K, ...args: Parameters<SttEvents[K]>): boolean;
}

export class InworldSTT extends EventEmitter {
  private ws: WebSocket | null = null;
  constructor(private readonly cfg: InworldConfig) { super(); }

  connect(): void {
    const ws = new WebSocket(STT_URL, { headers: { Authorization: auth(this.cfg) } });
    this.ws = ws;
    ws.on("open", () => {
      this.send({ transcribeConfig: { modelId: this.cfg.sttModel, audioEncoding: "LINEAR16", sampleRateHertz: this.cfg.plivoRate, numberOfChannels: 1, language: this.cfg.language } });
      this.emit("ready");
    });
    ws.on("message", (d: Buffer) => this.onMessage(d));
    ws.on("error", (e) => { console.error(`[stt] socket error: ${(e as Error).message}`); this.emit("closed"); });
    ws.on("close", () => this.emit("closed"));
    ws.on("unexpected-response", (_req, res) => {
      let body = "";
      res.on("data", (c: Buffer) => (body += c.toString()));
      res.on("end", () => { console.error(`[stt] HTTP ${res.statusCode}: ${body}`); this.emit("closed"); });
      res.on("error", () => this.emit("closed"));
    });
  }

  sendCallerAudio(ulawB64: string): void {
    const pcm = ulawToPcm(Buffer.from(ulawB64, "base64"));
    this.send({ audioChunk: { content: pcm.toString("base64") } });
  }

  close(): void { try { this.ws?.close(); } catch { } }

  private onMessage(data: Buffer): void {
    let m: any;
    try { m = JSON.parse(data.toString()); } catch { return; }
    if (m.error) { console.error(`[stt] error frame: ${JSON.stringify(m.error)}`); this.emit("closed"); return; }
    const t = m?.result?.transcription;
    if (t?.transcript) this.emit("transcript", t.transcript, !!t.isFinal);
  }

  private send(msg: object): void { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg)); }
}

export async function* streamLLM(cfg: InworldConfig, messages: Message[], tools: object[], signal: AbortSignal): AsyncGenerator<LlmChunk> {
  const res = await fetch(LLM_URL, {
    method: "POST",
    headers: { Authorization: auth(cfg), "Content-Type": "application/json" },
    body: JSON.stringify({ model: cfg.llmModel, messages, stream: true, tools, tool_choice: "auto" }),
    signal,
  });
  if (!res.ok) throw new Error(`Router ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const reader = res.body?.getReader();
  if (!reader) throw new Error("Router: no response body");
  const decoder = new TextDecoder();
  let buf = "";
  const toolAcc: Record<number, { id: string; name: string; args: string }> = {};
  const flush = function* (): Generator<LlmChunk> {
    for (const tc of Object.values(toolAcc)) if (tc.name) yield { type: "tool_call", id: tc.id, name: tc.name, args: tc.args };
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") { yield* flush(); return; }
      let delta: any;
      try { delta = JSON.parse(data)?.choices?.[0]?.delta; } catch { continue; }
      if (delta?.content) yield { type: "text", text: delta.content as string };
      for (const tc of delta?.tool_calls ?? []) {
        const i: number = tc.index ?? 0;
        const acc = (toolAcc[i] ||= { id: "", name: "", args: "" });
        if (tc.id) acc.id = tc.id;
        if (tc.function?.name) acc.name = tc.function.name;
        if (tc.function?.arguments) acc.args += tc.function.arguments;
      }
    }
  }
  yield* flush();
}

interface TtsEvents {
  ready: () => void;
  audio: (ulaw: Buffer) => void;
  done: () => void;
  closed: () => void;
}
export declare interface InworldTTS {
  on<K extends keyof TtsEvents>(event: K, listener: TtsEvents[K]): this;
  emit<K extends keyof TtsEvents>(event: K, ...args: Parameters<TtsEvents[K]>): boolean;
}

export class InworldTTS extends EventEmitter {
  private ws: WebSocket | null = null;
  private ctx = "";
  private seq = 0;
  constructor(private readonly cfg: InworldConfig) { super(); }

  connect(): void {
    const ws = new WebSocket(TTS_URL, { headers: { Authorization: auth(this.cfg) } });
    this.ws = ws;
    ws.on("open", () => this.emit("ready"));
    ws.on("message", (d: Buffer) => this.onMessage(d));
    ws.on("error", (e) => { console.error(`[tts] socket error: ${(e as Error).message}`); this.emit("closed"); });
    ws.on("close", () => this.emit("closed"));
    ws.on("unexpected-response", (_req, res) => {
      let body = "";
      res.on("data", (c: Buffer) => (body += c.toString()));
      res.on("end", () => { console.error(`[tts] HTTP ${res.statusCode}: ${body}`); this.emit("closed"); });
      res.on("error", () => this.emit("closed"));
    });
  }

  beginTurn(): void {
    this.ctx = `turn-${++this.seq}`;
    this.send({ context_id: this.ctx, create: { voice_id: this.cfg.voice, model_id: this.cfg.ttsModel, audio_config: { audio_encoding: "MULAW", sample_rate_hertz: this.cfg.plivoRate } } });
  }

  speak(text: string): void {
    if (!this.ctx) this.beginTurn();
    this.send({ context_id: this.ctx, send_text: { text, flush_context: {} } });
  }

  endTurn(): void {
    if (this.ctx) this.send({ context_id: this.ctx, close_context: {} });
  }

  interrupt(): void {
    if (!this.ctx) return;
    this.send({ context_id: this.ctx, close_context: {} });
    this.ctx = "";
  }

  close(): void { try { this.ws?.close(); } catch { } }

  private onMessage(data: Buffer): void {
    let m: any;
    try { m = JSON.parse(data.toString()); } catch { return; }
    if (m.error) { console.error(`[tts] error frame: ${JSON.stringify(m.error)}`); this.emit("closed"); return; }
    const r = m.result;
    if (!r || r.contextId !== this.ctx) return;
    const b64 = r.audioChunk?.audioContent;
    if (b64) this.emit("audio", Buffer.from(b64, "base64"));
    if (r.contextClosed !== undefined) { this.ctx = ""; this.emit("done"); }
  }

  private send(msg: object): void { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg)); }
}
