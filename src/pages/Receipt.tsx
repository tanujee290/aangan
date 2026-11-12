import { useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Download, Landmark, MessageCircle, Share2, Trash2 } from "lucide-react";
import { useCanWrite, useData } from "../state/data";
import { useNotify } from "../state/notify";
import { supabase, errorMessage } from "../lib/supabase";
import { dateLabel, money, periodLabel, waLink } from "../lib/format";
import { ReceiptPaper, type ReceiptView } from "../components/receipt";
import { Empty } from "../components/ui";

export default function ReceiptPage() {
  const { id } = useParams();
  const d = useData();
  const notify = useNotify();
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const canWrite = useCanWrite();
  const p = d.payments.find((x) => x.id === id);
  const bank = p && d.bankLines.find((l) => l.payment_id === p.id);
  const lease = p && d.leases.find((l) => l.id === p.lease_id);
  const tenant = lease && d.tenants.find((t) => t.id === lease.tenant_id);
  const unit = lease && d.units.find((u) => u.id === lease.unit_id);
  const property = unit && d.properties.find((x) => x.id === unit.property_id);
  if (!p || !tenant || !unit || !property || !d.workspace) {
    return <div className="page"><Empty title="Receipt not found"><Link to="/app/payments">Back to payments</Link></Empty></div>;
  }
  const verifyUrl = `${window.location.origin}/r/${p.verify_token}`;
  const r: ReceiptView = {
    receipt_no: p.receipt_no, amount: p.amount, period: p.period, method: p.method, paid_at: p.paid_at,
    tenant: tenant.name, property: property.name, unit: unit.label, landlord: d.workspace.name,
    currency: d.workspace.currency, locale: d.workspace.locale, reference: p.reference, note: p.note, verifyUrl,
  };
  const message = `Hi ${tenant.name.split(" ")[0]}, thank you! Received ${money(p.amount)} for rent (${periodLabel(p.period)}), ${unit.label}. Receipt ${p.receipt_no}: ${verifyUrl}`;

  async function png() {
    return import("html-to-image").then((m) => m.toPng(ref.current!, { pixelRatio: 2, cacheBust: true }));
  }
  async function download() {
    const a = document.createElement("a");
    a.href = await png();
    a.download = `${p!.receipt_no}.png`;
    a.click();
  }
  async function share() {
    try {
      const blob = await (await fetch(await png())).blob();
      const file = new File([blob], `${p!.receipt_no}.png`, { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: `Receipt ${p!.receipt_no}`, text: message });
      else if (navigator.share) await navigator.share({ title: `Receipt ${p!.receipt_no}`, text: message, url: verifyUrl });
      else { await navigator.clipboard.writeText(verifyUrl); notify("Verification link copied"); }
    } catch { /* share cancelled */ }
  }
  async function remove() {
    if (!confirm(`Delete receipt ${p!.receipt_no}? The payment will no longer count towards rent.`)) return;
    setBusy(true);
    const { error } = await supabase.from("payments").delete().eq("id", p!.id);
    setBusy(false);
    if (error) return notify(errorMessage(error));
    await d.refresh();
    notify("Receipt deleted");
    navigate("/app/payments");
  }

  return (
    <div className="page narrow">
      <div className="page-head"><Link to="/app/payments" className="btn ghost small"><ArrowLeft size={16} /> Payments</Link></div>
      <ReceiptPaper r={r} ref={ref} />
      <div className="receipt-actions">
        <button className="btn" onClick={share}><Share2 size={16} /> Share</button>
        <a className="btn primary" href={waLink(tenant.phone_whatsapp, message)} target="_blank" rel="noreferrer"><MessageCircle size={16} /> WhatsApp</a>
        <button className="btn" onClick={download}><Download size={16} /> Download</button>
        {canWrite && <button className="btn danger" onClick={remove} disabled={busy}><Trash2 size={16} /> Delete</button>}
      </div>
      {bank && (
        <p className="small muted row gap-sm center"><Landmark size={14} /> Seen in the bank on {dateLabel(bank.txn_date)} · <Link className="link" to="/app/reconcile">Reconcile</Link></p>
      )}
    </div>
  );
}
