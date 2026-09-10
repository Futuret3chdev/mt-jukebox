import { heartbeat } from "./_store";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get("id") || "anon";
    const name = url.searchParams.get("name") || "Listener";
    return Response.json(heartbeat(id, name));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "room failed" }, { status: 500 });
  }
}

export default async function handler(req: { method?: string; query?: { id?: string; name?: string }; url?: string }, res?: { setHeader: Function; status: Function }) {
  try {
    const id = String(req.query?.id || "anon");
    const name = String(req.query?.name || "Listener");
    const room = heartbeat(id, name);
    if (res) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json(room);
    }
    return Response.json(room);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "room failed";
    if (res) return res.status(500).json({ error: msg });
    return Response.json({ error: msg }, { status: 500 });
  }
}
