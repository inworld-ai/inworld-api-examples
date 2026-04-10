import { useState, useRef, useCallback, useEffect } from "react";

interface Props {
  userName: string;
  accessToken: string;
}

interface Turn {
  role: "user" | "agent";
  text: string;
  pending?: boolean; // true = user is still speaking, show "..."
}

/**
 * Inworld Realtime voice chat component.
 * Adapted from realtime/js/websockets/basic — same WebSocket proxy pattern,
 * AudioWorklet mic capture, and scheduled buffer playback.
 */
export default function RealtimeChat({ userName, accessToken }: Props) {
  const [active, setActive] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const transcriptRef = useRef<HTMLDivElement>(null);

  // Refs for audio/ws state (not React state — these mutate in event handlers)
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const captureCtxRef = useRef<AudioContext | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const nextPlayTimeRef = useRef(0);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const interruptedRef = useRef(false);
  const currentTurnRef = useRef<{ role: string; index: number } | null>(null);

  // Auto-scroll transcript
  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [turns]);

  // --- Audio helpers ---

  function arrayBufferToBase64(buf: ArrayBuffer): string {
    const bytes = new Uint8Array(buf);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode(
        ...bytes.subarray(i, Math.min(i + 0x8000, bytes.length))
      );
    }
    return btoa(bin);
  }

  function base64ToFloat32(b64: string): Float32Array {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const pcm16 = new Int16Array(bytes.buffer);
    const f32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) f32[i] = pcm16[i] / 32768;
    return f32;
  }

  function queueAudio(base64: string) {
    const ctx = playbackCtxRef.current;
    if (!ctx || interruptedRef.current) return;
    const f32 = base64ToFloat32(base64);
    const buf = ctx.createBuffer(1, f32.length, 24000);
    buf.getChannelData(0).set(f32);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    const now = ctx.currentTime;
    if (nextPlayTimeRef.current < now) nextPlayTimeRef.current = now;
    src.start(nextPlayTimeRef.current);
    nextPlayTimeRef.current += buf.duration;
    activeSourcesRef.current.push(src);
    src.onended = () => {
      const idx = activeSourcesRef.current.indexOf(src);
      if (idx !== -1) activeSourcesRef.current.splice(idx, 1);
    };
  }

  function flushAudio() {
    activeSourcesRef.current.forEach((s) => {
      try { s.stop(); } catch { /* already stopped */ }
    });
    activeSourcesRef.current = [];
    nextPlayTimeRef.current = 0;
  }

  // --- Send helper ---

  function sendWs(obj: Record<string, unknown>) {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }

  // --- Transcript helpers ---

  const appendToAgentTurn = useCallback((delta: string) => {
    setTurns((prev) => {
      const current = currentTurnRef.current;
      if (current && current.role === "agent" && current.index < prev.length) {
        const updated = [...prev];
        updated[current.index] = {
          ...updated[current.index],
          text: updated[current.index].text + delta,
        };
        return updated;
      }
      const newTurns = [...prev, { role: "agent" as const, text: delta }];
      currentTurnRef.current = { role: "agent", index: newTurns.length - 1 };
      return newTurns;
    });
  }, []);

  const finalizeAgentTurn = useCallback((text: string) => {
    setTurns((prev) => {
      const current = currentTurnRef.current;
      if (current && current.role === "agent" && current.index < prev.length) {
        const updated = [...prev];
        updated[current.index] = { ...updated[current.index], text };
        return updated;
      }
      // Don't create a new turn — only update existing ones.
      // This prevents duplicates from late-arriving events after response.done clears the ref.
      return prev;
    });
  }, []);

  // User: show "..." pending bubble while speaking, replace with final text
  const startUserTurn = useCallback(() => {
    setTurns((prev) => {
      // Don't double-create if there's already a pending user turn
      const current = currentTurnRef.current;
      if (current && current.role === "user" && current.index < prev.length && prev[current.index].pending) {
        return prev;
      }
      const newTurns = [...prev, { role: "user" as const, text: "", pending: true }];
      currentTurnRef.current = { role: "user", index: newTurns.length - 1 };
      return newTurns;
    });
  }, []);

  const finalizeUserTurn = useCallback((text: string) => {
    setTurns((prev) => {
      const current = currentTurnRef.current;
      if (current && current.role === "user" && current.index < prev.length) {
        const updated = [...prev];
        updated[current.index] = { role: "user", text, pending: false };
        return updated;
      }
      return prev;
    });
  }, []);

  // --- Mic capture ---

  async function startCapture() {
    const ctx = new AudioContext({ sampleRate: 24000 });
    captureCtxRef.current = ctx;
    const source = ctx.createMediaStreamSource(streamRef.current!);

    const workletCode = `
      class P extends AudioWorkletProcessor {
        constructor() { super(); this._buf = []; this._len = 0; }
        process(inputs) {
          const ch = inputs[0]?.[0];
          if (!ch) return true;
          const pcm = new Int16Array(ch.length);
          for (let i = 0; i < ch.length; i++) {
            const s = Math.max(-1, Math.min(1, ch[i]));
            pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          }
          this._buf.push(pcm);
          this._len += pcm.length;
          if (this._len >= 2400) {
            const out = new Int16Array(this._len);
            let off = 0;
            for (const c of this._buf) { out.set(c, off); off += c.length; }
            this._buf = []; this._len = 0;
            this.port.postMessage(out.buffer, [out.buffer]);
          }
          return true;
        }
      }
      registerProcessor('pcm', P);
    `;
    const blob = new Blob([workletCode], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);

    const worklet = new AudioWorkletNode(ctx, "pcm");
    workletRef.current = worklet;
    worklet.port.onmessage = (e: MessageEvent) => {
      sendWs({
        type: "input_audio_buffer.append",
        audio: arrayBufferToBase64(e.data),
      });
    };
    source.connect(worklet);
    worklet.connect(ctx.destination);
  }

  // --- Session lifecycle ---

  async function start() {
    setConnecting(true);
    setTurns([]);
    currentTurnRef.current = null;
    interruptedRef.current = false;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    streamRef.current = stream;

    const playbackCtx = new AudioContext({ sampleRate: 24000 });
    playbackCtxRef.current = playbackCtx;
    if (playbackCtx.state === "suspended") await playbackCtx.resume();

    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(accessToken)}`);
    wsRef.current = ws;

    ws.onmessage = async (e) => {
      const msg = JSON.parse(e.data);
      const type = msg.type || "";

      if (msg.errorType === "SESSION_RESOURCES_EXHAUSTED") return;

      switch (type) {
        case "session.created":
          sendWs({
            type: "session.update",
            session: {
              type: "realtime",
              model: "openai/gpt-4o-mini",
              instructions: `You are a friendly voice assistant talking to ${userName}. Keep responses brief and conversational.`,
              output_modalities: ["audio", "text"],
              audio: {
                input: {
                  turn_detection: {
                    type: "semantic_vad",
                    eagerness: "high",
                    create_response: true,
                    interrupt_response: true,
                  },
                },
                output: { model: "inworld-tts-1.5-mini", voice: "Clive" },
              },
            },
          });
          break;

        case "session.updated":
          setConnecting(false);
          setActive(true);
          await startCapture();
          sendWs({
            type: "conversation.item.create",
            item: {
              type: "message",
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: `Greet ${userName} by name and ask how you can help. One sentence max.`,
                },
              ],
            },
          });
          sendWs({ type: "response.create" });
          break;

        // Agent audio playback
        case "response.audio.delta":
        case "response.output_audio.delta":
          if (msg.delta) queueAudio(msg.delta);
          break;

        // Agent transcript — use ONLY audio transcript to avoid double-display
        case "response.audio_transcript.delta":
        case "response.output_audio_transcript.delta":
          if (msg.delta) appendToAgentTurn(msg.delta);
          break;

        case "response.output_audio_transcript.done":
          if (msg.transcript) finalizeAgentTurn(msg.transcript);
          break;

        // User: finalized transcription only (no progressive deltas)
        case "conversation.item.input_audio_transcription.completed":
          if (msg.transcript) finalizeUserTurn(msg.transcript);
          break;

        // User started speaking
        case "input_audio_buffer.speech_started":
          interruptedRef.current = true;
          flushAudio();
          sendWs({ type: "response.cancel" });
          if (currentTurnRef.current?.role === "agent") {
            currentTurnRef.current = null;
          }
          startUserTurn();
          break;

        case "response.output_item.added":
          if (interruptedRef.current) interruptedRef.current = false;
          break;

        case "response.done":
          currentTurnRef.current = null;
          break;
      }
    };

    ws.onclose = () => {
      if (active) stop();
    };
    ws.onerror = (e) => console.error("WS error:", e);
  }

  function stop() {
    if (workletRef.current) {
      workletRef.current.disconnect();
      workletRef.current = null;
    }
    if (captureCtxRef.current) {
      captureCtxRef.current.close();
      captureCtxRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    flushAudio();
    if (playbackCtxRef.current) {
      playbackCtxRef.current.close();
      playbackCtxRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setActive(false);
    setConnecting(false);
    interruptedRef.current = false;
    currentTurnRef.current = null;
  }

  function toggle() {
    if (active) {
      stop();
    } else {
      start().catch((e) => {
        console.error(e);
        stop();
      });
    }
  }

  return (
    <div className="realtime-chat">
      <div className="chat-header">
        <h2>Voice Conversation</h2>
        <p>Hi {userName}! You're verified and ready to chat.</p>
        <button
          className={`btn ${active ? "btn-stop" : ""}`}
          onClick={toggle}
          disabled={connecting}
        >
          {connecting
            ? "Connecting..."
            : active
              ? "Stop Conversation"
              : "Start Conversation"}
        </button>
      </div>

      <div className="transcript" ref={transcriptRef}>
        {turns.length === 0 && !active && (
          <p className="transcript-empty">
            Click "Start Conversation" to begin speaking with the voice agent.
          </p>
        )}
        {turns.map((turn, i) => (
          <div key={i} className="turn">
            <div className={`turn-label ${turn.role}`}>
              {turn.role === "user" ? "You" : "Agent"}
            </div>
            <div className="turn-text">
              {turn.pending ? <span className="typing-dots" /> : turn.text}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
