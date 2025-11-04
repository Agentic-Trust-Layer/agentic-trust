import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Agent Provider',
  description: 'Agent Provider with A2A endpoints',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

