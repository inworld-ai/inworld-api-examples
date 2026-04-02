import express from "express";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { config } from "./config.js";
import { webhookRouter } from "./server/webhook.js";
import { handleCallStream } from "./voice/call-handler.js";

const app = express();
app.use(express.json());
app.use(webhookRouter);

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
  console.log(`[server] Webhook URL: ${config.serverUrl}/webhook`);
});

process.on("SIGINT", () => { server.close(); process.exit(0); });
process.on("SIGTERM", () => { server.close(); process.exit(0); });
