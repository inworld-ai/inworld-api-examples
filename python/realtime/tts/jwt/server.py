import asyncio
import os
import sys
from pathlib import Path

import httpx
from aiohttp import web
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from jwt.mint_jwt import mint_jwt

HTML = (Path(__file__).parent / "index.html").read_bytes()
JWT = None


async def init_jwt():
    global JWT
    result = await mint_jwt()
    JWT = result["token"]
    print(f"JWT minted (expires {result['expirationTime']})")


async def index(request):
    return web.Response(body=HTML, content_type="text/html")


async def tts_proxy(request):
    params = await request.json()
    body = {
        "text": params.get("text", ""),
        "voiceId": params.get("voiceId", "Clive"),
        "modelId": params.get("modelId", "inworld-tts-1.5-mini"),
        "audioConfig": {
            "audioEncoding": "LINEAR16",
            "sampleRateHertz": params.get("sampleRateHertz", 24000),
        },
    }

    async with httpx.AsyncClient() as client:
        async with client.stream(
            "POST",
            "https://api.inworld.ai/tts/v1/voice:stream",
            headers={
                "Authorization": f"Bearer {JWT}",
                "Content-Type": "application/json",
            },
            json=body,
            timeout=60,
        ) as r:
            if not r.is_success:
                await r.aread()
                return web.Response(status=r.status_code, text=r.text)

            resp = web.StreamResponse(
                status=200,
                headers={"Content-Type": r.headers.get("content-type", "application/json")},
            )
            await resp.prepare(request)
            async for chunk in r.aiter_bytes():
                await resp.write(chunk)
            await resp.write_eof()
            return resp


app = web.Application()
app.router.add_get("/", index)
app.router.add_post("/api/tts", tts_proxy)

if __name__ == "__main__":
    asyncio.run(init_jwt())
    web.run_app(app, port=int(os.environ.get("PORT", 3000)))
