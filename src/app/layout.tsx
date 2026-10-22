import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, DM_Mono } from 'next/font/google';

import { Providers } from '@/components/providers';
import { ServiceWorkerRegister } from '@/components/pwa/service-worker-register';
import { THEME_COLOR } from '@/lib/theme/preference';
import { getThemePreference } from '@/lib/theme/server';

import './globals.css';

// One family carries display and body: Bricolage's opsz axis tightens it at
// headline sizes and opens it up for running text.
const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-bricolage',
  display: 'swap',
  axes: ['opsz'],
});

// Codes, times and small labels.
const dmMono = DM_Mono({
  subsets: ['latin'],
  variable: '--font-dm-mono',
  display: 'swap',
  weight: ['400', '500'],
});

export const metadata: Metadata = {
  title: { default: 'Atlas', template: '%s · Atlas' },
  description: 'A self-hosted personal travel companion.',
  robots: { index: false, follow: false },
  icons: {
    icon: '/favicon.svg',
    // ?v matches manifest.ts ICON_REV — bump both when the icon art changes so
    // sticky OS/home-screen icon caches re-fetch instead of serving the old one.
    apple: '/apple-touch-icon.png?v=2',
  },
  // Sets the iOS home-screen title and standalone status-bar style. The
  // standalone launch itself comes from the manifest's display:standalone.
  appleWebApp: {
    capable: true,
    title: 'Atlas',
    statusBarStyle: 'default',
  },
};

// Browser-chrome colour follows the theme: pinned when the user chose one,
// otherwise one entry per OS scheme.
export async function generateViewport(): Promise<Viewport> {
  const preference = await getThemePreference();
  if (preference !== 'system') return { themeColor: THEME_COLOR[preference] };
  return {
    themeColor: [
      { media: '(prefers-color-scheme: light)', color: THEME_COLOR.light },
      { media: '(prefers-color-scheme: dark)', color: THEME_COLOR.dark },
    ],
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // `system` leaves data-theme off so the CSS media query decides; an
  // explicit choice pins it. Read server-side so the first paint is right.
  const preference = await getThemePreference();
  return (
    <html
      lang="en"
      className={`${bricolage.variable} ${dmMono.variable}`}
      data-theme={preference === 'system' ? undefined : preference}
      suppressHydrationWarning
    >
      <body className="min-h-screen">
        <Providers>{children}</Providers>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
