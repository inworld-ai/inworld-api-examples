/**
 * TwiML webhook: returns <Connect><Stream> to open a media stream back to us.
 */
import { Router } from "express";
import twilio from "twilio";
import { config } from "../config.js";

export const twimlRouter = Router();

twimlRouter.post("/voice", (_req, res) => {
  const response = new twilio.twiml.VoiceResponse();
  response.connect().stream({
    url: `${config.serverUrl.replace("https://", "wss://")}/media-stream`,
  });
  res.type("text/xml").send(response.toString());
});
