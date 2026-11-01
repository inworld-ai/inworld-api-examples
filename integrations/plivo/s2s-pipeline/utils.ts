/**
 * Shared utilities for the s2s-pipeline example.
 *
 * For the speech-to-speech pipeline, audio is G.711 μ-law at 8 kHz on BOTH the
 * Plivo and Inworld legs, so no transcoding/resampling is needed (unlike a
 * cascaded pipeline whose STT/TTS want LINEAR16/PCM). This file therefore only
 * holds phone-number helpers and shared constants. Audio-conversion helpers
 * (ulaw↔pcm, resample) live here in pipelines that need them.
 */

/**
 * Normalize a phone number to bare E.164 digits (no leading '+'), the form the
 * Plivo Numbers API expects. Returns "" if no digits are present.
 *
 * Examples: "+1 (415) 555-1234" -> "14155551234"; "4155551234" -> "14155551234"
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
