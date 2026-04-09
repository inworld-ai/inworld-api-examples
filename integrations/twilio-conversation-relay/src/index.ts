import express from "express";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { config } from "./config.js";
import { twimlRouter } from "./server/twiml.js";
import { handleConversation } from "./conversation/session-handler.js";
import { getAudio } from "./conversation/audio-store.js";

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(twimlRouter);

// Serve synthesized audio clips for ConversationRelay `play` messages
app.get("/audio/:id", (req, res) => {
  const clip = getAudio(req.params.id);
  if (!clip) {
    res.status(404).send("Not found");
    return;
  }
  res.set("Content-Type", clip.contentType);
  res.set("Content-Length", String(clip.buffer.length));
  res.send(clip.buffer);
});

const server = createServer(app);
const wss = new WebSocketServer({ server });

wss.on("connection", (ws, req) => {
  if (req.url?.startsWith("/conversation")) {
    handleConversation(ws);
  } else {
    ws.close();
  }
});

server.listen(config.port, () => {
  console.log(`[server] Listening on port ${config.port}`);
  console.log(`[server] Voice webhook: ${config.serverUrl}/voice`);
});

process.on("SIGINT", () => { server.close(); process.exit(0); });
process.on("SIGTERM", () => { server.close(); process.exit(0); });
