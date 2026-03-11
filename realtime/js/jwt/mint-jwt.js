import crypto from 'crypto';
import CryptoJS from 'crypto-js';
const { HmacSHA256 } = CryptoJS;

function getDateTime() {
  const parts = new Date().toISOString().split('T');
  const date = parts[0].replace(/-/g, '');
  const time = parts[1].replace(/:/g, '').substring(0, 6);
  return `${date}${time}`;
}

function getSignatureKey(key, params) {
  let signature = `IW1${key}`;
  for (const p of params) signature = HmacSHA256(p, signature);
  return HmacSHA256('iw1_request', signature).toString();
}

function buildAuthHeader({ key, secret, engineHost }) {
  const path = 'ai.inworld.engine.WorldEngine/GenerateToken';
  const datetime = getDateTime();
  const nonce = crypto.randomBytes(16).toString('hex').slice(1, 12);
  const signature = getSignatureKey(secret, [
    datetime,
    engineHost.replace(':443', ''),
    path,
    nonce,
  ]);
  return `IW1-HMAC-SHA256 ApiKey=${key},DateTime=${datetime},Nonce=${nonce},Signature=${signature}`;
}

/**
 * Mint a JWT from Inworld's auth endpoint.
 * Reads INWORLD_KEY, INWORLD_SECRET, INWORLD_WORKSPACE from process.env.
 * Returns { token, type, expirationTime, sessionId }.
 */
export async function mintJwt() {
  const key = process.env.INWORLD_KEY || '';
  const secret = process.env.INWORLD_SECRET || '';
  const host = process.env.INWORLD_HOST || 'api.inworld.ai';
  const engineHost = process.env.INWORLD_ENGINE_HOST || 'api-engine.inworld.ai';
  const workspace = process.env.INWORLD_WORKSPACE || 'workspaces/default-workspace';

  const authHeader = buildAuthHeader({ key, secret, engineHost });

  const res = await fetch(`https://${host}/auth/v1/tokens/token:generate`, {
    method: 'POST',
    headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, resources: [workspace] }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`JWT mint failed (${res.status}): ${body}`);
  }

  return res.json();
}
