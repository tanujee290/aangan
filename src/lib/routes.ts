// Page chunks, shared by the router (src/main.tsx) and the prefetcher below, so a screen's code
// can be fetched before it's opened: when a link is hovered, touched or focused, and for every
// /app screen once the browser is idle. Each import() runs once; later calls reuse the promise.
function once<T>(fn: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | null = null;
  return () => (p ??= fn().catch((e) => { p = null; throw e; }));
}

export const pages = {
  landing: once(() => import("../pages/Landing")),
  auth: once(() => import("../pages/Auth")),
  mockAuth: once(() => import("../pages/MockAuth")),
  verify: once(() => import("../pages/Verify")),
  home: once(() => import("../pages/Home")),
  wallet: once(() => import("../pages/Wallet")),
  payments: once(() => import("../pages/Payments")),
  receipt: once(() => import("../pages/Receipt")),
  tasks: once(() => import("../pages/Tasks")),
  properties: once(() => import("../pages/Properties")),
  tenants: once(() => import("../pages/Tenants")),
  settings: once(() => import("../pages/Settings")),
  reminders: once(() => import("../pages/Reminders")),
  billing: once(() => import("../pages/Billing")),
  reconcile: once(() => import("../pages/Reconcile")),
  documents: once(() => import("../pages/Documents")),
  team: once(() => import("../pages/Team")),
  join: once(() => import("../pages/Join")),
  portal: once(() => import("../pages/Portal")),
  reports: once(() => import("../pages/Reports")),
  assistant: once(() => import("../pages/Assistant")),
};

type PageKey = keyof typeof pages;

const APP_ROUTES: [RegExp, PageKey][] = [
  [/^\/app\/?$/, "home"], [/^\/app\/wallet/, "wallet"], [/^\/app\/payments\/./, "receipt"], [/^\/app\/payments/, "payments"],
  [/^\/app\/tasks/, "tasks"], [/^\/app\/properties/, "properties"], [/^\/app\/tenants/, "tenants"], [/^\/app\/reminders/, "reminders"],
  [/^\/app\/billing/, "billing"], [/^\/app\/reconcile/, "reconcile"], [/^\/app\/documents/, "documents"], [/^\/app\/reports/, "reports"],
  [/^\/app\/assistant/, "assistant"], [/^\/app\/team/, "team"], [/^\/app\/settings/, "settings"], [/^\/login/, "auth"], [/^\/$/, "landing"],
];

/** Starts loading the code for the screen at `path` (ignores unknown paths and load errors). */
export function prefetchPath(path: string) {
  const hit = APP_ROUTES.find(([re]) => re.test(path));
  if (hit) pages[hit[1]]().catch(() => {});
}

function slowConnection() {
  const c = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  return !!c && (c.saveData || /(^|-)2g$/.test(c.effectiveType ?? ""));
}

let warmed = false;
/** Fetches every in-app screen a little at a time while the browser is idle, so navigation never waits. */
export function prefetchAppScreens() {
  if (warmed || slowConnection()) return;
  warmed = true;
  const order: PageKey[] = ["home", "payments", "wallet", "tasks", "tenants", "properties", "receipt", "reminders", "billing",
    "reports", "settings", "documents", "reconcile", "team", "assistant"];
  const idle = (cb: () => void) =>
    "requestIdleCallback" in window ? window.requestIdleCallback(cb, { timeout: 2500 }) : setTimeout(cb, 300);
  const next = () => {
    const k = order.shift();
    if (!k) return;
    pages[k]().catch(() => {}).finally(() => idle(next));
  };
  idle(next);
}

/** Pointer/focus handlers that prefetch a link's target screen before it's clicked. */
export function prefetchHandlers(to: string) {
  const go = () => prefetchPath(to);
  return { onPointerEnter: go, onTouchStart: go, onFocus: go };
}
