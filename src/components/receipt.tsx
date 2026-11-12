import { forwardRef } from "react";
import { BadgeCheck } from "lucide-react";
import { dateLabel, METHOD_LABEL, money, periodLabel } from "../lib/format";
import { Jaali, QR } from "./ui";

export interface ReceiptView {
  receipt_no: string;
  amount: number | string;
  period: string;
  method: string;
  paid_at: string;
  tenant: string;
  property: string;
  unit: string;
  landlord: string;
  currency: string;
  locale?: string;
  reference?: string | null;
  note?: string | null;
  verifyUrl?: string;
}

/** The printed-paper receipt: torn edge, mono numerals, verification QR. */
export const ReceiptPaper = forwardRef<HTMLDivElement, { r: ReceiptView }>(function ReceiptPaper({ r }, ref) {
  const fmt = { cur: r.currency, loc: r.locale ?? "en-IN" };
  return (
    <div className="paper" ref={ref}>
      <Jaali className="paper-art" />
      <div className="paper-head">
        <span className="eyebrow">Rent receipt</span>
        <h3>{r.landlord}</h3>
        <span className="mono small">No. {r.receipt_no}</span>
      </div>
      <div className="paper-amount">
        <span className="mono">{money(r.amount, fmt)}</span>
        <span className="stamp"><BadgeCheck size={14} /> Received</span>
      </div>
      <dl className="paper-lines">
        <div><dt>Received from</dt><dd>{r.tenant}</dd></div>
        <div><dt>For</dt><dd>Rent · {periodLabel(r.period)}</dd></div>
        <div><dt>Property</dt><dd>{r.property} · {r.unit}</dd></div>
        <div><dt>Paid on</dt><dd>{dateLabel(r.paid_at)}</dd></div>
        <div><dt>Method</dt><dd>{METHOD_LABEL[r.method] ?? r.method}{r.reference ? ` · ${r.reference}` : ""}</dd></div>
        {r.note && <div><dt>Note</dt><dd>{r.note}</dd></div>}
      </dl>
      {r.verifyUrl && (
        <div className="paper-foot">
          <QR value={r.verifyUrl} size={84} />
          <p>Scan to verify this receipt with Aangan. This records a payment the landlord confirmed; it is not a bank statement.</p>
        </div>
      )}
      <div className="paper-edge" aria-hidden />
    </div>
  );
});
