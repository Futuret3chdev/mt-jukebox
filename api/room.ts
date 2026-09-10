import crypto from "crypto";

type Track = {
  id: string;
  title: string;
  artist: string;
  url: string;
  addedBy: string;
  duration: number;
  kind?: string;
  spotifyUri?: string;
  tgChatId?: number;
  tgMessageId?: number;
  fileSize?: number;
  playUrl?: string;
};
type Room = {
  hostId: string | null;
  hostName: string;
  current: Track | null;
  startedAt: number | null;
  paused: boolean;
  pausePos: number;
  queue: Track[];
  library: Track[];
  listeners: { id: string; name: string; seen: number }[];
  connected: boolean;
  wantLive: number;
  loop: boolean;
};

const BOT = process.env.BOT_TOKEN || "8657477411:AAEedpalxENlRBGITjD-ztlXfbB_7hwziik";
const APP = "https://mt-house-jukebox.vercel.app/";
const ART = "https://mt-house-jukebox.vercel.app/radio.jpg";
const LIVE = "https://t.me/+WgogJ0YgKAQzN2Q9";
const INVITE = "https://t.me/+WgogJ0YgKAQzN2Q9";
const GROUP = -1002671373361;
const BOT_DM = "https://t.me/Mtradiobot?start=menu";
const DJ_KEY = process.env.DJ_KEY || "mt-radio-dj-9f3";
const STATION = {
  name: "MT Radio",
  tagline: "MT ecosystem · made by FutureT3ch and MemeTorrent",
};

function bag() {
  const g = globalThis as typeof globalThis & {
    __jb?: { room: Room; audio: Map<string, { buf: Buffer; mime: string }> };
    __adm?: Map<string, { ok: boolean; exp: number }>;
  };
  if (!g.__jb) {
    g.__jb = {
      room: {
        hostId: null,
        hostName: "",
        current: null,
        startedAt: null,
        paused: true,
        pausePos: 0,
        queue: [],
        library: [],
        listeners: [],
        connected: true,
        wantLive: 0,
        loop: true,
      },
      audio: new Map(),
    };
  }
  if (!g.__adm) g.__adm = new Map();
  return g.__jb;
}

function newId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function getRoom(): Room {
  const room = bag().room;
  const now = Date.now();
  room.listeners = room.listeners.filter((l) => now - l.seen < 25000);
  if (room.current && !room.paused && room.startedAt && room.current.duration) {
    if ((now - room.startedAt) / 1000 >= room.current.duration + 0.3) skip("sys");
  }
  return room;
}

function publicRoom(isAdmin: boolean) {
  const room = getRoom();
  const current =
    room.current ||
    ({
      id: "station",
      title: STATION.name,
      artist: STATION.tagline,
      url: "",
      addedBy: "MT Radio",
      duration: 0,
      kind: "station",
    } as Track);
  return {
    ...room,
    current,
    paused: room.current ? room.paused : true,
    loop: room.loop !== false,
    isAdmin,
    live: LIVE,
    invite: INVITE,
    station: STATION,
  };
}

function heartbeat(id: string, name: string) {
  const room = getRoom();
  const found = room.listeners.find((l) => l.id === id);
  if (found) {
    found.seen = Date.now();
    if (name) found.name = name;
  } else {
    room.listeners.push({ id, name: name || "Listener", seen: Date.now() });
  }
  return room;
}

function startTrack(track: Track) {
  const room = getRoom();
  room.current = track;
  room.startedAt = Date.now();
  room.paused = false;
  room.pausePos = 0;
  return room;
}

function addTrack(track: Track, playNow: boolean) {
  const room = getRoom();
  const url = String(track.url || "");
  const title = String(track.title || "");
  const existing = room.library.find(
    (t) => t.id === track.id || (url && t.url === url && t.title === title),
  );
  if (existing) {
    if (playNow && (!room.current || room.current.kind === "station")) startTrack(existing);
    else if (!room.queue.some((t) => t.id === existing.id)) room.queue.push(existing);
    return room;
  }
  room.library = [track, ...room.library.filter((t) => t.id !== track.id)].slice(0, 200);
  const idle = !room.current || room.current.kind === "station";
  if (playNow && idle) startTrack(track);
  else if (room.current && room.current.kind !== "station") room.queue.push(track);
  else if (playNow) startTrack(track);
  else room.queue.push(track);
  return room;
}

function play(userId: string, name?: string) {
  if (name) heartbeat(userId, name);
  const room = getRoom();
  room.hostId = userId;
  if (name) room.hostName = name;
  if (!room.current) {
    const next = room.queue.shift() || room.library.find((t) => t.kind !== "station");
    if (next) startTrack(next);
    return room;
  }
  if (room.paused) {
    room.startedAt = Date.now() - room.pausePos * 1000;
    room.paused = false;
  }
  return room;
}

function pause(userId: string, name?: string) {
  if (name) heartbeat(userId, name);
  const room = getRoom();
  if (!room.current || room.paused) return room;
  room.pausePos = room.startedAt ? (Date.now() - room.startedAt) / 1000 : 0;
  room.paused = true;
  return room;
}

function playPause(userId: string, name?: string) {
  const room = getRoom();
  if (room.paused || !room.current) return play(userId, name);
  return pause(userId, name);
}

function skip(userId: string, name?: string) {
  if (name) heartbeat(userId, name);
  const room = getRoom();
  const next = room.queue.shift();
  if (next) startTrack(next);
  else {
    room.current = null;
    room.startedAt = null;
    room.paused = true;
    room.pausePos = 0;
  }
  return room;
}

function queueTrack(trackId: string, userId: string, name: string) {
  heartbeat(userId, name);
  const room = getRoom();
  const track = room.library.find((t) => t.id === trackId);
  if (!track) return room;
  const copy = { ...track, addedBy: name, id: newId() };
  if (!room.current) startTrack(copy);
  else room.queue.push(copy);
  return room;
}

function removeFromQueue(trackId: string) {
  const room = getRoom();
  room.queue = room.queue.filter((t) => t.id !== trackId);
  return room;
}

function deleteTrack(trackId: string) {
  const room = getRoom();
  room.queue = room.queue.filter((t) => t.id !== trackId);
  room.library = room.library.filter((t) => t.id !== trackId);
  bag().audio.delete(trackId);
  if (room.current && room.current.id === trackId) skip("sys");
  return room;
}

function saveAudio(buf: Buffer, mime: string) {
  const id = newId();
  bag().audio.set(id, { buf, mime });
  return id;
}

function getAudio(id: string) {
  return bag().audio.get(id) || null;
}

async function lyricsFor(track: Track | null) {
  if (!track || track.kind === "station") return STATION.name + "\n" + STATION.tagline;
  if (track.kind === "youtube" || track.kind === "twitch" || track.kind === "kick" || track.kind === "radio") {
    return track.title + " is a live stream — lyrics aren't attached to this source.";
  }
  const { artist, title } = parseArtistTitle(track);
  const tries = [
    "https://lrclib.net/api/get?artist_name=" + encodeURIComponent(artist) + "&track_name=" + encodeURIComponent(title),
    "https://lrclib.net/api/search?q=" + encodeURIComponent((artist + " " + title).trim()),
    "https://lrclib.net/api/search?track_name=" + encodeURIComponent(title) + "&artist_name=" + encodeURIComponent(artist),
    "https://lrclib.net/api/search?q=" + encodeURIComponent(title),
  ];
  for (const url of tries) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "MT-Radio/1.0 (https://mt-house-jukebox.vercel.app)" } });
      if (!r.ok) continue;
      const data = await r.json();
      const rows = Array.isArray(data) ? data : data ? [data] : [];
      const hit = rows.find((x: any) => x && (x.plainLyrics || x.syncedLyrics));
      const text = hit && (hit.plainLyrics || hit.syncedLyrics);
      if (text) return (artist ? artist + " — " + title + "\n\n" : title + "\n\n") + stripSync(String(text));
    } catch {
      /* next */
    }
  }
  try {
    const r = await fetch(
      "https://api.lyrics.ovh/v1/" + encodeURIComponent(artist || "Unknown") + "/" + encodeURIComponent(title),
    );
    const j = (await r.json()) as { lyrics?: string };
    if (j.lyrics) return artist + " — " + title + "\n\n" + j.lyrics.trim();
  } catch {
    /* none */
  }
  return "No lyrics for " + (artist ? artist + " — " : "") + title + ".";
}

function stripSync(text: string) {
  return text.replace(/\[\d+:\d+[^\]]*\]/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

function cleanName(s: string) {
  return String(s || "")
    .replace(/\.(mp3|m4a|wav|aac|ogg|flac|mp4|webm|mov)$/i, "")
    .replace(/[_]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function parseArtistTitle(track: Track) {
  let title = cleanName(track.title);
  let artist = cleanName(track.artist);
  const userish = !artist || /futuret3ch|xai|guest|mt radio|admin|^dj$/i.test(artist) || artist === title;
  const m = title.match(/^(.+?)\s[-–—]\s(.+)$/);
  if (m && userish) {
    artist = m[1];
    title = m[2];
  }
  if (/^2\s*pac$/i.test(artist)) artist = "2Pac";
  return { artist, title };
}

function parseSource(raw: string): { kind: string; url: string; title: string; artist: string } | null {
  const text = String(raw || "").trim();
  const m = text.match(/https?:\/\/[^\s<>"']+/i);
  const url = m ? m[0] : text;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  const path = u.pathname + u.search;
  if (host === "youtu.be" || host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
    return { kind: "youtube", url, title: "YouTube", artist: "MT Radio" };
  }
  if (host === "twitch.tv" || host.endsWith(".twitch.tv")) {
    return { kind: "twitch", url, title: "Twitch", artist: "Game stream" };
  }
  if (host === "kick.com") {
    return { kind: "kick", url, title: "Kick", artist: "Game stream" };
  }
  if (host === "soundcloud.com") {
    return { kind: "soundcloud", url, title: "SoundCloud", artist: "MT Radio" };
  }
  if (host.endsWith("mixcloud.com")) {
    return { kind: "mixcloud", url, title: "Mixcloud", artist: "MT Radio" };
  }
  if (host.endsWith("bandcamp.com")) {
    return { kind: "stream", url, title: "Bandcamp", artist: "MT Radio" };
  }
  if (/\.(mp4|webm|mov|mkv|m4v)(?:$|[?#])/i.test(path)) {
    const name = decodeURIComponent(u.pathname.split("/").pop() || "Video").replace(/\.[^.]+$/, "");
    return { kind: "video", url, title: name, artist: "MT Radio" };
  }
  if (/\.(mp3|aac|ogg|opus|m4a|wav|flac)(?:$|[?#])/i.test(path) || /tmpfiles\.org|catbox\.moe|litterbox/.test(host)) {
    const name = decodeURIComponent(u.pathname.split("/").pop() || "Audio").replace(/\.[^.]+$/, "");
    return { kind: "mp3", url, title: name, artist: "MT Radio" };
  }
  if (/\.(m3u8?|pls)(?:$|[?#])/i.test(path) || /icecast|shoutcast|listen/i.test(url) || /:(8000|8443|8080|8008)\b/.test(url)) {
    return { kind: "radio", url, title: "Radio stream", artist: "MT Radio" };
  }
  return { kind: "stream", url, title: host, artist: "MT Radio" };
}

function userFromInit(initData: string): { id: string; name: string } | null {
  if (!initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash") || "";
  params.delete("hash");
  const dataCheck = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => k + "=" + v)
    .join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(BOT).digest();
  const check = crypto.createHmac("sha256", secret).update(dataCheck).digest("hex");
  if (check !== hash) return null;
  try {
    const user = JSON.parse(params.get("user") || "null");
    if (!user?.id) return null;
    return {
      id: String(user.id),
      name: [user.first_name, user.last_name].filter(Boolean).join(" ").trim() || user.username || "Listener",
    };
  } catch {
    return null;
  }
}

async function isAdmin(userId: string): Promise<boolean> {
  const n = Number(userId);
  if (!n) return false;
  const g = globalThis as any;
  if (!g.__adm) g.__adm = new Map();
  const map: Map<string, { ok: boolean; exp: number }> = g.__adm;
  const hit = map.get(userId);
  if (hit && hit.exp > Date.now()) return hit.ok;
  const r = await tg("getChatMember", { chat_id: GROUP, user_id: n });
  const st = r?.result?.status;
  const ok = st === "creator" || st === "administrator";
  map.set(userId, { ok, exp: Date.now() + 45000 });
  return ok;
}

export const config = { api: { bodyParser: false } };

function extractAudio(req: any, raw: Buffer): Buffer {
  const ct = String(req.headers?.["content-type"] || req.headers?.["Content-Type"] || "");
  if (!ct.toLowerCase().includes("multipart/form-data")) return raw;
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ct);
  const boundary = ((m && (m[1] || m[2])) || "").trim();
  if (!boundary) return raw;
  const sep = Buffer.from("--" + boundary);
  let start = 0;
  while (start < raw.length) {
    const idx = raw.indexOf(sep, start);
    if (idx < 0) break;
    const partStart = idx + sep.length;
    const headerEnd = raw.indexOf(Buffer.from("\r\n\r\n"), partStart);
    if (headerEnd < 0) break;
    const headers = raw.slice(partStart, headerEnd).toString("utf8");
    const next = raw.indexOf(sep, headerEnd + 4);
    if (next < 0) break;
    if (/filename=|name="file"/i.test(headers)) {
      let body = raw.slice(headerEnd + 4, next);
      if (body.length >= 2 && body[body.length - 2] === 13 && body[body.length - 1] === 10) {
        body = body.subarray(0, body.length - 2);
      }
      return body;
    }
    start = next;
  }
  return raw;
}

async function tg(method: string, body: Record<string, unknown>) {
  const res = await fetch("https://api.telegram.org/bot" + BOT + "/" + method, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

function tgName(from: any) {
  if (!from) return "Someone";
  const n = [from.first_name, from.last_name].filter(Boolean).join(" ").trim();
  return n || from.username || "Someone";
}

function fmtTime(s: number) {
  if (!isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return m + ":" + String(sec).padStart(2, "0");
}

function progressBar(t: number, dur: number) {
  const n = 14;
  if (!dur) return "●" + "▬".repeat(n - 1);
  const i = Math.max(0, Math.min(n - 1, Math.round((t / dur) * (n - 1))));
  return "▬".repeat(i) + "●" + "▬".repeat(n - 1 - i);
}

function nowPos() {
  const room = getRoom();
  if (!room.current) return 0;
  if (room.paused) return room.pausePos || 0;
  if (!room.startedAt) return 0;
  return Math.max(0, (Date.now() - room.startedAt) / 1000);
}

function nowText() {
  const room = getRoom();
  const cur = room.current;
  if (!cur) {
    return "MT Radio  ·  $MT\nOn air\n" + STATION.tagline + "\n\nTap Join live — color video in SoftwareTesters.";
  }
  const { artist, title } = parseArtistTitle(cur);
  const t = nowPos();
  const dur = cur.duration || 0;
  const state = room.paused ? "⏸ Paused" : "▶ Playing";
  return (
    "MT Radio  ·  $MT\n" +
    state + "\n" +
    (artist ? artist + " — " : "") + title + "\n" +
    progressBar(t, dur) + "  " + fmtTime(t) + (dur ? " / " + fmtTime(dur) : "") + "\n" +
    STATION.tagline
  );
}

function liveKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "▶  Join live", url: LIVE }],
      [{ text: "Open player", web_app: { url: APP } }],
    ],
  };
}

function dmKeyboard() {
  return liveKeyboard();
}

function isPrivateChat(chat: any) {
  return chat?.type === "private";
}

function menuKeyboard(admin: boolean) {
  const room = getRoom();
  const playing = !!(room.current && !room.paused);
  if (!admin) {
    return {
      inline_keyboard: [
        [{ text: "▶  Join live", url: LIVE }],
        [{ text: "📜  Lyrics", callback_data: "lyrics" }, { text: "Open player", web_app: { url: APP } }],
      ],
    };
  }
  return {
    inline_keyboard: [
      [
        { text: playing ? "⏸" : "▶", callback_data: "play" },
        { text: "⏭", callback_data: "skip" },
      ],
      [
        { text: "📜  Lyrics", callback_data: "lyrics" },
        { text: "☰  Queue", callback_data: "queue" },
      ],
      [{ text: "▶  Join live", url: LIVE }],
      [{ text: "Open player", web_app: { url: APP } }],
    ],
  };
}

function queueKeyboard() {
  const room = getRoom();
  const rows: { text: string; callback_data: string }[][] = [];
  room.queue.slice(0, 20).forEach((t, i) => {
    rows.push([{ text: "Remove " + (i + 1) + ". " + t.title.slice(0, 28), callback_data: "rm:" + t.id }]);
  });
  rows.push([{ text: "« Menu", callback_data: "menu" }]);
  return { inline_keyboard: rows };
}

async function wipe(chat: any, messageId?: number) {
  if (!chat || isPrivateChat(chat) || !messageId) return;
  await tg("deleteMessage", { chat_id: chat.id, message_id: messageId });
}

async function dmUser(from: any, text: string, markup: any) {
  return tg("sendMessage", {
    chat_id: from.id,
    text,
    reply_markup: markup,
  });
}

async function sendPlayer(chatId: number, caption: string, markup: any) {
  await tg("sendPhoto", {
    chat_id: chatId,
    photo: ART,
    caption: String(caption || nowText()).slice(0, 1024),
    reply_markup: markup,
  });
}

async function shortcutToDm(from: any, chat: any, messageId: number | undefined, text: string, markup: any) {
  await wipe(chat, messageId);
  try {
    await sendPlayer(from.id, text, markup);
  } catch {
    await dmUser(from, text, markup);
  }
  return true;
}

async function sendMenu(from: any, chat: any, messageId?: number, extra?: string, admin = true) {
  const text = (extra ? extra + "\n\n" : "") + nowText();
  const markup = menuKeyboard(admin);
  if (isPrivateChat(chat)) {
    await sendPlayer(chat.id, text, markup);
    return;
  }
  await shortcutToDm(from, chat, messageId, text, markup);
}

async function handleTelegram(update: any) {
  const cb = update.callback_query;
  if (cb) {
    const from = cb.from;
    const id = String(from?.id || "tg");
    const name = tgName(from);
    const data = String(cb.data || "");
    const admin = await isAdmin(id);
    heartbeat(id, name);
    const chat = cb.message?.chat;
    const priv = isPrivateChat(chat);
    let text = nowText();
    let markup: any = menuKeyboard(admin);
    if (!admin && ["play", "pause", "skip"].includes(data)) {
      text = "Only group admins can DJ.\n\n" + nowText();
      markup = liveKeyboard();
    } else if (data === "play") {
      playPause(id, name);
      text = nowText();
    } else if (data === "pause") {
      pause(id, name);
      text = nowText();
    } else if (data === "skip") {
      skip(id, name);
      text = nowText();
    } else if (data === "queue") {
      const room = getRoom();
      text = room.queue.length
        ? "Up next:\n" + room.queue.map((t, i) => (i + 1) + ". " + t.title + (t.addedBy ? " · " + t.addedBy : "")).join("\n")
        : "Queue is empty.";
      markup = admin ? queueKeyboard() : liveKeyboard();
    } else if (data === "lyrics") {
      text = (await lyricsFor(getRoom().current)).slice(0, 3500);
      markup = { inline_keyboard: [[{ text: "« Menu", callback_data: "menu" }]] };
    } else if (data === "menu") {
      text = nowText();
      markup = menuKeyboard(admin);
    } else if (data.startsWith("rm:")) {
      if (admin) removeFromQueue(data.slice(3));
      const room = getRoom();
      text = room.queue.length
        ? "Up next:\n" + room.queue.map((t, i) => (i + 1) + ". " + t.title).join("\n")
        : "Queue is empty.";
      markup = admin ? queueKeyboard() : liveKeyboard();
    } else if (data.startsWith("del:")) {
      if (admin) deleteTrack(data.slice(4));
      text = nowText();
      markup = menuKeyboard(admin);
    }
    await tg("answerCallbackQuery", { callback_query_id: cb.id });
    if (!priv) {
      await shortcutToDm(from, chat, cb.message?.message_id, text, markup);
      return;
    }
    if (data === "lyrics") {
      await tg("sendMessage", { chat_id: chat.id, text, reply_markup: markup });
      return;
    }
    const isPhoto = Array.isArray(cb.message?.photo) && cb.message.photo.length;
    try {
      if (isPhoto) {
        await tg("editMessageCaption", {
          chat_id: chat.id,
          message_id: cb.message.message_id,
          caption: text.slice(0, 1024),
          reply_markup: markup,
        });
      } else {
        await tg("editMessageText", {
          chat_id: chat.id,
          message_id: cb.message.message_id,
          text,
          reply_markup: markup,
        });
      }
    } catch {
      await sendPlayer(chat.id, text, markup);
    }
    return;
  }

  const msg = update.message;
  if (!msg) return;
  const chatId = msg.chat.id;
  const from = msg.from;
  const id = String(from?.id || "tg");
  const name = tgName(from);
  heartbeat(id, name);
  const admin = await isAdmin(id);
  const priv = isPrivateChat(msg.chat);

  const audio = msg.audio;
  const doc = msg.document;
  const voice = msg.voice;
  const video = msg.video;
  const fname = `${audio?.file_name || ""} ${doc?.file_name || ""} ${doc?.mime_type || ""} ${audio?.mime_type || ""}`;
  const isMp3 = Boolean(audio || voice) || Boolean(video && /\.(mp4|mkv|webm|mov|m4v)$/i.test(video.file_name || "")) || (doc && /audio|mpeg|mp3|m4a|wav|aac|ogg|flac|opus|wma|aiff/i.test(`${doc.mime_type || ""} ${doc.file_name || ""}`)) || /\.(mp3|m4a|wav|aac|ogg|flac|opus|wma|aiff|oga)$/i.test(fname);
  if (isMp3) {
    if (!admin) {
      if (priv) await tg("sendMessage", { chat_id: chatId, text: "Only group admins can add tracks. Tap Join live to listen.", reply_markup: liveKeyboard() });
      return;
    }
    const fileId = audio?.file_id || voice?.file_id || video?.file_id || doc?.file_id;
    if (!fileId) return;
    const title = audio?.title || (doc?.file_name || video?.file_name || "Untitled").replace(/\.[^.]+$/, "");
    addTrack(
      {
        id: newId(),
        title,
        artist: audio?.performer || name,
        url: "/api/room?tgfile=" + fileId,
        addedBy: name,
        duration: audio?.duration || voice?.duration || video?.duration || 0,
        kind: "tg",
        tgChatId: chatId,
        tgMessageId: msg.message_id,
        fileSize: audio?.file_size || voice?.file_size || video?.file_size || doc?.file_size || 0,
      },
      true,
    );
    const queued = "Queued on MT Radio: " + title + "\n\n" + nowText();
    if (priv) await tg("sendMessage", { chat_id: chatId, text: queued, reply_markup: menuKeyboard(true) });
    else await dmUser(from, queued, menuKeyboard(true));
    return;
  }

  const text = String(msg.text || "");
  const src = parseSource(text);
  const cmd = text.replace(/@\w+/, "").trim().toLowerCase();
  const isSlash = cmd.startsWith("/");

  if (!priv) {
    if (isSlash) {
      await wipe(msg.chat, msg.message_id);
      await dmUser(from, nowText(), admin ? menuKeyboard(true) : liveKeyboard());
    }
    return;
  }

  if (src && !isSlash && admin) {
    const title = src.title === src.kind || src.title === "YouTube" || src.title === "Twitch" ? src.title + " stream" : src.title;
    addTrack(
      {
        id: newId(),
        title,
        artist: src.artist,
        url: src.url,
        addedBy: name,
        duration: 0,
        kind: src.kind,
      },
      true,
    );
    const queued = "Queued on MT Radio: " + title + "\n\n" + nowText();
    if (priv) {
      await tg("sendMessage", { chat_id: chatId, text: queued, reply_markup: menuKeyboard(true) });
    } else {
      await shortcutToDm(from, msg.chat, undefined, queued, menuKeyboard(true));
    }
    return;
  }

  if (!priv && !isSlash) return;

  if (cmd === "/play" || cmd === "play" || cmd === "▶️ play") {
    if (!admin) return void sendMenu(from, msg.chat, msg.message_id, "Only group admins can DJ.", false);
    play(id, name);
    await sendMenu(from, msg.chat, msg.message_id, undefined, true);
  } else if (cmd === "/pause" || cmd === "pause" || cmd === "⏸ pause") {
    if (!admin) return void sendMenu(from, msg.chat, msg.message_id, "Only group admins can DJ.", false);
    pause(id, name);
    await sendMenu(from, msg.chat, msg.message_id, undefined, true);
  } else if (cmd === "/skip" || cmd === "skip" || cmd === "⏭ skip") {
    if (!admin) return void sendMenu(from, msg.chat, msg.message_id, "Only group admins can DJ.", false);
    skip(id, name);
    await sendMenu(from, msg.chat, msg.message_id, undefined, true);
  } else if (cmd === "/queue" || cmd === "queue" || cmd === "📋 queue") {
    const room = getRoom();
    const q = room.queue.length
      ? "Up next:\n" + room.queue.map((t, i) => (i + 1) + ". " + t.title + (t.addedBy ? " · " + t.addedBy : "")).join("\n")
      : "Queue is empty.";
    const body = q + "\n\n" + nowText();
    const markup = admin ? queueKeyboard() : liveKeyboard();
    if (priv) await tg("sendMessage", { chat_id: chatId, text: body, reply_markup: markup });
    else await shortcutToDm(from, msg.chat, msg.message_id, body, markup);
  } else if (cmd === "/lyrics" || cmd === "lyrics" || cmd === "🎤 lyrics") {
    const lyrics = (await lyricsFor(getRoom().current)).slice(0, 3500);
    const markup = { inline_keyboard: [[{ text: "« Menu", callback_data: "menu" }]] };
    if (priv) await tg("sendMessage", { chat_id: chatId, text: lyrics, reply_markup: markup });
    else await shortcutToDm(from, msg.chat, msg.message_id, lyrics, markup);
  } else if (cmd === "/live" || cmd === "live" || /^\/live(@\w+)?$/.test(cmd) || cmd === "/now" || cmd === "/now") {
    const body = nowText() + "\n\nTap Join MT Radio live — voice chat at the top of SoftwareTesters.";
    if (priv) await tg("sendMessage", { chat_id: chatId, text: body, reply_markup: liveKeyboard() });
    else await shortcutToDm(from, msg.chat, msg.message_id, body, liveKeyboard());
  } else if (/^\/(start|jukebox|menu)(@\w+)?/.test(cmd) || cmd === "menu") {
    if (!admin) {
      const body = "MT Radio is on air.\n" + STATION.tagline + "\n\nEveryone can listen. Only admins can add music.";
      if (priv) await tg("sendMessage", { chat_id: chatId, text: body, reply_markup: liveKeyboard() });
      else await shortcutToDm(from, msg.chat, msg.message_id, body, liveKeyboard());
      return;
    }
    await sendMenu(from, msg.chat, msg.message_id, "DJ: " + name, true);
  } else if (isSlash && !priv) {
    await shortcutToDm(from, msg.chat, msg.message_id, nowText(), menuKeyboard(admin));
  }
}
async function setupBot() {
  const g = globalThis as any;
  if (g.__jbBotReady === "player-art-1") return;
  g.__jbBotReady = "player-art-1";
  const groupCmds = [
    { command: "live", description: "Join MT Radio live" },
    { command: "now", description: "What's playing" },
  ];
  const dmCmds = [
    { command: "menu", description: "Open the DJ menu" },
    { command: "live", description: "Join MT Radio live" },
    { command: "now", description: "What's playing" },
    { command: "play", description: "Play / resume" },
    { command: "pause", description: "Pause" },
    { command: "skip", description: "Next track" },
    { command: "queue", description: "Queue" },
    { command: "lyrics", description: "Lyrics" },
    { command: "jukebox", description: "Open DJ desk" },
  ];
  await tg("setMyCommands", { commands: groupCmds });
  await tg("setMyCommands", { commands: groupCmds, scope: { type: "all_group_chats" } });
  await tg("setMyCommands", { commands: groupCmds, scope: { type: "chat", chat_id: GROUP } });
  await tg("setMyCommands", { commands: dmCmds, scope: { type: "all_private_chats" } });
  await tg("setMyCommands", { commands: dmCmds, scope: { type: "all_chat_administrators" } });
  await tg("setChatMenuButton", {
    menu_button: { type: "web_app", text: "MT Radio", web_app: { url: APP } },
  });
  await tg("setChatMenuButton", {
    chat_id: GROUP,
    menu_button: { type: "commands" },
  });
}

function initFromReq(req: any, body?: any) {
  return String(req.headers?.["x-telegram-init-data"] || req.headers?.["X-Telegram-Init-Data"] || body?.initData || "");
}

async function adminFromReq(req: any, body?: any, fallbackId?: string) {
  const key = String(req.query?.key || body?.key || "");
  if (key && key === DJ_KEY) return { admin: true, id: "dj", name: "DJ" };
  const verified = userFromInit(initFromReq(req, body));
  if (verified) {
    return { admin: await isAdmin(verified.id), id: verified.id, name: verified.name };
  }
  return { admin: false, id: String(fallbackId || "anon"), name: "Listener" };
}

export default async function handler(req: any, res: any) {
  try {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Telegram-Init-Data");
    res.setHeader("Cache-Control", "no-store");
    if (req.method === "OPTIONS") return res.status(200).end("ok");
    void setupBot();

    const url = new URL(req.url || "/", "http://x");
    const audioId = url.searchParams.get("audio") || req.query?.audio;
    if (audioId) {
      const file = getAudio(String(audioId));
      if (!file) return res.status(404).json({ error: "Track gone — add it again" });
      res.setHeader("Content-Type", file.mime);
      return res.status(200).end(file.buf);
    }

    const tgfile = url.searchParams.get("tgfile") || req.query?.tgfile;
    if (tgfile) {
      const fileRes = await fetch("https://api.telegram.org/bot" + BOT + "/getFile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_id: String(tgfile) }),
      });
      const fileJson = (await fileRes.json()) as { ok: boolean; result?: { file_path?: string } };
      const path = fileJson.result?.file_path;
      if (!path) return res.status(404).json({ error: "Telegram file expired — drop the mp3 again" });
      const bin = await fetch("https://api.telegram.org/file/bot" + BOT + "/" + path);
      const buf = Buffer.from(await bin.arrayBuffer());
      res.setHeader("Content-Type", "audio/mpeg");
      return res.status(200).end(buf);
    }

    if (req.method === "GET") {
      const who = await adminFromReq(req, {}, String(req.query?.id || "anon"));
      heartbeat(who.id, String(req.query?.name || who.name));
      return res.status(200).json(publicRoom(who.admin));
    }

    const chunks: Buffer[] = [];
    const raw: Buffer = await new Promise((resolve, reject) => {
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });

    const asText = raw.length < 200000 ? raw.toString("utf8") : "";
    if (asText.includes("update_id") || url.searchParams.get("hook") || req.query?.hook) {
      try {
        await handleTelegram(JSON.parse(asText || "{}"));
      } catch (e: any) {
        return res.status(200).json({ ok: true, error: String(e && e.message ? e.message : e) });
      }
      return res.status(200).json({ ok: true });
    }

    const titleQ = url.searchParams.get("title") || req.query?.title;
    if (titleQ) {
      const who = await adminFromReq(req, {}, String(url.searchParams.get("id") || "anon"));
      if (!who.admin) {
        return res.status(403).json({ error: "Only group admins can add tracks. Join live to listen.", live: LIVE });
      }
      const audioBuf = extractAudio(req, raw);
      if (audioBuf.length < 200) {
        return res.status(400).json({ error: "That file did not arrive — pick it from Files, not Photos" });
      }
      const mimeHead = String(req.headers?.["content-type"] || "audio/mpeg").split(";")[0] || "audio/mpeg";
      const mime = mimeHead.includes("multipart") ? "audio/mpeg" : mimeHead;
      const id = saveAudio(audioBuf, mime);
      const name = decodeURIComponent(String(url.searchParams.get("name") || who.name || "Someone"));
      heartbeat(who.id, name);
      const track = {
        id,
        title: decodeURIComponent(String(titleQ)),
        artist: name,
        url: "/api/room?audio=" + id,
        addedBy: name,
        duration: 0,
        kind: "mp3",
      };
      addTrack(track, true);
      return res.status(200).json(publicRoom(true));
    }

    let body: any = {};
    if (raw.length) {
      try {
        body = JSON.parse(raw.toString("utf8") || "{}");
      } catch {
        body = {};
      }
    }
    const who = await adminFromReq(req, body, String(body.id || "anon"));
    const id = who.id;
    const name = who.name || String(body.name || "Listener");
    heartbeat(id, name);
    const type = String(body.type || "");
    if (type === "playUrl") {
      if (String(body.key || "") !== DJ_KEY) return res.status(403).json({ error: "no" });
      const playUrl = String(body.url || "");
      const tid = String(body.trackId || "");
      const room = getRoom();
      if (room.current && playUrl.indexOf("https://") === 0) {
        if (!tid || room.current.id === tid) room.current.playUrl = playUrl;
      }
      return res.status(200).json(publicRoom(true));
    }
    if (type === "replay" && String(body.key || "") === DJ_KEY) {
      const room = getRoom();
      if (room.current) startTrack(room.current);
      return res.status(200).json(publicRoom(true));
    }
    if ((type === "restore" || type === "seed") && (String(body.key || "") === DJ_KEY || true)) {
      const whoSeed = await adminFromReq(req, body, String(body.id || "anon"));
      if (String(body.key || "") === DJ_KEY || whoSeed.admin) {
        const room = getRoom();
        const tracks = Array.isArray(body.tracks) ? body.tracks : [];
        for (const raw of tracks) {
          if (!raw || !raw.url) continue;
          const t = {
            id: String(raw.id || newId()),
            title: String(raw.title || "Track"),
            artist: String(raw.artist || "MT Radio"),
            url: String(raw.url),
            addedBy: String(raw.addedBy || "Library"),
            duration: Number(raw.duration || 0),
            kind: String(raw.kind || "mp3"),
          } as Track;
          if (!room.library.some((x) => x.id === t.id || (x.url === t.url && x.title === t.title))) {
            room.library.push(t);
          }
        }
        return res.status(200).json(publicRoom(true));
      }
    }
    if (type === "lyrics") {
      const text = await lyricsFor(getRoom().current);
      return res.status(200).json({ ...publicRoom(who.admin), lyrics: text });
    }
    if (!who.admin && ["play", "pause", "skip", "queue", "remove", "delete", "addUrl", "golive", "loop", "replay"].includes(type)) {
      return res.status(403).json({ error: "Only group admins can DJ. Tap Play in the Mini App to listen.", live: LIVE, ...publicRoom(false) });
    }
    if (type === "golive") {
      getRoom().wantLive = Date.now();
      play(id, name);
    }
    else if (type === "play") play(id, name);
    else if (type === "pause") pause(id, name);
    else if (type === "skip") skip(id, name);
    else if (type === "replay") {
      const room = getRoom();
      if (room.current && room.current.kind !== "station") startTrack(room.current);
      else play(id, name);
    }
    else if (type === "loop") {
      const room = getRoom();
      room.loop = !(room.loop !== false);
    }
    else if (type === "queue") queueTrack(String(body.trackId || ""), id, name);
    else if (type === "remove") removeFromQueue(String(body.trackId || ""));
    else if (type === "delete") deleteTrack(String(body.trackId || ""));
    else if (type === "addUrl") {
      const src = parseSource(String(body.url || ""));
      if (!src) return res.status(400).json({ error: "Paste a YouTube, Twitch, radio, or stream URL." });
      const title = String(body.title || "").trim() || src.title;
      addTrack(
        {
          id: newId(),
          title,
          artist: src.artist,
          url: src.url,
          addedBy: name,
          duration: 0,
          kind: src.kind,
        },
        body.playNow !== false,
      );
    }
    return res.status(200).json(publicRoom(who.admin));
  } catch (e: any) {
    return res.status(500).json({ error: String(e && e.message ? e.message : e) });
  }
}
