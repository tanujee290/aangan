import { useSyncExternalStore } from "react";

/** "schedule" is Telegram's automatic night mode: dark between two times of day. */
export type Mode = "system" | "light" | "dark" | "schedule";
// Telegram-style accent themes. The first is the default; stored accents from older versions keep working.
export const ACCENTS = [
  { name: "Telegram blue", value: "#3390ec" },
  { name: "Sky", value: "#2aabee" },
  { name: "Mint", value: "#2fb46c" },
  { name: "Violet", value: "#8e5cf6" },
  { name: "Sunset", value: "#f2874b" },
  { name: "Rose", value: "#e5487a" },
  { name: "Lagoon", value: "#1f7a74" },
  { name: "Indigo", value: "#5856d6" },
  { name: "Peacock", value: "#00a3a3" },
  { name: "Saffron", value: "#e8930c" },
  { name: "Cherry", value: "#d63a3a" },
  { name: "Lotus", value: "#c05fd0" },
  { name: "Graphite", value: "#6e6e78" },
];
/** Wallpapers: palettes live in skin.css and skin-plus.css under [data-wall="…"] (each has a light and a dark variant). */
export const WALLPAPERS = [
  { id: "courtyard", name: "Courtyard" },
  { id: "dusk", name: "Dusk" },
  { id: "monsoon", name: "Monsoon" },
  { id: "marigold", name: "Marigold" },
  { id: "plain", name: "Plain" },
  { id: "aurora", name: "Aurora" },
  { id: "ocean", name: "Ocean" },
  { id: "sakura", name: "Sakura" },
  { id: "forest", name: "Forest" },
  { id: "peacock", name: "Peacock" },
  { id: "midnight", name: "Midnight" },
] as const;
export type Wall = (typeof WALLPAPERS)[number]["id"];
export const WALL_DEFAULT: Wall = "courtyard";

/** Telegram-style chat themes: one tap sets the accent, wallpaper and colour mode together. */
export type Preset = { id: string; name: string; emoji: string; accent: string; wall: Wall; mode: Mode };
export const PRESETS: Preset[] = [
  { id: "classic", name: "Classic", emoji: "🏠", accent: "#3390ec", wall: "courtyard", mode: "system" },
  { id: "day", name: "Day", emoji: "☀️", accent: "#2aabee", wall: "plain", mode: "light" },
  { id: "night", name: "Night", emoji: "🌙", accent: "#5856d6", wall: "midnight", mode: "dark" },
  { id: "diwali", name: "Diwali", emoji: "🪔", accent: "#e8930c", wall: "marigold", mode: "dark" },
  { id: "holi", name: "Holi", emoji: "🎨", accent: "#e5487a", wall: "sakura", mode: "light" },
  { id: "monsoon", name: "Monsoon", emoji: "🌧️", accent: "#1f7a74", wall: "monsoon", mode: "system" },
  { id: "aurora", name: "Aurora", emoji: "🌌", accent: "#8e5cf6", wall: "aurora", mode: "dark" },
  { id: "peacock", name: "Peacock", emoji: "🦚", accent: "#00a3a3", wall: "peacock", mode: "system" },
  { id: "ocean", name: "Ocean", emoji: "🌊", accent: "#2aabee", wall: "ocean", mode: "light" },
  { id: "forest", name: "Forest", emoji: "🌿", accent: "#2fb46c", wall: "forest", mode: "system" },
  { id: "dusk", name: "Dusk", emoji: "🌆", accent: "#c05fd0", wall: "dusk", mode: "dark" },
];

/* ---------------------------------------------------------- display preferences */

export type TextSize = "s" | "m" | "l" | "xl";
export type Corners = "liquid" | "classic";
export type Density = "comfortable" | "compact";
export type MotionLevel = "full" | "reduced";
/** off: still · step: Telegram's gradient turns a step on each screen change · live: slow continuous drift. */
export type WallMotion = "off" | "step" | "live";

export type Prefs = {
  text: TextSize;
  bold: boolean;
  corners: Corners;
  density: Density;
  motion: MotionLevel;
  wallMotion: WallMotion;
  /** Strength of the jaali pattern over the wallpaper, 0…100. */
  pattern: number;
  haptics: boolean;
  tabLabels: boolean;
  /** Scheduled night mode, "HH:MM" local time. */
  nightFrom: string;
  nightTo: string;
};

export const PREFS_DEFAULT: Prefs = {
  text: "m", bold: false, corners: "liquid", density: "comfortable", motion: "full", wallMotion: "step",
  pattern: 50, haptics: true, tabLabels: true, nightFrom: "19:00", nightTo: "07:00",
};

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);

/** Accepts anything (old, partial or hand-edited storage) and returns a complete, valid set of preferences. */
export function normalizePrefs(raw: unknown): Prefs {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = PREFS_DEFAULT;
  const pattern = Number(r.pattern);
  return {
    text: pick(r.text, ["s", "m", "l", "xl"] as const, d.text),
    bold: typeof r.bold === "boolean" ? r.bold : d.bold,
    corners: pick(r.corners, ["liquid", "classic"] as const, d.corners),
    density: pick(r.density, ["comfortable", "compact"] as const, d.density),
    motion: pick(r.motion, ["full", "reduced"] as const, d.motion),
    wallMotion: pick(r.wallMotion, ["off", "step", "live"] as const, d.wallMotion),
    pattern: r.pattern !== undefined && Number.isFinite(pattern) ? Math.max(0, Math.min(100, Math.round(pattern))) : d.pattern,
    haptics: typeof r.haptics === "boolean" ? r.haptics : d.haptics,
    tabLabels: typeof r.tabLabels === "boolean" ? r.tabLabels : d.tabLabels,
    nightFrom: typeof r.nightFrom === "string" && TIME.test(r.nightFrom) ? r.nightFrom : d.nightFrom,
    nightTo: typeof r.nightTo === "string" && TIME.test(r.nightTo) ? r.nightTo : d.nightTo,
  };
}

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** True when `now` falls in the night window. Windows can cross midnight (19:00 → 07:00). */
export function isNight(now: Date, from: string, to: string) {
  const m = now.getHours() * 60 + now.getMinutes();
  const a = minutes(from), b = minutes(to);
  if (a === b) return false;
  return a < b ? m >= a && m < b : m >= a || m < b;
}

/**
 * Telegram's gradient wallpaper moves its colour points around a loop of eight positions.
 * Returns the offset (in vmax) for each of the four blobs at a given phase.
 */
export function wallpaperPhase(phase: number, radius = 9): { x: number; y: number }[] {
  return [0, 1, 2, 3].map((k) => {
    const a = ((((phase % 8) + 8) % 8) * 45 + k * 90) * (Math.PI / 180);
    return { x: Math.round(Math.cos(a) * radius * 100) / 100, y: Math.round(Math.sin(a) * radius * 100) / 100 };
  });
}

function safeStorage() {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

let prefsCache: Prefs | null = null;
const listeners = new Set<() => void>();

export function getPrefs(): Prefs {
  if (prefsCache) return prefsCache;
  let raw: unknown = null;
  try { raw = JSON.parse(safeStorage()?.getItem("angan.prefs") ?? "null"); } catch { raw = null; }
  prefsCache = normalizePrefs(raw);
  return prefsCache;
}

export function setPrefs(patch: Partial<Prefs>) {
  prefsCache = normalizePrefs({ ...getPrefs(), ...patch });
  safeStorage()?.setItem("angan.prefs", JSON.stringify(prefsCache));
  applyPrefs();
  if ("nightFrom" in patch || "nightTo" in patch) applyTheme();
  listeners.forEach((l) => l());
}

export function resetPrefs() {
  prefsCache = { ...PREFS_DEFAULT };
  safeStorage()?.removeItem("angan.prefs");
  applyPrefs();
  applyTheme();
  listeners.forEach((l) => l());
}

/** Live display preferences for React (re-renders when any of them change). */
export function usePrefs() {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, getPrefs, getPrefs);
}

/** Motion is reduced when the device asks for it or when the user picked Reduced in Settings. */
export function motionReduced() {
  return getPrefs().motion === "reduced" || (typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches);
}

export function applyPrefs() {
  const p = getPrefs();
  const root = document.documentElement;
  const set = (name: string, on: boolean, value = "") => (on ? root.setAttribute(name, value) : root.removeAttribute(name));
  set("data-text", p.text !== "m", p.text);
  set("data-bold", p.bold);
  set("data-corners", p.corners !== "liquid", p.corners);
  set("data-density", p.density !== "comfortable", p.density);
  set("data-motion", p.motion !== "full", p.motion);
  root.setAttribute("data-wallmotion", p.wallMotion);
  set("data-notablabels", !p.tabLabels);
  root.style.setProperty("--pattern", String(p.pattern / 100));
}

/* ------------------------------------------------------------------ colour mode */

function readWall(): Wall {
  const v = safeStorage()?.getItem("angan.wall");
  return WALLPAPERS.some((w) => w.id === v) ? (v as Wall) : WALL_DEFAULT;
}

/** iOS 27-style glass setting: 0 = clear (most transparent) … 100 = tinted (frosted, highest contrast). */
export const GLASS_DEFAULT = 45;

function readGlass() {
  const s = safeStorage();
  const v = Number(s?.getItem("angan.glass"));
  return Number.isFinite(v) && s?.getItem("angan.glass") != null ? Math.max(0, Math.min(100, v)) : GLASS_DEFAULT;
}

function readMode(): Mode {
  const v = safeStorage()?.getItem("angan.mode");
  return v === "light" || v === "dark" || v === "schedule" ? v : "system";
}

export function applyTheme() {
  const mode = readMode();
  const accent = localStorage.getItem("angan.accent") || ACCENTS[0].value;
  const root = document.documentElement;
  const p = getPrefs();
  const effective = mode === "schedule" ? (isNight(new Date(), p.nightFrom, p.nightTo) ? "dark" : "light") : mode;
  if (effective === "system") root.removeAttribute("data-mode");
  else root.setAttribute("data-mode", effective);
  root.style.setProperty("--accent", accent);
  applyGlass(readGlass());
  root.setAttribute("data-wall", readWall());
  applyPrefs();
  const dark = effective === "dark" || (effective === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  syncThemeColor(dark);
}

/** The browser bar takes the wallpaper's base colour, so the page and the status bar read as one surface. */
function syncThemeColor(dark?: boolean) {
  const root = document.documentElement;
  // A fresh element has no running transition, so it reports the colour the page is heading to, not the one it is leaving.
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;width:0;height:0;visibility:hidden;background:var(--bg)";
  document.body.appendChild(probe);
  const bg = getComputedStyle(probe).backgroundColor;
  probe.remove();
  const fallback = (dark ?? root.getAttribute("data-mode") === "dark") ? "#000000" : "#f2f2f7";
  const colour = bg && !/rgba?\([^)]*,\s*0\)|transparent/.test(bg) ? bg : fallback;
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", colour));
}

export function applyGlass(level: number) {
  document.documentElement.style.setProperty("--tint", String(level / 100));
}

export function setGlass(level: number) {
  localStorage.setItem("angan.glass", String(level));
  applyGlass(level);
}

/* ------------------------------------------------------------- theme transitions */

type Point = { x: number; y: number };
let lastPointer: (Point & { at: number }) | null = null;

/** Remembers where the last tap landed, so theme changes can grow out of the control that made them. */
export function installThemeClock() {
  document.addEventListener("pointerdown", (e) => { lastPointer = { x: e.clientX, y: e.clientY, at: Date.now() }; }, { passive: true, capture: true });
  // Scheduled night mode: check every minute, and when the app comes back to the foreground.
  const tick = () => { if (readMode() === "schedule") applyTheme(); };
  setInterval(tick, 60_000);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && tick());
}

function recentPointer(): Point | undefined {
  return lastPointer && Date.now() - lastPointer.at < 1500 ? lastPointer : undefined;
}

/**
 * Telegram's theme switch: the new look spreads from the tap as a growing circle. Uses the View Transitions API;
 * browsers without it (or with motion reduced) simply switch.
 */
export function themeTransition(apply: () => void, origin: Point | undefined = recentPointer()) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void>; finished: Promise<void> } };
  if (!doc.startViewTransition || motionReduced()) { apply(); return; }
  if (!origin) { doc.startViewTransition(apply); return; }
  const root = document.documentElement;
  root.classList.add("vt-reveal");
  const t = doc.startViewTransition(apply);
  const r = Math.hypot(Math.max(origin.x, innerWidth - origin.x), Math.max(origin.y, innerHeight - origin.y));
  t.ready.then(() => {
    root.animate(
      { clipPath: [`circle(0px at ${origin.x}px ${origin.y}px)`, `circle(${r}px at ${origin.x}px ${origin.y}px)`] },
      { duration: 560, easing: "cubic-bezier(.32,.72,0,1)", pseudoElement: "::view-transition-new(root)" },
    );
  }).catch(() => {});
  t.finished.finally(() => root.classList.remove("vt-reveal"));
}

export function setWall(id: Wall) {
  localStorage.setItem("angan.wall", id);
  themeTransition(() => { document.documentElement.setAttribute("data-wall", id); syncThemeColor(); });
}

export function setTheme(mode: Mode, accent: string) {
  localStorage.setItem("angan.mode", mode);
  localStorage.setItem("angan.accent", accent);
  themeTransition(applyTheme);
}

export function applyPreset(p: Preset) {
  localStorage.setItem("angan.mode", p.mode);
  localStorage.setItem("angan.accent", p.accent);
  localStorage.setItem("angan.wall", p.wall);
  themeTransition(applyTheme);
}

/** The effective look right now: dark if the page is showing dark colours, whatever the setting. */
export function isDarkNow() {
  const m = document.documentElement.getAttribute("data-mode");
  return m === "dark" || (m !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
}

/** Telegram's moon button: flips between day and night, growing the new look out of the button. */
export function toggleNight() {
  const accent = localStorage.getItem("angan.accent") || ACCENTS[0].value;
  setTheme(isDarkNow() ? "light" : "dark", accent);
}

/* ---------------------------------------------------------------- wallpaper motion */

let phase = 0;
/** Turns the background gradient one step, like Telegram does when you send a message. */
export function advanceWallpaper() {
  if (getPrefs().wallMotion !== "step" || motionReduced()) return;
  phase = (phase + 1) % 8;
  const root = document.documentElement;
  wallpaperPhase(phase).forEach((o, i) => {
    root.style.setProperty(`--p${i + 1}x`, `${o.x}vmax`);
    root.style.setProperty(`--p${i + 1}y`, `${o.y}vmax`);
  });
}

export function getTheme() {
  return {
    mode: readMode(),
    accent: localStorage.getItem("angan.accent") || ACCENTS[0].value,
    glass: readGlass(),
    wall: readWall(),
  };
}
