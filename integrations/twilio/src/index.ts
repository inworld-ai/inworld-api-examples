import express from "express";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { config } from "./config.js";
import { twimlRouter } from "./server/twiml.js";
import { handleCallStream } from "./voice/call-handler.js";

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(twimlRouter);

const server = createServer(app);
const wss = new WebSocketServer({ server });

wss.on("connection", (ws, req) => {
  if (req.url?.startsWith("/media-stream")) {
    handleCallStream(ws);
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
