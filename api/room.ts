const DEMO = [
  { id: "demo-night", title: "Night Garden", artist: "MT House", url: "https://cdn.jsdelivr.net/gh/Futuret3chdev/mt-jukebox@main/public/tracks/night-garden.mp3", addedBy: "Library", duration: 16 },
  { id: "demo-lot", title: "Lot Lights", artist: "MT House", url: "https://cdn.jsdelivr.net/gh/Futuret3chdev/mt-jukebox@main/public/tracks/lot-lights.mp3", addedBy: "Library", duration: 16 },
  { id: "demo-empty", title: "Empty House", artist: "MT House", url: "https://cdn.jsdelivr.net/gh/Futuret3chdev/mt-jukebox@main/public/tracks/empty-house.mp3", addedBy: "Library", duration: 16 },
];

function bag() {
  const g = globalThis as any;
  if (!g.__jb) {
    g.__jb = {
      room: {
        hostId: null, hostName: "", current: null, startedAt: null, paused: true, pausePos: 0,
        queue: [], library: DEMO.map((t: any) => ({ ...t })), listeners: [], connected: true,
      },
      audio: new Map(),
    };
  }
  return g.__jb;
}

function nid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function startTrack(track: any) {
  const room = bag().room;
  room.current = track;
  room.startedAt = Date.now();
  room.paused = false;
  room.pausePos = 0;
}

function beat(id: string, name: string) {
  const room = bag().room;
  const now = Date.now();
  room.listeners = (room.listeners || []).filter((l: any) => now - l.seen < 25000);
  const found = room.listeners.find((l: any) => l.id === id);
  if (found) { found.seen = now; found.name = name; }
  else room.listeners.push({ id, name, seen: now });
  if (!room.hostId || !room.listeners.some((l: any) => l.id === room.hostId)) {
    room.hostId = id;
    room.hostName = name;
  }
  return room;
}

export const config = { api: { bodyParser: false } };

export default async function handler(req: any, res: any) {
  try {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "no-store");
    if (req.method === "OPTIONS") return res.status(200).end("ok");

    const url = new URL(req.url || "/", "http://x");
    const audioId = url.searchParams.get("audio") || req.query?.audio;
    if (audioId) {
      const file = bag().audio.get(String(audioId));
      if (!file) return res.status(404).json({ error: "Track gone — add it again" });
      res.setHeader("Content-Type", file.mime);
      return res.status(200).end(file.buf);
    }

    if (req.method === "GET") {
      const id = String(req.query?.id || "anon");
      const name = String(req.query?.name || "Listener");
      return res.status(200).json(beat(id, name));
    }

    const chunks: Buffer[] = [];
    const raw: Buffer = await new Promise((resolve, reject) => {
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });

    const titleQ = url.searchParams.get("title") || req.query?.title;
    if (titleQ) {
      if (raw.length < 1000) return res.status(400).json({ error: "That file is empty" });
      if (raw.length > 4_500_000) return res.status(400).json({ error: "Over 4.5 MB — drop the mp3 in SoftwareTesters" });
      const id = nid();
      bag().audio.set(id, { buf: raw, mime: "audio/mpeg" });
      const name = decodeURIComponent(String(url.searchParams.get("name") || req.query?.name || "Someone"));
      const uid = String(url.searchParams.get("id") || req.query?.id || "anon");
      beat(uid, name);
      const track = { id, title: decodeURIComponent(String(titleQ)), artist: name, url: "/api/room?audio=" + id, addedBy: name, duration: 0 };
      const room = bag().room;
      room.library = [track, ...room.library.filter((t: any) => t.id !== id)].slice(0, 200);
      if (!room.current) startTrack(track);
      else room.queue.push(track);
      return res.status(200).json(room);
    }

    let body: any = {};
    if (raw.length) {
      try { body = JSON.parse(raw.toString("utf8") || "{}"); } catch { body = {}; }
    } else if (req.body && typeof req.body === "object") {
      body = req.body;
    }
    const id = String(body.id || "anon");
    const name = String(body.name || "Listener");
    const room = beat(id, name);
    const type = String(body.type || "");
    if (type === "play") {
      room.hostId = id;
      room.hostName = name;
      if (!room.current) {
        const next = room.queue.shift() || room.library[0];
        if (next) startTrack(next);
      } else if (room.paused) {
        room.startedAt = Date.now() - (room.pausePos || 0) * 1000;
        room.paused = false;
      } else {
        room.pausePos = room.startedAt ? (Date.now() - room.startedAt) / 1000 : 0;
        room.paused = true;
      }
    } else if (type === "skip") {
      room.hostId = id;
      room.hostName = name;
      const next = room.queue.shift();
      if (next) startTrack(next);
      else { room.current = null; room.startedAt = null; room.paused = true; room.pausePos = 0; }
    } else if (type === "queue") {
      const track = room.library.find((t: any) => t.id === body.trackId);
      if (track) {
        const copy = { ...track, addedBy: name, id: nid() };
        if (!room.current) startTrack(copy);
        else room.queue.push(copy);
      }
    }
    return res.status(200).json(room);
  } catch (e: any) {
    return res.status(500).json({ error: String(e && e.message ? e.message : e) });
  }
}
