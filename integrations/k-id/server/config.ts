import "dotenv/config";

function required(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

export const config = {
  kidApiKey: required("K_ID_API_KEY"),
  kidApiUrl: optional("K_ID_API_URL", "https://game-api.test.k-id.com"),
  inworldApiKey: required("INWORLD_API_KEY"),
  port: parseInt(optional("PORT", "3000"), 10),
  systemPrompt: optional(
    "SYSTEM_PROMPT",
    "You are a friendly voice assistant. Keep responses brief and conversational."
  ),
  inworldModel: optional("INWORLD_MODEL", "openai/gpt-4o-mini"),
  ttsVoice: optional("TTS_VOICE", "Clive"),
} as const;
