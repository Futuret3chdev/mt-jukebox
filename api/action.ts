import { addTrack, getRoom, heartbeat, newId, playPause, skip, startTrack } from "./_store";

async function run(body: Record<string, unknown>) {
  const id = String(body.id || "anon");
  const name = String(body.name || "Listener");
  heartbeat(id, name);
  const type = String(body.type || "");
  if (type === "play") return playPause(id);
  if (type === "skip") return skip(id);
  if (type === "queue") {
    const room = getRoom();
    const track = room.library.find((t) => t.id === body.trackId);
    if (track) addTrack({ ...track, addedBy: name, id: newId() }, !room.current);
    return getRoom();
  }
  if (type === "play-now" && body.trackId) {
    const track = getRoom().library.find((t) => t.id === body.trackId);
    if (track) startTrack({ ...track, addedBy: name, id: newId() });
    return getRoom();
  }
  throw new Error("Unknown action");
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    return Response.json(await run(body));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "action failed" }, { status: 500 });
  }
}

export default async function handler(req: { method?: string; body?: Record<string, unknown> }, res?: { setHeader: Function; status: Function }) {
  try {
    if (req.method === "OPTIONS" && res) return res.status(200).json({ ok: true });
    const room = await run(req.body || {});
    if (res) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.status(200).json(room);
    }
    return Response.json(room);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "action failed";
    if (res) return res.status(500).json({ error: msg });
    return Response.json({ error: msg }, { status: 500 });
  }
}
