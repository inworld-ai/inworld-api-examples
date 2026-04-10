import { existsSync } from "fs";
import { createServer } from "http";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import express from "express";
import { WebSocketServer } from "ws";
import { config } from "./config.js";
import kidRoutes, { approvedSessions } from "./kid-routes.js";
import { setupInworldProxy } from "./inworld-proxy.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());

// k-ID API proxy routes
app.use("/api/kid", kidRoutes);

// Serve built React frontend in production
const clientDir = resolve(__dirname, "../client");
if (existsSync(clientDir)) {
  app.use(express.static(clientDir));
  app.get("*", (_req, res) => {
    res.sendFile(resolve(clientDir, "index.html"));
  });
}

const server = createServer(app);

// WebSocket proxy to Inworld Realtime API
const wss = new WebSocketServer({ noServer: true });
setupInworldProxy(wss);

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url || "", `http://${req.headers.host}`);
  if (url.pathname !== "/ws") {
    socket.destroy();
    return;
  }

  // Require a valid access token from the k-ID verification flow
  const token = url.searchParams.get("token");
  if (!token || !approvedSessions.has(token)) {
    console.warn("[Server] WebSocket rejected: missing or invalid access token");
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }

  // Consume the token (one-time use)
  approvedSessions.delete(token);
  console.log("[Server] WebSocket approved, token consumed");

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

let port = config.port;
server.on("error", (e: NodeJS.ErrnoException) => {
  if (e.code === "EADDRINUSE") {
    console.warn(`Port ${port} in use, trying ${++port}...`);
    server.listen(port);
  } else {
    throw e;
  }
});

server.listen(port, () => {
  console.log(`[Server] Running on http://localhost:${port}`);
  console.log(`[Server] k-ID API: ${config.kidApiUrl}`);
});
