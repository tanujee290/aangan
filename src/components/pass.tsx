import { useState } from "react";
import { Link } from "react-router-dom";
import { MessageCircle, RotateCw } from "lucide-react";
import type { LeaseRow } from "../lib/rent";
import type { Payment, Workspace } from "../lib/types";
import { dateLabel, initials, money, periodLabel, upiLink, waLink } from "../lib/format";
import { reminderText } from "../lib/reminders";
import { Jaali, Pill, QR } from "./ui";

export function Pass({ row, payments, workspace, focused, onFocus }: {
  row: LeaseRow; payments: Payment[]; workspace: Workspace; focused?: boolean; onFocus?: () => void;
}) {
  const [flipped, setFlipped] = useState(false);
  const colour = row.unit.pass_colour ?? "var(--accent)";
  const recent = payments.filter((p) => p.lease_id === row.lease.id).slice(0, 4);
  const upi = workspace.upi_id;
  const upiUrl = upi
    ? upiLink({ upi, payee: workspace.name, amount: row.balance || row.rent, note: `Rent ${row.dueDate.slice(0, 7)} ${row.unit.label}`, cur: workspace.currency })
    : null;

  return (
    <div className={`pass ${focused ? "focused" : ""} ${flipped ? "flipped" : ""}`} style={{ ["--pass" as string]: colour }} onClick={onFocus}>
      <div className="pass-inner">
        <div className="pass-face pass-front">
          <Jaali className="pass-art" />
          <div className="pass-top">
            <div>
              <span className="eyebrow light">{row.property.type}</span>
              <h2 className="h3">{row.property.name}</h2>
              <span className="pass-unit">{row.unit.label}</span>
            </div>
            <Pill status={row.status} />
          </div>
          <div className="pass-mid">
            <div className="avatar light">{initials(row.tenant.name)}</div>
            <div>
              <span className="eyebrow light">Tenant</span>
              <strong>{row.tenant.name}</strong>
            </div>
          </div>
          <div className="pass-bottom">
            <div><span className="eyebrow light">Rent</span><span className="mono big">{money(row.rent)}</span></div>
            <div><span className="eyebrow light">Due</span><span className="mono">{dateLabel(row.dueDate, { day: "numeric", month: "short" })}</span></div>
            <div><span className="eyebrow light">{row.balance > 0 ? "Balance" : "Paid"}</span><span className="mono">{money(row.balance > 0 ? row.balance : row.paid)}</span></div>
          </div>
        </div>
        <div className="pass-face pass-back">
          <div className="pass-back-grid">
            <div>
              <span className="eyebrow">Recent payments</span>
              {recent.length === 0 ? <p className="muted small">None recorded yet.</p> : (
                <ul className="mini-list">
                  {recent.map((p) => (
                    <li key={p.id}><Link to={`/app/payments/${p.id}`} onClick={(e) => e.stopPropagation()}>
                      <span>{periodLabel(p.period, true)}</span><span className="mono">{money(p.amount)}</span>
                    </Link></li>
                  ))}
                </ul>
              )}
            </div>
            <div className="pass-qr">
              {upiUrl ? (<><QR value={upiUrl} size={104} /><span className="small mono">{upi}</span></>) : (
                <p className="muted small">Add your UPI ID in <Link to="/app/settings" onClick={(e) => e.stopPropagation()}>Settings</Link> to show a pay QR here.</p>
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="pass-actions" onClick={(e) => e.stopPropagation()}>
        <button className="btn ghost small" onClick={() => setFlipped(!flipped)}><RotateCw size={14} /> {flipped ? "Front" : "Flip"}</button>
        {row.status !== "paid" && (
          <a className="btn ghost small" href={waLink(row.tenant.phone_whatsapp, reminderText(row, workspace))} target="_blank" rel="noreferrer">
            <MessageCircle size={14} /> Remind
          </a>
        )}
        <Link className="btn ghost small" to={`/app/tenants/${row.tenant.id}`}>Details</Link>
      </div>
    </div>
  );
}
