import type { Metadata, Viewport } from 'next';
import { Fraunces, Hanken_Grotesk, IBM_Plex_Mono } from 'next/font/google';

import { Providers } from '@/components/providers';
import { ServiceWorkerRegister } from '@/components/pwa/service-worker-register';

import './globals.css';

const hanken = Hanken_Grotesk({
  subsets: ['latin'],
  variable: '--font-hanken',
  display: 'swap',
  weight: ['400', '500', '600', '700'],
});

const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  display: 'swap',
  axes: ['SOFT', 'opsz'],
  style: ['normal', 'italic'],
});

const ibmMono = IBM_Plex_Mono({
  subsets: ['latin'],
  variable: '--font-mono-ibm',
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

export const viewport: Viewport = {
  themeColor: '#e8dec7',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${hanken.variable} ${fraunces.variable} ${ibmMono.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-screen">
        <Providers>{children}</Providers>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
