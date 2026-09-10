import { getAudio } from "../../jb-store";

export default function handler(req: { query?: { id?: string }; method?: string }, res: {
  setHeader: (k: string, v: string) => void;
  status: (n: number) => { json: (b: unknown) => void; end: (b?: unknown) => void };
  end: (b?: unknown) => void;
}) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const id = String(req.query?.id || "");
  const file = getAudio(id);
  if (!file) return res.status(404).json({ error: "Track gone — add it again" });
  res.setHeader("Content-Type", file.mime);
  res.setHeader("Cache-Control", "no-store");
  res.status(200).end(file.buf);
}
