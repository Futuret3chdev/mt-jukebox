export const config = { api: { bodyParser: false } };

function state() {
  const g = globalThis as any;
  if (!g.__jbRoom) {
    g.__jbRoom = {
      hostId: null, hostName: "", current: null, startedAt: null, paused: true, pausePos: 0,
      queue: [], library: [], listeners: [], connected: true,
    };
  }
  if (!g.__jbAudio) g.__jbAudio = new Map();
  return g;
}

export default async function handler(req: any, res: any) {
  try {
    res.setHeader("Access-Control-Allow-Origin", "*");
    const chunks: Buffer[] = [];
    const buf: Buffer = await new Promise((resolve, reject) => {
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });
    if (buf.length < 1000) return res.status(400).json({ error: "That file is empty" });
    if (buf.length > 4_500_000) return res.status(400).json({ error: "Over 4.5 MB — drop the mp3 in SoftwareTesters" });
    const g = state();
    const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    g.__jbAudio.set(id, { buf, mime: "audio/mpeg" });
    const title = decodeURIComponent(String(req.query?.title || "Untitled"));
    const name = decodeURIComponent(String(req.query?.name || "Someone"));
    const track = { id, title, artist: name, url: "/api/audio/" + id, addedBy: name, duration: 0 };
    const room = g.__jbRoom;
    room.library = [track, ...(room.library || [])].slice(0, 200);
    if (!room.current) {
      room.current = track;
      room.startedAt = Date.now();
      room.paused = false;
      room.pausePos = 0;
    } else {
      room.queue.push(track);
    }
    res.status(200).json(room);
  } catch (e: any) {
    res.status(400).json({ error: String(e && e.message ? e.message : e) });
  }
}
