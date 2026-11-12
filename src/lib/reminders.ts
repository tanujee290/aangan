import type { LeaseRow } from "./rent";
import type { Workspace } from "./types";
import { dateLabel, money, periodLabel } from "./format";

/** A reminder draft the landlord reviews in WhatsApp before sending. */
export function reminderText(row: LeaseRow, ws: Workspace) {
  const first = row.tenant.name.split(" ")[0];
  const amount = money(row.balance || row.rent);
  const month = periodLabel(row.dueDate.slice(0, 7));
  const upi = ws.upi_id ? `\nUPI: ${ws.upi_id}` : "";
  if (row.status === "overdue") {
    return `Hi ${first}, a gentle reminder that rent of ${amount} for ${row.unit.label}, ${row.property.name} (${month}) was due on ${dateLabel(row.dueDate, { day: "numeric", month: "short" })}. Please pay at your earliest convenience.${upi}\n\nThank you,\n${ws.name}`;
  }
  return `Hi ${first}, rent of ${amount} for ${row.unit.label}, ${row.property.name} (${month}) is due on ${dateLabel(row.dueDate, { day: "numeric", month: "short" })}.${upi}\n\nThank you,\n${ws.name}`;
}
