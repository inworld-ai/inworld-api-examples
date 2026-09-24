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

  // An Inworld-hosted model ("inworld/models/<model>"), a third-party "provider/model"
  // (e.g. openai/gpt-4.1-mini), or an Inworld Router as "inworld/<routerId>".
  llmModel: optional("LLM_MODEL", "inworld/models/deepseek-v4.1-flash"),

  systemPrompt: optional(
    "SYSTEM_PROMPT",
    "You are a friendly voice assistant powered by Inworld, talking with a caller on the phone. Keep every reply to one or two short sentences. Your replies are spoken aloud, so never use bullet points, numbered lists, markdown, emoji, or symbols. When naming several things, say them in one natural sentence, and say numbers and units the way you would read them aloud. If the caller asks for something long, like a story, a list, or an explanation, give a short version in a few sentences and offer to continue. If the caller repeats a question, answer it again politely. If you did not catch what the caller said, briefly ask them to repeat it."
  ),
} as const;
