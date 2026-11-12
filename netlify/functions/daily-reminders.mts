import type { Config } from "@netlify/functions";
import { logReminderResult, runDailyReminders } from "../../server/reminders.js";
import { generateRemindersViaSql } from "../../server/reminders-pg.js";

// 06:00 IST every day.
export default async () => {
  logReminderResult(await runDailyReminders(process.env, { viaSql: generateRemindersViaSql }));
};

export const config: Config = { schedule: "30 0 * * *" };
