"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

/**
 * Keeps a public results page current without the visitor reloading it.
 *
 * `router.refresh()` re-runs this route's server components against the
 * database and swaps in whatever changed, while every client component (the
 * standings subject/scope toggle, for instance) keeps its own state, so a
 * visitor mid-read does not get reset to the default view.
 *
 * Paused while the tab is not visible, so a results board left open in a
 * background tab does not poll the database for no one.
 */
export function AutoRefresh({ intervalMs = 15_000 }: { intervalMs?: number }) {
  const router = useRouter();

  React.useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);

  return null;
}
