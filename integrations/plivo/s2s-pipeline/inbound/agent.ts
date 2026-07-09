// Inbound voice agent (Inworld Realtime) — call state machine: barge-in + end_call.
import WebSocket from "ws";
import { config } from "./config.js";
import { InworldRealtime } from "./inworld.js";

const PLIVO_CHUNK_SIZE = 160;

const TOOLS = [
  {
    type: "function",
    name: "end_call",
    description: "End the phone call after saying a brief goodbye, when the caller is done.",
    parameters: {
      type: "object",
      properties: { reason: { type: "string", description: "Why the call is ending." } },
      required: ["reason"],
    },
  },
];

export interface AgentOptions {
  plivoWs: WebSocket;
  callId: string;
  streamId: string;
  fromNumber?: string;
  systemPrompt?: string;
  hangup?: () => Promise<void> | void;
}

export function runAgent(opts: AgentOptions): Promise<void> {
  const { plivoWs, callId, streamId, hangup } = opts;
  const log = (stage: string, msg: string) => console.log(`[${callId}] [${stage}] ${msg}`);

  let outBuffer = Buffer.alloc(0);
  let responseGenerating = false;
  let cancelling = false;
  let running = true;
  let txTimer: ReturnType<typeof setInterval> | null = null;

  let pendingHangup = false;
  let farewellStarted = false;
  let hangupSilenceTicks = 0;
  let hangupArmedAt = 0;
  let hungUp = false;

  let instructions = opts.systemPrompt || config.systemPrompt;
  if (opts.fromNumber) instructions += `\n\n## Call Context\n- Caller: ${opts.fromNumber}\n- Call ID: ${callId}`;
  const inworld = new InworldRealtime(`voice-${callId}`, instructions, TOOLS);

  const isSpeaking = () => responseGenerating || outBuffer.length > 0;

  function sendChunk(chunk: Buffer): void {
    if (plivoWs.readyState !== WebSocket.OPEN || !streamId) return;
    plivoWs.send(JSON.stringify({
      event: "playAudio",
      media: { contentType: "audio/x-mulaw", sampleRate: 8000, payload: chunk.toString("base64") },
    }));
  }

  function bargeIn(): void {
    log("barge-in", "user interrupted");
    responseGenerating = false;
    if (pendingHangup && !hungUp) { pendingHangup = false; farewellStarted = false; hangupSilenceTicks = 0; hangupArmedAt = 0; }
    outBuffer = Buffer.alloc(0);
    cancelling = true;
    if (plivoWs.readyState === WebSocket.OPEN) plivoWs.send(JSON.stringify({ event: "clearAudio", streamId }));
    inworld.cancelResponse();
  }

  function doHangup(): void {
    if (hungUp) return;
    hungUp = true;
    if (!hangup) { try { plivoWs.close(); } catch { } return; }
    Promise.resolve(hangup()).catch((err) => {
      console.error(`[${callId}] [end_call] hangup failed: ${(err as Error).message}`);
      try { plivoWs.close(); } catch { }
    });
  }

  let resolveRun: (() => void) | null = null;
  function finish(): void {
    if (!running) return;
    running = false;
    if (txTimer) { clearInterval(txTimer); txTimer = null; }
    log("session", "ended");
    inworld.close();
    try { if (plivoWs.readyState === WebSocket.OPEN) plivoWs.close(); } catch { }
    resolveRun?.();
    resolveRun = null;
  }

  function onPlivoMessage(data: Buffer): void {
    let msg: { event?: string; media?: { payload?: string } };
    try { msg = JSON.parse(data.toString()); } catch { return; }
    if (msg.event === "media" && msg.media?.payload) inworld.appendAudio(msg.media.payload);
    else if (msg.event === "stop") finish();
  }

  inworld.on("ready", () => inworld.greet());
  inworld.on("audio", (audioB64) => {
    if (cancelling) return;
    responseGenerating = true;
    if (pendingHangup) farewellStarted = true;
    if (audioB64) outBuffer = Buffer.concat([outBuffer, Buffer.from(audioB64, "base64")]);
  });
  inworld.on("responseDone", () => { responseGenerating = false; cancelling = false; });
  inworld.on("userTranscript", (text) => log("user", text));
  inworld.on("speechStarted", () => { if (isSpeaking()) bargeIn(); });
  inworld.on("toolCall", (toolCallId, name, argsJson) => {
    if (name !== "end_call") return;
    let reason = "";
    try { reason = String(JSON.parse(argsJson || "{}").reason || ""); } catch { }
    inworld.sendToolResult(toolCallId, { ok: true });
    pendingHangup = true;
    hangupArmedAt = Date.now();
    if (isSpeaking()) farewellStarted = true;
    log("end_call", reason || "requested");
  });
  inworld.on("closed", () => finish());

  return new Promise<void>((resolve) => {
    resolveRun = resolve;
    plivoWs.on("message", onPlivoMessage);
    plivoWs.on("close", finish);
    plivoWs.on("error", finish);

    txTimer = setInterval(() => {
      if (outBuffer.length >= PLIVO_CHUNK_SIZE) {
        sendChunk(outBuffer.subarray(0, PLIVO_CHUNK_SIZE));
        outBuffer = outBuffer.subarray(PLIVO_CHUNK_SIZE);
      } else if (outBuffer.length > 0 && !responseGenerating) {
        sendChunk(outBuffer);
        outBuffer = Buffer.alloc(0);
      }

      if (pendingHangup && !hungUp) {
        if (Date.now() - hangupArmedAt > 12000) doHangup();
        else if (farewellStarted && !isSpeaking()) { if (++hangupSilenceTicks >= 30) doHangup(); }
        else hangupSilenceTicks = 0;
      }
    }, 20);

    inworld.connect();
  });
}
