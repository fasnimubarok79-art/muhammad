"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

// The single toast implementation in the app.
type Toast = { id: number; title: string; body?: string; tone: "info" | "success" | "error" };
const Ctx = createContext<(t: Omit<Toast, "id">) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs.slice(-3), { ...t, id }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), t.tone === "error" ? 7000 : 4000);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div aria-live="polite" className="fixed bottom-4 right-4 z-50 flex w-[min(360px,calc(100vw-32px))] flex-col gap-2">
        {items.map((t) => (
          <div key={t.id} role={t.tone === "error" ? "alert" : "status"} className="card shadow-float px-4 py-3">
            <div className="flex items-center gap-2 text-[14px] font-semibold">
              <span className={`h-2 w-2 rounded-full ${t.tone === "error" ? "bg-danger" : t.tone === "success" ? "bg-system" : "bg-muted"}`} />
              {t.title}
            </div>
            {t.body && <p className="mt-1 text-[13px] text-muted">{t.body}</p>}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  return useContext(Ctx);
}
