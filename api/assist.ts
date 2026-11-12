// Vercel Function: POST /api/assist (streams text). Logic lives in server/assist.ts.
import { handleAssist } from "../server/assist.js";

export function POST(req: Request) {
  return handleAssist(req, process.env);
}
