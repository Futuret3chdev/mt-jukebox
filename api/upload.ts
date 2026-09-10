import { addTrack, getRoom, heartbeat, saveAudio } from "../jb-store";

export const config = { api: { bodyParser: false } };

export default async function handler(req: {
  method?: string;
  query?: { title?: string; name?: string; id?: string };
  on: (e: string, fn: (c?: Buffer) => void) => void;
}, res: {
  setHeader: (k: string, v: string) => void;
  status: (n: number) => { json: (b: unknown) => void; end: (b?: string) => void };
}) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => resolve());
    req.on("error", reject);
  });
  const buf = Buffer.concat(chunks);
  if (buf.length < 1000) return res.status(400).json({ error: "That file is empty" });
  if (buf.length > 4_500_000) {
    return res.status(400).json({ error: "Over 4.5 MB — drop the mp3 in SoftwareTesters and the bot will queue it" });
  }
  const title = decodeURIComponent(String(req.query?.title || "Untitled"));
  const name = decodeURIComponent(String(req.query?.name || "Someone"));
  const id = String(req.query?.id || "anon");
  const audioId = saveAudio(buf, "audio/mpeg", title);
  heartbeat(id, name);
  const track = {
    id: audioId,
    title,
    artist: name,
    url: `/api/audio/${audioId}`,
    addedBy: name,
    duration: 0,
    kind: "mp3",
  };
  addTrack(track, !getRoom().current);
  return res.status(200).json(getRoom());
}
