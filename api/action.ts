function state() {
  const g = globalThis as any;
  if (!g.__jbRoom) {
    g.__jbRoom = {
      hostId: null, hostName: "", current: null, startedAt: null, paused: true, pausePos: 0,
      queue: [], library: [], listeners: [], connected: true,
    };
  }
  return g.__jbRoom;
}

function startTrack(room: any, track: any) {
  room.current = track;
  room.startedAt = Date.now();
  room.paused = false;
  room.pausePos = 0;
}

export default function handler(req: any, res: any) {
  try {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "no-store");
    if (req.method === "OPTIONS") return res.status(200).json({ ok: true });
    const body = req.body || {};
    const id = String(body.id || "anon");
    const name = String(body.name || "Listener");
    const room = state();
    if (!room.hostId) { room.hostId = id; room.hostName = name; }
    const type = String(body.type || "");
    if (type === "play") {
      if (room.hostId !== id) return res.status(200).json(room);
      if (!room.current) {
        const next = room.queue.shift() || room.library[0];
        if (next) startTrack(room, next);
      } else if (room.paused) {
        room.startedAt = Date.now() - (room.pausePos || 0) * 1000;
        room.paused = false;
      } else {
        room.pausePos = room.startedAt ? (Date.now() - room.startedAt) / 1000 : 0;
        room.paused = true;
      }
    } else if (type === "skip") {
      if (room.hostId === id) {
        const next = room.queue.shift();
        if (next) startTrack(room, next);
        else { room.current = null; room.startedAt = null; room.paused = true; room.pausePos = 0; }
      }
    } else if (type === "queue") {
      const track = (room.library || []).find((t: any) => t.id === body.trackId);
      if (track) {
        const copy = { ...track, addedBy: name, id: Math.random().toString(36).slice(2) };
        if (!room.current) startTrack(room, copy);
        else room.queue.push(copy);
      }
    }
    res.status(200).json(room);
  } catch (e: any) {
    res.status(500).json({ error: String(e && e.message ? e.message : e) });
  }
}
