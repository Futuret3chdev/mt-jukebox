type Track = {
  id: string;
  title: string;
  artist: string;
  url: string;
  addedBy: string;
  duration: number;
  kind?: string;
  spotifyUri?: string;
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
};

function bag() {
  const g = globalThis as typeof globalThis & {
    __jb?: { room: Room; audio: Map<string, { buf: Buffer; mime: string }> };
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
      },
      audio: new Map(),
    };
  }
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

function heartbeat(id: string, name: string) {
  const room = getRoom();
  const found = room.listeners.find((l) => l.id === id);
  if (found) {
    found.seen = Date.now();
    if (name) found.name = name;
  } else {
    room.listeners.push({ id, name: name || "Listener", seen: Date.now() });
  }
  if (!room.hostId || !room.listeners.some((l) => l.id === room.hostId)) {
    room.hostId = id;
    room.hostName = name || "Listener";
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
  room.library = [track, ...room.library.filter((t) => t.id !== track.id)].slice(0, 200);
  if (!room.current || playNow) startTrack(track);
  else room.queue.push(track);
  return room;
}

function play(userId: string, name?: string) {
  if (name) heartbeat(userId, name);
  const room = getRoom();
  room.hostId = userId;
  if (name) room.hostName = name;
  if (!room.current) {
    const next = room.queue.shift() || room.library[0];
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
  if (!track) return "Nothing is playing.";
  const title = stripFileJunk(track.title);
  const artist = stripFileJunk(track.artist);
  const q = encodeURIComponent([artist, title].filter(Boolean).join(" ").trim() || title);
  try {
    const r = await fetch("https://lrclib.net/api/search?q=" + q, { headers: { "User-Agent": "MT-Jukebox" } });
    const arr = (await r.json()) as { plainLyrics?: string; syncedLyrics?: string; trackName?: string }[];
    const hit = Array.isArray(arr) && arr.find((x) => x.plainLyrics || x.syncedLyrics);
    const text = (hit && (hit.plainLyrics || hit.syncedLyrics)) || "";
    if (text) return stripSync(text);
  } catch {
    /* try backup */
  }
  try {
    const r = await fetch(
      "https://api.lyrics.ovh/v1/" + encodeURIComponent(artist || "Unknown") + "/" + encodeURIComponent(title),
    );
    const j = (await r.json()) as { lyrics?: string };
    if (j.lyrics) return j.lyrics.trim();
  } catch {
    /* none */
  }
  return "No lyrics found for " + title + ".";
}

function stripSync(text: string) {
  return text.replace(/\[\d+:\d+[^\]]*\]/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

function stripFileJunk(s: string) {
  return String(s || "")
    .replace(/\.(mp3|m4a|wav|aac|ogg|flac)$/i, "")
    .replace(/[_]+/g, " ")
    .trim();
}

const BOT = process.env.BOT_TOKEN || "8657477411:AAEedpalxENlRBGITjD-ztlXfbB_7hwziik";
const APP = "https://mt-house-jukebox.vercel.app/";

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

function nowText() {
  const room = getRoom();
  const cur = room.current;
  if (!cur) return "Nothing on. Drop an mp3 here or open the jukebox.";
  return (room.paused ? "Paused: " : "Playing: ") + cur.title + (cur.artist ? " — " + cur.artist : "");
}

function menuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "Play", callback_data: "play" },
        { text: "Pause", callback_data: "pause" },
        { text: "Skip", callback_data: "skip" },
      ],
      [
        { text: "Queue", callback_data: "queue" },
        { text: "Lyrics", callback_data: "lyrics" },
      ],
      [{ text: "Open jukebox", url: APP }],
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

async function sendMenu(chatId: number, extra?: string) {
  await tg("sendMessage", {
    chat_id: chatId,
    text: (extra ? extra + "\n\n" : "") + nowText(),
    reply_markup: menuKeyboard(),
  });
}

async function handleTelegram(update: any) {
  const cb = update.callback_query;
  if (cb) {
    const from = cb.from;
    const id = String(from?.id || "tg");
    const name = tgName(from);
    const data = String(cb.data || "");
    heartbeat(id, name);
    let text = nowText();
    let markup: any = menuKeyboard();
    if (data === "play") {
      play(id, name);
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
      markup = queueKeyboard();
    } else if (data === "lyrics") {
      text = (await lyricsFor(getRoom().current)).slice(0, 3500);
      markup = { inline_keyboard: [[{ text: "« Menu", callback_data: "menu" }]] };
    } else if (data === "menu") {
      text = nowText();
    } else if (data.startsWith("rm:")) {
      removeFromQueue(data.slice(3));
      const room = getRoom();
      text = room.queue.length
        ? "Removed. Up next:\n" + room.queue.map((t, i) => (i + 1) + ". " + t.title).join("\n")
        : "Queue is empty.";
      markup = queueKeyboard();
    } else if (data.startsWith("del:")) {
      deleteTrack(data.slice(4));
      text = "Deleted.\n" + nowText();
    }
    await tg("answerCallbackQuery", { callback_query_id: cb.id });
    try {
      await tg("editMessageText", {
        chat_id: cb.message.chat.id,
        message_id: cb.message.message_id,
        text,
        reply_markup: markup,
      });
    } catch {
      await tg("sendMessage", { chat_id: cb.message.chat.id, text, reply_markup: markup });
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

  const audio = msg.audio;
  const doc = msg.document;
  const isMp3 = Boolean(audio) || (doc && /audio|mpeg|mp3|m4a|wav|aac|ogg|flac/i.test(`${doc.mime_type || ""} ${doc.file_name || ""}`));
  if (isMp3) {
    const fileId = audio?.file_id || doc?.file_id;
    if (!fileId) return;
    const title = audio?.title || (doc?.file_name || "Untitled").replace(/\.[^.]+$/, "");
    addTrack(
      {
        id: newId(),
        title,
        artist: audio?.performer || name,
        url: "/api/room?tgfile=" + fileId,
        addedBy: name,
        duration: audio?.duration || 0,
        kind: "mp3",
      },
      !getRoom().current,
    );
    await tg("sendMessage", {
      chat_id: chatId,
      text: "Added: " + title + " — " + name,
      reply_markup: menuKeyboard(),
    });
    return;
  }

  const text = String(msg.text || "");
  const cmd = text.replace(/@\w+/, "").trim().toLowerCase();
  if (cmd === "/play" || cmd === "play" || cmd === "▶️ play") {
    play(id, name);
    await sendMenu(chatId);
  } else if (cmd === "/pause" || cmd === "pause" || cmd === "⏸ pause") {
    pause(id, name);
    await sendMenu(chatId);
  } else if (cmd === "/skip" || cmd === "skip" || cmd === "⏭ skip") {
    skip(id, name);
    await sendMenu(chatId);
  } else if (cmd === "/queue" || cmd === "queue" || cmd === "📋 queue") {
    const room = getRoom();
    const q = room.queue.length
      ? "Up next:\n" + room.queue.map((t, i) => (i + 1) + ". " + t.title + (t.addedBy ? " · " + t.addedBy : "")).join("\n")
      : "Queue is empty.";
    await tg("sendMessage", { chat_id: chatId, text: q + "\n\n" + nowText(), reply_markup: queueKeyboard() });
  } else if (cmd === "/lyrics" || cmd === "lyrics" || cmd === "🎤 lyrics") {
    const lyrics = (await lyricsFor(getRoom().current)).slice(0, 3500);
    await tg("sendMessage", {
      chat_id: chatId,
      text: lyrics,
      reply_markup: { inline_keyboard: [[{ text: "« Menu", callback_data: "menu" }]] },
    });
  } else if (/^\/(start|jukebox|menu)(@\w+)?$/.test(cmd) || cmd === "menu") {
    await tg("sendMessage", {
      chat_id: chatId,
      text: nowText() + "\nDetected: " + name,
      reply_markup: menuKeyboard(),
    });
  }
}

async function setupBot() {
  const g = globalThis as any;
  if (g.__jbBotReady) return;
  g.__jbBotReady = true;
  await tg("setMyCommands", {
    commands: [
      { command: "menu", description: "Play, pause, skip, queue, lyrics" },
      { command: "play", description: "Play / resume" },
      { command: "pause", description: "Pause" },
      { command: "skip", description: "Next track" },
      { command: "queue", description: "Show and remove queued songs" },
      { command: "lyrics", description: "Lyrics for what's playing" },
      { command: "jukebox", description: "Open the jukebox" },
    ],
  });
  await tg("setChatMenuButton", {
    menu_button: { type: "web_app", text: "Jukebox", web_app: { url: APP } },
  });
}

export default async function handler(req: any, res: any) {
  try {
    res.setHeader("Access-Control-Allow-Origin", "*");
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
      const id = String(req.query?.id || "anon");
      const name = String(req.query?.name || "Listener");
      return res.status(200).json(heartbeat(id, name));
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
      const audioBuf = extractAudio(req, raw);
      if (audioBuf.length < 200) {
        return res.status(400).json({ error: "That file did not arrive — pick it from Files, not Photos" });
      }
      if (audioBuf.length > 4_500_000) {
        return res.status(400).json({ error: "Over 4.5 MB — drop the mp3 in SoftwareTesters" });
      }
      const mimeHead = String(req.headers?.["content-type"] || "audio/mpeg").split(";")[0] || "audio/mpeg";
      const mime = mimeHead.includes("multipart") ? "audio/mpeg" : mimeHead;
      const id = saveAudio(audioBuf, mime);
      const name = decodeURIComponent(String(url.searchParams.get("name") || req.query?.name || "Someone"));
      const uid = String(url.searchParams.get("id") || req.query?.id || "anon");
      heartbeat(uid, name);
      const track = {
        id,
        title: decodeURIComponent(String(titleQ)),
        artist: name,
        url: "/api/room?audio=" + id,
        addedBy: name,
        duration: 0,
        kind: "mp3",
      };
      addTrack(track, !getRoom().current);
      return res.status(200).json(getRoom());
    }

    let body: any = {};
    if (raw.length) {
      try {
        body = JSON.parse(raw.toString("utf8") || "{}");
      } catch {
        body = {};
      }
    }
    const id = String(body.id || "anon");
    const name = String(body.name || "Listener");
    heartbeat(id, name);
    const type = String(body.type || "");
    if (type === "play") playPause(id, name);
    else if (type === "pause") pause(id, name);
    else if (type === "skip") skip(id, name);
    else if (type === "queue") queueTrack(String(body.trackId || ""), id, name);
    else if (type === "remove") removeFromQueue(String(body.trackId || ""));
    else if (type === "delete") deleteTrack(String(body.trackId || ""));
    else if (type === "lyrics") {
      const text = await lyricsFor(getRoom().current);
      return res.status(200).json({ ...getRoom(), lyrics: text });
    }
    return res.status(200).json(getRoom());
  } catch (e: any) {
    return res.status(500).json({ error: String(e && e.message ? e.message : e) });
  }
}
