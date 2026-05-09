import 'fumadocs-ui/style.css';
import './globals.css';

import { i18nUI } from '@/lib/layout.shared';
import { RootProvider } from 'fumadocs-ui/provider/next';
import type { Metadata } from 'next';
import { Outfit } from 'next/font/google';

// export const viewport: Viewport = {
//   themeColor: '#1E5BFF',
// };

export const metadata: Metadata = {
  metadataBase: new URL('https://fluo.ayden94.com'),
  title: {
    default: 'fluo',
    template: '%s | fluo',
  },
  description: 'Official documentation for the fluo backend framework.',
  icons: {
    icon: '/favicon.ico',
  },
};

const outfit = Outfit({
  subsets: ['latin'],
  variable: '--font-display',
});

export default async function Layout({ params, children }: LayoutProps<'/[lang]'>) {
  const { lang } = await params;

  return (
    <html lang={lang} className={`${outfit.variable} ${outfit.className}`} suppressHydrationWarning>
      <body
        style={{
          display: 'flex',
          flexDirection: 'column',
          minHeight: '100vh',
        }}
      >
        <RootProvider i18n={i18nUI.provider(lang)}>{children}</RootProvider>
      </body>
    </html>
  );
}
