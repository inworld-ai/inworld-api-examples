/**
 * TwiML webhook: returns <Connect><ConversationRelay> to start a conversation session.
 *
 * No welcomeGreeting or ttsProvider — we handle TTS ourselves via Inworld TTS
 * and send `play` messages with audio URLs.
 */
import { Router } from "express";
import twilio from "twilio";
import { config } from "../config.js";

export const twimlRouter = Router();

twimlRouter.post("/voice", (_req, res) => {
  const wsUrl = new URL("/conversation", config.serverUrl);
  wsUrl.protocol = wsUrl.protocol === "http:" ? "ws:" : "wss:";

  const response = new twilio.twiml.VoiceResponse();
  const connect = response.connect();
  connect.conversationRelay({
    url: wsUrl.toString(),
    transcriptionProvider: config.transcriptionProvider,
    interruptible: "true",
    dtmfDetection: true,
  });

  res.type("text/xml").send(response.toString());
});
