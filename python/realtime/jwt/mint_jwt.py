import hashlib
import hmac
import os
import secrets
from datetime import datetime, timezone

import httpx


def _hmac_sha256(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode(), hashlib.sha256).digest()


def _signature_key(secret: str, params: list[str]) -> str:
    sig = f"IW1{secret}".encode()
    for p in params:
        sig = _hmac_sha256(sig, p)
    return _hmac_sha256(sig, "iw1_request").hex()


def _build_auth_header(key: str, secret: str, engine_host: str) -> str:
    path = "ai.inworld.engine.WorldEngine/GenerateToken"
    dt = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    nonce = secrets.token_hex(8)[:11]
    sig = _signature_key(secret, [dt, engine_host.replace(":443", ""), path, nonce])
    return f"IW1-HMAC-SHA256 ApiKey={key},DateTime={dt},Nonce={nonce},Signature={sig}"


async def mint_jwt() -> dict:
    """Mint a JWT from Inworld's auth endpoint.

    Reads INWORLD_KEY, INWORLD_SECRET, INWORLD_WORKSPACE from env.
    Returns dict with token, type, expirationTime, sessionId.
    """
    key = os.environ.get("INWORLD_KEY", "")
    secret = os.environ.get("INWORLD_SECRET", "")
    host = os.environ.get("INWORLD_HOST", "api.inworld.ai")
    engine_host = os.environ.get("INWORLD_ENGINE_HOST", "api-engine.inworld.ai")
    workspace = os.environ.get("INWORLD_WORKSPACE", "workspaces/default-workspace")

    auth = _build_auth_header(key, secret, engine_host)

    async with httpx.AsyncClient() as client:
        r = await client.post(
            f"https://{host}/auth/v1/tokens/token:generate",
            headers={"Authorization": auth, "Content-Type": "application/json"},
            json={"key": key, "resources": [workspace]},
        )
        r.raise_for_status()
        return r.json()
