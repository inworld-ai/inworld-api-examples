/**
 * In-memory audio clip store + WAV wrapping.
 *
 * Stores synthesized audio buffers and serves them via HTTP so
 * ConversationRelay can fetch them for `play` messages.
 */
import { randomUUID } from "node:crypto";

const store = new Map<string, { buffer: Buffer; contentType: string }>();

/** Store an audio buffer and return its ID. Auto-expires after 60s. */
export function storeAudio(buffer: Buffer, contentType: string): string {
  const id = randomUUID();
  store.set(id, { buffer, contentType });
  setTimeout(() => store.delete(id), 60_000);
  return id;
}

/** Retrieve a stored audio clip by ID. */
export function getAudio(id: string) {
  return store.get(id) ?? null;
}

/**
 * Wrap raw PCM audio (48kHz, 16-bit, mono) in a WAV header.
 */
export function wrapPcmWav(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44);
  const sampleRate = 48000;
  const bitsPerSample = 16;
  const channels = 1;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);       // fmt chunk size
  header.writeUInt16LE(1, 20);        // PCM format
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}
