let currency = "INR";
let locale = "en-IN";

export function setFormatting(c: string, l: string) {
  currency = c || "INR";
  locale = l || "en-IN";
}

export function money(n: number | string, opts: { compact?: boolean; cur?: string; loc?: string } = {}) {
  const v = typeof n === "string" ? Number(n) : n;
  return new Intl.NumberFormat(opts.loc ?? locale, {
    style: "currency",
    currency: opts.cur ?? currency,
    maximumFractionDigits: opts.compact || Number.isInteger(v) ? 0 : 2,
    notation: opts.compact ? "compact" : "standard",
  }).format(Number.isFinite(v) ? v : 0);
}

export function currencySymbol(cur = currency) {
  return (
    new Intl.NumberFormat(locale, { style: "currency", currency: cur }).formatToParts(0).find((p) => p.type === "currency")
      ?.value ?? cur
  );
}

export function dateLabel(d: string | Date, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }) {
  const date = typeof d === "string" ? new Date(d.length === 10 ? d + "T00:00:00" : d) : d;
  return new Intl.DateTimeFormat(locale, opts).format(date);
}

export function periodLabel(period: string, short = false) {
  const [y, m] = period.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, { month: short ? "short" : "long", year: "numeric" }).format(new Date(y, m - 1, 1));
}

export function currentPeriod(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function shiftPeriod(period: string, delta: number) {
  const [y, m] = period.split("-").map(Number);
  return currentPeriod(new Date(y, m - 1 + delta, 1));
}

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

/** Normalises a phone number for wa.me links. Ten-digit numbers are treated as Indian (+91). */
export function waNumber(phone: string | null | undefined) {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 10) return "91" + digits;
  if (digits.length === 11 && digits.startsWith("0")) return "91" + digits.slice(1);
  return digits;
}

export function waLink(phone: string | null | undefined, text: string) {
  const n = waNumber(phone);
  return `https://wa.me/${n ?? ""}?text=${encodeURIComponent(text)}`;
}

export function upiLink(opts: { upi: string; payee: string; amount?: number; note?: string; cur?: string }) {
  const p = new URLSearchParams({ pa: opts.upi, pn: opts.payee, cu: opts.cur ?? "INR" });
  if (opts.amount && opts.amount > 0) p.set("am", opts.amount.toFixed(2));
  if (opts.note) p.set("tn", opts.note);
  return `upi://pay?${p.toString()}`;
}

export const METHOD_LABEL: Record<string, string> = {
  upi: "UPI", bank: "Bank transfer", cash: "Cash", cheque: "Cheque", card: "Card", other: "Other",
};

/** Stable Telegram-style avatar colour (0–6) for a name, so the same person always gets the same gradient. */
export function tone(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 7;
}
