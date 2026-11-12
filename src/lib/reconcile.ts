// Bank statement reconciliation: parse a bank CSV, then match each line to a receipt,
// an unpaid rent row (record a payment) or an expense. Everything here is pure, so the
// same logic runs on live Supabase data and on the sample-data preview.
import type { Data } from "../state/data";
import type { BankLine, Expense, Payment } from "./types";
import { currentPeriod, shiftPeriod, todayISO } from "./format";
import { rentRows, type LeaseRow } from "./rent";
import { leaseLookup } from "./reports";

/* ------------------------------------------------------------------ CSV */

export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const delim = [",", ";", "\t", "|"].map((d) => [d, firstLine.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell.trim() === "") { quoted = true; cell = ""; }
    else if (c === delim) { row.push(cell.trim()); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell.trim()); cell = "";
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell.trim());
  if (row.some((x) => x !== "")) rows.push(row);
  return rows;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n: number) => String(n).padStart(2, "0");

/** Indian statements use day-first dates: 05/11/2026, 05-11-26, 05-Nov-2026, 5 Nov 2026, or ISO. */
export function parseDate(raw: string): string | null {
  const s = raw.trim().replace(/\s+\d{1,2}:\d{2}(:\d{2})?(\s*[AP]M)?$/i, "");
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2,4})$/);
  if (m) return valid(year(m[3]), +m[2], +m[1]);
  m = s.match(/^(\d{1,2})[-/ ]([A-Za-z]{3,9})[-/ ,]+(\d{2,4})$/);
  if (m) return valid(year(m[3]), MONTHS[m[2].slice(0, 4).toLowerCase()] ?? MONTHS[m[2].slice(0, 3).toLowerCase()], +m[1]);
  m = s.match(/^([A-Za-z]{3,9})[ ](\d{1,2}),?[ ](\d{4})$/);
  if (m) return valid(+m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], +m[2]);
  return null;
}
function year(y: string) { const n = Number(y); return n < 100 ? 2000 + n : n; }
function valid(y: number, mo: number | undefined, d: number) {
  if (!mo || mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  const dt = new Date(y, mo - 1, d);
  return dt.getMonth() === mo - 1 ? `${y}-${pad(mo)}-${pad(d)}` : null;
}

/** "1,23,456.00", "₹ 9,500", "(250.00)", "5,000.00 Cr" → number; Dr / brackets / minus → negative. */
export function parseAmount(raw: string): number | null {
  const s = raw.trim();
  if (!s || s === "-") return null;
  const neg = /^\(.*\)$/.test(s) || /^-/.test(s) || /\bdr\.?$/i.test(s);
  const n = Number(s.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n) || n === 0) return null;
  return neg ? -n : n;
}

type Col = "date" | "description" | "reference" | "credit" | "debit" | "amount" | "type";
const HEADS: [Col, RegExp][] = [
  ["date", /^(txn |transaction |tran |value |posting |book )?date$|^date/],
  ["description", /narration|description|particulars|remarks|details|transaction details/],
  ["reference", /ref|utr|chq|cheque|instrument/],
  ["credit", /credit|deposit|cr amount|money in|paid in/],
  ["debit", /debit|withdrawal|dr amount|money out|paid out/],
  ["type", /^(cr\/dr|dr\/cr|type|txn type)$/],
  ["amount", /amount|amt/],
];

export interface ParsedLine {
  txn_date: string;
  description: string;
  reference: string | null;
  amount: number;
  fingerprint: string;
}
export interface ParseResult { lines: ParsedLine[]; skipped: number; error?: string }

/** Finds the header row (statements often start with account details) and reads every transaction under it. */
export function parseStatement(text: string): ParseResult {
  const rows = parseCsv(text);
  let headerAt = -1;
  let map: Partial<Record<Col, number>> = {};
  for (let r = 0; r < Math.min(rows.length, 40); r++) {
    const m: Partial<Record<Col, number>> = {};
    rows[r].forEach((h, i) => {
      const key = h.toLowerCase().replace(/[._]/g, " ").replace(/\s+/g, " ").trim();
      for (const [col, re] of HEADS) {
        if (m[col] === undefined && re.test(key)) { m[col] = i; break; }
      }
    });
    if (m.date !== undefined && (m.credit !== undefined || m.amount !== undefined)) { headerAt = r; map = m; break; }
  }
  if (headerAt < 0) return { lines: [], skipped: rows.length, error: "Couldn't find the header row. The CSV needs a date column and an amount, credit or deposit column." };

  const lines: ParsedLine[] = [];
  const seen = new Map<string, number>();
  let skipped = 0;
  for (const row of rows.slice(headerAt + 1)) {
    const date = parseDate(row[map.date!] ?? "");
    let amount: number | null = null;
    if (map.credit !== undefined || map.debit !== undefined) {
      const cr = map.credit !== undefined ? parseAmount(row[map.credit] ?? "") : null;
      const dr = map.debit !== undefined ? parseAmount(row[map.debit] ?? "") : null;
      amount = cr ? Math.abs(cr) : dr ? -Math.abs(dr) : null;
    }
    if (amount === null && map.amount !== undefined) {
      amount = parseAmount(row[map.amount] ?? "");
      const t = map.type !== undefined ? (row[map.type] ?? "").toLowerCase() : "";
      if (amount !== null && /^d/.test(t)) amount = -Math.abs(amount);
      if (amount !== null && /^c/.test(t)) amount = Math.abs(amount);
    }
    if (!date || amount === null) { skipped++; continue; }
    const description = (map.description !== undefined ? row[map.description] : row.filter((_, i) => i !== map.date).join(" "))?.slice(0, 300) ?? "";
    const reference = (map.reference !== undefined ? row[map.reference] : "") || extractRef(description);
    const base = [date, amount.toFixed(2), normal(description), reference ?? ""].join("|");
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    lines.push({ txn_date: date, description, reference: reference || null, amount: Math.round(amount * 100) / 100, fingerprint: hash(`${base}|${n}`) });
  }
  if (lines.length === 0) return { lines, skipped, error: "No transactions found under the header row." };
  return { lines, skipped };
}

/** UPI references are 12 digits; NEFT/IMPS UTRs are 16–22 characters. */
export function extractRef(text: string): string | null {
  const upi = text.match(/(?<!\d)\d{12}(?!\d)/);
  if (upi) return upi[0];
  const utr = text.match(/\b[A-Z]{4}[A-Z0-9]{12,18}\b/);
  return utr ? utr[0] : null;
}

const normal = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function hash(s: string) {
  // FNV-1a, twice with different seeds: short, stable and plenty for de-duplicating statement lines.
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995);
  }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}

/* ------------------------------------------------------------- matching */

export type Suggestion =
  | { kind: "payment"; payment: Payment; score: number; reason: string; by?: "ai" }
  | { kind: "record"; row: LeaseRow; amount: number; score: number; reason: string; by?: "ai" }
  | { kind: "expense"; expense: Expense; score: number; reason: string; by?: "ai" };

export type Confidence = "high" | "medium" | "low";
export const confidence = (score: number): Confidence => (score >= 80 ? "high" : score >= 55 ? "medium" : "low");

const dayDiff = (a: string, b: string) => Math.abs(new Date(a.slice(0, 10)).getTime() - new Date(b.slice(0, 10)).getTime()) / 86_400_000;

function nameHit(name: string | undefined, desc: string) {
  if (!name) return false;
  const words = normal(name).split(" ").filter((w) => w.length >= 3);
  const d = ` ${normal(desc)} `;
  return words.some((w) => d.includes(` ${w}`));
}

/**
 * Suggestions for one line, best first. `taken` holds payment/expense ids already linked to
 * other lines so the same receipt is never offered twice.
 */
export function suggest(line: Pick<BankLine, "txn_date" | "amount" | "description" | "reference">, d: Data, taken: Set<string>): Suggestion[] {
  const amount = Number(line.amount);
  const who = leaseLookup(d);
  const out: Suggestion[] = [];
  const desc = `${line.description} ${line.reference ?? ""}`;

  if (amount > 0) {
    for (const p of d.payments) {
      if (taken.has(p.id) || Math.abs(Number(p.amount) - amount) > 0.5) continue;
      const days = dayDiff(p.paid_at, line.txn_date);
      if (days > 10) continue;
      const tenant = who(p.lease_id).tenant;
      const refHit = !!p.reference && p.reference.replace(/\D/g, "").length >= 6 && desc.replace(/\D/g, "").includes(p.reference.replace(/\D/g, ""));
      const named = nameHit(tenant?.name, desc);
      const score = 55 + (days <= 1 ? 20 : days <= 4 ? 10 : 0) + (named ? 15 : 0) + (refHit ? 25 : 0);
      const why = [`same amount`, days < 1 ? "same day" : `${Math.round(days)} day${Math.round(days) === 1 ? "" : "s"} apart`];
      if (named) why.push(`mentions ${tenant!.name.split(" ")[0]}`);
      if (refHit) why.push("reference matches");
      out.push({ kind: "payment", payment: p, score: Math.min(99, score), reason: why.join(" · ") });
    }
    const period = line.txn_date.slice(0, 7);
    for (const per of [period, shiftPeriod(period, -1), shiftPeriod(period, 1)]) {
      for (const row of rentRows(per, d, todayISO())) {
        if (row.balance <= 0) continue;
        const exact = Math.abs(row.balance - amount) <= 0.5 || Math.abs(row.rent - amount) <= 0.5;
        const named = nameHit(row.tenant.name, desc);
        if (!exact && !(named && amount < row.balance)) continue;
        const score = (exact ? 45 : 30) + (named ? 30 : 0) + (per === period ? 10 : 0);
        const why = [exact ? `matches ${per === period ? "this month's" : "that month's"} balance` : "part payment", named ? `mentions ${row.tenant.name.split(" ")[0]}` : ""].filter(Boolean);
        out.push({ kind: "record", row, amount, score, reason: why.join(" · ") });
      }
    }
  } else {
    for (const e of d.expenses) {
      if (taken.has(e.id) || Math.abs(Number(e.amount) + amount) > 0.5) continue;
      const days = dayDiff(e.spent_on, line.txn_date);
      if (days > 10) continue;
      out.push({ kind: "expense", expense: e, score: 60 + (days <= 2 ? 20 : 5), reason: `same amount · ${e.category}` });
    }
  }
  // A confident receipt match means the money is already recorded; offering to record it again is noise.
  const sure = out.some((s) => s.kind === "payment" && s.score >= 80);
  return out.filter((s) => !(sure && s.kind === "record")).sort((a, b) => b.score - a.score).slice(0, 4);
}

export function takenIds(lines: Pick<BankLine, "payment_id" | "expense_id">[]) {
  const s = new Set<string>();
  for (const l of lines) {
    if (l.payment_id) s.add(l.payment_id);
    if (l.expense_id) s.add(l.expense_id);
  }
  return s;
}

/* -------------------------------------------------------- sample statement */

/**
 * A fictional statement for the preview: most recorded receipts show up as bank credits,
 * plus a rent transfer that hasn't been recorded yet, a debit and some noise.
 */
export function sampleStatement(d: Data): string {
  const who = leaseLookup(d);
  const from = shiftPeriod(currentPeriod(), -1);
  const fmt = (iso: string) => { const [y, m, dd] = iso.slice(0, 10).split("-"); return `${dd}/${m}/${y}`; };
  const rows: string[][] = [["Txn Date", "Narration", "Ref No", "Withdrawal Amt", "Deposit Amt", "Balance"]];
  let bal = 182_450;
  const lines: { date: string; desc: string; ref: string; dr?: number; cr?: number }[] = [];
  let n = 0;
  for (const p of [...d.payments].reverse()) {
    if (p.period < from || p.method === "cash") continue;
    n++;
    const name = who(p.lease_id).tenant?.name.toUpperCase() ?? "TENANT";
    const ref = p.method === "upi" ? `4${String(31_000_000_000 + n * 7_919_301).slice(0, 11)}` : `HDFCN5${String(260_000_000 + n * 37).padStart(10, "0")}`;
    const desc = p.method === "upi" ? `UPI/${ref}/${name}/okaxis/Rent` : `NEFT-${ref}-${name}-RENT`;
    lines.push({ date: p.paid_at, desc, ref, cr: Number(p.amount) });
  }
  const row = rentRows(currentPeriod(), d).find((r) => r.status !== "paid" && r.balance > 0);
  if (row) lines.push({ date: todayISO(), desc: `IMPS/P2A/${String(6_310_000_000_00 + 4421).slice(0, 12)}/${row.tenant.name.toUpperCase()}/RENT`, ref: "631000004421", cr: row.balance });
  const exp = d.expenses.find((e) => e.spent_on.slice(0, 7) >= from);
  if (exp) lines.push({ date: exp.spent_on, desc: `UPI/${exp.category.toUpperCase()}/PAYMENT`, ref: "", dr: Number(exp.amount) });
  lines.push({ date: `${from}-15`, desc: "ATM WDL/MG ROAD", ref: "", dr: 5000 });
  lines.push({ date: `${from}-28`, desc: "INT.PD:SAVINGS", ref: "", cr: 312.4 });
  lines.sort((a, b) => a.date.localeCompare(b.date));
  for (const l of lines) {
    bal += (l.cr ?? 0) - (l.dr ?? 0);
    rows.push([fmt(l.date), l.desc, l.ref, l.dr ? l.dr.toFixed(2) : "", l.cr ? l.cr.toFixed(2) : "", bal.toFixed(2)]);
  }
  return ["Account statement — sample bank (preview)", "Account No: XXXXXX1234", "", ...rows.map((r) => r.map((c) => (c.includes(",") ? `"${c}"` : c)).join(","))].join("\n");
}

/* -------------------------------------------------------- AI suggestions */

type AiMatch = { line: string; kind: "payment" | "record" | "expense"; target: string; confidence: number; reason: string };

/**
 * Asks /api/reconcile to place lines the rules couldn't. Every id that comes back is
 * checked against local data, so a bad answer can only ever drop a suggestion.
 */
export async function aiSuggest(lines: BankLine[], d: Data, taken: Set<string>, authHeader?: string): Promise<Map<string, Suggestion>> {
  const who = leaseLookup(d);
  const r2 = (v: string | number) => Math.round(Number(v) * 100) / 100;
  const dates = lines.map((l) => l.txn_date).sort();
  const lo = shiftPeriod(dates[0].slice(0, 7), -1);
  const hi = shiftPeriod(dates[dates.length - 1].slice(0, 7), 1);
  const periods: string[] = [];
  for (let p = lo; p <= hi; p = shiftPeriod(p, 1)) periods.push(p);
  const unpaid = new Map<string, LeaseRow>();
  for (const p of periods) for (const row of rentRows(p, d)) if (row.balance > 0) unpaid.set(`${row.lease.id}:${p}`, row);
  const ctx = {
    lines: lines.map((l) => ({ id: l.id, date: l.txn_date, amount: r2(l.amount), narration: l.description, ref: l.reference })),
    receipts: d.payments.filter((p) => !taken.has(p.id) && p.paid_at.slice(0, 7) >= lo && p.paid_at.slice(0, 7) <= hi).map((p) => {
      const w = who(p.lease_id);
      return { id: p.id, receipt: p.receipt_no, tenant: w.tenant?.name, place: `${w.property?.name} ${w.unit?.label}`, amount: r2(p.amount), date: p.paid_at.slice(0, 10), method: p.method, ref: p.reference };
    }),
    unpaid: [...unpaid.entries()].map(([id, r]) => ({ id, tenant: r.tenant.name, upi: r.tenant.upi_id, place: `${r.property.name} ${r.unit.label}`, month: id.split(":")[1], owed: r.rent, balance: r.balance, due: r.dueDate })),
    expenses: d.expenses.filter((e) => !taken.has(e.id) && e.spent_on.slice(0, 7) >= lo && e.spent_on.slice(0, 7) <= hi).map((e) => ({ id: e.id, date: e.spent_on, category: e.category, amount: r2(e.amount), note: e.note })),
  };
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authHeader) headers.Authorization = authHeader;
  const res = await fetch("/api/reconcile", { method: "POST", headers, body: JSON.stringify({ context: JSON.stringify(ctx) }) });
  if (!res.ok) {
    let msg = "The assistant couldn't suggest matches just now.";
    try { msg = (await res.json()).error ?? msg; } catch { /* not JSON */ }
    if (res.status === 404) msg = "AI matching needs the API routes. Run the app with `npm run dev:netlify`, `vercel dev` or `npm run dev:cloudflare` to try it locally.";
    throw new Error(msg);
  }
  const { matches } = (await res.json()) as { matches: AiMatch[] };
  const out = new Map<string, Suggestion>();
  const used = new Set<string>();
  const byLine = new Map(lines.map((l) => [l.id, l]));
  for (const m of matches) {
    const line = byLine.get(m.line);
    if (!line || out.has(line.id) || used.has(m.target)) continue;
    const amount = Number(line.amount);
    const score = Math.max(30, Math.min(95, Math.round(m.confidence)));
    const reason = `AI: ${String(m.reason).slice(0, 90)}`;
    if (m.kind === "payment" && amount > 0) {
      const payment = d.payments.find((p) => p.id === m.target && !taken.has(p.id));
      if (payment) out.set(line.id, { kind: "payment", payment, score, reason, by: "ai" });
    } else if (m.kind === "record" && amount > 0) {
      const row = unpaid.get(m.target);
      if (row) out.set(line.id, { kind: "record", row, amount, score, reason, by: "ai" });
    } else if (m.kind === "expense" && amount < 0) {
      const expense = d.expenses.find((e) => e.id === m.target && !taken.has(e.id));
      if (expense) out.set(line.id, { kind: "expense", expense, score, reason, by: "ai" });
    }
    if (out.has(line.id)) used.add(m.target);
  }
  return out;
}
