import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { supabase } from "../lib/supabase";
import { ReceiptPaper, type ReceiptView } from "../components/receipt";
import { Logo } from "../components/ui";

export default function VerifyPage() {
  const { token } = useParams();
  const [state, setState] = useState<"loading" | "missing" | ReceiptView>("loading");

  useEffect(() => {
    supabase.rpc("verify_receipt", { p_token: token ?? "" }).then(({ data, error }) => {
      setState(error || !data ? "missing" : (data as ReceiptView));
    });
  }, [token]);

  return (
    <div role="main" className="auth verify">
      <a className="skip-link" href="#main">Skip to content</a>
      <Link to="/" className="brand"><Logo /><span>Aangan</span></Link>
      <h1 className="sr-only" id="main">{state === "missing" ? "Receipt not found" : state === "loading" ? "Checking receipt" : "Verified receipt"}</h1>
      {state === "loading" && <p className="muted">Checking receipt…</p>}
      {state === "missing" && (
        <div className="card verify-banner bad"><ShieldAlert /><div><strong>Receipt not found</strong><p className="small">This link doesn't match any receipt, or the receipt was deleted by the landlord.</p></div></div>
      )}
      {typeof state === "object" && (
        <>
          <div className="card verify-banner ok"><ShieldCheck /><div><strong>Verified receipt</strong><p className="small">Issued by {state.landlord} through Aangan. It records a payment the landlord confirmed.</p></div></div>
          <ReceiptPaper r={state} />
        </>
      )}
    </div>
  );
}
