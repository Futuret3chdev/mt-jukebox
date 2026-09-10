import { addTrack, getRoom, heartbeat, newId, playPause, skip, startTrack } from "../jb-store";

export default async function handler(req: { method?: string; body?: Record<string, unknown> }, res: {
  setHeader: (k: string, v: string) => void;
  status: (n: number) => { json: (b: unknown) => void; end: (b?: string) => void };
}) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const body = req.body || {};
  const id = String(body.id || "anon");
  const name = String(body.name || "Listener");
  heartbeat(id, name);
  const type = String(body.type || "");
  if (type === "play") return res.status(200).json(playPause(id));
  if (type === "skip") return res.status(200).json(skip(id));
  if (type === "queue") {
    const room = getRoom();
    const track = room.library.find((t) => t.id === body.trackId);
    if (track) addTrack({ ...track, addedBy: name, id: newId() }, !room.current);
    return res.status(200).json(getRoom());
  }
  if (type === "play-now" && body.trackId) {
    const room = getRoom();
    const track = room.library.find((t) => t.id === body.trackId);
    if (track) startTrack({ ...track, addedBy: name, id: newId() });
    return res.status(200).json(getRoom());
  }
  if (type === "spotify" && body.spotifyUri && body.title) {
    addTrack(
      {
        id: newId(),
        title: String(body.title),
        artist: String(body.artist || "Spotify"),
        url: String(body.spotifyUri),
        addedBy: name,
        duration: Number(body.duration) || 0,
        kind: "spotify",
        spotifyUri: String(body.spotifyUri),
      },
      !getRoom().current,
    );
    return res.status(200).json(getRoom());
  }
  return res.status(400).json({ error: "Unknown action" });
}
