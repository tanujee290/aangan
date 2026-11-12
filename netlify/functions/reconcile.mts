import type { Config } from "@netlify/functions";
import { handleReconcile } from "../../server/reconcile.js";

export default (req: Request) => handleReconcile(req, process.env);

export const config: Config = { path: "/api/reconcile" };
