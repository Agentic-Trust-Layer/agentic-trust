import type { Metadata } from 'next';
import './globals.css';
import dynamic from 'next/dynamic';

// Dynamically import providers to prevent SSR execution
const Web3AuthProvider = dynamic(
  () => import('@/components/Web3AuthProvider').then((mod) => mod.Web3AuthProvider),
  { ssr: false }
);

const WalletProvider = dynamic(
  () => import('@/components/WalletProvider').then((mod) => mod.WalletProvider),
  { ssr: false }
);

export const metadata: Metadata = {
  title: 'Agent Admin',
  description: 'Agent Administration - Create, Update, Delete, and Transfer Agents',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <WalletProvider>
          <Web3AuthProvider>
            {children}
          </Web3AuthProvider>
        </WalletProvider>
      </body>
    </html>
  );
}

