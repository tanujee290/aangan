import { getPrefs } from "./theme";
/**
 * Telegram-style touch feedback for glass controls.
 *
 * While a finger or pointer is down on a control, it gets `.is-pressed` plus `--px`/`--py` (where the touch is, in %)
 * and `--sx`/`--sy` (a small stretch toward the drag). CSS uses those for the swelling glass and the radial highlight
 * that follows the finger. Lift-on and lift-off use different springs (see --lift-on / --lift-off in skin.css),
 * converted from Telegram-iOS's TouchEffect values.
 */
const SELECTOR = ".btn, .icon-btn, .chip, .tab, .tab-plus, .quick-item, .suggest button, .unit-opt, .swatch, .segmented button, .nav-glass-btn, a.list-row, .list-row.as-button, a.tile, .prop-card, .side-link, .send-orb, .wall-opt, .theme-card, .ios-cell.as-button, .ctx-item, .alert-btn, .night-btn";

export function installTouchEffect() {
  if (typeof window === "undefined") return;
  let el: HTMLElement | null = null;
  let start = { x: 0, y: 0 };
  let raf = 0;
  let last: PointerEvent | null = null;

  const release = () => {
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    if (!el) return;
    el.classList.remove("is-pressed");
    el.style.setProperty("--sx", "0");
    el.style.setProperty("--sy", "0");
    el = null;
  };

  // pointermove can fire faster than the screen refreshes; measuring and styling once per frame keeps the press smooth.
  const apply = () => {
    raf = 0;
    const e = last;
    if (!e || !el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--px", `${((e.clientX - r.left) / r.width) * 100}%`);
    el.style.setProperty("--py", `${((e.clientY - r.top) / r.height) * 100}%`);
    // Rubber-band stretch toward the finger, capped so it stays a hint.
    const dx = Math.max(-1, Math.min(1, (e.clientX - start.x) / 120));
    const dy = Math.max(-1, Math.min(1, (e.clientY - start.y) / 120));
    el.style.setProperty("--sx", dx.toFixed(3));
    el.style.setProperty("--sy", dy.toFixed(3));
    // A finger that wanders far off the control cancels the press, like UIKit.
    if (e.clientX < r.left - 60 || e.clientX > r.right + 60 || e.clientY < r.top - 60 || e.clientY > r.bottom + 60) release();
  };
  const track = (e: PointerEvent) => {
    if (!el) return;
    last = e;
    if (!raf) raf = requestAnimationFrame(apply);
  };

  document.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const hit = (e.target as Element | null)?.closest?.(SELECTOR) as HTMLElement | null;
    if (!hit || (hit as HTMLButtonElement).disabled) return;
    release();
    el = hit;
    start = { x: e.clientX, y: e.clientY };
    el.classList.add("is-pressed");
    last = e;
    apply();
  }, { passive: true });
  document.addEventListener("pointermove", track, { passive: true });
  document.addEventListener("pointerup", release, { passive: true });
  document.addEventListener("pointercancel", release, { passive: true });
  window.addEventListener("blur", release);
  // Scrolling is not a tap: drop the highlight as soon as the page moves.
  window.addEventListener("scroll", release, { passive: true, capture: true });
}

/** A short haptic tick where supported (Android browsers); a no-op elsewhere. */
export function haptic(ms = 8) {
  if (!getPrefs().haptics) return;
  try { navigator.vibrate?.(ms); } catch { /* unsupported */ }
}
