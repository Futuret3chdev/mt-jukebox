import { getAudio } from "../_store";

export async function GET(_request: Request, ctx: { params: { id: string } }) {
  const file = getAudio(ctx.params.id);
  if (!file) return Response.json({ error: "Track gone — add it again" }, { status: 404 });
  return new Response(file.buf, { headers: { "Content-Type": file.mime, "Cache-Control": "no-store" } });
}

export default function handler(req: { query?: { id?: string } }, res: any) {
  const file = getAudio(String(req.query?.id || ""));
  if (!file) return res.status(404).json({ error: "Track gone — add it again" });
  res.setHeader("Content-Type", file.mime);
  res.setHeader("Cache-Control", "no-store");
  res.status(200).end(file.buf);
}
