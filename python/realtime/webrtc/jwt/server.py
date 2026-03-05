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

PROXY = "https://api.inworld.ai"
HTML = (Path(__file__).parent / "index.html").read_bytes()
JWT = None


async def init_jwt():
    global JWT
    result = await mint_jwt()
    JWT = result["token"]
    print(f"JWT minted (expires {result['expirationTime']})")


async def index(request):
    return web.Response(body=HTML, content_type="text/html")


async def config(request):
    headers = {"Authorization": f"Bearer {JWT}"}
    ice = []
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(f"{PROXY}/v1/realtime/ice-servers", headers=headers)
            if r.is_success:
                ice = r.json().get("ice_servers", [])
    except Exception as e:
        print(f"ICE fetch error: {e}")

    return web.json_response({
        "jwt": JWT,
        "ice_servers": ice,
        "url": f"{PROXY}/v1/realtime/calls",
    })


app = web.Application()
app.router.add_get("/", index)
app.router.add_get("/api/config", config)

if __name__ == "__main__":
    asyncio.run(init_jwt())
    web.run_app(app, port=int(os.environ.get("PORT", 3000)))
