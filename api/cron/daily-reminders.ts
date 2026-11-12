// Vercel Cron target (see "crons" in vercel.json). Vercel calls it with
// `Authorization: Bearer $CRON_SECRET`; anything else is refused.
import { cronAuthorized } from "../../server/cron.js";
import { bad } from "../../server/http.js";
import { logReminderResult, runDailyReminders } from "../../server/reminders.js";
import { generateRemindersViaSql } from "../../server/reminders-pg.js";

export async function GET(req: Request) {
  if (!cronAuthorized(req, process.env.CRON_SECRET)) return bad(401, "Unauthorized.");
  const result = await runDailyReminders(process.env, { viaSql: generateRemindersViaSql });
  logReminderResult(result);
  return Response.json(result, { status: result.ok || result.via === "none" ? 200 : 500, headers: { "Cache-Control": "no-store" } });
}
