import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { ChevronRight, Moon, Sun } from "lucide-react";
import { parseConfirm, type AlertSpec } from "../lib/confirm";
import { haptic } from "../lib/touch";
import { isDarkNow, toggleNight, type Wall } from "../lib/theme";

const POP = { type: "spring", stiffness: 520, damping: 36, mass: 0.8 } as const;

/* ------------------------------------------------------------------ alerts
   iOS 26 alert: a centred glass card that pops in slightly oversized and settles, with capsule buttons.
   askConfirm() is a drop-in, promise-based replacement for window.confirm(). */

type AlertReq = AlertSpec & { resolve: (ok: boolean) => void };
let pushAlert: ((r: AlertReq) => void) | null = null;

export function askConfirm(text: string, opts?: Partial<AlertSpec>): Promise<boolean> {
  const spec = parseConfirm(text, opts);
  if (!pushAlert) return Promise.resolve(typeof window !== "undefined" ? window.confirm(text) : false);
  return new Promise((resolve) => pushAlert!({ ...spec, resolve }));
}

export function AlertHost() {
  const [queue, setQueue] = useState<AlertReq[]>([]);
  const current = queue[0];
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    pushAlert = (r) => setQueue((q) => [...q, r]);
    return () => { pushAlert = null; };
  }, []);
  const answer = (ok: boolean) => {
    if (!current) return;
    haptic(ok ? 10 : 6);
    current.resolve(ok);
    setQueue((q) => q.slice(1));
  };
  useEffect(() => {
    if (!current) return;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); answer(false); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);
  return createPortal(
    <AnimatePresence>
      {current && (
        <motion.div key="alert" className="alert-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.16 } }}
          transition={{ duration: 0.2 }} onMouseDown={(e) => e.target === e.currentTarget && answer(false)}>
          <motion.div className="alert" role="alertdialog" aria-modal="true" aria-labelledby="ios-alert-title" aria-describedby={current.message ? "ios-alert-msg" : undefined}
            initial={{ opacity: 0, scale: 1.18 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.14 } }} transition={POP}>
            <h2 id="ios-alert-title">{current.title}</h2>
            {current.message && <p id="ios-alert-msg">{current.message}</p>}
            <div className="alert-actions">
              <button ref={cancelRef} type="button" className="alert-btn" onClick={() => answer(false)}>Cancel</button>
              <button type="button" className={`alert-btn primary ${current.destructive ? "destructive" : ""}`} onClick={() => answer(true)}>{current.confirmLabel}</button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/* ------------------------------------------------------------ context menu
   iOS / Telegram long-press menu: the page blurs, the pressed row lifts out at its own position, and a glass
   action list springs open beside it. The row moves up if the menu would not fit below. */

export type MenuAction = { label: string; icon?: ReactNode; destructive?: boolean; onSelect: () => void };

export function ContextMenu({ anchor, preview, actions, onClose }: { anchor: DOMRect | null; preview: ReactNode; actions: MenuAction[]; onClose: () => void }) {
  const first = useRef<HTMLButtonElement>(null);
  const [menuH, setMenuH] = useState(actions.length * 46 + 12);
  const menuRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { if (anchor && menuRef.current) setMenuH(menuRef.current.offsetHeight); }, [anchor]);
  useEffect(() => {
    if (!anchor) return;
    first.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onResize = () => onClose();
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => { document.removeEventListener("keydown", onKey); window.removeEventListener("resize", onResize); };
  }, [anchor, onClose]);

  let layout: { top: number; left: number; width: number; menuTop: number; menuLeft: number; origin: string } | null = null;
  if (anchor) {
    const vw = window.innerWidth, vh = window.innerHeight;
    const width = Math.min(anchor.width, vw - 16);
    const left = Math.max(8, Math.min(anchor.left, vw - width - 8));
    const bottomSafe = 24;
    let top = anchor.top;
    // Room for the menu below the row; otherwise shift the lifted row up (never above the top inset).
    const overflow = top + anchor.height + 10 + menuH + bottomSafe - vh;
    if (overflow > 0) top = Math.max(12, top - overflow);
    const menuW = Math.min(260, vw - 16);
    const alignRight = anchor.left + anchor.width / 2 > vw / 2;
    const menuLeft = alignRight ? Math.max(8, left + width - menuW) : Math.min(left, vw - menuW - 8);
    layout = { top, left, width, menuTop: top + anchor.height + 10, menuLeft, origin: alignRight ? "100% 0" : "0 0" };
  }
  return createPortal(
    <AnimatePresence>
      {anchor && layout && (
        <motion.div key="ctx" className="ctx-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.18 } }}
          transition={{ duration: 0.22 }} onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }}>
          <motion.div className="ctx-preview" aria-hidden style={{ top: layout.top, left: layout.left, width: layout.width }}
            initial={{ y: anchor.top - layout.top, scale: 1 }} animate={{ y: 0, scale: 1.03 }} exit={{ y: anchor.top - layout.top, scale: 1, opacity: 0, transition: { duration: 0.18 } }}
            transition={POP}>
            {preview}
          </motion.div>
          <motion.div ref={menuRef} className="ctx-menu" role="menu" style={{ top: layout.menuTop, left: layout.menuLeft, transformOrigin: layout.origin }}
            initial={{ opacity: 0, scale: 0.4 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6, transition: { duration: 0.15 } }}
            transition={POP} onClick={(e) => e.stopPropagation()}>
            {actions.map((a, i) => (
              <button key={a.label} ref={i === 0 ? first : undefined} type="button" role="menuitem" className={`ctx-item ${a.destructive ? "destructive" : ""}`}
                onClick={() => { onClose(); a.onSelect(); }}>
                <span>{a.label}</span>{a.icon}
              </button>
            ))}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** Long-press (touch and pen) or right-click (mouse) to open a context menu. Movement cancels, like UIKit. */
export function useLongPress(onOpen: (el: HTMLElement) => void, ms = 460) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const start = useRef({ x: 0, y: 0 });
  const fired = useRef(false);
  const clear = () => { clearTimeout(timer.current); timer.current = undefined; };
  useEffect(() => clear, []);
  return {
    fired,
    cancel: clear,
    handlers: {
      onPointerDown: (e: RPointerEvent<HTMLElement>) => {
        fired.current = false;
        if (e.pointerType === "mouse") return;
        const el = e.currentTarget;
        start.current = { x: e.clientX, y: e.clientY };
        clear();
        timer.current = setTimeout(() => { fired.current = true; haptic(12); onOpen(el); }, ms);
      },
      onPointerMove: (e: RPointerEvent<HTMLElement>) => {
        if (timer.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 8) clear();
      },
      onPointerUp: clear,
      onPointerCancel: clear,
      onContextMenu: (e: RMouseEvent<HTMLElement>) => {
        e.preventDefault();
        clear();
        if (!fired.current) { fired.current = true; onOpen(e.currentTarget); }
      },
    },
  };
}

/* ------------------------------------------------------------ settings rows
   iOS Settings-style inset grouped list: coloured rounded icon tiles, hairline separators that start after the icon. */

export function IosGroup({ title, footer, children }: { title?: string; footer?: ReactNode; children: ReactNode }) {
  return (
    <section className="ios-group">
      {title && <h3 className="ios-group-title">{title}</h3>}
      <div className="ios-group-body">{children}</div>
      {footer && <p className="ios-group-foot">{footer}</p>}
    </section>
  );
}

export function IosCell({ icon, color, label, sub, detail, children, onClick, chevron }: {
  icon?: ReactNode; color?: string; label: ReactNode; sub?: ReactNode; detail?: ReactNode; children?: ReactNode; onClick?: () => void; chevron?: boolean;
}) {
  const inner = (
    <>
      {icon && <span className="ios-icon" style={{ background: color }} aria-hidden>{icon}</span>}
      <span className="ios-cell-text"><span className="ios-cell-label">{label}</span>{sub && <span className="ios-cell-sub">{sub}</span>}</span>
      {detail && <span className="ios-cell-detail">{detail}</span>}
      {children && <span className="ios-cell-control">{children}</span>}
      {chevron && <ChevronRight className="ios-chev" size={18} aria-hidden />}
    </>
  );
  return onClick
    ? <button type="button" className="ios-cell as-button" onClick={onClick}>{inner}</button>
    : <div className="ios-cell">{inner}</div>;
}

/* ------------------------------------------------------------ theme preview
   A small Telegram chat over the wallpaper, drawn from the same colour tokens as the app. */

export function ThemePreview({ wall, accent, dark, compact }: { wall: Wall; accent?: string; dark?: boolean; compact?: boolean }) {
  const style: CSSProperties & Record<string, string> = {};
  if (accent) style["--accent"] = accent;
  if (dark !== undefined) style.colorScheme = dark ? "dark" : "light";
  return (
    <div className={`theme-preview ${compact ? "compact" : ""}`} data-wall={wall} style={style} aria-hidden>
      <i className="tp-blob" /><i className="tp-blob" /><i className="tp-blob" />
      <div className="tp-bar"><span className="tp-avatar" /><span className="tp-lines"><i /><i /></span></div>
      <div className="tp-chat">
        <span className="tp-bubble in">{compact ? "" : "Rent for November?"}</span>
        <span className="tp-bubble out">{compact ? "" : "Paid ₹18,000 ✓✓"}</span>
        {!compact && <span className="tp-bubble in short">Receipt sent 🧾</span>}
      </div>
      <div className="tp-tabs"><i className="on" /><i /><i /><i /></div>
    </div>
  );
}

/* ------------------------------------------------------------ night button
   Telegram's moon: switches day ↔ night and the new look grows out of the button in a circle. */

export function NightButton() {
  const [dark, setDark] = useState(() => isDarkNow());
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const sync = () => setDark(isDarkNow());
    mq.addEventListener("change", sync);
    const id = setInterval(sync, 60_000);
    return () => { mq.removeEventListener("change", sync); clearInterval(id); };
  }, []);
  return (
    <button type="button" className="nav-glass-btn night-btn" aria-label={dark ? "Switch to day mode" : "Switch to night mode"} aria-pressed={dark}
      onClick={() => { haptic(8); toggleNight(); setDark(!dark); }}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={dark ? "sun" : "moon"} className="night-icon" initial={{ rotate: -90, scale: 0.3, opacity: 0 }} animate={{ rotate: 0, scale: 1, opacity: 1 }}
          exit={{ rotate: 90, scale: 0.3, opacity: 0 }} transition={POP}>
          {dark ? <Sun size={18} /> : <Moon size={18} />}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}
