import { heartbeat } from "../jb-store";

export default function handler(req: { query?: { id?: string; name?: string }; method?: string }, res: {
  setHeader: (k: string, v: string) => void;
  status: (n: number) => { json: (b: unknown) => void; end: (b?: string) => void };
  json: (b: unknown) => void;
}) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(200).end();
  const id = String(req.query?.id || "anon");
  const name = String(req.query?.name || "Listener");
  return res.status(200).json(heartbeat(id, name));
}
