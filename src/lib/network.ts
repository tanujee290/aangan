// One place to ask "is there a connection?". On the mock backend you can also switch on a
// simulated outage (Settings → Mock backend), so offline capture and sync can be tested without
// touching the device's network. The switch is per tab and resets when the tab closes.
const KEY = "angan.mock-offline";
const listeners = new Set<() => void>();

let simulated = (() => {
  try { return sessionStorage.getItem(KEY) === "1"; } catch { return false; }
})();

const emit = () => listeners.forEach((l) => l());
if (typeof window !== "undefined") {
  window.addEventListener("online", emit);
  window.addEventListener("offline", emit);
}

export function isOnline() {
  if (simulated) return false;
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

export function isSimulatedOffline() {
  return simulated;
}

/** Turns the simulated outage on or off. Only the mock backend honours it. */
export function setSimulatedOffline(on: boolean) {
  simulated = on;
  try { on ? sessionStorage.setItem(KEY, "1") : sessionStorage.removeItem(KEY); } catch { /* blocked */ }
  emit();
}

export function onNetworkChange(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
