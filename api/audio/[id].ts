export default function handler(req: any, res: any) {
  const g = globalThis as any;
  const id = String(req.query?.id || "");
  const file =
    (g.__jb && g.__jb.audio && g.__jb.audio.get(id)) ||
    (g.__jbAudio && g.__jbAudio.get(id));
  if (!file) return res.status(404).json({ error: "Track gone — add it again" });
  res.setHeader("Content-Type", file.mime || "audio/mpeg");
  res.setHeader("Cache-Control", "no-store");
  res.status(200).end(file.buf);
}
