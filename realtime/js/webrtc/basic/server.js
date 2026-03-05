import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { createServer } from 'http';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env') });

const html = readFileSync(resolve(__dirname, 'index.html'));
const API_KEY = process.env.INWORLD_API_KEY || '';
const AUTH_PREFIX = process.env.AUTH_TYPE === 'bearer' ? 'Bearer' : 'Basic';
const PROXY = 'https://api.inworld.ai';

const server = createServer(async (req, res) => {
  if (req.url === '/api/config') {
    console.log('[config] browser requested config');
    let ice = [];
    try {
      const iceUrl = `${PROXY}/v1/realtime/ice-servers`;
      console.log('[config] fetching ICE servers →', iceUrl);
      const r = await fetch(iceUrl, {
        headers: { Authorization: `${AUTH_PREFIX} ${API_KEY}` },
      });
      if (r.ok) {
        ice = (await r.json()).ice_servers || [];
        console.log(`[config] got ${ice.length} ICE server(s)`);
      } else {
        const body = await r.text();
        console.error(`[config] ICE fetch failed (${r.status}):`, body.slice(0, 200));
      }
    } catch (e) {
      console.error('[config] ICE fetch error:', e.message);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ api_key: API_KEY, auth_prefix: AUTH_PREFIX, ice_servers: ice, url: `${PROXY}/v1/realtime/calls` }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(html);
});

let port = 3000;
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') { console.warn(`Port ${port} in use, trying ${++port}…`); server.listen(port); }
  else throw e;
});
server.listen(port, () => console.log(`Open http://localhost:${port}`));
