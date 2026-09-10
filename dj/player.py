#!/usr/bin/env python3
"""SoftwareTesters live DJ. Polls the jukebox room and plays into the group voice chat."""

import asyncio
import os
import tempfile
import urllib.request

from pyrogram import Client
from pytgcalls import PyTgCalls
from pytgcalls.types import GroupCallConfig

API_ID = int(os.environ["API_ID"])
API_HASH = os.environ["API_HASH"]
SESSION = os.environ.get("SESSION_STRING") or "mt_jukebox_dj"
CHAT_ID = int(os.environ.get("CHAT_ID", "-1002671373361"))
ROOM = os.environ.get("JUKEBOX_URL", "https://mt-house-jukebox.vercel.app/api/room")
BOT_TOKEN = os.environ.get("BOT_TOKEN", "")
APP = os.environ.get("APP_URL", "https://mt-house-jukebox.vercel.app")

client = Client(SESSION, api_id=API_ID, api_hash=API_HASH, in_memory=bool(os.environ.get("SESSION_STRING")))
if os.environ.get("SESSION_STRING"):
    client = Client("dj", api_id=API_ID, api_hash=API_HASH, session_string=os.environ["SESSION_STRING"])
calls = PyTgCalls(client)


def abs_url(url: str) -> str:
    if url.startswith("http"):
        return url
    return APP + url


def fetch_room() -> dict:
    with urllib.request.urlopen(ROOM + "?id=dj&name=DJ", timeout=15) as r:
        import json

        return json.load(r)


def download(url: str) -> str:
    dest = os.path.join(tempfile.gettempdir(), "jb-live.mp3")
    urllib.request.urlretrieve(url, dest)
    return dest


async def announce(text: str) -> None:
    if not BOT_TOKEN:
        return
    import json
    import urllib.parse

    data = urllib.parse.urlencode(
        {
            "chat_id": CHAT_ID,
            "text": text,
        }
    ).encode()
    req = urllib.request.Request(f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage", data=data)
    try:
        urllib.request.urlopen(req, timeout=15)
    except Exception:
        pass


async def main() -> None:
    await client.start()
    await calls.start()
    last = ""
    paused = False
    await announce("Jukebox is live in the voice chat. Tap the voice chat at the top of this group — close the Mini App, music stays on.")
    print("DJ on", flush=True)
    while True:
        try:
            room = await asyncio.to_thread(fetch_room)
            cur = room.get("current")
            is_paused = bool(room.get("paused"))
            key = ""
            if cur:
                key = f"{cur.get('id')}:{room.get('startedAt')}"
            if cur and not is_paused and key != last:
                url = abs_url(cur.get("url") or "")
                path = await asyncio.to_thread(download, url)
                await calls.play(CHAT_ID, path, GroupCallConfig(auto_start=True))
                last = key
                paused = False
                print("playing", cur.get("title"), flush=True)
                await announce(f"Live: {cur.get('title')} — join the voice chat at the top of SoftwareTesters.")
            elif cur and is_paused and not paused:
                try:
                    await calls.pause(CHAT_ID)
                except Exception:
                    pass
                paused = True
            elif cur and (not is_paused) and paused:
                try:
                    await calls.resume(CHAT_ID)
                except Exception:
                    pass
                paused = False
            elif not cur and last:
                try:
                    await calls.leave_call(CHAT_ID)
                except Exception:
                    pass
                last = ""
        except Exception as e:
            print("dj error", e, flush=True)
        await asyncio.sleep(2)


if __name__ == "__main__":
    asyncio.run(main())
