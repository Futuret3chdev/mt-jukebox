import type { IncomingMessage, ServerResponse } from "node:http";
import { handleApi } from "../server/http";

export const config = { api: { bodyParser: false } };

export default function handler(req: IncomingMessage, res: ServerResponse) {
  const q = req.url?.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  req.url = "/api/room" + q;
  return handleApi(req, res);
}
