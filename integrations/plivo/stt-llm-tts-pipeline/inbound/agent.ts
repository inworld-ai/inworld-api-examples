// Inbound voice agent (Inworld cascaded STT→LLM→TTS) — turn/state machine: barge-in, end_call, history.
import WebSocket from "ws";
import { config } from "./config.js";
import { InworldSTT, InworldTTS, streamLLM, type InworldConfig, type Message } from "./inworld.js";

const PLIVO_RATE = 8000;
const PLIVO_CHUNK_SIZE = 160;
const END_OF_UTTERANCE_MS = 800;
const GREETING = "Hello! How can I help you today?";

const CFG: InworldConfig = {
  apiKey: config.inworldApiKey,
  llmModel: config.llmModel,
  sttModel: config.sttModel,
  ttsModel: config.ttsModel,
  voice: config.voice,
  plivoRate: PLIVO_RATE,
  language: "en-US",
};

const TOOLS = [
  {
    type: "function",
    function: {
      name: "end_call",
      description: "End the phone call after saying a brief goodbye, when the caller is done.",
      parameters: {
        type: "object",
        properties: { reason: { type: "string", description: "Why the call is ending." } },
        required: ["reason"],
      },
    },
  },
];

const SENTENCE_SEGMENTER = new Intl.Segmenter("en", { granularity: "sentence" });
const LIST_MARKER = /^\s*(?:\d+[.)]|[-*•])\s*$/;

function splitSentences(buf: string): { speak: string[]; rest: string } {
  const parts = [...SENTENCE_SEGMENTER.segment(buf)].map((s) => s.segment);
  if (parts.length <= 1) return { speak: [], rest: buf };
  const rest = parts.pop() ?? "";
  const speak: string[] = [];
  let carry = "";
  for (const p of parts) {
    if (LIST_MARKER.test(p)) { carry += p; continue; }
    const s = (carry + p).trim();
    if (s) speak.push(s);
    carry = "";
  }
  return { speak, rest: carry + rest };
}

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

  let prompt = opts.systemPrompt || config.systemPrompt;
  if (opts.fromNumber) prompt += `\n\n## Call Context\n- Caller: ${opts.fromNumber}\n- Call ID: ${callId}`;
  const history: Message[] = [{ role: "system", content: prompt }];
  const stt = new InworldSTT(CFG);
  const tts = new InworldTTS(CFG);

  let running = true;
  let processing = false;
  let ttsBusy = false;
  let outBuffer = Buffer.alloc(0);
  let txTimer: ReturnType<typeof setInterval> | null = null;
  let activeAbort: AbortController | null = null;
  let silenceTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingTranscript = "";
  let pendingTurn: string | null = null;
  let resolveRun: (() => void) | null = null;

  let pendingHangup = false;
  let hangupSilenceTicks = 0;
  let hangupArmedAt = 0;
  let hungUp = false;

  const isSpeaking = () => outBuffer.length > 0 || ttsBusy;

  function sendChunk(chunk: Buffer): void {
    if (plivoWs.readyState !== WebSocket.OPEN || !streamId) return;
    plivoWs.send(JSON.stringify({
      event: "playAudio",
      media: { contentType: "audio/x-mulaw", sampleRate: 8000, payload: chunk.toString("base64") },
    }));
  }

  function greet(): void {
    ttsBusy = true;
    tts.beginTurn();
    tts.speak(GREETING);
    tts.endTurn();
    history.push({ role: "assistant", content: GREETING });
  }

  async function handleTurn(transcript: string): Promise<void> {
    if (processing) { pendingTurn = transcript; return; }
    processing = true;
    log("turn", `user: ${transcript}`);
    history.push({ role: "user", content: transcript });

    const abort = new AbortController();
    activeAbort = abort;
    let full = "";
    let sentence = "";
    let spoke = false;
    const toolCalls: { name: string; args: string }[] = [];
    ttsBusy = true;
    tts.beginTurn();
    try {
      for await (const chunk of streamLLM(CFG, history, TOOLS, abort.signal)) {
        if (chunk.type === "tool_call") { toolCalls.push(chunk); continue; }
        full += chunk.text;
        sentence += chunk.text;
        const { speak, rest } = splitSentences(sentence);
        for (const s of speak) { tts.speak(s); spoke = true; }
        sentence = rest;
      }
      if (sentence.trim()) { tts.speak(sentence.trim()); spoke = true; }
      if (toolCalls.some((tc) => tc.name === "end_call") && !spoke) tts.speak("Thanks for calling. Goodbye!");
      tts.endTurn();
      for (const tc of toolCalls) if (tc.name === "end_call") armHangup(tc.args);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      console.error(`[${callId}] [turn] error: ${(err as Error).message}`);
      tts.speak("Sorry, I ran into a problem. Could you say that again?");
      tts.endTurn();
    } finally {
      if (full.trim()) history.push({ role: "assistant", content: full });
      processing = false;
      activeAbort = null;
      if (pendingTurn && !pendingHangup) { const next = pendingTurn; pendingTurn = null; void handleTurn(next); }
      else pendingTurn = null;
    }
  }

  function armHangup(argsJson: string): void {
    let reason = "";
    try { reason = String(JSON.parse(argsJson || "{}").reason || ""); } catch { }
    pendingHangup = true;
    hangupArmedAt = Date.now();
    log("end_call", reason || "requested");
  }

  function bargeIn(): void {
    log("barge-in", "user interrupted");
    if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
    pendingTranscript = "";
    pendingTurn = null;
    if (pendingHangup && !hungUp) { pendingHangup = false; hangupSilenceTicks = 0; hangupArmedAt = 0; }
    outBuffer = Buffer.alloc(0);
    tts.interrupt();
    ttsBusy = false;
    activeAbort?.abort();
    if (plivoWs.readyState === WebSocket.OPEN) plivoWs.send(JSON.stringify({ event: "clearAudio", streamId }));
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

  function finish(): void {
    if (!running) return;
    running = false;
    if (silenceTimer) clearTimeout(silenceTimer);
    if (txTimer) { clearInterval(txTimer); txTimer = null; }
    activeAbort?.abort();
    stt.close();
    tts.close();
    try { if (plivoWs.readyState === WebSocket.OPEN) plivoWs.close(); } catch { }
    log("session", "ended");
    resolveRun?.();
    resolveRun = null;
  }

  function onPlivoMessage(data: Buffer): void {
    let msg: { event?: string; media?: { payload?: string } };
    try { msg = JSON.parse(data.toString()); } catch { return; }
    if (msg.event === "media" && msg.media?.payload) stt.sendCallerAudio(msg.media.payload);
    else if (msg.event === "stop") finish();
  }

  let sttReady = false;
  let ttsReady = false;
  let greeted = false;
  function maybeGreet(): void {
    if (sttReady && ttsReady && !greeted) { greeted = true; greet(); }
  }

  tts.on("ready", () => { ttsReady = true; maybeGreet(); });
  tts.on("audio", (ulaw) => { outBuffer = Buffer.concat([outBuffer, ulaw]); });
  tts.on("done", () => { ttsBusy = false; });
  tts.on("closed", () => finish());

  stt.on("ready", () => { sttReady = true; maybeGreet(); });
  stt.on("transcript", (text, isFinal) => {
    if (isSpeaking()) bargeIn();
    if (!isFinal) return;
    pendingTranscript = (pendingTranscript + " " + text).trim();
    if (silenceTimer) clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => {
      const utterance = pendingTranscript;
      pendingTranscript = "";
      if (utterance) void handleTurn(utterance);
    }, END_OF_UTTERANCE_MS);
  });
  stt.on("closed", () => finish());

  return new Promise<void>((resolve) => {
    resolveRun = resolve;
    plivoWs.on("message", onPlivoMessage);
    plivoWs.on("close", finish);
    plivoWs.on("error", finish);

    txTimer = setInterval(() => {
      if (outBuffer.length >= PLIVO_CHUNK_SIZE) {
        sendChunk(outBuffer.subarray(0, PLIVO_CHUNK_SIZE));
        outBuffer = outBuffer.subarray(PLIVO_CHUNK_SIZE);
      } else if (outBuffer.length > 0 && !processing && !ttsBusy) {
        sendChunk(outBuffer);
        outBuffer = Buffer.alloc(0);
      }

      if (pendingHangup && !hungUp) {
        if (Date.now() - hangupArmedAt > 12000) doHangup();
        else if (!processing && !ttsBusy && outBuffer.length === 0) { if (++hangupSilenceTicks >= 30) doHangup(); }
        else hangupSilenceTicks = 0;
      }
    }, 20);

    stt.connect();
    tts.connect();
  });
}
