// Sample workspace for the preview that runs when no Supabase project is connected.
// Newly written, fictional content; it is never stored anywhere.
import type { Data } from "../state/data";
import { currentPeriod, shiftPeriod, todayISO } from "./format";

const WS = "00000000-0000-4000-8000-000000000001";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const token = (n: number) => `demo${String(n).padStart(4, "0")}`.padEnd(64, "0");

function dayIn(period: string, day: number, hour = 11) {
  return `${period}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:15:00.000Z`;
}

export function demoData(): Data {
  const now = currentPeriod();
  const today = todayISO();
  const todayDay = Number(today.slice(8, 10));
  const created = `${shiftPeriod(now, -14)}-02T09:00:00.000Z`;

  const properties = [
    { id: id(11), workspace_id: WS, name: "Gulmohar Court", type: "Apartment" as const, address: "14 Lake View Road, Pune 411001", created_at: created, archived_at: null, cover_path: null },
    { id: id(12), workspace_id: WS, name: "Amaltas House", type: "PG/Hostel" as const, address: "3rd Cross, Indiranagar, Bengaluru", created_at: created, archived_at: null, cover_path: null },
    { id: id(13), workspace_id: WS, name: "Old Market Shop", type: "Commercial" as const, address: "Shop 7, Station Road", created_at: created, archived_at: "2026-06-30T00:00:00.000Z", cover_path: null },
  ];
  const units = [
    { id: id(21), property_id: id(11), label: "Flat 3A", pass_colour: "#0f6e6e", archived_at: null },
    { id: id(22), property_id: id(11), label: "Flat 4B", pass_colour: "#3f4aa8", archived_at: null },
    { id: id(23), property_id: id(11), label: "Flat 5C", pass_colour: "#b5532f", archived_at: null },
    { id: id(24), property_id: id(12), label: "Room 1", pass_colour: "#c98a0b", archived_at: null },
    { id: id(25), property_id: id(12), label: "Room 2", pass_colour: "#8a3a6b", archived_at: null },
    { id: id(26), property_id: id(13), label: "Main", pass_colour: "#2d2a26", archived_at: null },
  ];
  const tenants = [
    { id: id(31), name: "Kavya Iyer", phone_whatsapp: "98765 43210", email: "kavya@example.com", upi_id: null, created_at: created, archived_at: null, portal_token: token(1) },
    { id: id(32), name: "Rohan Mehta", phone_whatsapp: "98200 11223", email: null, upi_id: null, created_at: created, archived_at: null, portal_token: null },
    { id: id(33), name: "Sana Qureshi", phone_whatsapp: "99000 44556", email: "sana@example.com", upi_id: null, created_at: created, archived_at: null, portal_token: null },
    { id: id(34), name: "Arjun Das", phone_whatsapp: "97311 77889", email: null, upi_id: null, created_at: created, archived_at: null, portal_token: null },
    { id: id(35), name: "Meher Bakery", phone_whatsapp: null, email: null, upi_id: null, created_at: created, archived_at: "2026-06-30T00:00:00.000Z", portal_token: null },
  ];
  const start = `${shiftPeriod(now, -10)}-01`;
  const endSoon = `${shiftPeriod(now, 1)}-20`;
  const leases = [
    { id: id(41), unit_id: id(21), tenant_id: id(31), rent: "18500.00", deposit: "55000.00", due_day: 5, start_date: start, end_date: null, status: "active" as const },
    { id: id(42), unit_id: id(22), tenant_id: id(32), rent: "21000.00", deposit: "60000.00", due_day: 5, start_date: start, end_date: endSoon, status: "active" as const },
    { id: id(43), unit_id: id(24), tenant_id: id(33), rent: "9500.00", deposit: "19000.00", due_day: 1, start_date: start, end_date: null, status: "active" as const },
    { id: id(44), unit_id: id(25), tenant_id: id(34), rent: "9000.00", deposit: "18000.00", due_day: Math.min(28, Math.max(todayDay + 2, 10)), start_date: `${shiftPeriod(now, -4)}-01`, end_date: null, status: "active" as const },
    { id: id(45), unit_id: id(26), tenant_id: id(35), rent: "15000.00", deposit: "30000.00", due_day: 10, start_date: `${shiftPeriod(now, -14)}-01`, end_date: "2026-06-30", status: "ended" as const },
  ];

  // Six months of history: mostly on time, one partial and one late payer this month.
  const payments: Data["payments"] = [];
  let seq = 0;
  const pay = (lease: string, period: string, amount: number, day: number, method: Data["payments"][number]["method"], reference: string | null = null) => {
    seq += 1;
    payments.push({
      id: id(500 + seq), lease_id: lease, receipt_no: `ANG-${String(seq).padStart(5, "0")}`, verify_token: token(100 + seq),
      amount: amount.toFixed(2), period, method, reference, note: null, paid_at: dayIn(period, day),
    });
  };
  // The shop's lease ran until June 2026; it paid on time throughout.
  for (let i = -14; i <= -1; i++) {
    const p = shiftPeriod(now, i);
    if (p > "2026-06") break;
    pay(id(45), p, 15000, 9, "cheque", `CHQ ${300100 + i + 14}`);
  }
  for (let i = -10; i <= -1; i++) {
    const p = shiftPeriod(now, i);
    pay(id(41), p, 18500, 4, "upi", `UPI ${4410 + i}…${8821 - i}`);
    pay(id(42), p, 21000, i === -2 ? 9 : 5, "bank", "NEFT");
    pay(id(43), p, 9500, 2, "upi");
    if (i >= -4) pay(id(44), p, 9000, 8, "cash");
  }
  pay(id(41), now, 18500, Math.max(1, Math.min(todayDay, 4)), "upi", "UPI 4421…7710");
  pay(id(43), now, 5000, 1, "cash");
  payments.sort((a, b) => b.paid_at.localeCompare(a.paid_at));

  const expenses: Data["expenses"] = [];
  const cats = [["Repairs", 3200, id(11), "Bathroom tap, Flat 4B"], ["Society charges", 4500, id(11), null], ["Utilities", 2100, id(12), "Common area power"], ["Cleaning", 1500, id(12), null]] as const;
  for (let i = -5; i <= 0; i++) {
    const p = shiftPeriod(now, i);
    cats.forEach(([category, amount, property, note], k) => {
      if ((i + k) % 3 === 0 || category === "Society charges") {
        expenses.push({ id: id(700 + expenses.length), property_id: property, category, amount: (amount + k * 150 + (i + 5) * 40).toFixed(2), spent_on: `${p}-${String(i === 0 ? Math.min(6 + k * 4, Math.max(1, todayDay)) : 6 + k * 4).padStart(2, "0")}`, note });
      }
    });
  }
  expenses.sort((a, b) => b.spent_on.localeCompare(a.spent_on));

  const tasks: Data["tasks"] = [
    { id: id(61), property_id: id(11), title: "Fix leaking tap in 4B", priority: "high", status: "in_progress", vendor: "Sharma Plumbing", created_at: dayIn(now, 2), tenant_id: id(32), details: null, source: "landlord" },
    { id: id(62), property_id: id(12), title: "Wi-Fi drops in Room 2 every evening", priority: "medium", status: "open", vendor: null, created_at: dayIn(now, 3), tenant_id: id(34), details: "Router seems to restart around 8 pm.", source: "tenant" },
    { id: id(63), property_id: id(11), title: "Annual pest control", priority: "low", status: "open", vendor: null, created_at: dayIn(shiftPeriod(now, -1), 20), tenant_id: null, details: null, source: "landlord" },
    { id: id(64), property_id: id(12), title: "Replace geyser element", priority: "urgent", status: "open", vendor: "Volt Electricals", created_at: dayIn(now, 1), tenant_id: null, details: null, source: "landlord" },
    { id: id(65), property_id: id(11), title: "Repaint stairwell", priority: "medium", status: "done", vendor: "Colour Co.", created_at: dayIn(shiftPeriod(now, -2), 12), tenant_id: null, details: null, source: "landlord" },
  ];

  const prev = shiftPeriod(now, -1);
  const invoices: Data["invoices"] = [
    { id: id(81), lease_id: id(41), invoice_no: "ANG-INV-00011", period: now, due_date: `${now}-05`, rent: "18500.00", utilities: "0.00", late_fee: "0.00", other: "0.00", carried_forward: "0.00", total: "18500.00", status: "open", note: null, created_at: dayIn(now, 1) },
    { id: id(82), lease_id: id(43), invoice_no: "ANG-INV-00012", period: now, due_date: `${now}-01`, rent: "9500.00", utilities: "640.00", late_fee: "0.00", other: "0.00", carried_forward: "0.00", total: "10140.00", status: "open", note: null, created_at: dayIn(now, 1) },
    { id: id(83), lease_id: id(44), invoice_no: "ANG-INV-00013", period: now, due_date: `${now}-${String(leases[3].due_day).padStart(2, "0")}`, rent: "9000.00", utilities: "520.00", late_fee: "0.00", other: "0.00", carried_forward: "0.00", total: "9520.00", status: "open", note: null, created_at: dayIn(now, 1) },
    { id: id(84), lease_id: id(42), invoice_no: "ANG-INV-00014", period: now, due_date: `${now}-05`, rent: "21000.00", utilities: "0.00", late_fee: "500.00", other: "0.00", carried_forward: "0.00", total: "21500.00", status: "open", note: "Late fee after grace period", created_at: dayIn(now, 1) },
    { id: id(85), lease_id: id(41), invoice_no: "ANG-INV-00007", period: prev, due_date: `${prev}-05`, rent: "18500.00", utilities: "0.00", late_fee: "0.00", other: "0.00", carried_forward: "0.00", total: "18500.00", status: "open", note: null, created_at: dayIn(prev, 1) },
  ];
  const meters: Data["meters"] = [
    { id: id(91), unit_id: id(24), kind: "electric", period: now, previous: "1204.00", current: "1284.00", rate: "8.0000", amount: "640.00" },
    { id: id(92), unit_id: id(25), kind: "electric", period: now, previous: "880.00", current: "945.00", rate: "8.0000", amount: "520.00" },
    { id: id(93), unit_id: id(24), kind: "electric", period: prev, previous: "1130.00", current: "1204.00", rate: "8.0000", amount: "592.00" },
  ];
  const deposits: Data["deposits"] = [
    { id: id(101), lease_id: id(41), type: "received", amount: "55000.00", txn_date: start, note: "At move-in" },
    { id: id(102), lease_id: id(42), type: "received", amount: "60000.00", txn_date: start, note: "At move-in" },
    { id: id(103), lease_id: id(43), type: "received", amount: "19000.00", txn_date: start, note: null },
    { id: id(104), lease_id: id(45), type: "received", amount: "30000.00", txn_date: "2025-09-01", note: null },
    { id: id(105), lease_id: id(45), type: "deduction", amount: "4000.00", txn_date: "2026-06-30", note: "Shutter repair" },
    { id: id(106), lease_id: id(45), type: "refund", amount: "26000.00", txn_date: "2026-07-03", note: "Settled by bank transfer" },
  ];
  const documents: Data["documents"] = [
    { id: id(111), property_id: id(11), tenant_id: id(31), kind: "lease", name: "Lease agreement — Flat 3A.pdf", path: `${WS}/docs/lease-3a.pdf`, size: 482_133, mime: "application/pdf", created_at: dayIn(shiftPeriod(now, -10), 1) },
    { id: id(112), property_id: null, tenant_id: id(33), kind: "id", name: "Aadhaar (masked) — Sana.jpg", path: `${WS}/docs/id-sana.jpg`, size: 211_904, mime: "image/jpeg", created_at: dayIn(shiftPeriod(now, -10), 2) },
    { id: id(113), property_id: id(12), tenant_id: null, kind: "inspection", name: "Move-in inspection — Room 2.pdf", path: `${WS}/docs/inspect-r2.pdf`, size: 1_302_044, mime: "application/pdf", created_at: dayIn(shiftPeriod(now, -4), 1) },
  ];
  const reminders: Data["reminders"] = [
    { id: id(121), lease_id: id(42), period: now, kind: "overdue", for_date: today, amount: "21500.00", status: "pending" },
    { id: id(122), lease_id: id(43), period: now, kind: todayDay > 1 ? "overdue" : "due", for_date: today, amount: "5140.00", status: "pending" },
    { id: id(123), lease_id: id(44), period: now, kind: "upcoming", for_date: today, amount: "9520.00", status: "pending" },
  ];
  const audit: Data["audit"] = payments.slice(0, 6).map((p, i) => ({
    id: 900 - i, actor_email: "owner@example.com", entity: "payments", entity_id: p.id, action: "insert", summary: p.receipt_no, at: p.paid_at,
  }));
  audit.push(
    { id: 800, actor_email: "owner@example.com", entity: "tasks", entity_id: id(61), action: "update", summary: "Fix leaking tap in 4B", at: dayIn(now, 2, 15) },
    { id: 799, actor_email: "caretaker@example.com", entity: "expenses", entity_id: expenses[0]?.id ?? null, action: "insert", summary: expenses[0]?.category ?? "Repairs", at: dayIn(now, 1, 18) },
    { id: 798, actor_email: "owner@example.com", entity: "properties", entity_id: id(13), action: "archive", summary: "Old Market Shop", at: "2026-06-30T10:00:00.000Z" },
  );
  audit.sort((a, b) => b.at.localeCompare(a.at));

  return {
    workspace: {
      id: WS, owner_id: id(1), name: "Meera Rentals (preview)", currency: "INR", locale: "en-IN", upi_id: "meera.rentals@okbank",
      invoice_prefix: "ANG", receipt_seq: seq, created_at: created, invoice_seq: 14, remind_before_days: 3, grace_days: 3,
      late_fee_type: "flat", late_fee_value: "500.00",
    },
    role: "owner", v2: true, properties, units, tenants, leases, payments, tasks, expenses, invoices, meters, deposits,
    documents, reminders, audit, recon: true, bankLines: [],
    members: [{ workspace_id: WS, user_id: id(2), email: "caretaker@example.com", role: "manager", created_at: created }],
    invites: [{ id: id(131), email: "accounts@example.com", role: "viewer", token: token(9), created_at: dayIn(now, 1), expires_at: dayIn(shiftPeriod(now, 1), 1), accepted_at: null }],
  };
}

export const DEMO_EMAIL = "preview@angan.app";
