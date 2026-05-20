'use client';

import { useRouter } from 'next/navigation';
import * as React from 'react';

interface ExtractingAutoRefreshProps {
  /** Polling interval in ms. Defaults to 4s — fast enough to feel live,
   * slow enough not to hammer the RSC pipeline. */
  intervalMs?: number;
}

// Mounted by the Documents tab page when at least one document is in
// the "extracting" state. While mounted, it polls `router.refresh()`
// so the RSC re-fetches the documents list and the "Extracting…" chip
// flips to "Extracted" (or "Failed") without a manual reload. Unmounts
// itself the moment no docs are extracting — the parent removes it
// from the tree based on the live count it computed on the server.
export function ExtractingAutoRefresh({ intervalMs = 4000 }: ExtractingAutoRefreshProps) {
  const router = useRouter();

  React.useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);

  return null;
}
