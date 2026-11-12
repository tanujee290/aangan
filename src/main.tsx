import { lazy, StrictMode, Suspense, useEffect } from "react";
import { pages, prefetchPath } from "./lib/routes";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import "@fontsource/spline-sans-mono/400.css";
import "@fontsource/spline-sans-mono/500.css";
import "./styles.css";
import "./skin.css";
import { applyTheme } from "./lib/theme";
import { registerServiceWorker } from "./lib/pwa";
import { installTouchEffect } from "./lib/touch";
import { AuthProvider, useAuth } from "./state/auth";
import { DataProvider, useData } from "./state/data";
import { NotifyProvider } from "./state/notify";
import { AppShell } from "./components/shell";
import { demoMode } from "./lib/supabase";
const LandingPage = lazy(() => pages.landing());
const LoginPage = lazy(() => pages.auth().then((m) => ({ default: m.LoginPage })));
const OnboardingPage = lazy(() => pages.auth().then((m) => ({ default: m.OnboardingPage })));
const MockInboxPage = lazy(() => pages.mockAuth().then((m) => ({ default: m.MockInboxPage })));
const MockOAuthPage = lazy(() => pages.mockAuth().then((m) => ({ default: m.MockOAuthPage })));
const AuthConfirmPage = lazy(() => pages.mockAuth().then((m) => ({ default: m.AuthConfirmPage })));
const VerifyPage = lazy(() => pages.verify());
const HomePage = lazy(() => pages.home());
const WalletPage = lazy(() => pages.wallet());
const PaymentsPage = lazy(() => pages.payments());
const ReceiptPage = lazy(() => pages.receipt());
const TasksPage = lazy(() => pages.tasks());
const PropertiesPage = lazy(() => pages.properties().then((m) => ({ default: m.PropertiesPage })));
const PropertyDetailPage = lazy(() => pages.properties().then((m) => ({ default: m.PropertyDetailPage })));
const TenantsPage = lazy(() => pages.tenants().then((m) => ({ default: m.TenantsPage })));
const TenantDetailPage = lazy(() => pages.tenants().then((m) => ({ default: m.TenantDetailPage })));
const SettingsPage = lazy(() => pages.settings());
const RemindersPage = lazy(() => pages.reminders());
const BillingPage = lazy(() => pages.billing());
const ReconcilePage = lazy(() => pages.reconcile());
const DocumentsPage = lazy(() => pages.documents());
const TeamPage = lazy(() => pages.team());
const JoinPage = lazy(() => pages.join());
const PortalPage = lazy(() => pages.portal());
const ReportsPage = lazy(() => pages.reports());
const AssistantPage = lazy(() => pages.assistant());
import { Atmosphere, GlassDefs, Logo, SkeletonApp } from "./components/ui";

applyTheme();
installTouchEffect();
registerServiceWorker();
// After a deploy, a tab that is still open can ask for a chunk file that no longer exists. Reload once
// (at most every 30s, so it can never loop) to pick up the new build.
window.addEventListener("vite:preloadError", (e) => {
  try {
    const last = Number(sessionStorage.getItem("angan.preloadReload") || 0);
    if (Date.now() - last < 30_000) return;
    sessionStorage.setItem("angan.preloadReload", String(Date.now()));
  } catch { return; }
  e.preventDefault();
  window.location.reload();
});
// Fetch the first screen's code while auth and the workspace load, instead of after.
prefetchPath(window.location.pathname);

function Splash({ text }: { text?: string }) {
  return <div className="splash"><Logo size={44} />{text && <p className="muted small">{text}</p>}</div>;
}

function Protected() {
  const { session, loading } = useAuth();
  const d = useData();
  if (loading) return <Splash />;
  if (!session) return <Navigate to="/login" replace />;
  if (d.loading) return <SkeletonApp />;
  if (d.error && !d.workspace) return <Splash text={`Couldn't load your workspace: ${d.error}`} />;
  if (!d.workspace) return <Suspense fallback={<Splash />}><OnboardingPage /></Suspense>;
  return <AppShell />;
}

const TITLES: [RegExp, string][] = [
  [/^\/app\/?$/, "Home"], [/^\/app\/wallet/, "Wallet"], [/^\/app\/payments\/./, "Receipt"], [/^\/app\/payments/, "Payments"],
  [/^\/app\/tasks/, "Tasks"], [/^\/app\/properties/, "Properties"], [/^\/app\/tenants/, "Tenants"], [/^\/app\/reminders/, "Reminders"],
  [/^\/app\/billing/, "Billing"], [/^\/app\/reconcile/, "Reconcile"], [/^\/app\/documents/, "Documents"], [/^\/app\/reports/, "Reports"],
  [/^\/app\/assistant/, "Assistant"], [/^\/app\/team/, "Team"], [/^\/app\/settings/, "Settings"], [/^\/login/, "Sign in"],
  [/^\/auth\/confirm/, "Signing in"], [/^\/mock\/inbox/, "Mock inbox"], [/^\/mock\/oauth/, "Mock Google sign-in"],
  [/^\/r\//, "Verify receipt"], [/^\/join\//, "Join workspace"], [/^\/t\//, "Tenant portal"],
];

function useDocumentTitle() {
  const { pathname } = useLocation();
  useEffect(() => {
    const hit = TITLES.find(([re]) => re.test(pathname));
    document.title = hit ? `${hit[1]} · Aangan` : "Aangan — rent, receipts and reminders";
  }, [pathname]);
}

function NotFound() {
  return (
    <div className="auth"><div className="auth-card card">
      <Link to="/" className="brand"><Logo /><span>Aangan</span></Link>
      <span className="eyebrow">404</span>
      <h1 className="display">This page isn't here</h1>
      <p className="muted">The link may be old or mistyped. Receipts and tenant links always start with <code>/r/</code> or <code>/t/</code>.</p>
      <div className="row gap-sm wrap">
        <Link to="/app" className="btn primary">Open Aangan</Link>
        <Link to="/" className="btn ghost">Home page</Link>
      </div>
    </div></div>
  );
}

function App() {
  useDocumentTitle();
  return (
    <Suspense fallback={<Splash />}>
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/auth/confirm" element={<AuthConfirmPage />} />
      {demoMode && <Route path="/mock/inbox" element={<MockInboxPage />} />}
      {demoMode && <Route path="/mock/oauth/google" element={<MockOAuthPage />} />}
      <Route path="/r/:token" element={<VerifyPage />} />
      <Route path="/join/:token" element={<JoinPage />} />
      <Route path="/t/:token" element={<PortalPage />} />
      <Route path="/app" element={<Protected />}>
        <Route index element={<HomePage />} />
        <Route path="wallet" element={<WalletPage />} />
        <Route path="payments" element={<PaymentsPage />} />
        <Route path="payments/:id" element={<ReceiptPage />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="properties" element={<PropertiesPage />} />
        <Route path="properties/:id" element={<PropertyDetailPage />} />
        <Route path="tenants" element={<TenantsPage />} />
        <Route path="tenants/:id" element={<TenantDetailPage />} />
        <Route path="reminders" element={<RemindersPage />} />
        <Route path="billing" element={<BillingPage />} />
        <Route path="reconcile" element={<ReconcilePage />} />
        <Route path="documents" element={<DocumentsPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="assistant" element={<AssistantPage />} />
        <Route path="team" element={<TeamPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFound />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
    </Suspense>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <GlassDefs />
    <Atmosphere />
    <BrowserRouter>
      <AuthProvider>
        <DataProvider>
          <NotifyProvider>
            <App />
          </NotifyProvider>
        </DataProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
