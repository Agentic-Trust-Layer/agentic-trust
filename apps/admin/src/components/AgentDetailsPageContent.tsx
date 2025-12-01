'use client';

import { Box, Container } from '@mui/material';
import { Header } from '@/components/Header';
import AgentDetailsTabs, {
  type AgentDetailsFeedbackSummary,
  type AgentDetailsValidationsSummary,
} from '@/components/AgentDetailsTabs';
import type { AgentsPageAgent } from '@/components/AgentsPage';
import BackToAgentsButton from '@/components/BackToAgentsButton';
import { useAuth } from '@/components/AuthProvider';

type AgentDetailsPageContentProps = {
  agent: AgentsPageAgent;
  feedbackItems: unknown[];
  feedbackSummary: AgentDetailsFeedbackSummary;
  validations: AgentDetailsValidationsSummary | null;
  heroImageSrc: string;
  heroImageFallbackSrc: string;
  displayDid: string;
  chainId: number;
  ownerDisplay: string;
  validationSummaryText: string;
  reviewsSummaryText: string;
};

export default function AgentDetailsPageContent({
  agent,
  feedbackItems,
  feedbackSummary,
  validations,
  heroImageSrc,
  heroImageFallbackSrc,
  displayDid,
  chainId,
  ownerDisplay,
  validationSummaryText,
  reviewsSummaryText,
}: AgentDetailsPageContentProps) {
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
          display: 'flex',
          flexDirection: 'column',
          gap: '1.75rem',
        }}
      >
        <BackToAgentsButton />
        <Box
          sx={{
            borderRadius: '20px',
            p: { xs: 2, md: 4 },
            border: '1px solid rgba(15,23,42,0.08)',
            background:
              'linear-gradient(135deg, rgba(15,23,42,0.9) 0%, rgba(15,23,42,0.6) 55%, rgba(37,99,235,0.7) 100%)',
            color: '#f8fafc',
            display: 'flex',
            gap: { xs: '1.5rem', md: '2.5rem' },
            flexWrap: 'wrap',
            alignItems: 'stretch',
            boxShadow: '0 18px 45px rgba(15,23,42,0.25)',
          }}
        >
          <Box sx={{ flex: '1 1 360px', minWidth: 0 }}>
            <p
              style={{
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                fontSize: '0.8rem',
                color: 'rgba(248,250,252,0.7)',
                marginBottom: '0.35rem',
              }}
            >
              Agent Details
            </p>
            <h1
              style={{
                margin: 0,
                fontSize: '2.5rem',
                lineHeight: 1.1,
              }}
            >
              {agent.agentName || `Agent #${agent.agentId}`}
            </h1>
            <p
              style={{
                margin: '0.5rem 0 0',
                fontSize: '1rem',
                color: 'rgba(248,250,252,0.8)',
                wordBreak: 'break-all',
              }}
            >
              {displayDid}
            </p>
            <div
              style={{
                marginTop: '1.25rem',
                display: 'flex',
                flexWrap: 'wrap',
                gap: '0.85rem',
              }}
            >
              {[
                { label: 'Chain', value: chainId.toString() },
                { label: 'Owner', value: ownerDisplay },
                { label: 'Validations', value: validationSummaryText },
                { label: 'Reputation', value: reviewsSummaryText },
              ].map((chip) => (
                <div
                  key={chip.label}
                  style={{
                    padding: '0.5rem 0.85rem',
                    borderRadius: '999px',
                    backgroundColor: 'rgba(15,23,42,0.5)',
                    border: '1px solid rgba(248,250,252,0.18)',
                    fontSize: '0.85rem',
                  }}
                >
                  <strong style={{ fontWeight: 600 }}>{chip.label}:</strong>{' '}
                  <span style={{ fontWeight: 500 }}>{chip.value}</span>
                </div>
              ))}
            </div>
            <div
              style={{
                marginTop: '1.75rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.4rem',
                fontSize: '0.95rem',
              }}
            >
              {agent.a2aEndpoint && (
                <div>
                  <span style={{ color: 'rgba(248,250,252,0.6)' }}>A2A:</span>{' '}
                  <a
                    href={agent.a2aEndpoint}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      color: '#bfdbfe',
                      textDecoration: 'none',
                      wordBreak: 'break-all',
                    }}
                  >
                    {agent.a2aEndpoint}
                  </a>
                </div>
              )}
              {agent.agentAccountEndpoint && (
                <div>
                  <span style={{ color: 'rgba(248,250,252,0.6)' }}>MCP:</span>{' '}
                  <a
                    href={agent.agentAccountEndpoint}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      color: '#bfdbfe',
                      textDecoration: 'none',
                      wordBreak: 'break-all',
                    }}
                  >
                    {agent.agentAccountEndpoint}
                  </a>
                </div>
              )}
            </div>
          </Box>
          <Box
            sx={{
              flex: '0 0 260px',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <div
              style={{
                width: '260px',
                height: '260px',
                borderRadius: '24px',
                overflow: 'hidden',
                border: '1px solid rgba(248,250,252,0.2)',
                boxShadow: '0 10px 30px rgba(15,23,42,0.35)',
                backgroundColor: 'rgba(15,23,42,0.4)',
              }}
            >
              <img
                src={heroImageSrc}
                alt={agent.agentName || `Agent #${agent.agentId}`}
                onError={(event) => {
                  if (event.currentTarget.src !== heroImageFallbackSrc) {
                    event.currentTarget.src = heroImageFallbackSrc;
                  }
                }}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  display: 'block',
                }}
              />
            </div>
          </Box>
        </Box>
        <AgentDetailsTabs
            agent={agent}
            feedbackItems={feedbackItems}
            feedbackSummary={feedbackSummary}
            validations={validations}
        />
      </Container>
    </Box>
  );
}

