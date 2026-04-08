/**
 * Handles a ConversationRelay WebSocket session.
 *
 * Uses Inworld Router's combined LLM+TTS endpoint: a single streaming request
 * returns both text and audio. Audio segments (sentence-level) are stored and
 * served via HTTP, then sent as `play` messages to ConversationRelay.
 */
import WebSocket from "ws";
import { config } from "../config.js";
import { type Message, streamWithAudio } from "./inworld-llm.js";
import { storeAudio, wrapPcmWav } from "./audio-store.js";

interface SetupMessage {
  type: "setup";
  callSid: string;
  from: string;
  to: string;
  [key: string]: unknown;
}

interface PromptMessage {
  type: "prompt";
  voicePrompt: string;
}

interface InterruptMessage {
  type: "interrupt";
  utteranceUntilInterrupt: string;
  durationUntilInterruptMs: number;
}

interface DtmfMessage {
  type: "dtmf";
  digit: string;
}

interface ErrorMessage {
  type: "error";
  description: string;
}

type IncomingMessage =
  | SetupMessage
  | PromptMessage
  | InterruptMessage
  | DtmfMessage
  | ErrorMessage;

export function handleConversation(ws: WebSocket): void {
  const history: Message[] = [{ role: "system", content: config.systemPrompt }];
  let activeAbort: AbortController | null = null;

  function sendPlay(audioId: string) {
    if (ws.readyState === WebSocket.OPEN) {
      const url = `${config.serverUrl}/audio/${audioId}`;
      ws.send(JSON.stringify({ type: "play", source: url }));
    }
  }

  /** Store a PCM audio segment as WAV and send a play message. */
  function playSegment(pcm: Buffer, transcript: string) {
    const wav = wrapPcmWav(pcm);
    const id = storeAudio(wav, "audio/wav");
    console.log(`[tts] Playing: "${transcript.slice(0, 80)}${transcript.length > 80 ? "..." : ""}" (${id})`);
    sendPlay(id);
  }

  async function handleSetup() {
    // Speak welcome greeting via Inworld LLM+TTS
    try {
      const messages: Message[] = [
        { role: "system", content: "You are a voice assistant. Repeat the following greeting exactly as given." },
        { role: "user", content: config.welcomeGreeting },
      ];
      for await (const segment of streamWithAudio(messages)) {
        playSegment(segment.pcm, segment.transcript);
      }
    } catch (err) {
      console.error("[conversation] Welcome greeting error:", err);
    }
  }

  async function handlePrompt(text: string) {
    history.push({ role: "user", content: text });

    const abort = new AbortController();
    activeAbort = abort;

    let fullTranscript = "";

    try {
      for await (const segment of streamWithAudio(history, abort.signal)) {
        fullTranscript += segment.transcript;
        playSegment(segment.pcm, segment.transcript);
      }

      history.push({ role: "assistant", content: fullTranscript });
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        console.log("[conversation] Stream aborted (interrupt)");
        if (fullTranscript) {
          history.push({ role: "assistant", content: fullTranscript });
        }
      } else {
        console.error("[conversation] Error:", err);
      }
    } finally {
      activeAbort = null;
    }
  }

  ws.on("message", (data: Buffer) => {
    const msg: IncomingMessage = JSON.parse(data.toString());

    switch (msg.type) {
      case "setup":
        console.log(`[conversation] Call connected (sid: ${msg.callSid}, from: ${msg.from})`);
        handleSetup();
        break;

      case "prompt":
        console.log(`[conversation] User: ${msg.voicePrompt}`);
        handlePrompt(msg.voicePrompt);
        break;

      case "interrupt":
        console.log(
          `[conversation] Interrupted after ${msg.durationUntilInterruptMs}ms: "${msg.utteranceUntilInterrupt}"`
        );
        activeAbort?.abort();
        activeAbort = null;
        break;

      case "dtmf":
        console.log(`[conversation] DTMF: ${msg.digit}`);
        break;

      case "error":
        console.error(`[conversation] Error: ${msg.description}`);
        break;
    }
  });

  ws.on("close", () => {
    console.log("[conversation] WebSocket closed");
    activeAbort?.abort();
  });
}
