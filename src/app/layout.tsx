import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ToastProvider } from '@/components/ui';

export const metadata: Metadata = {
  title: 'ROYALWEB AUTOPILOT',
  description:
    'AI-powered multi-platform publishing, marketing distribution and content automation for ROYALWEB.',
  robots: { index: false, follow: false },
  applicationName: 'ROYALWEB AUTOPILOT',
};

export const viewport: Viewport = {
  themeColor: '#07070A',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
