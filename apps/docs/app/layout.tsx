import 'fumadocs-ui/style.css';
import './globals.css';

import { RootProvider } from 'fumadocs-ui/provider/next';
import type { Metadata } from 'next';

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

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        style={{
          display: 'flex',
          flexDirection: 'column',
          minHeight: '100dvh',
        }}
      >
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
