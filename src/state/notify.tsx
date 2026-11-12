import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { AnimatePresence } from "motion/react";
import { Toast } from "../components/ui";

const Ctx = createContext<(msg: string) => void>(() => {});

export function NotifyProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<{ text: string; key: number } | null>(null);
  const clear = useCallback(() => setMsg(null), []);
  const notify = useCallback((text: string) => setMsg({ text, key: Date.now() }), []);
  return (
    <Ctx.Provider value={notify}>
      {children}
      <div className="toast-wrap">
        <AnimatePresence mode="popLayout">{msg && <Toast key={msg.key} message={msg.text} onDone={clear} />}</AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}

export const useNotify = () => useContext(Ctx);
