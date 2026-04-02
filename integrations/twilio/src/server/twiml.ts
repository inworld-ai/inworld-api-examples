/**
 * TwiML webhook: returns <Connect><Stream> to open a media stream back to us.
 */
import { Router } from "express";
import twilio from "twilio";
import { config } from "../config.js";

export const twimlRouter = Router();

twimlRouter.post("/voice", (_req, res) => {
  const wsUrl = new URL("/media-stream", config.serverUrl);
  wsUrl.protocol = wsUrl.protocol === "http:" ? "ws:" : "wss:";

  const response = new twilio.twiml.VoiceResponse();
  response.connect().stream({ url: wsUrl.toString() });
  res.type("text/xml").send(response.toString());
});
