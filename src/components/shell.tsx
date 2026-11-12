import { Suspense, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { NavLink, useLocation, useNavigate, useOutlet } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  BellRing, Building2, ChevronLeft, CreditCard, FileText, FolderOpen, Hammer, Home, IndianRupee, Landmark, LineChart, Plus, Receipt, Settings,
  Sparkles, Users, UsersRound, Wallet, Wrench, X,
} from "lucide-react";
import { useData } from "../state/data";
import { initials, tone } from "../lib/format";
import { haptic } from "../lib/touch";
import { ExpenseForm, PaymentForm, PropertyForm, TaskForm, TenantLeaseForm } from "./forms";
import { LENS_SPRING, Logo, NAV_EXIT, NAV_SPRING, SheetIf, SPRING } from "./ui";
import { SyncStatus } from "./sync";
import { prefetchAppScreens, prefetchHandlers } from "../lib/routes";

type AddKind = "payment" | "tenant" | "property" | "task" | "expense";
const ADD_TITLES: Record<AddKind, string> = {
  payment: "Record a payment", tenant: "Add tenant & lease", property: "Add property", task: "New maintenance task", expense: "Log an expense",
};

type NavItem = { to: string; label: string; icon: typeof Home; end?: boolean };
const NAV: NavItem[] = [
  { to: "/app", label: "Home", icon: Home, end: true },
  { to: "/app/wallet", label: "Wallet", icon: Wallet },
  { to: "/app/payments", label: "Payments", icon: CreditCard },
  { to: "/app/tasks", label: "Tasks", icon: Wrench },
];
const GROUPS: { title: string; items: NavItem[] }[] = [
  { title: "Collect", items: [
    { to: "/app/reminders", label: "Reminders", icon: BellRing },
    { to: "/app/billing", label: "Billing", icon: FileText },
    { to: "/app/reconcile", label: "Reconcile", icon: Landmark },
  ] },
  { title: "Manage", items: [
    { to: "/app/properties", label: "Properties", icon: Building2 },
    { to: "/app/tenants", label: "Tenants", icon: Users },
    { to: "/app/documents", label: "Documents", icon: FolderOpen },
  ] },
  { title: "Insights", items: [
    { to: "/app/reports", label: "Reports", icon: LineChart },
    { to: "/app/assistant", label: "Assistant", icon: Sparkles },
  ] },
  { title: "Workspace", items: [
    { to: "/app/team", label: "Team", icon: UsersRound },
    { to: "/app/settings", label: "Settings", icon: Settings },
  ] },
];
const MORE = GROUPS.flatMap((g) => g.items);

function isActive(pathname: string, n: NavItem) {
  return n.end ? pathname === n.to : pathname === n.to || pathname.startsWith(n.to + "/");
}

const TAB_TITLES: [RegExp, string][] = [
  [/^\/app\/?$/, "Home"], [/^\/app\/wallet/, "Wallet"], [/^\/app\/payments\/./, "Receipt"], [/^\/app\/payments/, "Payments"],
  [/^\/app\/tasks/, "Tasks"], [/^\/app\/properties\/./, "Property"], [/^\/app\/properties/, "Properties"], [/^\/app\/tenants\/./, "Tenant"],
  [/^\/app\/tenants/, "Tenants"], [/^\/app\/reminders/, "Reminders"], [/^\/app\/billing/, "Billing"], [/^\/app\/reconcile/, "Reconcile"],
  [/^\/app\/documents/, "Documents"], [/^\/app\/reports/, "Reports"], [/^\/app\/assistant/, "Assistant"], [/^\/app\/team/, "Team"],
  [/^\/app\/settings/, "Settings"],
];
const depth = (p: string) => p.split("/").filter(Boolean).length;

/** Scroll position and direction, read once per frame. Drives the collapsing nav title and the shrinking tab bar. */
function useScrollInfo() {
  const [info, setInfo] = useState({ scrolled: false, minimized: false });
  useEffect(() => {
    let last = window.scrollY, raf = 0, travel = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const y = window.scrollY, dy = y - last;
        last = y;
        travel = Math.sign(dy) === Math.sign(travel) ? travel + dy : dy;
        setInfo((cur) => {
          const scrolled = y > 36;
          // Shrink after a deliberate scroll down; expand on any scroll up or near the top, like iOS 26.
          const minimized = y < 80 ? false : travel > 24 ? true : travel < -12 ? false : cur.minimized;
          return scrolled === cur.scrolled && minimized === cur.minimized ? cur : { scrolled, minimized };
        });
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); cancelAnimationFrame(raf); };
  }, []);
  return info;
}

export function AppShell() {
  const { workspace, role, demo, reminders, tasks } = useData();
  const [menu, setMenu] = useState(false);
  const [add, setAdd] = useState<AddKind | null>(null);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const reduce = useReducedMotion();
  const close = () => setAdd(null);
  const canWrite = role !== "viewer";
  const pending = reminders.filter((r) => r.status === "pending").length;
  const urgent = tasks.filter((t) => t.status !== "done" && (t.priority === "urgent" || t.priority === "high")).length;
  const { scrolled, minimized } = useScrollInfo();
  const title = TAB_TITLES.find(([re]) => re.test(pathname))?.[1] ?? "Aangan";
  const isRoot = NAV.some((n) => n.to === pathname || (n.end && pathname === n.to + "/"));
  const outlet = useOutlet({ openAdd: setAdd } satisfies ShellCtx);

  // iOS push/pop: deeper screens slide in from the right, going back slides in from the left.
  const prev = useRef(pathname);
  const dir = depth(pathname) > depth(prev.current) ? 1 : depth(pathname) < depth(prev.current) ? -1 : 0;
  useEffect(() => { prev.current = pathname; window.scrollTo({ top: 0 }); }, [pathname]);

  // Once the shell is up, quietly fetch the other screens so every tap opens instantly.
  useEffect(() => { prefetchAppScreens(); }, []);

  return (
    <div className={`app ${scrolled ? "is-scrolled" : ""}`}>
      <aside className="sidebar">
        <div className="brand"><Logo /><span>Aangan</span></div>
        {canWrite && <button className="btn primary block" onClick={() => setMenu(true)}><Plus size={16} /> Quick add</button>}
        <nav aria-label="Main">
          {NAV.map((n) => <SideLink key={n.to} n={n} active={isActive(pathname, n)} />)}
          {GROUPS.map((g) => (
            <div key={g.title} className="side-section">
              <span className="side-group">{g.title}</span>
              {g.items.map((n) => <SideLink key={n.to} n={n} active={isActive(pathname, n)} badge={n.to === "/app/reminders" ? pending : 0} />)}
            </div>
          ))}
        </nav>
        <button className="side-foot" onClick={() => navigate("/app/settings")}>
          <div className="avatar" data-tone={tone(workspace?.name ?? "A")} aria-hidden="true">{initials(workspace?.name ?? "A")}</div>
          <span className="grow">
            <span className="small ellipsis" style={{ display: "block" }}>{workspace?.name}</span>
            <span className="tiny muted" style={{ textTransform: "capitalize" }}>{role}{demo ? " · mock data" : ""}</span>
          </span>
        </button>
      </aside>

      <header className="topbar">
        <div className="topbar-inner">
          <div className="nav-lead">
            {isRoot
              ? <div className="brand nav-brand"><Logo size={26} /><span>Aangan</span></div>
              : <button className="nav-glass-btn" onClick={() => navigate(-1)} aria-label="Back"><ChevronLeft size={22} /></button>}
          </div>
          <AnimatePresence initial={false}>
            {(scrolled || !isRoot) && (
              <motion.span key={title} className="nav-title" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6, transition: { duration: 0.12 } }} transition={SPRING}>{title}</motion.span>
            )}
          </AnimatePresence>
          <div className="nav-trail nav-glass-group">
            <NavLink to="/app/reminders" className="nav-glass-btn badge-host" aria-label={pending > 0 ? `Reminders, ${pending} pending` : "Reminders"}>
              <BellRing size={18} />{pending > 0 && <span className="badge">{pending}</span>}
            </NavLink>
            <button className="nav-glass-btn avatar-btn" onClick={() => navigate("/app/settings")} aria-label={`${initials(workspace?.name ?? "A")} · Settings`}>
              <div className="avatar" data-tone={tone(workspace?.name ?? "A")} aria-hidden="true">{initials(workspace?.name ?? "A")}</div>
            </button>
          </div>
        </div>
      </header>

      <a className="skip-link" href="#main">Skip to content</a>
      <main id="main" tabIndex={-1} className="main">
        {demo && (
          <div className="demo-banner">
            <Sparkles size={15} />
            <span><strong>Running on the mock backend.</strong> <span className="demo-more">Everything works and saves in this browser.</span> <NavLink to="/app/settings" className="link">Reset or learn more</NavLink></span>
          </div>
        )}
        <SyncStatus />
        <Suspense fallback={<PageSkeleton />}>
          <AnimatePresence mode="popLayout" initial={false} custom={dir}>
            <motion.div key={pathname} className="route" custom={dir}
              variants={{
                // Tab switches (d = 0) are a quick cross-fade, like iOS; pushes slide in, pops slide back.
                enter: (d: number) => reduce || d === 0 ? { opacity: 0 } : { opacity: 1, x: d > 0 ? "32%" : "-22%" },
                center: (d: number) => ({ opacity: 1, x: 0, transition: reduce || d === 0 ? { duration: reduce ? 0.12 : 0.18, ease: "easeOut" } : NAV_SPRING }),
                exit: (d: number) => reduce || d === 0 ? { opacity: 0, transition: { duration: 0.1 } } : { opacity: 0, x: d > 0 ? "-14%" : "26%", transition: NAV_EXIT },
              }}
              initial="enter" animate="center" exit="exit">
              {outlet}
            </motion.div>
          </AnimatePresence>
        </Suspense>
      </main>

      <div className={`tabdock ${minimized ? "min" : ""}`}>
        <TabBar pathname={pathname} badges={{ "/app/tasks": urgent }} onNavigate={(to) => navigate(to)} />
        <button className="tab-plus" onClick={() => { haptic(); setMenu(true); }} aria-label="Quick add and more"><Plus size={24} /></button>
      </div>

      <AnimatePresence>
        {menu && (
          <motion.div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setMenu(false)}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>
            <motion.div className="quick" role="dialog" aria-modal="true" aria-label="Quick add"
              style={{ transformOrigin: "100% 100%" }}
              initial={reduce ? { opacity: 0 } : { y: 24, opacity: 0, scale: 0.82 }} animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={reduce ? { opacity: 0 } : { y: 16, opacity: 0, scale: 0.9, transition: { duration: 0.16, ease: [0.4, 0, 1, 1] } }} transition={SPRING}>
              <div className="row between"><h2>{canWrite ? "Quick add" : "Go to"}</h2><button className="nav-glass-btn" onClick={() => setMenu(false)} aria-label="Close"><X size={18} /></button></div>
              {canWrite && (
                <div className="quick-grid">
                  {([
                    ["payment", IndianRupee, "Payment", "Issue a receipt"],
                    ["tenant", Users, "Tenant", "With a lease"],
                    ["property", Building2, "Property", "And its units"],
                    ["task", Hammer, "Task", "Maintenance"],
                    ["expense", Receipt, "Expense", "Repairs, bills…"],
                  ] as const).map(([k, Icon, label, sub], i) => (
                    <motion.button key={k} className="quick-item" data-tone={i} onClick={() => { setMenu(false); setAdd(k); }}
                      initial={reduce ? false : { opacity: 0, y: 14, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ ...SPRING, delay: 0.02 * i }}>
                      <span className="qi-icon"><Icon size={20} /></span><strong>{label}</strong><small>{sub}</small>
                    </motion.button>
                  ))}
                </div>
              )}
              <div className="quick-more">
                {MORE.map((n) => <NavLink key={n.to} to={n.to} onClick={() => setMenu(false)} {...prefetchHandlers(n.to)}><n.icon size={16} /> {n.label}</NavLink>)}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <SheetIf open={add} title={add ? ADD_TITLES[add] : ""} onClose={close}>
        {add === "payment" && <PaymentForm onDone={close} />}
        {add === "tenant" && <TenantLeaseForm onDone={close} />}
        {add === "property" && <PropertyForm onDone={close} />}
        {add === "task" && <TaskForm onDone={close} />}
        {add === "expense" && <ExpenseForm onDone={close} />}
      </SheetIf>
    </div>
  );
}

/**
 * Telegram-iOS style tab bar: a glass capsule with a liquid lens on the active tab. Press and drag along the bar and
 * the lens lifts (grows, turns clearer) and follows the finger; let go over a tab to open it.
 */
function TabBar({ pathname, badges, onNavigate }: { pathname: string; badges: Record<string, number>; onNavigate: (to: string) => void }) {
  const bar = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const active = Math.max(0, NAV.findIndex((n) => isActive(pathname, n)));
  const onTab = NAV.some((n) => isActive(pathname, n));
  const [scrub, setScrub] = useState<{ x: number; moved: boolean } | null>(null);
  const [w, setW] = useState(0);
  const lastIndex = useRef(active);
  // Set when a drag ends, so the click the browser sends afterwards doesn't open a second tab.
  const swallowClick = useRef(false);
  useLayoutEffect(() => {
    const el = bar.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth - 8));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const col = w / NAV.length;
  const indexAt = (x: number) => Math.max(0, Math.min(NAV.length - 1, Math.floor(x / col)));
  const localX = (e: ReactPointerEvent) => e.clientX - bar.current!.getBoundingClientRect().left - 4;

  const lensX = scrub && scrub.moved ? Math.max(0, Math.min(w - col, scrub.x - col / 2)) : active * col;
  return (
    <nav ref={bar} className={`tabbar ${scrub?.moved ? "scrubbing" : ""}`} aria-label="Main"
      onPointerDown={(e) => { if (e.pointerType === "mouse" && e.button !== 0) return; swallowClick.current = false; setScrub({ x: localX(e), moved: false }); lastIndex.current = indexAt(localX(e)); }}
      onPointerMove={(e) => {
        if (!scrub) return;
        const x = localX(e);
        if (!scrub.moved && Math.abs(x - scrub.x) < 6) return;
        if (!scrub.moved) (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        const i = indexAt(x);
        if (i !== lastIndex.current) { lastIndex.current = i; haptic(5); }
        setScrub({ x, moved: true });
      }}
      onPointerUp={(e) => {
        if (scrub?.moved) { e.preventDefault(); swallowClick.current = true; onNavigate(NAV[indexAt(localX(e))].to); }
        setScrub(null);
      }}
      onPointerCancel={() => setScrub(null)}
      onClickCapture={(e) => { if (swallowClick.current || scrub?.moved) { swallowClick.current = false; e.preventDefault(); } }}>
      {w > 0 && (onTab || scrub?.moved) && (
        <motion.span className={`tab-lens lens ${scrub?.moved ? "lifted" : ""}`} aria-hidden
          initial={false}
          animate={{ x: lensX, width: col, scale: scrub?.moved ? 1.15 : 1, opacity: 1 }}
          transition={scrub?.moved ? { type: "spring", stiffness: 900, damping: 50, mass: 0.6 } : reduce ? { duration: 0 } : LENS_SPRING} />
      )}
      {NAV.map((n, i) => (
        <Tab key={n.to} n={n} active={scrub?.moved ? indexAt(scrub.x) === i : isActive(pathname, n)} badge={badges[n.to] ?? 0} />
      ))}
    </nav>
  );
}

function SideLink({ n, active, badge = 0 }: { n: NavItem; active: boolean; badge?: number }) {
  return (
    <NavLink to={n.to} end={n.end} className="side-link" {...prefetchHandlers(n.to)}>
      {active && <motion.span layoutId="side-lens" className="side-lens lens" transition={SPRING} />}
      <n.icon size={18} /> <span className="grow">{n.label}</span>
      {badge > 0 && <span className="badge inline">{badge}</span>}
    </NavLink>
  );
}

function Tab({ n, active, badge = 0 }: { n: NavItem; active: boolean; badge?: number }) {
  return (
    <NavLink to={n.to} end={n.end} className={`tab ${active ? "on" : ""}`} draggable={false} {...prefetchHandlers(n.to)}>
      <span className="tab-icon"><n.icon size={23} strokeWidth={active ? 2.3 : 1.9} />{badge > 0 && <span className="badge">{badge}</span>}</span>
      <span className="tab-label">{n.label}</span>
    </NavLink>
  );
}

function PageSkeleton() {
  return (
    <div className="page" aria-busy="true" aria-label="Loading">
      <div className="sk" style={{ height: 38, width: 200, borderRadius: 12 }} />
      <div className="tiles">{[0, 1, 2, 3].map((i) => <div key={i} className="sk" style={{ height: 92, borderRadius: 20 }} />)}</div>
      <div className="sk" style={{ height: 280, borderRadius: 26 }} />
    </div>
  );
}

export interface ShellCtx { openAdd: (k: AddKind) => void }
