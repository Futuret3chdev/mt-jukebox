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
      };
      const id = body.id || "anon";
      const name = body.name || "Listener";
      heartbeat(id, name);
      claimHost(id, name);
      if (body.type === "play") return send(res, 200, playPause(id));
      if (body.type === "skip") return send(res, 200, skip(id));
      if (body.type === "queue") {
        const room = getRoom();
        const track = room.library.find((t) => t.id === body.trackId);
        if (track) addTrack({ ...track, addedBy: name, id: newId() }, !room.current);
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
      if (buf.length > 8_000_000) return send(res, 400, { error: "Keep it under 8 MB" });
      const audioId = saveAudio(title, buf, "audio/mpeg");
      const track = {
        id: audioId,
        title,
        artist: name,
        url: `/api/audio/${audioId}`,
        addedBy: name,
        duration: 0,
      };
      heartbeat(idName, name);
      const room = addTrack(track, true);
      void announceNowPlaying(title, name);
      return send(res, 200, room);
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
