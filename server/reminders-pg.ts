// Node-only: direct Postgres connection for the daily reminder job. Not imported by the Cloudflare Worker.
import type { SqlRunner } from "./reminders.js";

export const generateRemindersViaSql: SqlRunner = async (dbUrl, today) => {
  const { default: postgres } = await import("postgres");
  const sql = postgres(dbUrl, { max: 1, ssl: "require", prepare: false, onnotice: () => {} });
  try {
    const [row] = await sql`select public.generate_reminders(${today}::date) as n`;
    return Number(row?.n ?? 0);
  } finally {
    await sql.end();
  }
};
