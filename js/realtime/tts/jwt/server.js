import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { createServer } from 'http';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
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

const server = createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/tts') {
    let body = '';
    for await (const chunk of req) body += chunk;

    try {
      const params = JSON.parse(body);
      const apiRes = await fetch('https://api.inworld.ai/tts/v1/voice:stream', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${JWT}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: params.text,
          voiceId: params.voiceId || 'Clive',
          modelId: params.modelId || 'inworld-tts-1.5-mini',
          audioConfig: {
            audioEncoding: 'LINEAR16',
            sampleRateHertz: params.sampleRateHertz || 24000,
          },
        }),
      });

      if (!apiRes.ok) {
        const err = await apiRes.text();
        console.error(`TTS API error (${apiRes.status}):`, err);
        res.writeHead(apiRes.status, { 'Content-Type': 'text/plain' });
        res.end(err);
        return;
      }

      res.writeHead(200, {
        'Content-Type': apiRes.headers.get('content-type') || 'application/json',
        'Transfer-Encoding': 'chunked',
      });
      for await (const chunk of apiRes.body) {
        res.write(Buffer.from(chunk));
      }
      res.end();
    } catch (e) {
      console.error('TTS proxy error:', e.message);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(e.message);
    }
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
