// Vercel Function: POST /api/reconcile. Logic lives in server/reconcile.ts.
import { handleReconcile } from "../server/reconcile.js";

export function POST(req: Request) {
  return handleReconcile(req, process.env);
}
