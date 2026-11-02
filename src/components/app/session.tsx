"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { loadSession } from "@/lib/client";

type User = Awaited<ReturnType<typeof loadSession>>;
const Ctx = createContext<{ user: User; loading: boolean; refresh: () => Promise<void> }>({ user: null, loading: true, refresh: async () => undefined });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    setUser(await loadSession());
    setLoading(false);
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return <Ctx.Provider value={{ user, loading, refresh }}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);
