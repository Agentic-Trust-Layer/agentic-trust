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
    openAgentSelectionModal,
  } = useAuth();

  const handleNavigateAgents = () => {
    // Check if we have a cached agent
    const CACHE_KEY = 'agentic-trust-selected-agent';
    const cached = typeof window !== 'undefined' ? localStorage.getItem(CACHE_KEY) : null;
    
    if (cached) {
      // Agent is cached, navigate directly
      router.push('/agents');
    } else if (isConnected) {
      // Show modal to select agent
      openAgentSelectionModal();
    } else {
      // If not connected, navigate directly (they can connect later)
      router.push('/agents');
    }
  };

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
          onNavigateAgents={handleNavigateAgents}
          onOpenAdminTools={() => router.push('/admin-tools?mode=create')}
          isConnected={isConnected}
        />
      </Container>
    </Box>
  );
}

