import os
from pathlib import Path

import httpx
from aiohttp import web
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

API_KEY = os.environ.get("INWORLD_API_KEY", "")
AUTH_PREFIX = "Bearer" if os.environ.get("AUTH_TYPE") == "bearer" else "Basic"
PROXY = "https://api.inworld.ai"
HTML = (Path(__file__).parent / "index.html").read_bytes()


async def index(request):
    return web.Response(body=HTML, content_type="text/html")


async def config(request):
    headers = {"Authorization": f"{AUTH_PREFIX} {API_KEY}"}
    ice = []
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(f"{PROXY}/v1/realtime/ice-servers", headers=headers)
            if r.is_success:
                ice = r.json().get("ice_servers", [])
    except Exception as e:
        print(f"ICE fetch error: {e}")

    return web.json_response({
        "api_key": API_KEY,
        "auth_prefix": AUTH_PREFIX,
        "ice_servers": ice,
        "url": f"{PROXY}/v1/realtime/calls",
    })


app = web.Application()
app.router.add_get("/", index)
app.router.add_get("/api/config", config)

if __name__ == "__main__":
    web.run_app(app, port=int(os.environ.get("PORT", 3000)))
