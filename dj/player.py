import asyncio, json, os, random, shutil, subprocess, time, urllib.request
from pyrogram import Client
from pyrogram.raw.functions.phone import CreateGroupCall
from pytgcalls import PyTgCalls
from pytgcalls.types import GroupCallConfig
from pytgcalls.types.raw import Stream, AudioStream, AudioParameters, VideoStream, VideoParameters
from pytgcalls.types.stream.media_stream import MediaStream
from ntgcalls import MediaSource

API_ID = 21002278
API_HASH = "d28bcbe7f5d614eee061716b5443927c"
BOT_TOKEN = "8657477411:AAEedpalxENlRBGITjD-ztlXfbB_7hwziik"
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
LIB = os.path.join(WORKDIR, "library.json")
GONE = os.path.join(WORKDIR, "deleted.json")
YDL_KINDS = {"youtube", "twitch", "kick", "soundcloud", "mixcloud"}
VIDEO_KINDS = {"video"}
os.environ["PATH"] = "/usr/local/bin:/usr/bin:/bin:" + os.environ.get("PATH", "")
os.makedirs(TRACK_DIR, exist_ok=True)


def fetch_room():
    with urllib.request.urlopen(ROOM + "?id=dj&name=DJ&key=" + DJ_KEY, timeout=15) as r:
        return json.load(r)


def title_key(t):
    import re
    s = re.sub(r"\.[a-z0-9]{2,5}$", "", str((t or {}).get("title") or ""), flags=re.I)
    s = re.sub(r"[_-]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip().lower()
    return s or str((t or {}).get("url") or "")


def load_gone():
    try:
        with open(GONE) as f:
            data = json.load(f)
        return set(data if isinstance(data, list) else [])
    except Exception:
        return set()


def save_gone(keys):
    try:
        with open(GONE, "w") as f:
            json.dump(sorted(set(keys)), f)
    except Exception:
        pass


def load_lib():
    gone = load_gone()
    try:
        with open(LIB) as f:
            data = json.load(f)
        rows = data if isinstance(data, list) else []
    except Exception:
        rows = []
    seen = set()
    out = []
    for t in rows:
        k = title_key(t)
        tid = str((t or {}).get("id") or "")
        if not k or k in seen:
            continue
        if tid and len(tid) > 4 and tid in gone:
            continue
        seen.add(k)
        out.append(t)
    return out


def save_lib(tracks, deleted=None):
    if deleted:
        save_gone(list(load_gone()) + list(deleted))
    gone = load_gone()
    keep = []
    seen = set()
    for t in tracks or []:
        if not t.get("url") or t.get("kind") == "station":
            continue
        k = title_key(t)
        if not k or k in gone or k in seen:
            continue
        seen.add(k)
        keep.append(t)
    try:
        with open(LIB, "w") as f:
            json.dump(keep[:200], f)
    except Exception as e:
        print("lib_save_err", e, flush=True)


def restore_lib(tracks):
    if not tracks:
        return
    try:
        data = json.dumps({"type": "restore", "key": DJ_KEY, "tracks": tracks}).encode()
        req = urllib.request.Request(ROOM, data=data, headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=15)
        print("lib_restored", len(tracks), flush=True)
    except Exception as e:
        print("lib_restore_err", e, flush=True)


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


def radio_av(audio_path):
    vid = RADIO_MP4 if os.path.exists(RADIO_MP4) else RADIO_JPG
    return Stream(
        microphone=AudioStream(
            MediaSource.FILE,
            audio_path,
            AudioParameters(bitrate=48000, channels=2),
        ),
        camera=VideoStream(
            MediaSource.FILE,
            vid,
            VideoParameters(width=720, height=720, frame_rate=24),
        ),
    )


def audio_stream(path):
    return Stream(
        microphone=AudioStream(
            MediaSource.FILE,
            path,
            AudioParameters(bitrate=48000, channels=2),
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


def publish_play(tid, src):
    try:
        mp3 = os.path.join(WORKDIR, "pub-" + str(tid)[:16] + ".mp3")
        if (not os.path.exists(mp3)) or os.path.getsize(mp3) < 1000:
            subprocess.check_call(
                ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", src, "-t", "600", "-b:a", "128k", mp3]
            )
        out = subprocess.check_output(
            [
                "curl", "-sS", "-F", "reqtype=fileupload", "-F", "time=72h",
                "-F", "fileToUpload=@" + mp3,
                "https://litterbox.catbox.moe/resources/internals/api.php",
            ],
            timeout=90,
        )
        url = out.decode("utf-8", "ignore").strip()
        if not url.startswith("http"):
            out = subprocess.check_output(
                ["curl", "-sS", "-F", "reqtype=fileupload", "-F", "fileToUpload=@" + mp3, "https://catbox.moe/user/api.php"],
                timeout=90,
            )
            url = out.decode("utf-8", "ignore").strip()
        if not url.startswith("http"):
            print("pub_fail", url[:120], flush=True)
            return
        data = json.dumps({"type": "playUrl", "key": DJ_KEY, "trackId": tid, "url": url}).encode()
        req = urllib.request.Request(ROOM, data=data, headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=15)
        print("published", url[:90], flush=True)
    except Exception as e:
        print("publish_err", e, flush=True)


def ytid(url):
    import re
    m = re.search(r"(?:v=|youtu\.be/|shorts/)([A-Za-z0-9_-]{6,})", url or "")
    return m.group(1) if m else ""


def probe_dur(path):
    try:
        out = subprocess.check_output(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
            timeout=15,
        )
        return float(out.decode().strip() or 0)
    except Exception:
        return 0


def ytdlp_to(url, video):
    vid = ytid(url)
    if video:
        cached = os.path.join(TRACK_DIR, "yt-" + (vid or "x") + ".mp4")
        if os.path.exists(cached) and os.path.getsize(cached) > 100000:
            print("yt_video_cache", vid, flush=True)
            return cached
        cmd = [
            "yt-dlp",
            "-f", "best[height<=720][ext=mp4]/best[height<=720]/best",
            "--merge-output-format", "mp4",
            "--extractor-args", "youtube:player_client=android,ios,tv,web",
            "--no-playlist",
            "--no-warnings",
            "-o", cached,
            url,
        ]
        subprocess.check_call(cmd, timeout=240)
        if os.path.exists(cached) and os.path.getsize(cached) > 100000:
            return cached
        return ""
    cached = os.path.join(TRACK_DIR, "yt-" + (vid or "x") + ".wav")
    if os.path.exists(cached) and os.path.getsize(cached) > 20000:
        print("yt_cache", vid, flush=True)
        return cached
    out_tpl = os.path.join(WORKDIR, "live.%(ext)s")
    cmd = [
        "yt-dlp",
        "-f", "bestaudio[ext=m4a]/bestaudio/best",
        "-x", "--audio-format", "wav",
        "--extractor-args", "youtube:player_client=android,ios,tv,web",
        "--no-playlist",
        "--no-warnings",
        "-o", out_tpl,
        url,
    ]
    subprocess.check_call(cmd, timeout=180)
    found = ""
    for name in ("live.wav", "live.m4a", "live.webm", "live.mp3"):
        p = os.path.join(WORKDIR, name)
        if os.path.exists(p) and os.path.getsize(p) > 1000:
            found = p
            break
    if not found:
        return ""
    if not found.endswith(".wav"):
        to_wav(found, cached, 0)
    else:
        try:
            shutil.copyfile(found, cached)
        except Exception:
            return found
    return cached


def dj_replay(tid):
    try:
        data = json.dumps({"type": "replay", "key": DJ_KEY, "trackId": tid}).encode()
        req = urllib.request.Request(ROOM, data=data, headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=15)
    except Exception as e:
        print("replay_err", e, flush=True)


def fetch_bytes(url, dest):
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "Mozilla/5.0 (compatible; MTRadio/1.0)", "Accept": "*/*"},
    )
    with urllib.request.urlopen(req, timeout=60) as r, open(dest, "wb") as f:
        while True:
            chunk = r.read(1024 * 256)
            if not chunk:
                break
            f.write(chunk)
    return dest


def title_cache(cur):
    return os.path.join(TRACK_DIR, (title_key(cur) or "x").replace("/", "")[:80] + ".wav")


def newest_wav():
    best, mtime = "", 0
    try:
        for name in os.listdir(TRACK_DIR):
            if not name.endswith(".wav"):
                continue
            p = os.path.join(TRACK_DIR, name)
            st = os.path.getmtime(p)
            if os.path.getsize(p) > 20000 and st > mtime:
                best, mtime = p, st
    except Exception:
        pass
    return best


def stream_from_url(url, kind, start=0):
    video = kind in VIDEO_KINDS
    if kind in YDL_KINDS and url:
        try:
            vpath = ytdlp_to(url, True)
            if vpath and vpath.endswith(".mp4"):
                print("yt_video", vpath, flush=True)
                return av_stream(vpath)
            path = ytdlp_to(url, False)
            if path:
                return radio_av(path)
        except Exception as e:
            print("ytdlp_err", e, flush=True)
    if url:
        try:
            fetch_bytes(url, MP3)
            low = url.lower().split("?")[0]
            if video or low.endswith((".mp4", ".webm", ".mov", ".mkv")):
                return av_stream(MP3)
            to_wav(MP3, WAV, start)
            return audio_stream(WAV)
        except Exception as e:
            print("dl_err", e, flush=True)
    print("no_source", flush=True)
    return audio_stream(HOLD_WAV)


async def media_for(user, cur, start=0):
    kind = (cur or {}).get("kind") or "mp3"
    tid = str((cur or {}).get("id") or "x")
    cached = cache_wav(tid)
    titled = title_cache(cur)
    for p in (cached, titled):
        if p and os.path.exists(p) and os.path.getsize(p) > 20000 and kind not in VIDEO_KINDS:
            print("cache", p, "seek", int(start), flush=True)
            if start > 2:
                sliced = os.path.join(WORKDIR, "seek.wav")
                to_wav(p, sliced, start)
                return audio_stream(sliced)
            return audio_stream(p)
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
                for dest in (cached, titled):
                    try:
                        shutil.copyfile(WAV, dest)
                    except Exception:
                        pass
                if start > 2:
                    sliced = os.path.join(WORKDIR, "seek.wav")
                    to_wav(WAV, sliced, start)
                    return audio_stream(sliced)
                return audio_stream(WAV)
        except Exception as e:
            print("tg_dl_err", e, flush=True)
    url = abs_url((cur or {}).get("url") or "")
    stream = await asyncio.to_thread(stream_from_url, url, kind, start)
    if os.path.exists(WAV) and os.path.getsize(WAV) > 1000 and kind not in YDL_KINDS and kind not in VIDEO_KINDS:
        for dest in (cached, titled):
            try:
                shutil.copyfile(WAV, dest)
            except Exception:
                pass
    return stream


async def main():
    if not os.path.exists(HOLD_WAV):
        to_wav(HOLD, HOLD_WAV)
    user = Client("mt_jukebox_dj2", api_id=API_ID, api_hash=API_HASH, workdir=WORKDIR)
    bot = Client("mt_radio_bot", api_id=API_ID, api_hash=API_HASH, bot_token=BOT_TOKEN, workdir=WORKDIR)
    await user.start()
    await bot.start()
    ume = await user.get_me()
    bme = await bot.get_me()
    print("DJ_USER", ume.id, ume.username, flush=True)
    print("DJ_BOT", bme.id, bme.username, flush=True)
    bot_calls = PyTgCalls(bot)
    user_calls = PyTgCalls(user)
    await bot_calls.start()
    await user_calls.start()
    try:
        chat = await bot.get_chat(CHAT_ID)
        print("peer", chat.title, flush=True)
    except Exception as e:
        print("peer_err", e, flush=True)
    last = ""
    last_play = 0
    last_live = 0
    paused_state = False
    joined = False
    bot_on = False
    empty_n = 0
    pause_votes = 0
    switching = False
    print("DJ_READY", flush=True)
    group_peer = await user.resolve_peer(CHAT_ID)

    @user_calls.on_update()
    async def _on_update(client, update):
        nonlocal last, joined, switching
        name = type(update).__name__
        print("call_update", name, flush=True)
        if switching:
            return
        if "Discarded" in name:
            last = ""
            joined = False
            print("call_discarded", flush=True)
            return
        if "Ended" in name:
            print("stream_ended", last, flush=True)

    async def ensure_call():
        try:
            peer = await user.resolve_peer(CHAT_ID)
            await user.invoke(CreateGroupCall(peer=peer, random_id=random.randint(1, 0x7FFFFFFF), title="MT Radio"))
            print("created_call", flush=True)
            await asyncio.sleep(2)
            return True
        except Exception as e:
            msg = str(e)
            if "GROUPCALL_ALREADY_STARTED" in msg or "ALREADY_STARTED" in msg:
                print("call_exists", flush=True)
                return True
            print("create_call_err", type(e).__name__, e, flush=True)
            return False

    async def put_stream(stream, can_start, hard=False):
        nonlocal joined, bot_on, switching
        switching = True
        if not joined:
            await ensure_call()
            await asyncio.sleep(1)
        try:
            await user_calls.play(
                CHAT_ID,
                stream,
                GroupCallConfig(auto_start=True, join_as=group_peer),
            )
            joined = True
            bot_on = False
            try:
                await user_calls.unmute(CHAT_ID)
            except Exception:
                pass
            print("mic_live", flush=True)
            switching = False
            return True
        except Exception as e:
            print("group_play_err", type(e).__name__, e, flush=True)
            try:
                await user_calls.play(CHAT_ID, stream, GroupCallConfig(auto_start=True))
                joined = True
                try:
                    await user_calls.unmute(CHAT_ID)
                except Exception:
                    pass
                print("self_mic", flush=True)
                switching = False
                return True
            except Exception as e2:
                print("user_play_err", type(e2).__name__, e2, flush=True)
                joined = False
                switching = False
                return False

    while True:
        try:
            room = await asyncio.to_thread(fetch_room)
            want = float(room.get("wantLive") or 0)
            if want > 1e12:
                want = want / 1000.0
            looping = room.get("loop") is not False
            lib = [t for t in (room.get("library") or []) if t.get("url") and t.get("kind") != "station"]
            if lib:
                save_lib(lib, room.get("deleted") or [])
            else:
                saved = load_lib()
                if saved:
                    asyncio.create_task(asyncio.to_thread(restore_lib, saved))
            cur = room.get("current")
            kind = (cur or {}).get("kind")
            paused = bool(room.get("paused"))
            if cur and kind == "station":
                cur = None
                paused = True
            if (not cur or paused) and lib:
                cur = lib[0]
                kind = cur.get("kind") or "mp3"
                paused = False
            if cur and not paused:
                empty_n = 0
                pause_votes = 0
                tid = title_key(cur) or str(cur.get("id") or "x")
            else:
                tid = "silence"
                cur = None
            now = time.time()
            start_live = bool(want and want > last_live)
            if start_live:
                print("golive", int(want), flush=True)
                last_live = want
                if joined:
                    print("golive_already_on", flush=True)
                    start_live = False
            srcp = cache_wav(str((cur or {}).get("id") or last or "x"))
            ytc = os.path.join(TRACK_DIR, "yt-" + ytid((cur or {}).get("url") or "") + ".wav") if cur else ""
            durp = srcp if os.path.exists(srcp) else (ytc if ytc and os.path.exists(ytc) else "")
            dur = probe_dur(durp) if durp else 0
            posn = started_pos(room)
            if looping and cur and not paused and dur > 45 and posn >= dur - 1.5 and now - last_play > 20:
                print("loop_restart", tid, flush=True)
                asyncio.create_task(asyncio.to_thread(dj_replay, tid))
                last = ""
                await asyncio.sleep(1)
                continue
            refresh_hold = False
            if start_live or tid != last:
                start = 0
                if kind in YDL_KINDS:
                    start = 0
                if cur and not paused:
                    print("play", kind, cur.get("title"), "at", int(start), flush=True)
                    stream = await media_for(user, cur, start)
                    srcp = cache_wav(str(cur.get("id") or ""))
                    if not (os.path.exists(srcp) and os.path.getsize(srcp) > 1000):
                        srcp = WAV if os.path.exists(WAV) else ""
                    if srcp:
                        asyncio.create_task(asyncio.to_thread(publish_play, str(cur.get("id") or ""), srcp))
                else:
                    stream = audio_stream(HOLD_WAV)
                    print("silence", flush=True)
                hard = False
                ok = await put_stream(stream, not joined, False)
                if not ok:
                    last = ""
                    joined = False
                    last_play = now
                    await asyncio.sleep(4)
                    continue
                last = tid
                last_play = now
                paused_state = False
                print("playing", tid, flush=True)
            elif paused and cur and not paused_state and last != "silence":
                pause_votes += 1
                if pause_votes < 2:
                    await asyncio.sleep(3)
                    continue
                try:
                    if bot_on:
                        await bot_calls.pause(CHAT_ID)
                    else:
                        await user_calls.pause(CHAT_ID)
                    paused_state = True
                    print("paused", flush=True)
                except Exception as e:
                    print("pause_err", e, flush=True)
                    paused_state = True
            elif (not paused) and paused_state and joined:
                pause_votes = 0
                try:
                    if bot_on:
                        await bot_calls.resume(CHAT_ID)
                    else:
                        await user_calls.resume(CHAT_ID)
                    paused_state = False
                    print("resumed", flush=True)
                except Exception as e:
                    print("resume_err", e, flush=True)
                    paused_state = False
        except Exception as e:
            print("dj error", type(e).__name__, e, flush=True)
            await asyncio.sleep(8)
            continue
        await asyncio.sleep(3)


if __name__ == "__main__":
    asyncio.run(main())
