import asyncio
import os
import sys
import time
from pathlib import Path

import aiohttp
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


async def ws_proxy(request):
    browser = web.WebSocketResponse()
    await browser.prepare(request)

    url = f"wss://api.inworld.ai/api/v1/realtime/session?key=voice-{int(time.time()*1000)}&protocol=realtime"
    session = aiohttp.ClientSession()
    api = await session.ws_connect(url, headers={"Authorization": f"Bearer {JWT}"})

    async def api_to_browser():
        async for msg in api:
            if msg.type == aiohttp.WSMsgType.TEXT:
                await browser.send_str(msg.data)
            elif msg.type in (aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                break
        if not browser.closed:
            await browser.close()

    async def browser_to_api():
        async for msg in browser:
            if msg.type == aiohttp.WSMsgType.TEXT:
                await api.send_str(msg.data)
            elif msg.type in (aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                break
        await api.close()
        await session.close()

    await asyncio.gather(api_to_browser(), browser_to_api())
    return browser


app = web.Application()
app.router.add_get("/", index)
app.router.add_get("/ws", ws_proxy)

if __name__ == "__main__":
    asyncio.run(init_jwt())
    web.run_app(app, port=int(os.environ.get("PORT", 3000)))
