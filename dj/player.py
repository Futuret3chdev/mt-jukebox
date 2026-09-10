import asyncio, json, os, shutil, subprocess, time, urllib.request
from pyrogram import Client
from pytgcalls import PyTgCalls
from pytgcalls.types import GroupCallConfig
from pytgcalls.types.raw import Stream, AudioStream, AudioParameters, VideoStream, VideoParameters
from ntgcalls import MediaSource

API_ID = 21002278
API_HASH = "d28bcbe7f5d614eee061716b5443927c"
CHAT_ID = -1002671373361
DJ_KEY = "mt-radio-dj-9f3"
ROOM = "https://mt-house-jukebox.vercel.app/api/room"
APP = "https://mt-house-jukebox.vercel.app"
WORKDIR = "/tmp/mt-jukebox/dj"
MP3 = os.path.join(WORKDIR, "live.mp3")
WAV = os.path.join(WORKDIR, "live.wav")
HOLD = os.path.join(WORKDIR, "hold.mp3")
HOLD_WAV = os.path.join(WORKDIR, "hold.wav")
RADIO_MP4 = os.path.join(WORKDIR, "radio.mp4")
RADIO_JPG = os.path.join(WORKDIR, "radio.jpg")
TRACK_DIR = os.path.join(WORKDIR, "tracks")
YDL_KINDS = {"youtube", "twitch", "kick", "soundcloud", "mixcloud"}
VIDEO_KINDS = {"youtube", "twitch", "kick", "video"}
os.environ["PATH"] = "/usr/local/bin:/usr/bin:/bin:" + os.environ.get("PATH", "")
os.makedirs(TRACK_DIR, exist_ok=True)


def fetch_room():
    with urllib.request.urlopen(ROOM + "?id=dj&name=DJ&key=" + DJ_KEY, timeout=15) as r:
        return json.load(r)


def abs_url(url):
    if not url:
        return ""
    return url if url.startswith("http") else APP + url


def started_pos(room):
    st = room.get("startedAt") or 0
    if not st or room.get("paused"):
        return float(room.get("pausePos") or 0)
    if st > 1e12:
        st = st / 1000.0
    return max(0.0, time.time() - st)


def to_wav(src, dest, start=0):
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error"]
    if start and start > 1:
        cmd += ["-ss", str(int(start))]
    cmd += ["-i", src, "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", dest]
    subprocess.check_call(cmd)
    return dest


def audio_stream(path):
    cam = RADIO_MP4 if os.path.exists(RADIO_MP4) else RADIO_JPG
    return Stream(
        microphone=AudioStream(
            MediaSource.FILE,
            path,
            AudioParameters(bitrate=48000, channels=2),
        ),
        camera=VideoStream(
            MediaSource.FILE,
            cam,
            VideoParameters(width=720, height=720, frame_rate=24),
        ),
    )


def av_stream(path):
    return Stream(
        microphone=AudioStream(
            MediaSource.FILE,
            path,
            AudioParameters(bitrate=48000, channels=2),
        ),
        camera=VideoStream(
            MediaSource.FILE,
            path,
            VideoParameters(width=1280, height=720, frame_rate=24),
        ),
    )


def cache_wav(tid):
    return os.path.join(TRACK_DIR, str(tid) + ".wav")


def ytdlp_to(url, video):
    out_tpl = os.path.join(WORKDIR, "live.%(ext)s")
    cmd = ["yt-dlp", "--no-playlist", "--no-warnings", "-o", out_tpl, url]
    if video:
        cmd[1:1] = ["-f", "bv*[height<=720]+ba/b[height<=720]/bestaudio/best", "--merge-output-format", "mp4"]
    else:
        cmd[1:1] = ["-f", "bestaudio/best", "-x", "--audio-format", "wav"]
    subprocess.check_call(cmd, timeout=180)
    for name in ("live.mp4", "live.mkv", "live.webm", "live.wav", "live.m4a"):
        p = os.path.join(WORKDIR, name)
        if os.path.exists(p) and os.path.getsize(p) > 1000:
            return p
    return ""


def stream_from_url(url, kind, start=0):
    video = kind in VIDEO_KINDS
    if kind in YDL_KINDS and url:
        try:
            path = ytdlp_to(url, video)
            if path:
                if path.endswith((".mp4", ".mkv", ".webm")):
                    return av_stream(path)
                if not path.endswith(".wav"):
                    to_wav(path, WAV, start)
                    path = WAV
                elif start > 1:
                    to_wav(path, WAV, start)
                    path = WAV
                return audio_stream(path)
        except Exception as e:
            print("ytdlp_err", e, flush=True)
            try:
                path = ytdlp_to(url, False)
                if path:
                    if not path.endswith(".wav"):
                        to_wav(path, WAV, start)
                        path = WAV
                    return audio_stream(path)
            except Exception as e2:
                print("ytdlp_audio_err", e2, flush=True)
    if url:
        try:
            urllib.request.urlretrieve(url, MP3)
            low = url.lower().split("?")[0]
            if video or low.endswith((".mp4", ".webm", ".mov", ".mkv")):
                return av_stream(MP3)
            to_wav(MP3, WAV, start)
            return audio_stream(WAV)
        except Exception as e:
            print("dl_err", e, flush=True)
    return audio_stream(HOLD_WAV)


async def media_for(user, cur, start=0):
    kind = (cur or {}).get("kind") or "mp3"
    tid = str((cur or {}).get("id") or "x")
    cached = cache_wav(tid)
    if os.path.exists(cached) and os.path.getsize(cached) > 1000 and kind not in VIDEO_KINDS:
        print("cache", tid, "seek", int(start), flush=True)
        if start > 2:
            sliced = os.path.join(WORKDIR, "seek.wav")
            to_wav(cached, sliced, start)
            return audio_stream(sliced)
        return audio_stream(cached)
    chat_id = cur.get("tgChatId")
    mid = cur.get("tgMessageId")
    if chat_id and mid:
        try:
            msg = await user.get_messages(int(chat_id), int(mid))
            path = await user.download_media(msg, file_name=MP3)
            if path:
                print("tg_dl", path, os.path.getsize(path), flush=True)
                video = kind == "video" or str(path).lower().endswith((".mp4", ".mov", ".webm", ".mkv"))
                if video:
                    return av_stream(path)
                to_wav(path, WAV, 0)
                try:
                    shutil.copyfile(WAV, cached)
                except Exception:
                    pass
                if start > 2:
                    sliced = os.path.join(WORKDIR, "seek.wav")
                    to_wav(cached, sliced, start)
                    return audio_stream(sliced)
                return audio_stream(cached)
        except Exception as e:
            print("tg_dl_err", e, flush=True)
    url = abs_url((cur or {}).get("url") or "")
    stream = await asyncio.to_thread(stream_from_url, url, kind, start)
    if os.path.exists(WAV) and os.path.getsize(WAV) > 1000 and kind not in YDL_KINDS and kind not in VIDEO_KINDS:
        try:
            shutil.copyfile(WAV, cached)
        except Exception:
            pass
    return stream


async def main():
    if not os.path.exists(HOLD_WAV):
        to_wav(HOLD, HOLD_WAV)
    user = Client("mt_jukebox_dj2", api_id=API_ID, api_hash=API_HASH, workdir=WORKDIR)
    calls = PyTgCalls(user)
    await user.start()
    me = await user.get_me()
    print("DJ_USER", me.id, me.username, flush=True)
    await calls.start()
    async for d in user.get_dialogs(limit=40):
        if d.chat.id == CHAT_ID:
            print("peer", d.chat.title, flush=True)
            break
    last = ""
    last_play = 0
    paused_state = False
    joined = False
    fail_until = 0
    empty_n = 0
    print("DJ_READY", flush=True)
    while True:
        try:
            if time.time() < fail_until:
                await asyncio.sleep(2)
                continue
            room = await asyncio.to_thread(fetch_room)
            cur = room.get("current")
            kind = (cur or {}).get("kind")
            paused = bool(room.get("paused"))
            if cur and kind == "station":
                cur = None
            if cur and not paused:
                empty_n = 0
                tid = cur.get("id")
            else:
                empty_n += 1
                if empty_n < 5 and last and last != "hold":
                    tid = last
                    cur = None
                else:
                    tid = "hold"
                    cur = None
            now = time.time()
            refresh_hold = joined and tid == "hold" and last == "hold" and now - last_play > 480
            if tid != last or refresh_hold:
                start = started_pos(room) if (cur and tid == last) else (started_pos(room) if cur else 0)
                if cur and not paused:
                    print("play", kind, cur.get("title"), "at", int(start), flush=True)
                    stream = await media_for(user, cur, start)
                else:
                    stream = audio_stream(HOLD_WAV)
                    print("hold", flush=True)
                await calls.play(CHAT_ID, stream, GroupCallConfig(auto_start=not joined))
                joined = True
                last = tid
                last_play = now
                paused_state = False
                print("playing", tid, flush=True)
            elif paused and not paused_state and last != "hold":
                try:
                    await calls.pause(CHAT_ID)
                    paused_state = True
                    print("paused", flush=True)
                except Exception as e:
                    print("pause_err", e, flush=True)
            elif (not paused) and paused_state:
                await calls.resume(CHAT_ID)
                paused_state = False
                print("resumed", flush=True)
        except Exception as e:
            print("dj error", type(e).__name__, e, flush=True)
            fail_until = time.time() + 60
        await asyncio.sleep(3)


if __name__ == "__main__":
    asyncio.run(main())
