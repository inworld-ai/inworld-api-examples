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
  inworldApiKey: required("INWORLD_API_KEY"),

  port: parseInt(optional("PORT", "3000"), 10),
  serverUrl: required("SERVER_URL"),

  systemPrompt: optional(
    "SYSTEM_PROMPT",
    "You are a helpful voice assistant powered by Inworld. Keep responses brief and conversational."
  ),

  inworldModel: optional("INWORLD_MODEL", "openai/gpt-4.1-mini"),

  // Inworld TTS settings
  ttsVoice: optional("TTS_VOICE", "Clive"),
  ttsModel: optional("TTS_MODEL", "inworld-tts-1.5-max"),

  transcriptionProvider: optional("TRANSCRIPTION_PROVIDER", "Deepgram"),

  welcomeGreeting: optional(
    "WELCOME_GREETING",
    "Hi! I'm an AI assistant powered by Inworld. How can I help you?"
  ),
} as const;
