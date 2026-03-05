import os
from pathlib import Path

import httpx
from aiohttp import web
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

API_KEY = os.environ.get("INWORLD_API_KEY", "")
AUTH_PREFIX = "Bearer" if os.environ.get("AUTH_TYPE") == "bearer" else "Basic"
HTML = (Path(__file__).parent / "index.html").read_bytes()


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
                "Authorization": f"{AUTH_PREFIX} {API_KEY}",
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
    web.run_app(app, port=int(os.environ.get("PORT", 3000)))
