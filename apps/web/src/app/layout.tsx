import type { Metadata } from 'next';
import './globals.css';
import { ClientInitializer } from './client-initializer';

export const metadata: Metadata = {
  title: 'Agentic Trust',
  description: 'Agentic Trust Management Dashboard',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <ClientInitializer>{children}</ClientInitializer>
      </body>
    </html>
  );
}

