/**
 * Inworld LLM + TTS streaming client.
 *
 * Uses the Inworld Router's combined LLM+TTS endpoint: a single streaming
 * request returns both text and audio. Audio arrives as base64 PCM chunks
 * in the SSE stream alongside transcripts.
 *
 * Audio segments are yielded at natural sentence boundaries (determined by
 * Inworld's chunking engine). Each segment contains accumulated PCM audio
 * and the transcript for that segment.
 */
import { config } from "../config.js";

export type Message = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type AudioSegment = {
  pcm: Buffer;       // Raw PCM 48kHz 16-bit mono
  transcript: string; // Text being spoken
};

/**
 * Stream LLM + TTS from Inworld Router.
 * Yields AudioSegments at sentence boundaries.
 */
export async function* streamWithAudio(
  messages: Message[],
  signal?: AbortSignal
): AsyncGenerator<AudioSegment> {
  const response = await fetch("https://api.inworld.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Basic ${config.inworldApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.inworldModel,
      messages,
      stream: true,
      audio: {
        voice: config.ttsVoice,
        model: config.ttsModel,
      },
    }),
    signal,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Inworld Router error ${response.status}: ${body}`);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let sseBuffer = "";

  // Current audio segment being accumulated
  let audioChunks: Buffer[] = [];
  let currentTranscript = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    sseBuffer += decoder.decode(value, { stream: true });
    const lines = sseBuffer.split("\n");
    sseBuffer = lines.pop()!;

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") break;

      let chunk: { choices?: { delta?: { audio?: { transcript?: string; data?: string } } }[] };
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }

      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;

      const audio = delta.audio;
      if (audio) {
        // A new transcript marks the start of a new text segment.
        // Flush the previous segment if we have accumulated audio.
        if (audio.transcript && audioChunks.length > 0) {
          yield { pcm: Buffer.concat(audioChunks), transcript: currentTranscript };
          audioChunks = [];
          currentTranscript = "";
        }

        if (audio.transcript) {
          currentTranscript += audio.transcript;
        }

        if (audio.data) {
          audioChunks.push(Buffer.from(audio.data, "base64"));
        }
      }
    }
  }

  // Flush final segment
  if (audioChunks.length > 0) {
    yield { pcm: Buffer.concat(audioChunks), transcript: currentTranscript };
  }
}
