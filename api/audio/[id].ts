export default function handler(req: any, res: any) {
  const g = globalThis as any;
  const file = g.__jbAudio && g.__jbAudio.get(String(req.query?.id || ""));
  if (!file) return res.status(404).json({ error: "Track gone — add it again" });
  res.setHeader("Content-Type", file.mime);
  res.setHeader("Cache-Control", "no-store");
  res.status(200).end(file.buf);
}
