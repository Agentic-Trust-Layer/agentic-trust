'use client';

import { useRouter } from 'next/navigation';
import { Box, Container } from '@mui/material';
import { Header } from '@/components/Header';
import { HomePage } from '@/components/HomePage';
import { useAuth } from '@/components/AuthProvider';

export default function LandingPage() {
  const router = useRouter();
  const {
    isConnected,
    privateKeyMode,
    loading,
    walletAddress,
    openLoginModal,
    handleDisconnect,
  } = useAuth();

  return (
    <Box sx={{ bgcolor: 'background.default', minHeight: '100vh' }}>
      <Header
        displayAddress={walletAddress ?? null}
        privateKeyMode={privateKeyMode}
        isConnected={isConnected}
        onConnect={openLoginModal}
        onDisconnect={handleDisconnect}
        disableConnect={loading}
      />
      <Container
        maxWidth="lg"
        sx={{
          py: { xs: 4, md: 6 },
        }}
      >
        <HomePage
          onNavigateAgents={() => router.push('/agents')}
          onOpenAdminTools={() => router.push('/admin-tools?mode=create')}
          isConnected={isConnected}
        />
      </Container>
    </Box>
  );
}

