import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { createServer } from 'http';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { mintJwt } from '../../jwt/mint-jwt.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env') });

let JWT;
try {
  const result = await mintJwt();
  JWT = result.token;
  console.log(`JWT minted (expires ${result.expirationTime})`);
} catch (e) {
  console.error('Failed to mint JWT:', e.message);
  process.exit(1);
}

const html = readFileSync(resolve(__dirname, 'index.html'));
const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(html);
});
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (browser) => {
  console.log('[proxy] browser connected, opening API socket…');
  const apiUrl = `wss://api.inworld.ai/api/v1/realtime/session?key=voice-${Date.now()}&protocol=realtime`;
  console.log('[proxy] →', apiUrl);
  const api = new WebSocket(apiUrl, {
    headers: { Authorization: `Bearer ${JWT}` },
  });

  api.on('open', () => console.log('[proxy] API socket open'));
  api.on('message', (raw) => {
    const preview = raw.toString().slice(0, 200);
    console.log('[api→browser]', preview);
    if (browser.readyState === WebSocket.OPEN) browser.send(raw.toString());
  });

  browser.on('message', (msg) => {
    const s = msg.toString();
    if (!s.includes('"input_audio_buffer.append"')) {
      console.log('[browser→api]', s.slice(0, 200));
    }
    if (api.readyState === WebSocket.OPEN) api.send(s);
  });

  browser.on('close', () => { console.log('[proxy] browser closed'); api.close(); });
  api.on('close', (code, reason) => {
    console.log(`[proxy] API closed code=${code} reason=${reason}`);
    if (browser.readyState === WebSocket.OPEN) browser.close();
  });
  api.on('error', (e) => console.error('[proxy] API error:', e.message));
});

let port = 3000;
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') { console.warn(`Port ${port} in use, trying ${++port}…`); server.listen(port); }
  else throw e;
});
server.listen(port, () => console.log(`Open http://localhost:${port}`));
