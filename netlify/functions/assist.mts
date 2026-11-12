import type { Config } from "@netlify/functions";
import { handleAssist } from "../../server/assist.js";

export default (req: Request) => handleAssist(req, process.env);

export const config: Config = { path: "/api/assist" };
