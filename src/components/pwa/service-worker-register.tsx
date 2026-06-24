'use client';

import { useEffect } from 'react';

/**
 * Registers the Atlas service worker (public/sw.js).
 *
 * Production-only: a caching service worker in `next dev` fights Turbopack's
 * HMR and serves stale chunks. To exercise install/offline locally, run a
 * production build (`pnpm build && pnpm start`). Registration is best-effort —
 * the app is fully functional without it.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Swallow: the SW is an enhancement, not a requirement.
      });
    };

    if (document.readyState === 'complete') {
      register();
    } else {
      window.addEventListener('load', register, { once: true });
      return () => window.removeEventListener('load', register);
    }
  }, []);

  return null;
}
