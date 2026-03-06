import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { createServer } from 'http';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env') });

const API_KEY = process.env.INWORLD_API_KEY || '';

const html = readFileSync(resolve(__dirname, 'index.html'));
const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(html);
});
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (browser) => {
  const api = new WebSocket(
    `wss://api.inworld.ai/api/v1/realtime/session?key=voice-${Date.now()}&protocol=realtime`,
    { headers: { Authorization: `Basic ${API_KEY}` } }
  );

  api.on('message', (raw) => {
    if (browser.readyState === WebSocket.OPEN) browser.send(raw.toString());
  });

  browser.on('message', (msg) => {
    if (api.readyState === WebSocket.OPEN) api.send(msg.toString());
  });

  browser.on('close', () => api.close());
  api.on('close', () => { if (browser.readyState === WebSocket.OPEN) browser.close(); });
  api.on('error', (e) => console.error('API error:', e.message));
});

let port = 3000;
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') { console.warn(`Port ${port} in use, trying ${++port}…`); server.listen(port); }
  else throw e;
});
server.listen(port, () => console.log(`Open http://localhost:${port}`));
