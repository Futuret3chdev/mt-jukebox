import type { IncomingMessage, ServerResponse } from "node:http";
import {
  addTrack,
  botConfig,
  claimHost,
  getAudio,
  getRoom,
  heartbeat,
  newId,
  playPause,
  saveAudio,
  setBotConfig,
  setDuration,
  skip,
} from "./store";
import { announceNowPlaying, connectBot, handleUpdate } from "./telegram";

function readBody(req: IncomingMessage) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function send(res: ServerResponse, code: number, body: unknown, extra: Record<string, string> = {}) {
  const data = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(code, {
    "Content-Type": typeof body === "string" ? "text/plain" : "application/json",
    "Cache-Control": "no-store",
    ...extra,
  });
  res.end(data);
}

export async function handleApi(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || "/", "http://local");
  const path = url.pathname;
  try {
    if (req.method === "GET" && path === "/api/room") {
      const id = url.searchParams.get("id") || "anon";
      const name = url.searchParams.get("name") || "Listener";
      return send(res, 200, heartbeat(id, name));
    }

    if (req.method === "POST" && path === "/api/action") {
      const body = JSON.parse((await readBody(req)).toString() || "{}") as {
        type?: string;
        id?: string;
        name?: string;
        trackId?: string;
        duration?: number;
        title?: string;
        artist?: string;
        url?: string;
        spotifyUri?: string;
      };
      const id = body.id || "anon";
      const name = body.name || "Listener";
      heartbeat(id, name);
      claimHost(id, name);
      if (body.type === "play") return send(res, 200, playPause(id));
      if (body.type === "skip") return send(res, 200, skip(id));
      if (body.type === "duration" && body.trackId && body.duration) {
        return send(res, 200, setDuration(body.trackId, body.duration));
      }
      if (body.type === "queue") {
        const room = getRoom();
        const track = room.library.find((t) => t.id === body.trackId);
        if (track) addTrack({ ...track, addedBy: name, id: newId() }, !room.current);
        return send(res, 200, getRoom());
      }
      if (body.type === "spotify" && body.spotifyUri && body.title) {
        const room = getRoom();
        addTrack(
          {
            id: newId(),
            title: body.title,
            artist: body.artist || "Spotify",
            url: body.spotifyUri,
            addedBy: name,
            duration: body.duration || 0,
            kind: "spotify",
            spotifyUri: body.spotifyUri,
          },
          !room.current,
        );
        return send(res, 200, getRoom());
      }
      return send(res, 400, { error: "Unknown action" });
    }

    if (req.method === "POST" && path === "/api/upload") {
      const buf = await readBody(req);
      const title = decodeURIComponent(url.searchParams.get("title") || "Untitled");
      const name = decodeURIComponent(url.searchParams.get("name") || "Someone");
      const idName = url.searchParams.get("id") || "anon";
      if (buf.length < 1000) return send(res, 400, { error: "That file is empty" });
      if (buf.length > 4_500_000) {
        return send(res, 400, { error: "Over 4.5 MB — drop the mp3 in SoftwareTesters instead, the bot will queue it" });
      }
      const audioId = saveAudio(title, buf, "audio/mpeg");
      const dur = Number(url.searchParams.get("duration") || "0");
      const track = {
        id: audioId,
        title,
        artist: name,
        url: `/api/audio/${audioId}`,
        addedBy: name,
        duration: Number.isFinite(dur) ? dur : 0,
        kind: "mp3" as const,
      };
      heartbeat(idName, name);
      const playing = Boolean(getRoom().current);
      const room = addTrack(track, !playing);
      void announceNowPlaying(title, name);
      return send(res, 200, room);
    }

    if (req.method === "GET" && path.startsWith("/api/audio/tg/")) {
      const fileId = path.slice("/api/audio/tg/".length);
      const { token } = botConfig();
      if (!token) return send(res, 404, { error: "Bot not connected" });
      const fileRes = await fetch(`https://api.telegram.org/bot${token}/getFile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_id: fileId }),
      });
      const fileJson = (await fileRes.json()) as { ok: boolean; result?: { file_path?: string } };
      const filePath = fileJson.result?.file_path;
      if (!filePath) return send(res, 404, { error: "Telegram file expired — drop the mp3 again" });
      const bin = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
      const buf = Buffer.from(await bin.arrayBuffer());
      res.writeHead(200, {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
        "Content-Length": String(buf.length),
      });
      res.end(buf);
      return;
    }

    if (req.method === "GET" && path.startsWith("/api/audio/")) {
      const id = path.slice("/api/audio/".length);
      const file = getAudio(id);
      if (!file) return send(res, 404, { error: "Track gone — add it again" });
      res.writeHead(200, {
        "Content-Type": file.mime,
        "Cache-Control": "no-store",
        "Content-Length": String(file.buf.length),
      });
      res.end(file.buf);
      return;
    }

    if (req.method === "POST" && path === "/api/connect") {
      const body = JSON.parse((await readBody(req)).toString() || "{}") as {
        token?: string;
        chatId?: string;
        appUrl?: string;
      };
      if (!body.token) return send(res, 400, { error: "Need a bot token" });
      setBotConfig(body.token.trim(), (body.chatId || "").trim(), (body.appUrl || "").trim());
      await connectBot((body.appUrl || "").trim());
      return send(res, 200, { ok: true, room: getRoom() });
    }

    if (req.method === "GET" && path === "/api/status") {
      const cfg = botConfig();
      return send(res, 200, {
        connected: Boolean(cfg.token),
        hasChat: Boolean(cfg.chatId),
      });
    }

    if (req.method === "POST" && path === "/api/bot") {
      const update = JSON.parse((await readBody(req)).toString() || "{}");
      await handleUpdate(update);
      return send(res, 200, { ok: true });
    }

    send(res, 404, { error: "Not found" });
  } catch (err) {
    send(res, 500, { error: err instanceof Error ? err.message : "Server failed" });
  }
}
