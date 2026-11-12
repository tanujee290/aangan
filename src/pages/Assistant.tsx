import { Fragment, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowUp, Copy, RotateCcw, Sparkles, Square } from "lucide-react";
import { Jaali } from "../components/ui";
import { haptic } from "../lib/touch";
import { useData } from "../state/data";
import { useNotify } from "../state/notify";
import { ask, workspaceSnapshot, type ChatTurn } from "../lib/assist";

const SUGGESTIONS = [
  "Who's overdue this month, and by how much?",
  "Draft a polite but firm final reminder for the most overdue tenant",
  "Summarise the last 12 months for my income tax return",
  "Which property earns the most after expenses?",
  "What needs my attention this week?",
  "Which leases end soon, and what should I do about them?",
];
const STORE = "angan.assistant";

/** Light formatting for replies: **bold** and "- " bullets. Everything else stays plain text. */
function Rich({ text }: { text: string }) {
  const inline = (s: string): ReactNode[] => s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>);
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) blocks.push(<ul key={`l${blocks.length}`} className="bubble-list">{list.map((li, i) => <li key={i}>{inline(li)}</li>)}</ul>);
    list = [];
  };
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*[-*•]\s+(.*)$/);
    if (m) { list.push(m[1]); continue; }
    flush();
    blocks.push(line.trim() ? <p key={`p${blocks.length}`}>{inline(line)}</p> : <span key={`s${blocks.length}`} className="bubble-gap" />);
  }
  flush();
  return <>{blocks}</>;
}

export default function AssistantPage() {
  const d = useData();
  const notify = useNotify();
  const [turns, setTurns] = useState<ChatTurn[]>(() => {
    try { return JSON.parse(sessionStorage.getItem(STORE) ?? "[]"); } catch { return []; }
  });
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  const abort = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  // Telegram turns its gradient wallpaper a step on every message sent.
  const [turn, setTurn] = useState(0);
  // Bubbles already on screen when the page opens appear in place; only new ones fly in.
  const seen = useRef(turns.length);

  useEffect(() => { sessionStorage.setItem(STORE, JSON.stringify(turns)); }, [turns]);
  useEffect(() => { end.current?.scrollIntoView({ block: "end", behavior: "smooth" }); }, [turns]);
  useEffect(() => () => abort.current?.abort(), []);

  async function send(text: string) {
    const q = text.trim();
    if (!q || streaming) return;
    setError("");
    setDraft("");
    setTurn((t) => t + 1);
    haptic(10);
    const history: ChatTurn[] = [...turns, { role: "user", content: q }];
    setTurns([...history, { role: "assistant", content: "" }]);
    setStreaming(true);
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      const answer = await ask(history, workspaceSnapshot(d), (t) => {
        setTurns((cur) => [...cur.slice(0, -1), { role: "assistant", content: t }]);
      }, ctrl.signal);
      if (!answer.trim()) throw new Error("No answer came back. Please try again.");
    } catch (e) {
      const stopped = ctrl.signal.aborted;
      setTurns((cur) => {
        const last = cur[cur.length - 1];
        if (last?.role === "assistant" && last.content.trim()) return stopped ? [...cur.slice(0, -1), { ...last, content: last.content + " …" }] : cur;
        return cur.slice(0, -2); // drop the unanswered question so it can be retried
      });
      if (!stopped) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
        setDraft(q);
      }
    } finally {
      setStreaming(false);
      abort.current = null;
    }
  }

  function onSubmit(e: FormEvent) { e.preventDefault(); send(draft); }
  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(draft); }
  }

  return (
    <div className="page narrow assistant tg-chat" style={{ ["--turn" as string]: turn }}>
      <div className="chat-wall" aria-hidden><div className="wall-mesh"><i /><i /><i /><i /></div><Jaali className="wall-pattern" /></div>
      <div className="page-head">
        <div><span className="eyebrow">Ask about your rentals</span><h1 className="display">Assistant</h1></div>
        {turns.length > 0 && <button className="btn ghost small" onClick={() => { abort.current?.abort(); seen.current = 0; setTurns([]); setError(""); }} disabled={streaming}><RotateCcw size={14} /> New chat</button>}
      </div>

      {turns.length === 0 ? (
        <div className="card assistant-intro">
          <span className="qi-icon"><Sparkles size={20} /></span>
          <h2>Ask anything about your rent, tenants and spending</h2>
          <p className="muted small">Answers come only from this workspace's records. Drafts are for you to review before sending. Check figures before filing taxes.</p>
          <div className="suggest">{SUGGESTIONS.map((s) => <button key={s} onClick={() => send(s)}>{s}</button>)}</div>
        </div>
      ) : (
        <div className="chat" aria-live="polite">
          {turns.map((t, i) => {
            const last = i === turns.length - 1;
            const fresh = i >= seen.current && !reduce;
            const fly = { type: "spring", stiffness: 520, damping: 36, mass: 0.8 } as const;
            return t.role === "user" ? (
              <motion.div key={i} className={`bubble me ${turns[i + 1]?.role === "user" ? "" : "tail"}`} style={{ transformOrigin: "100% 100%" }}
                initial={fresh ? { opacity: 0, y: 60, scale: 0.6, x: 20 } : false} animate={{ opacity: 1, y: 0, scale: 1, x: 0 }} transition={fly}>{t.content}</motion.div>
            ) : (
              <motion.div key={i} className={`bubble ai tail ${streaming && last ? "typing" : ""}`} style={{ transformOrigin: "0% 100%" }}
                initial={fresh ? { opacity: 0, scale: 0.85, y: 12 } : false} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ ...fly, delay: fresh ? 0.12 : 0 }}>
                {t.content ? <Rich text={t.content} /> : <span className="typing-dots" aria-label="Reading your workspace"><i /><i /><i /></span>}
                {!(streaming && last) && t.content && (
                  <button className="bubble-copy" aria-label="Copy answer" title="Copy" onClick={() => navigator.clipboard.writeText(t.content).then(() => notify("Copied"), () => notify("Couldn't copy"))}><Copy size={13} /></button>
                )}
              </motion.div>
            );
          })}
          <div ref={end} />
        </div>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}

      <form className="composer" onSubmit={onSubmit}>
        <textarea rows={1} value={draft} placeholder="e.g. How much rent is still outstanding?" maxLength={4000}
          onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} aria-label="Your question" />
        <AnimatePresence mode="popLayout" initial={false}>
          {streaming
            ? <motion.button key="stop" type="button" className="send-orb stop" onClick={() => abort.current?.abort()} aria-label="Stop"
                initial={{ scale: 0.3, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.3, opacity: 0 }}><Square size={14} fill="currentColor" /></motion.button>
            : <motion.button key="send" className={`send-orb ${draft.trim() ? "ready" : ""}`} disabled={!draft.trim()} aria-label="Send"
                initial={{ scale: 0.3, opacity: 0 }} animate={{ scale: draft.trim() ? 1 : 0.86, opacity: 1 }} exit={{ scale: 0.3, opacity: 0 }}
                transition={{ type: "spring", stiffness: 600, damping: 22 }}><ArrowUp size={20} strokeWidth={2.6} /></motion.button>}
        </AnimatePresence>
      </form>
      {turns.length > 0 && !streaming && <div className="suggest">{SUGGESTIONS.slice(0, 3).map((s) => <button key={s} onClick={() => send(s)}>{s}</button>)}</div>}
    </div>
  );
}
