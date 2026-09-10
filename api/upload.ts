import { addTrack, getRoom, heartbeat, saveAudio } from "./_store";

export const config = { api: { bodyParser: false } };

async function ingest(buf: Buffer, title: string, name: string, id: string) {
  if (buf.length < 1000) throw new Error("That file is empty");
  if (buf.length > 4_500_000) throw new Error("Over 4.5 MB — drop the mp3 in SoftwareTesters");
  const audioId = saveAudio(buf, "audio/mpeg");
  heartbeat(id, name);
  addTrack(
    { id: audioId, title, artist: name, url: `/api/audio/${audioId}`, addedBy: name, duration: 0, kind: "mp3" },
    !getRoom().current,
  );
  return getRoom();
}

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const title = url.searchParams.get("title") || "Untitled";
    const name = url.searchParams.get("name") || "Someone";
    const id = url.searchParams.get("id") || "anon";
    const buf = Buffer.from(await request.arrayBuffer());
    return Response.json(await ingest(buf, title, name, id));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "upload failed" }, { status: 400 });
  }
}

export default async function handler(req: any, res?: any) {
  try {
    const chunks: Buffer[] = [];
    const buf: Buffer = await new Promise((resolve, reject) => {
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });
    const title = decodeURIComponent(String(req.query?.title || "Untitled"));
    const name = decodeURIComponent(String(req.query?.name || "Someone"));
    const id = String(req.query?.id || "anon");
    const room = await ingest(buf, title, name, id);
    if (res) return res.status(200).json(room);
    return Response.json(room);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "upload failed";
    if (res) return res.status(400).json({ error: msg });
    return Response.json({ error: msg }, { status: 400 });
  }
}
