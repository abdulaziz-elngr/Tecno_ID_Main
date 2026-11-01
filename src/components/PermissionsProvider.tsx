"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { canOpenPath } from "@/lib/nav-access";

interface PermissionsValue {
  loaded: boolean;
  has: (key: string) => boolean;
  canOpen: (pathname: string) => boolean;
}

const PermissionsContext = createContext<PermissionsValue>({
  loaded: false,
  has: () => false,
  canOpen: () => false
});

export function usePermissions(): PermissionsValue {
  return useContext(PermissionsContext);
}

/**
 * Loads the signed-in user's permission keys once and (a) lets the sidebar hide
 * pages the user cannot use, (b) sends the user back to the dashboard when they
 * open such a page by typing its URL. The API routes enforce the same rules on
 * the server — this is only the friendly front door.
 */
export function PermissionsProvider({ children }: { children: ReactNode }) {
  const [keys, setKeys] = useState<Set<string> | null>(null);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    let alive = true;
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => {
        if (alive) setKeys(new Set<string>(me?.permissions ?? []));
      })
      .catch(() => {
        if (alive) setKeys(new Set());
      });
    return () => {
      alive = false;
    };
  }, []);

  const value = useMemo<PermissionsValue>(() => {
    const has = (key: string) => keys?.has(key) ?? false;
    return { loaded: keys !== null, has, canOpen: (p) => canOpenPath(p, has) };
  }, [keys]);

  useEffect(() => {
    if (value.loaded && !value.canOpen(pathname)) router.replace("/dashboard");
  }, [value, pathname, router]);

  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>;
}
