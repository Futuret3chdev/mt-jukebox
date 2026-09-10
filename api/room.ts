import {
  addTrack,
  deleteTrack,
  getAudio,
  getRoom,
  heartbeat,
  lyricsFor,
  newId,
  pause,
  play,
  playPause,
  queueTrack,
  removeFromQueue,
  saveAudio,
  skip,
} from "./_store";

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
