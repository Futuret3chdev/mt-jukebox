import type { IncomingMessage, ServerResponse } from "node:http";
import { handleApi } from "../server/http";

export const config = { api: { bodyParser: false } };

export default function handler(req: IncomingMessage, res: ServerResponse) {
  const url = req.url || "/api";
  if (!url.startsWith("/api")) req.url = "/api" + (url.startsWith("/") ? url : `/${url}`);
  return handleApi(req, res);
}
