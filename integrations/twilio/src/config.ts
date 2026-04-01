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
  twilioAccountSid: optional("TWILIO_ACCOUNT_SID", ""),
  twilioAuthToken: optional("TWILIO_AUTH_TOKEN", ""),
  twilioPhoneNumber: optional("TWILIO_PHONE_NUMBER", ""),

  inworldApiKey: required("INWORLD_API_KEY"),

  port: parseInt(optional("PORT", "3000"), 10),
  serverUrl: required("SERVER_URL"),

  systemPrompt: optional(
    "SYSTEM_PROMPT",
    "You are a helpful voice assistant powered by Inworld. Keep responses brief and conversational."
  ),
} as const;
