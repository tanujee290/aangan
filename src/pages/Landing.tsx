import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { BellRing, MousePointerClick, QrCode, ReceiptText, ShieldCheck, Smartphone, Wallet } from "lucide-react";
import { demoMode, signInSample } from "../lib/supabase";
import { useAuth } from "../state/auth";
import { Jaali, Logo, Ring } from "../components/ui";
import { ReceiptPaper } from "../components/receipt";

// Preview content for the marketing page only. Never stored, clearly labelled.
const PREVIEW_RECEIPT = {
  receipt_no: "ANG-00042", amount: 18500, period: "2026-11", method: "upi", paid_at: "2026-11-04T10:30:00",
  tenant: "Kavya Iyer", property: "Gulmohar Court", unit: "Flat 3A", landlord: "Your name here", currency: "INR",
  reference: "UPI 4410…8821", verifyUrl: "https://aangan.example/r/preview",
};

export default function LandingPage() {
  const { session } = useAuth();
  const [opening, setOpening] = useState(false);
  if (session) return <Navigate to="/app" replace />;
  // The sign-in updates the session, and the redirect above takes over.
  const explore = async () => {
    setOpening(true);
    const { error } = await signInSample("owner");
    if (error) setOpening(false);
  };
  return (
    <div className="landing">
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="landing-nav">
        <div className="brand"><Logo /><span>Aangan</span></div>
        <div className="row gap-sm"><Link to="/login" className="btn ghost">Sign in</Link><Link to="/login?signup=1" className="btn primary">Start free</Link></div>
      </header>

      <main id="main">
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">आँगन · the courtyard</span>
          <h1>Rent, receipts and reminders, <em>without the spreadsheet.</em></h1>
          <p>Aangan is the shared space between you, your properties and your tenants. See who has paid at a glance, issue a numbered receipt in one tap, and draft a polite reminder that opens in WhatsApp, ready for you to read and send.</p>
          <div className="row gap-sm"><Link to="/login?signup=1" className="btn primary lg">Create your account</Link>{demoMode
            ? <button className="btn ghost lg" onClick={explore} disabled={opening}><MousePointerClick size={18} /> {opening ? "Opening…" : "Explore the demo"}</button>
            : <a href="#how" className="btn ghost lg">How it works</a>}</div>
          <p className="small muted">For landlords with 1–50 units: flats, PGs and hostels, small shops.{demoMode && " The demo opens a sample workspace you can change freely."}</p>
        </div>
        <div className="hero-art">
          <span className="preview-tag">Preview</span>
          <div className="pass demo" style={{ ["--pass" as string]: "#0f6e6e" }}>
            <div className="pass-inner"><div className="pass-face pass-front">
              <Jaali className="pass-art" />
              <div className="pass-top"><div><span className="eyebrow light">Apartment</span><h3>Gulmohar Court</h3><span className="pass-unit">Flat 3A</span></div><span className="pill pill-paid">Paid</span></div>
              <div className="pass-mid"><div className="avatar light">KI</div><div><span className="eyebrow light">Tenant</span><strong>Kavya Iyer</strong></div></div>
              <div className="pass-bottom"><div><span className="eyebrow light">Rent</span><span className="mono big">₹18,500</span></div><div><span className="eyebrow light">Due</span><span className="mono">5 Nov</span></div><div><span className="eyebrow light">Paid</span><span className="mono">₹18,500</span></div></div>
            </div></div>
          </div>
          <div className="hero-receipt"><ReceiptPaper r={PREVIEW_RECEIPT} /></div>
          <div className="hero-ring card"><Ring value={0.78} size={96} stroke={10}><strong className="mono">78%</strong></Ring><div><span className="eyebrow">November</span><strong className="mono">₹1,44,300</strong><small className="muted">collected</small></div></div>
        </div>
      </section>

      <section className="features" id="how">
        {[
          [Wallet, "A wallet of passes", "Every tenancy is a pass with rent, due date and status. Flip it for recent payments and your UPI QR."],
          [ReceiptText, "Receipts in one tap", "Sequential receipt numbers, a printed-paper look, and a QR that anyone can scan to verify."],
          [BellRing, "Reminders you review", "Aangan drafts a polite message and opens it in WhatsApp with one tap. You read it and press send yourself; nothing goes out automatically. Step through everyone overdue in one go."],
          [QrCode, "Made for India", "₹ and lakh/crore formatting, UPI IDs, WhatsApp first. Other currencies are a setting."],
          [ShieldCheck, "Honest numbers", "Recorded payments are never shown as a bank balance. Rent status is calculated, never typed in."],
          [Smartphone, "A portal for tenants", "Send each tenant a private link to check dues, pay by UPI, download receipts and report repairs. No app or account needed."],
        ].map(([Icon, title, body]) => {
          const I = Icon as typeof Wallet;
          return <div className="feature" key={title as string}><I size={22} /><h3>{title as string}</h3><p>{body as string}</p></div>;
        })}
      </section>
      </main>

      <footer className="landing-foot"><Logo size={20} /><span className="small muted">Aangan · built for small landlords</span></footer>
    </div>
  );
}
