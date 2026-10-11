/**
 * Shared utilities for the stt-llm-tts (cascaded) pipeline.
 *
 * Inworld TTS returns μ-law 8 kHz directly, so outbound audio needs no
 * conversion. Inworld STT wants linear PCM, so caller audio is decoded from
 * Plivo's μ-law with the standard G.711 routine below.
 */

export function normalizePhoneNumber(
  phone: string,
  defaultCountryCode: string = "1",
): string {
  if (!phone) return "";
  const hadPlus = phone.trim().startsWith("+");
  const digits = phone.replace(/\D/g, "");
  if (!digits) return "";
  if (hadPlus) return digits;
  if (digits.length === 10) return `${defaultCountryCode}${digits}`;
  return digits;
}

const BIAS = 0x84;

function ulawDecodeSample(uByte: number): number {
  uByte = ~uByte & 0xff;
  let t = ((uByte & 0x0f) << 3) + BIAS;
  t <<= (uByte & 0x70) >> 4;
  return (uByte & 0x80) ? BIAS - t : t - BIAS;
}

export function ulawToPcm(ulaw: Uint8Array) {
  const out = Buffer.alloc(ulaw.length * 2);
  for (let i = 0; i < ulaw.length; i++) out.writeInt16LE(ulawDecodeSample(ulaw[i]), i * 2);
  return out;
}

