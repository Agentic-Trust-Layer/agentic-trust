import type { Metadata } from 'next';
import './globals.css';
import dynamic from 'next/dynamic';
import { ThemeRegistry } from '@/lib/ThemeRegistry';

import { AuthProvider } from '@/components/AuthProvider';
import { AgentsProvider } from '@/context/AgentsContext';
import { OwnedAgentsProvider } from '@/context/OwnedAgentsContext';

// Dynamically import providers to prevent SSR execution
const Web3AuthProvider = dynamic(
  () => import('@/components/Web3AuthProvider').then((mod) => mod.Web3AuthProvider),
  { ssr: false },
);

const WalletProvider = dynamic(
  () => import('@/components/WalletProvider').then((mod) => mod.WalletProvider),
  { ssr: false },
);

export const metadata: Metadata = {
  title: 'Agent Explorer',
  description: 'Agent Explorer - Create, Update, Delete, and Transfer Agents',
  icons: {
    icon: '/8004AgentTabIcon.png',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <ThemeRegistry>
          <Web3AuthProvider>
            <WalletProvider>
              <AuthProvider>
                <OwnedAgentsProvider>
                  <AgentsProvider>{children}</AgentsProvider>
                </OwnedAgentsProvider>
              </AuthProvider>
            </WalletProvider>
          </Web3AuthProvider>
        </ThemeRegistry>
      </body>
    </html>
  );
}
