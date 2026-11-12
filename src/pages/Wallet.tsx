import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { Wallet as WalletIcon } from "lucide-react";
import { useLive } from "../state/data";
import { currentPeriod, periodLabel } from "../lib/format";
import { rentRows } from "../lib/rent";
import { Pass } from "../components/pass";
import { Empty } from "../components/ui";
import type { ShellCtx } from "../components/shell";

export default function WalletPage() {
  const live = useLive();
  const { openAdd } = useOutletContext<ShellCtx>();
  const period = currentPeriod();
  const rows = useMemo(() => rentRows(period, live), [period, live]);
  const [focus, setFocus] = useState<string | null>(null);

  return (
    <div className="page">
      <div className="page-head">
        <div><span className="eyebrow">{periodLabel(period)}</span><h1 className="display">Wallet</h1></div>
        <span className="muted small">{rows.length} pass{rows.length === 1 ? "" : "es"}</span>
      </div>
      {rows.length === 0 ? (
        <div className="card"><Empty icon={<WalletIcon />} title="No passes yet">
          <p>Each tenant's lease becomes a pass with their rent, due date and a UPI pay QR.</p>
          <button className="btn primary" onClick={() => openAdd(live.units.length ? "tenant" : "property")}>{live.units.length ? "Add a tenant" : "Add a property"}</button>
        </Empty></div>
      ) : (
        <div className={`wallet ${focus ? "has-focus" : ""}`}>
          {rows.map((r, i) => (
            <div className="wallet-slot" key={r.lease.id} style={{ ["--i" as string]: i }}>
              <Pass row={r} payments={live.payments} workspace={live.workspace!} focused={focus === r.lease.id}
                onFocus={() => setFocus(focus === r.lease.id ? null : r.lease.id)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
