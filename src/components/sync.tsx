import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CloudOff, CloudUpload, RotateCw, Trash2, X } from "lucide-react";
import { useAuth } from "../state/auth";
import { useData } from "../state/data";
import { useNotify } from "../state/notify";
import { discard, flush, offlineCapture, retry, useOutbox } from "../lib/outbox";
import { useOnline } from "../lib/pwa";
import { isOnline, isSimulatedOffline } from "../lib/network";
import { relativeTime } from "../lib/export";

/** Offline notice plus the queue of entries captured without a connection. */
export function SyncStatus() {
  const { session } = useAuth();
  const { refresh } = useData();
  const notify = useNotify();
  const online = useOnline();
  const items = useOutbox(session?.user.id);
  const [open, setOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const pending = items.filter((i) => !i.error).length;
  const failed = items.length - pending;
  const wasOnline = useRef(online);

  async function sync(quiet = false) {
    setSyncing(true);
    try {
      const n = await flush();
      if (n > 0) {
        await refresh();
        notify(`Synced ${n} entr${n === 1 ? "y" : "ies"} saved offline`);
      } else if (!quiet && isOnline()) notify("Nothing new to sync");
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    if (!offlineCapture || !session) return;
    if (online && (pending > 0)) void sync(true);
    if (online && !wasOnline.current) notify("Back online");
    wasOnline.current = online;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, session?.user.id, pending > 0]);

  if (!offlineCapture) return null;
  return (
    <>
      <AnimatePresence initial={false}>
        {(!online || items.length > 0) && (
          <motion.div className={`sync-bar ${online ? "" : "offline"}`} role="status"
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
            {online ? <CloudUpload size={16} /> : <CloudOff size={16} />}
            <span className="grow small">
              {!online && <strong>{isSimulatedOffline() ? "Simulated outage. " : "You're offline. "}</strong>}
              {!online && items.length === 0 && "New payments, expenses and tasks are saved on this device and sync when you reconnect."}
              {items.length > 0 && <>{pending > 0 && `${pending} waiting to sync`}{pending > 0 && failed > 0 && " · "}{failed > 0 && <span className="neg">{failed} need attention</span>}</>}
            </span>
            {items.length > 0 && <button className="btn small ghost" onClick={() => setOpen((o) => !o)}>{open ? "Hide" : "Review"}</button>}
            {online && pending > 0 && <button className="btn small" onClick={() => sync()} disabled={syncing}><RotateCw size={14} className={syncing ? "spin" : ""} /> Sync now</button>}
          </motion.div>
        )}
      </AnimatePresence>
      {open && items.length > 0 && (
        <div className="card sync-list">
          <div className="card-head"><h2>Saved on this device</h2><button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close"><X size={16} /></button></div>
          <ul className="list">
            {items.map((i) => (
              <li key={i.id} className="list-row">
                <div className="grow">
                  <strong>{i.label}</strong>
                  <small className={i.error ? "neg" : "muted"}>{i.kind} · captured {relativeTime(i.created_at)}{i.error ? ` · ${i.error}` : ""}</small>
                </div>
                {i.error && <button className="btn small" onClick={() => retry(i.id).then(() => refresh())}>Retry</button>}
                <button className="icon-btn" aria-label="Discard" onClick={() => confirm(`Discard “${i.label}”? It was never saved to your workspace.`) && discard(i.id)}><Trash2 size={15} /></button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
