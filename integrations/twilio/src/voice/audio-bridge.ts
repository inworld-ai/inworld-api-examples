/**
 * Audio format conversion: Twilio mulaw 8kHz ↔ Inworld PCM16 24kHz.
 */

const BIAS = 0x84;
const MAX = 32635;

function mulawDecode(byte: number): number {
  byte = ~byte;
  const sign = byte & 0x80;
  const exponent = (byte >> 4) & 0x07;
  const mantissa = byte & 0x0f;
  let sample = ((mantissa << 3) + BIAS) << exponent;
  sample -= BIAS;
  return sign ? sample : -sample;
}

function mulawEncode(sample: number): number {
  let sign = (sample >> 8) & 0x80;
  if (sign) sample = -sample;
  if (sample > MAX) sample = MAX;
  sample += BIAS;

  let exponent = 7;
  for (let mask = 0x4000; (sample & mask) === 0; mask >>= 1) exponent--;
  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  return (~(sign | (exponent << 4) | mantissa)) & 0xff;
}

function resample(buf: Buffer, fromRate: number, toRate: number): Buffer {
  if (fromRate === toRate) return buf;
  const inSamples = buf.length / 2;
  const outSamples = Math.floor((inSamples * toRate) / fromRate);
  const out = Buffer.alloc(outSamples * 2);
  const ratio = fromRate / toRate;

  for (let i = 0; i < outSamples; i++) {
    const src = i * ratio;
    const lo = Math.floor(src);
    const hi = Math.min(lo + 1, inSamples - 1);
    const frac = src - lo;
    const s1 = buf.readInt16LE(lo * 2);
    const s2 = buf.readInt16LE(hi * 2);
    out.writeInt16LE(Math.round(s1 + (s2 - s1) * frac), i * 2);
  }
  return out;
}

function mulawToPcm(buf: Buffer): Buffer {
  const pcm = Buffer.alloc(buf.length * 2);
  for (let i = 0; i < buf.length; i++) pcm.writeInt16LE(mulawDecode(buf[i]), i * 2);
  return pcm;
}

function pcmToMulaw(buf: Buffer): Buffer {
  const mulaw = Buffer.alloc(buf.length / 2);
  for (let i = 0; i < mulaw.length; i++) mulaw[i] = mulawEncode(buf.readInt16LE(i * 2));
  return mulaw;
}

/** Twilio mulaw 8kHz → Inworld PCM16 24kHz */
export function twilioToInworld(mulawBuf: Buffer): Buffer {
  return resample(mulawToPcm(mulawBuf), 8000, 24000);
}

/** Inworld PCM16 24kHz → Twilio mulaw 8kHz */
export function inworldToTwilio(pcmBuf: Buffer): Buffer {
  return pcmToMulaw(resample(pcmBuf, 24000, 8000));
}
