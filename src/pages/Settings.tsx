import { useState, type FormEvent } from "react";
import { DatabaseZap, Download, LogOut, RotateCcw, Share, Smartphone } from "lucide-react";
import { useData } from "../state/data";
import { useAuth } from "../state/auth";
import { useNotify } from "../state/notify";
import { supabase, errorMessage, resetMock, STORAGE_BUCKET } from "../lib/supabase";
import { ACCENTS, WALLPAPERS, getTheme, setGlass, setTheme, setWall, type Mode, type Wall } from "../lib/theme";
import { Link } from "react-router-dom";
import { currencySymbol } from "../lib/format";
import { exportPaymentsCsv, exportWorkspaceJson } from "../lib/reports";
import { Field, LensSlider, NeedsSchema, Segmented, Toggle } from "../components/ui";
import { useInstall, useOnline } from "../lib/pwa";
import { isSimulatedOffline, setSimulatedOffline } from "../lib/network";

type FeeType = "none" | "flat" | "percent";
const MODE_OPTIONS: { value: Mode; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];
const FEE_OPTIONS: { value: FeeType; label: string }[] = [
  { value: "none", label: "None" },
  { value: "flat", label: "Flat amount" },
  { value: "percent", label: "% of rent" },
];
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export const CURRENCIES = [
  { code: "INR", locale: "en-IN", label: "Indian rupee (₹)" },
  { code: "USD", locale: "en-US", label: "US dollar ($)" },
  { code: "EUR", locale: "en-IE", label: "Euro (€)" },
  { code: "GBP", locale: "en-GB", label: "Pound sterling (£)" },
  { code: "AED", locale: "en-AE", label: "UAE dirham" },
  { code: "SGD", locale: "en-SG", label: "Singapore dollar" },
];

export default function SettingsPage() {
  const d = useData();
  const { session } = useAuth();
  const notify = useNotify();
  const ws = d.workspace!;
  const [name, setName] = useState(ws.name);
  const [currency, setCurrency] = useState(ws.currency);
  const [upi, setUpi] = useState(ws.upi_id ?? "");
  const [prefix, setPrefix] = useState(ws.invoice_prefix);
  const [busy, setBusy] = useState(false);
  const isOwner = d.role === "owner";

  const [remind, setRemind] = useState(ws.remind_before_days ?? 3);
  const [grace, setGrace] = useState(ws.grace_days ?? 3);
  const [feeType, setFeeType] = useState<FeeType>(ws.late_fee_type ?? "none");
  const [feeValue, setFeeValue] = useState(Number(ws.late_fee_value) > 0 ? String(Number(ws.late_fee_value)) : "");
  const [feeBusy, setFeeBusy] = useState(false);
  const [feeError, setFeeError] = useState("");

  const theme = getTheme();
  const [mode, setMode] = useState<Mode>(theme.mode);
  const [accent, setAccent] = useState(theme.accent);
  const [glass, setGlassLevel] = useState(theme.glass);
  const [wall, setWallState] = useState<Wall>(theme.wall);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const locale = CURRENCIES.find((c) => c.code === currency)?.locale ?? "en-IN";
    const { error } = await supabase.from("workspaces").update({
      name: name.trim(), currency, locale, upi_id: upi.trim() || null, invoice_prefix: prefix.trim().toUpperCase() || "ANG",
    }).eq("id", ws.id);
    setBusy(false);
    if (error) return notify(errorMessage(error));
    await d.refresh();
    notify("Settings saved");
  }

  async function saveBilling(e: FormEvent) {
    e.preventDefault();
    const fee = Number(feeValue);
    if (feeType !== "none") {
      if (!Number.isFinite(fee) || fee <= 0) return setFeeError("Enter a late fee above zero, or choose None.");
      if (feeType === "percent" && fee > 100) return setFeeError("A percentage fee can't be more than 100.");
    }
    setFeeError("");
    setFeeBusy(true);
    const { error } = await supabase.from("workspaces").update({
      remind_before_days: remind, grace_days: grace, late_fee_type: feeType,
      late_fee_value: feeType === "none" ? 0 : Math.round(fee * 100) / 100,
    }).eq("id", ws.id);
    setFeeBusy(false);
    if (error) return notify(errorMessage(error));
    await d.refresh();
    notify("Reminder and late-fee settings saved");
  }

  return (
    <div className="page narrow">
      <div className="page-head"><h1 className="display">Settings</h1></div>
      <form className="card form" onSubmit={save}>
        <h2>Workspace</h2>
        {!isOwner && <p className="muted small">Only the workspace owner can change these settings.</p>}
        <fieldset className="fieldset-plain" disabled={!isOwner}>
          <Field label="Name shown on receipts"><input value={name} onChange={(e) => setName(e.target.value)} required /></Field>
          <Field label="Currency & region">
            <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
            </select>
          </Field>
          <Field label="UPI ID" hint="Shown as a pay QR on each tenant pass."><input value={upi} onChange={(e) => setUpi(e.target.value)} placeholder="name@bank" /></Field>
          <Field label="Receipt prefix" hint={`Next receipt: ${(prefix || "ANG").toUpperCase()}-${String(ws.receipt_seq + 1).padStart(5, "0")}`}>
            <input value={prefix} maxLength={8} onChange={(e) => setPrefix(e.target.value.replace(/[^a-z0-9]/gi, ""))} />
          </Field>
          <button className="btn primary" disabled={busy || !isOwner}>{busy ? "Saving…" : "Save"}</button>
        </fieldset>
      </form>

      {d.v2 ? (
        <form className="card form" onSubmit={saveBilling}>
          <h2>Reminders &amp; late fees</h2>
          <p className="muted small">Reminders are drafts that open in WhatsApp for you to review and send; Aangan never sends messages on its own. Late fees are added to invoices only; rent without an invoice is never charged a fee.</p>
          {!isOwner && <p className="muted small">Only the workspace owner can change these settings.</p>}
          <fieldset className="fieldset-plain" disabled={!isOwner}>
            <div className="field-group">
              <span className="field-label">Start reminding</span>
              <LensSlider label="Days before the due date to start reminders" min={0} max={15} value={remind} onChange={setRemind}
                format={(n) => (n === 0 ? "Due day" : plural(n, "day"))} />
              <span className="field-hint">{remind === 0 ? "Tenants appear on the list from the due date." : `Tenants appear on the list ${plural(remind, "day")} before the due date, and daily until they've paid.`}</span>
            </div>
            <div className="field-group">
              <span className="field-label">Grace period</span>
              <LensSlider label="Grace period in days before a late fee" min={0} max={31} value={grace} onChange={setGrace}
                format={(n) => (n === 0 ? "None" : plural(n, "day"))} />
              <span className="field-hint">How long after the due date an invoice can stay unpaid before a late fee applies.</span>
            </div>
            <div className="field-group">
              <span className="field-label">Late fee</span>
              <Segmented label="Late fee type" value={feeType} onChange={(v) => { setFeeType(v); setFeeError(""); }} options={FEE_OPTIONS} />
            </div>
            {feeType !== "none" && (
              <Field label={feeType === "flat" ? `Fee amount (${currencySymbol(ws.currency)})` : "Fee (% of the invoice's rent)"}
                hint="Charged once per invoice after the grace period. Invoices that already carry a late fee aren't changed.">
                <input type="number" inputMode="decimal" min={0} max={feeType === "percent" ? 100 : undefined} step="any" value={feeValue}
                  onChange={(e) => { setFeeValue(e.target.value); setFeeError(""); }} placeholder={feeType === "flat" ? "500" : "2"} />
              </Field>
            )}
            {feeError && <p className="form-error" role="alert">{feeError}</p>}
            <button className="btn primary" disabled={feeBusy || !isOwner}>{feeBusy ? "Saving…" : "Save"}</button>
          </fieldset>
        </form>
      ) : (
        <NeedsSchema feature="Reminder timing and late fees" />
      )}

      <div className="card form">
        <h2>Appearance</h2>
        <p className="muted small">Saved on this device.</p>
        <div className="row"><Segmented<Mode> label="Colour mode" value={mode} options={MODE_OPTIONS} onChange={(m) => { setMode(m); setTheme(m, accent); }} /></div>
        <div className="swatches">
          {ACCENTS.map((a) => (
            <button key={a.value} className={`swatch ${accent === a.value ? "on" : ""}`} style={{ background: a.value }} title={a.name} aria-label={a.name} aria-pressed={accent === a.value}
              onClick={() => { setAccent(a.value); setTheme(mode, a.value); }} />
          ))}
        </div>
        <div className="field-group">
          <span className="field-label" id="wall-label">Wallpaper</span>
          <div className="wall-grid" role="radiogroup" aria-labelledby="wall-label">
            {WALLPAPERS.map((w) => (
              <button key={w.id} type="button" role="radio" aria-checked={wall === w.id} className={`wall-opt ${wall === w.id ? "on" : ""}`} data-wall={w.id}
                onClick={() => { setWallState(w.id); setWall(w.id); }}><span>{w.name}</span></button>
            ))}
          </div>
          <span className="field-hint">Each wallpaper has a light and a dark version. Plain is the lightest on battery.</span>
        </div>
        <div className="field-group glass-setting">
          <div className="row between"><span className="field-label">Liquid Glass</span><span className="tiny muted">{glass < 34 ? "Clear" : glass > 66 ? "Tinted" : "Balanced"}</span></div>
          <div className="glass-preview" aria-hidden><span className="lens-surface">Aa</span><span className="lens-surface">₹</span><span className="lens-surface">◎</span></div>
          <div className="row gap-sm glass-scale"><span className="tiny muted">Clear</span>
            <div className="grow"><LensSlider label="Liquid Glass transparency" value={glass} min={0} max={100} step={1} onChange={(v) => { setGlassLevel(v); setGlass(v); }} format={(v) => `${v}%`} /></div>
            <span className="tiny muted">Tinted</span></div>
          <span className="field-hint">Clear shows more of what's behind the glass. Tinted frosts it for higher contrast.</span>
        </div>
      </div>

      <InstallCard />

      <div className="card form">
        <h2>Your data</h2>
        <p className="muted small">{d.demo ? "Saved by the built-in mock backend in this browser only." : "Stored in your Supabase database."} Download a full copy at any time, or see the ledger and more exports in <Link to="/app/reports">Reports</Link>.</p>
        <div className="row gap wrap">
          <button className="btn" onClick={() => exportWorkspaceJson(d)}><Download size={16} /> Full export (JSON)</button>
          <button className="btn" onClick={() => exportPaymentsCsv(d)}><Download size={16} /> Payments (CSV)</button>
        </div>
      </div>

      <div className="card form">
        <h2>Account</h2>
        <p className="small">Signed in as <strong>{session?.user.email}</strong> · <span style={{ textTransform: "capitalize" }}>{d.role}</span></p>
        <button className="btn danger" onClick={() => supabase.auth.signOut()}><LogOut size={16} /> Sign out</button>
      </div>

      {!d.demo && (
        <div className="card form">
          <h2><DatabaseZap size={18} style={{ verticalAlign: "-3px" }} /> Backend</h2>
          <p className="small muted">
            Connected to your Supabase project. Data is shared with your team and stored in the cloud; documents go to the
            private <code>{STORAGE_BUCKET}</code> storage bucket. Reminders open as drafts in WhatsApp, and nothing is sent automatically.
          </p>
        </div>
      )}

      {d.demo && (
        <div className="card form">
          <h2><DatabaseZap size={18} style={{ verticalAlign: "-3px" }} /> Mock backend</h2>
          <p className="small muted">
            No Supabase project is connected, so Aangan runs on a built-in mock of it: the same tables, roles, receipt numbering,
            invoices, reminders and tenant portal, stored in this browser. Connect Supabase to move to real accounts and cloud storage.
          </p>
          <div className="small">
            <strong>Demo mode vs a real Supabase project</strong>
            <ul className="small muted" style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              <li>Demo mode: data lives only in this browser. Other devices and people can't see it, and clearing site data erases it.</li>
              <li>Real Supabase: accounts, sign-in emails, team invites and documents are shared and stored in your own project.</li>
              <li>To connect, set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> (see <code>.env.example</code>), add <code>SUPABASE_DB_URL</code> so migrations run, then redeploy.</li>
            </ul>
          </div>
          <OutageSwitch />
          <p className="small"><Link to="/mock/inbox">Open the mock inbox</Link> to see sign-in links the mock has "emailed".</p>
          <div className="row gap wrap">
            <button className="btn" onClick={() => {
              if (confirm("Reset the mock backend? Every account, change and uploaded file in this browser is replaced by the sample workspace.")) resetMock();
            }}><RotateCcw size={16} /> Reset to sample data</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Mock backend only: cuts this tab off from the mock server so offline capture and sync can be tried. */
function OutageSwitch() {
  useOnline(); // re-render when the switch or the device's connection changes
  const notify = useNotify();
  const on = isSimulatedOffline();
  return (
    <div className="row gap">
      <div className="grow">
        <strong className="small">Simulate being offline</strong>
        <p className="tiny muted">Requests from this tab fail as if the connection dropped. New payments, expenses and tasks are kept on this device, then sync when you switch it off.</p>
      </div>
      <Toggle label="Simulate being offline" on={on} onChange={(v) => { setSimulatedOffline(v); notify(v ? "Simulated outage on" : "Simulated outage off"); }} />
    </div>
  );
}

function InstallCard() {
  const app = useInstall();
  const notify = useNotify();
  return (
    <div className="card form">
      <h2>Install the app</h2>
      <div className="install-card">
        <img src="/icons/icon-192.png" alt="" />
        <div className="grow">
          {app.installed ? (
            <p className="small">Aangan is installed on this device. It opens full screen, and payments, expenses and tasks you add offline sync when you reconnect.</p>
          ) : app.ios ? (
            <p className="small">On iPhone or iPad, tap <Share size={14} style={{ verticalAlign: "-2px" }} /> <strong>Share</strong> in Safari, then <strong>Add to Home Screen</strong>.</p>
          ) : (
            <p className="small">Add Aangan to your home screen to open it like an app. It loads without a connection, and entries made offline sync later.</p>
          )}
        </div>
      </div>
      {!app.installed && app.canPrompt && (
        <button className="btn primary" onClick={async () => { if (await app.install()) notify("Aangan installed"); }}><Smartphone size={16} /> Install Aangan</button>
      )}
      {!app.installed && !app.canPrompt && !app.ios && (
        <p className="tiny muted">If you don't see an install button, use your browser menu: <strong>Install app</strong> or <strong>Add to Home screen</strong>.</p>
      )}
    </div>
  );
}
