import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { AnalyticsProvider } from '@/components/analytics';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'EV Charging',
  description: 'EV Charger Reservation System',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <AnalyticsProvider posthogKey={process.env.NEXT_PUBLIC_POSTHOG_KEY}>
          {children}
        </AnalyticsProvider>
      </body>
    </html>
  );
}
