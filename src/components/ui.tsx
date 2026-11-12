import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, animate, motion, useAnimationControls, useDragControls, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { haptic } from "../lib/touch";
import { CheckCircle2, Database, X } from "lucide-react";
import type { RentStatus } from "../lib/rent";
import { STATUS_LABEL } from "../lib/rent";

export const SPRING = { type: "spring", stiffness: 420, damping: 34, mass: 0.9 } as const;
export const SOFT_SPRING = { type: "spring", stiffness: 260, damping: 30 } as const;
/** Telegram-iOS TouchEffect "lift off": the bouncy settle of a glass lens landing on its new tab. */
export const LENS_SPRING = { type: "spring", stiffness: 560, damping: 34, mass: 0.9 } as const;
/** iOS navigation push/pop: a short tween on UIKit's curve, so a screen is settled in ~0.28s instead of a long spring tail. */
export const IOS_EASE = [0.32, 0.72, 0, 1] as const;
export const NAV_SPRING = { type: "tween", duration: 0.28, ease: IOS_EASE } as const;
/** Leaving is quicker than arriving, so the next screen is never waiting on the old one. */
export const NAV_EXIT = { type: "tween", duration: 0.16, ease: [0.4, 0, 1, 1] } as const;

/* ------------------------------------------------------------------ sheet */

// Counts open sheets so an exiting sheet can't release the scroll lock a newly opened one still needs.
let scrollLocks = 0;

export function Sheet({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const reduce = useReducedMotion();
  const drag = useDragControls();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    document.addEventListener("keydown", onKey);
    if (scrollLocks++ === 0) document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      if (--scrollLocks === 0) document.body.style.overflow = "";
    };
  }, []);
  return (
    <motion.div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
      <motion.div className={`sheet ${wide ? "sheet-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}
        initial={reduce ? { opacity: 0 } : { y: "100%", opacity: 1 }} animate={{ y: 0, opacity: 1 }}
        exit={reduce ? { opacity: 0, transition: { duration: 0.12 } } : { y: "105%", opacity: 1, transition: { duration: 0.22, ease: [0.4, 0, 1, 1] } }}
        transition={reduce ? { duration: 0.15 } : { type: "tween", duration: 0.34, ease: IOS_EASE }}
        drag={reduce ? false : "y"} dragControls={drag} dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0.04, bottom: 0.7 }}
        dragListener={false} onDragEnd={(_, info) => (info.offset.y > 110 || info.velocity.y > 600) && onClose()}>
        <div className="sheet-drag" onPointerDown={(e) => drag.start(e)} style={{ touchAction: "none" }}>
          <div className="sheet-grab" aria-hidden />
          <header className="sheet-head">
            <h2>{title}</h2>
            <button className="nav-glass-btn sheet-close" onClick={onClose} onPointerDown={(e) => e.stopPropagation()} aria-label="Close"><X size={18} strokeWidth={2.4} /></button>
          </header>
        </div>
        <div className="sheet-body">{children}</div>
      </motion.div>
    </motion.div>
  );
}

/** Renders a Sheet with enter/exit animation when `open` is truthy. */
export function SheetIf({ open, ...props }: { open: unknown; title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return <AnimatePresence>{open ? <Sheet key="sheet" {...props} /> : null}</AnimatePresence>;
}

/* ----------------------------------------------------------------- inputs */

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label?: string;
}) {
  const id = useId();
  return (
    <div className="segmented" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={value === o.value} className={value === o.value ? "on" : ""} onClick={() => onChange(o.value)}>
          {value === o.value && <motion.span layoutId={`seg-${id}`} className="seg-lens lens" transition={SPRING} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} className={`toggle ${on ? "on" : ""}`} onClick={() => onChange(!on)}>
      <span className="knob lens" />
    </button>
  );
}

export function LensSlider({ value, min, max, step = 1, onChange, format, label }: {
  value: number; min: number; max: number; step?: number; onChange: (v: number) => void; format?: (v: number) => string; label: string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="row gap">
      <div className="slider grow" style={{ ["--v" as string]: `calc(22px + (100% - 44px) * ${pct / 100})` }}>
        <input type="range" aria-label={label} min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      </div>
      <span className="slider-out">{format ? format(value) : value}</span>
    </div>
  );
}

/* ------------------------------------------------------------ data bits */

export function Pill({ status }: { status: RentStatus }) {
  return <span className={`pill pill-${status}`}>{STATUS_LABEL[status]}</span>;
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <div className="empty-icon">{icon}</div>}
      <h3>{title}</h3>
      {children && <div className="empty-body">{children}</div>}
    </div>
  );
}

/** Animated number that eases from its previous value. */
export function CountUp({ value, format }: { value: number; format: (n: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(0);
  const reduce = useReducedMotion();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduce) {
      el.textContent = format(value);
      prev.current = value;
      return;
    }
    const controls = animate(prev.current, value, {
      duration: 0.5, ease: [0.2, 0.8, 0.2, 1],
      onUpdate: (v) => { el.textContent = format(Math.round(v)); },
    });
    prev.current = value;
    return () => controls.stop();
  }, [value, format, reduce]);
  return <span ref={ref}>{format(value)}</span>;
}

export function Ring({ value, size = 172, stroke = 14, children }: { value: number; size?: number; stroke?: number; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  const gid = useId().replace(/:/g, "");
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <defs>
          <linearGradient id={`rg${gid}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" style={{ stopColor: "color-mix(in oklab, var(--accent) 50%, white)" }} />
            <stop offset="1" style={{ stopColor: "var(--accent)" }} />
          </linearGradient>
          <filter id={`rf${gid}`} x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="5" /></filter>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" style={{ stroke: "var(--ring-track)" }} strokeWidth={stroke} />
        <motion.circle cx={size / 2} cy={size / 2} r={r} fill="none" style={{ stroke: "var(--accent)" }} strokeOpacity={0.35} strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={c} filter={`url(#rf${gid})`} transform={`rotate(-90 ${size / 2} ${size / 2})`}
          initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - v) }} transition={{ duration: 0.7, ease: [0.2, 0.8, 0.2, 1] }} />
        <motion.circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={`url(#rg${gid})`} strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={c} transform={`rotate(-90 ${size / 2} ${size / 2})`}
          initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - v) }} transition={{ duration: 0.7, ease: [0.2, 0.8, 0.2, 1] }} />
        <circle cx={size / 2} cy={size / 2} r={r - stroke / 2 - 4} fill="none" style={{ stroke: "var(--glass-spec)" }} strokeOpacity={0.5} strokeWidth={1} />
      </svg>
      <div className="ring-center">{children}</div>
    </div>
  );
}

export function QR({ value, size = 132, className }: { value: string; size?: number; className?: string }) {
  const [src, setSrc] = useState<string>("");
  useEffect(() => {
    let live = true;
    // The QR library loads on first use, keeping it out of the startup bundle.
    import("qrcode").then((m) => m.default.toDataURL(value, { margin: 1, width: size * 2, errorCorrectionLevel: "M", color: { dark: "#10201f", light: "#ffffff" } }))
      .then((s) => live && setSrc(s))
      .catch(() => setSrc(""));
    return () => { live = false; };
  }, [value, size]);
  return src ? <img className={`qr ${className ?? ""}`} src={src} width={size} height={size} alt="QR code" /> : <div className="qr" style={{ width: size, height: size }} />;
}

export function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2800);
    return () => clearTimeout(t);
  }, [message, onDone]);
  return (
    <motion.div className="toast" role="status" initial={{ y: -36, opacity: 0, scale: 0.8 }} animate={{ y: 0, opacity: 1, scale: 1 }}
      exit={{ y: -24, opacity: 0, scale: 0.9, transition: { duration: 0.18 } }} transition={LENS_SPRING}>
      <CheckCircle2 size={18} /> {message}
    </motion.div>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className="logo">
      <defs>
        <radialGradient id={`lg${id}`} cx="30%" cy="20%" r="90%">
          <stop offset="0" style={{ stopColor: "color-mix(in oklab, var(--accent) 45%, white)" }} />
          <stop offset=".6" style={{ stopColor: "var(--accent)" }} />
          <stop offset="1" style={{ stopColor: "color-mix(in oklab, var(--accent) 70%, black)" }} />
        </radialGradient>
      </defs>
      <rect width="64" height="64" rx="20" fill={`url(#lg${id})`} />
      <rect x="1" y="1" width="62" height="62" rx="19" fill="none" stroke="#ffffff" strokeOpacity="0.5" strokeWidth="1.5" />
      <path d="M14 44V28l18-12 18 12v16" fill="none" stroke="#f4fbfa" strokeWidth="5" strokeLinejoin="round" strokeLinecap="round" />
      <rect x="26" y="32" width="12" height="12" rx="3" fill="#f4fbfa" />
    </svg>
  );
}

/** Small courtyard motif used on passes and receipts. */
export function Jaali({ className }: { className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg className={className} viewBox="0 0 120 120" aria-hidden>
      <defs>
        <pattern id={`jaali${id}`} width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M10 0 L20 10 L10 20 L0 10 Z" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <circle cx="10" cy="10" r="2.2" fill="currentColor" />
        </pattern>
      </defs>
      <rect width="120" height="120" fill={`url(#jaali${id})`} />
    </svg>
  );
}

/* ------------------------------------------------------------ atmosphere */

// Edge-weighted displacement map: neutral in the middle, bending light at the rim like a glass bead.
const DISPLACEMENT_MAP = "data:image/svg+xml," + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100" preserveAspectRatio="none">
    <defs>
      <linearGradient id="r" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#f00"/></linearGradient>
      <linearGradient id="g" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#0f0"/></linearGradient>
      <filter id="b"><feGaussianBlur stdDeviation="7"/></filter>
    </defs>
    <rect width="100" height="100" fill="url(#r)"/>
    <rect width="100" height="100" fill="url(#g)" style="mix-blend-mode:screen"/>
    <rect x="12" y="16" width="76" height="68" rx="30" fill="#808080" filter="url(#b)"/>
  </svg>`,
);

export function GlassDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden focusable="false">
      <filter id="lg-refract" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
        <feImage href={DISPLACEMENT_MAP} x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="map" />
        <feDisplacementMap in="SourceGraphic" in2="map" scale="22" xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </svg>
  );
}

export function Atmosphere() {
  // Pauses the drifting background while the page scrolls (see .is-scrolling in styles.css).
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const root = document.documentElement;
    const onScroll = () => {
      if (!t) root.classList.add("is-scrolling");
      clearTimeout(t);
      t = setTimeout(() => { root.classList.remove("is-scrolling"); t = undefined; }, 160);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); clearTimeout(t); };
  }, []);
  return (
    <div className="atmo" aria-hidden>
      <i /><i /><i /><i />
      <svg className="jaali-field"><defs><pattern id="jf" width="44" height="44" patternUnits="userSpaceOnUse">
        <path d="M22 2 L42 22 L22 42 L2 22 Z" fill="none" stroke="currentColor" strokeWidth="1" />
        <circle cx="22" cy="22" r="2" fill="currentColor" />
      </pattern></defs><rect width="100%" height="100%" fill="url(#jf)" /></svg>
    </div>
  );
}

export function SkeletonApp() {
  return (
    <div className="skeleton-app" aria-busy="true" aria-label="Loading">
      <div className="sk" style={{ height: 22, width: 120 }} />
      <div className="sk" style={{ height: 48, width: "min(340px, 70%)" }} />
      <div className="home-grid">
        <div className="sk" style={{ height: 220 }} />
        <div className="tiles">{[0, 1, 2, 3].map((i) => <div key={i} className="sk" style={{ height: 100 }} />)}</div>
      </div>
      <div className="sk" style={{ height: 260 }} />
    </div>
  );
}

/** Shown on features that need the newer database migration. */
export function NeedsSchema({ feature }: { feature: string }) {
  return (
    <div className="card">
      <Empty icon={<Database />} title="Database update pending">
        <p>{feature} needs the latest Aangan database migration. Set <code>SUPABASE_DB_URL</code> for the site and redeploy, or run <code>npm run db:migrate</code> once with it set locally. Your existing data is untouched.</p>
      </Empty>
    </div>
  );
}

export function Stagger({ children, className, as = "ul" }: { children: ReactNode; className?: string; as?: "ul" | "div" }) {
  const C = as === "ul" ? motion.ul : motion.div;
  return (
    <C className={className} initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.02 } } }}>
      {children}
    </C>
  );
}

export const itemVariants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 380, damping: 32 } },
} as const;

/* ------------------------------------------------------------ swipe row */

export type SwipeAction = { label: string; icon: ReactNode; tone: "ok" | "accent" | "warn" | "bad"; onAction: () => void; href?: string };

/**
 * iOS 27 / Telegram chat-list swipe actions: drag a row left to reveal its actions, or swipe far to fire the first one.
 * Rows stay plain, tappable and keyboard-reachable; the actions are also reachable as normal buttons when revealed.
 */
export function SwipeRow({ actions, children, className }: { actions: SwipeAction[]; children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  const controls = useAnimationControls();
  const x = useMotionValue(0);
  // The actions only take up the space the row has uncovered, so nothing shows through the glass row at rest.
  const revealed = useTransform(x, (v) => Math.max(0, -v));
  const [open, setOpen] = useState(false);
  const dragged = useRef(false);
  const width = actions.length * 76;
  const settle = (to: number) => { controls.start({ x: to }, { type: "spring", stiffness: 520, damping: 42 }); setOpen(to !== 0); };
  const fire = (a: SwipeAction) => { settle(0); if (a.href) window.open(a.href, "_blank", "noopener"); else a.onAction(); };
  return (
    <li className={`swipe ${open ? "open" : ""} ${className ?? ""}`}>
      <motion.div className="swipe-actions" style={{ width: revealed }} aria-hidden={!open}>
        {actions.map((a) => (
          <button key={a.label} type="button" tabIndex={open ? 0 : -1} className={`swipe-act tone-${a.tone}`} onClick={() => fire(a)}>
            {a.icon}<span>{a.label}</span>
          </button>
        ))}
      </motion.div>
      <motion.div className="swipe-front" style={{ x }} animate={controls} drag={reduce ? false : "x"} dragDirectionLock
        dragConstraints={{ left: -width, right: 0 }} dragElastic={{ left: 0.35, right: 0.05 }} dragMomentum={false}
        onDragStart={() => { dragged.current = true; }}
        onDragEnd={(_, info) => {
          const at = x.get();
          // Full swipe: pulled well past the actions, or flicked hard once they are already uncovered.
          if (at < -width - 40 || (info.velocity.x < -1400 && at < -width * 0.8)) { haptic(12); return fire(actions[0]); }
          settle(at < -width / 2 || info.velocity.x < -400 ? -width : 0);
        }}
        onClickCapture={(e) => {
          // The click that ends a drag is not a tap on the row's contents.
          if (dragged.current) { dragged.current = false; e.preventDefault(); e.stopPropagation(); return; }
          if (open) { e.preventDefault(); e.stopPropagation(); settle(0); }
        }}
        onPointerDown={() => { dragged.current = false; }}>
        {children}
      </motion.div>
    </li>
  );
}
