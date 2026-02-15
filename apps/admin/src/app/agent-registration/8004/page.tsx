'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useOwnedAgents } from '@/context/OwnedAgentsContext';
import { useWallet } from '@/components/WalletProvider';
import { Header } from '@/components/Header';
import { useAuth } from '@/components/AuthProvider';
import type { Address } from 'viem';
import { createAgentWithWallet, getCounterfactualSmartAccountAddressByAgentName, createAgentDirect, getDeployedAccountClientByAgentName } from '@agentic-trust/core/client';
import type { Chain } from 'viem';
import {
  getEnsOrgName,
  getSupportedChainIds,
  getChainDisplayMetadata,
  getChainById,
  getChainIdHex as getChainIdHexUtil,
  DEFAULT_CHAIN_ID,
  getChainBundlerUrl,
} from '@agentic-trust/core/server';
import { getClientBundlerUrl } from '@/lib/clientChainEnv';
import { ensureWeb3AuthChain } from '@/lib/web3auth';
import { buildDidEnsFromAgentAndOrg } from '@/app/api/names/_lib/didEns';
import { keccak256, toHex } from "viem";
import { AGENT_CATEGORY_OPTIONS, SUPPORTED_TRUST_MECHANISMS } from '@/models/agentRegistration';

const CREATE_STEPS = ['Name', 'Information', 'Taxonomy', 'Protocols', 'Review & Register'] as const;
const REGISTRATION_PROGRESS_DURATION_MS = 60_000;
const REGISTRATION_UPDATE_INTERVAL_MS = 200;

const CHAIN_SUFFIX_MAP: Record<number, string> = {
  11155111: 'SEPOLIA',
  84532: 'BASE_SEPOLIA',
  11155420: 'OPTIMISM_SEPOLIA',
  59144: 'LINEA',
};

const getEnvVarHints = (chainId: number) => {
  const suffix = CHAIN_SUFFIX_MAP[chainId];
  if (!suffix) return null;
  return {
    rpcClient: `NEXT_PUBLIC_AGENTIC_TRUST_RPC_URL_${suffix}`,
    rpcServer: `AGENTIC_TRUST_RPC_URL_${suffix}`,
    bundlerClient: `NEXT_PUBLIC_AGENTIC_TRUST_BUNDLER_URL_${suffix}`,
    bundlerServer: `AGENTIC_TRUST_BUNDLER_URL_${suffix}`,
  };
};

const formatAgentSubdomain = (name?: string): string => {
  if (!name) return '';
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
};

const buildDefaultAgentUrl = (name?: string): string => {
  const slug = formatAgentSubdomain(name);
  return slug ? `https://${slug}.8004-agent.io` : '';
};

export default function AgentRegistrationPage() {
  // Get consolidated wallet state from useWallet hook
  const { 
    connected: eoaConnected, 
    address: eoaAddress, 
    eip1193Provider,
    privateKeyMode,
    loading,
  } = useWallet();
  const {
    isConnected: authConnected,
    privateKeyMode: authPrivateKeyMode,
    loading: authLoading,
    openLoginModal,
    handleDisconnect: authHandleDisconnect,
  } = useAuth();

  const router = useRouter();
  const { refreshOwnedAgents } = useOwnedAgents();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [registrationCompleteOpen, setRegistrationCompleteOpen] = useState(false);
  const [registrationCompleteDetails, setRegistrationCompleteDetails] = useState<{
    agentId?: string;
    txHash?: string;
  } | null>(null);

  // Create agent form state
  const getDefaultImageUrl = () => (typeof window !== 'undefined' ? `${window.location.origin}/8004Agent.png` : '/8004Agent.png');
  const [createForm, setCreateForm] = useState({
    agentName: '',
    agentAccount: '',
    description: '',
    image: getDefaultImageUrl(),
    agentUrl: '',
  });
  const [supportedTrust, setSupportedTrust] = useState<string[]>([]);
  const [agentUrlAutofillDisabled, setAgentUrlAutofillDisabled] = useState(false);
  const [imagePreviewError, setImagePreviewError] = useState(false);
  const [imageUploadError, setImageUploadError] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const imageFileInputRef = useRef<HTMLInputElement | null>(null);
  const handleImagePreviewLoad = useCallback(() => setImagePreviewError(false), []);
  const handleImagePreviewError = useCallback(() => setImagePreviewError(true), []);
  const [ensExisting, setEnsExisting] = useState<{ image: string | null; url: string | null; description: string | null } | null>(null);
  const [createStep, setCreateStep] = useState(0);
  const [protocolSettings, setProtocolSettings] = useState<{
    protocol: 'A2A' | 'MCP' | null;
    a2aEndpoint: string;
    mcpEndpoint: string;
    a2aSkills: string[];
    a2aDomains: string[];
    mcpSkills: string[];
    mcpDomains: string[];
  }>({
    protocol: 'A2A',
    a2aEndpoint: '',
    mcpEndpoint: '',
    a2aSkills: [],
    a2aDomains: [],
    mcpSkills: [],
    mcpDomains: [],
  });
  const [registering, setRegistering] = useState(false);
  const [registerProgress, setRegisterProgress] = useState(0);
  const registerTimerRef = useRef<number | null>(null);
  const [uaid, setUaid] = useState<string | null>(null);
  const [uaidLoading, setUaidLoading] = useState(false);
  const [oasfSkills, setOasfSkills] = useState<Array<{ id: string; label: string; description?: string; category?: string }>>([]);
  const [oasfDomains, setOasfDomains] = useState<Array<{ id: string; label: string; description?: string; category?: string }>>([]);
  const [loadingSkills, setLoadingSkills] = useState(false);
  const [loadingDomains, setLoadingDomains] = useState(false);
  const [oasfSkillsError, setOasfSkillsError] = useState<string | null>(null);
  const [oasfDomainsError, setOasfDomainsError] = useState<string | null>(null);

  const renderCategorizedOptions = useCallback(
    (
      items: Array<{ id: string; label: string; category?: string }>,
      selectedIds: string[],
    ) => {
      const remaining = items.filter((it) => !selectedIds.includes(it.id));
      const groups = new Map<string, Array<{ id: string; label: string; category?: string }>>();

      for (const item of remaining) {
        const category = (item.category || 'Uncategorized').trim() || 'Uncategorized';
        const list = groups.get(category) || [];
        list.push(item);
        groups.set(category, list);
      }

      const categories = Array.from(groups.keys()).sort((a, b) => a.localeCompare(b));

      return categories.map((category) => {
        const list = (groups.get(category) || []).sort((a, b) => a.label.localeCompare(b.label));
        return (
          <optgroup key={category} label={category}>
            {list.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </optgroup>
        );
      });
    },
    [],
  );
  const [walletConfirmOpen, setWalletConfirmOpen] = useState(false);
  const [walletConfirmPayload, setWalletConfirmPayload] = useState<{
    chainLabel: string;
    chainId: number;
    ensName: string;
    agentAccount: string;
    agentUrl: string;
    a2aEndpoint: string | null;
    mcpEndpoint: string | null;
  } | null>(null);
  const pendingWalletActionRef = useRef<null | (() => Promise<void>)>(null);
  const totalCreateSteps = CREATE_STEPS.length;
  const isReviewStep = createStep === totalCreateSteps - 1;
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const onResize = () => {
      if (typeof window === 'undefined') return;
      setIsMobile(window.innerWidth <= 640);
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Fetch OASF skills and domains from API
  useEffect(() => {
    const fetchSkills = async () => {
      setLoadingSkills(true);
      setOasfSkillsError(null);
      try {
        const response = await fetch('/api/oasf/skills');
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          setOasfSkills([]);
          setOasfSkillsError(
            typeof (data as any)?.message === 'string'
              ? (data as any).message
              : 'Failed to load OASF skills from discovery endpoint.',
          );
          return;
        }

        if (Array.isArray((data as any).skills)) {
          const normalized = (data as any).skills
            .map((s: any) => {
              const idRaw = s?.id ?? s?.key;
              const id = idRaw == null ? '' : String(idRaw);
              const labelRaw = s?.label ?? s?.caption ?? s?.key ?? s?.id ?? '';
              return {
                id,
                label: String(labelRaw),
                description: typeof s?.description === 'string' ? s.description : undefined,
                category: typeof s?.category === 'string' ? s.category : undefined,
              };
            })
            .filter((s: any) => s.id);
          setOasfSkills(normalized);
        } else {
          setOasfSkills([]);
          setOasfSkillsError('OASF skills response is missing `skills` array.');
        }
      } catch (error) {
        console.warn('[AgentRegistration] Failed to fetch OASF skills:', error);
        setOasfSkills([]);
        setOasfSkillsError('Failed to load OASF skills from discovery endpoint.');
      } finally {
        setLoadingSkills(false);
      }
    };

    const fetchDomains = async () => {
      setLoadingDomains(true);
      setOasfDomainsError(null);
      try {
        const response = await fetch('/api/oasf/domains');
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          setOasfDomains([]);
          setOasfDomainsError(
            typeof (data as any)?.message === 'string'
              ? (data as any).message
              : 'Failed to load OASF domains from discovery endpoint.',
          );
          return;
        }

        if (Array.isArray((data as any).domains)) {
          const normalized = (data as any).domains
            .map((d: any) => {
              const idRaw = d?.id ?? d?.key;
              const id = idRaw == null ? '' : String(idRaw);
              const labelRaw = d?.label ?? d?.caption ?? d?.key ?? d?.id ?? '';
              return {
                id,
                label: String(labelRaw),
                description: typeof d?.description === 'string' ? d.description : undefined,
                category: typeof d?.category === 'string' ? d.category : undefined,
              };
            })
            .filter((d: any) => d.id);
          setOasfDomains(normalized);
        } else {
          setOasfDomains([]);
          setOasfDomainsError('OASF domains response is missing `domains` array.');
        }
      } catch (error) {
        console.warn('[AgentRegistration] Failed to fetch OASF domains:', error);
        setOasfDomains([]);
        setOasfDomainsError('Failed to load OASF domains from discovery endpoint.');
      } finally {
        setLoadingDomains(false);
      }
    };

    fetchSkills();
    fetchDomains();
  }, []);
  const getStepLabel = useCallback(
    (label: (typeof CREATE_STEPS)[number]) => {
      if (!isMobile) return label;
      if (label === 'Information') return 'Info';
      if (label === 'Taxonomy') return 'Taxon.';
      if (label === 'Protocols') return "Prot's";
      if (label === 'Review & Register') return 'Review';
      return label;
    },
    [isMobile],
  );

  const resetRegistrationProgress = useCallback(() => {
    if (registerTimerRef.current) {
      clearInterval(registerTimerRef.current);
      registerTimerRef.current = null;
    }
    setRegistering(false);
    setRegisterProgress(0);
  }, []);

  const startRegistrationProgress = useCallback(() => {
    if (registerTimerRef.current) {
      clearInterval(registerTimerRef.current);
      registerTimerRef.current = null;
    }
    setRegistering(true);
    setRegisterProgress(0);
    if (typeof window === 'undefined') {
      return;
    }
    const startTime = Date.now();
    registerTimerRef.current = window.setInterval(() => {
      const elapsed = Date.now() - startTime;
      const pct = Math.min(100, (elapsed / REGISTRATION_PROGRESS_DURATION_MS) * 100);
      setRegisterProgress(pct);
      if (pct >= 100 && registerTimerRef.current) {
        clearInterval(registerTimerRef.current);
        registerTimerRef.current = null;
      }
    }, REGISTRATION_UPDATE_INTERVAL_MS);
  }, []);

  const openCompletionModal = useCallback((details: { agentId?: string; txHash?: string }) => {
    setRegistrationCompleteDetails(details);
    setRegistrationCompleteOpen(true);
  }, []);

  useEffect(() => {
    return () => resetRegistrationProgress();
  }, [resetRegistrationProgress]);

  // Ensure absolute default image URL on the client
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    if (createForm.image === '/8004Agent.png') {
      setCreateForm(prev => ({ ...prev, image: `${window.location.origin}/8004Agent.png` }));
    }
  }, [createForm.image]);

  useEffect(() => {
    if (agentUrlAutofillDisabled) {
      return;
    }
    const defaultUrl = buildDefaultAgentUrl(createForm.agentName);
    setCreateForm(prev => {
      const current = (prev.agentUrl || '').trim();
      if ((current || '') === (defaultUrl || '')) {
        return prev;
      }
      if (!current && !defaultUrl) {
        return prev;
      }
      return { ...prev, agentUrl: defaultUrl };
    });
  }, [agentUrlAutofillDisabled, createForm.agentName]);

  // Get admin EOA for private key mode display
  const [adminEOA, setAdminEOA] = useState<string | null>(null);
  useEffect(() => {
    if (privateKeyMode) {
      (async () => {
        try {
          const res = await fetch('/api/admin/address', { method: 'GET' });
          if (res.ok) {
            const data = await res.json();
            if (data?.address && typeof data.address === 'string') {
              setAdminEOA(data.address);
            }
          }
        } catch {
          // ignore
        }
      })();
    }
  }, [privateKeyMode]);

  // Chain selection for Create Agent
  const [selectedChainId, setSelectedChainId] = useState<number>(DEFAULT_CHAIN_ID);

  const supportedChainIds = React.useMemo(() => getSupportedChainIds(), []);
  const registerChainIds = React.useMemo(
    () => supportedChainIds.filter(id => id !== 11155420),
    [supportedChainIds],
  );

  useEffect(() => {
    if (registerChainIds.length === 0) {
      return;
    }
    if (!registerChainIds.includes(selectedChainId)) {
      setSelectedChainId(registerChainIds[0]);
    }
  }, [registerChainIds, selectedChainId]);

  const CHAIN_METADATA = React.useMemo((): Record<number, ReturnType<typeof getChainDisplayMetadata>> => {
    const entries: Record<number, ReturnType<typeof getChainDisplayMetadata>> = {};
    supportedChainIds.forEach(chainId => {
      try {
        entries[chainId] = getChainDisplayMetadata(chainId);
      } catch (error) {
        console.warn('[chain] Unable to load metadata for chain', chainId, error);
      }
    });
    return entries;
  }, [supportedChainIds]);

  const CHAIN_OBJECTS: Record<number, Chain> = React.useMemo(() => {
    const map: Record<number, Chain> = {};
    supportedChainIds.forEach(chainId => {
      try {
        map[chainId] = getChainById(chainId) as Chain;
      } catch (error) {
        console.warn('[chain] Unable to load chain object', chainId, error);
      }
    });
    return map;
  }, [supportedChainIds]);

  const getChainIdHex = React.useCallback(
    (chainId: number): string => CHAIN_METADATA[chainId]?.chainIdHex ?? getChainIdHexUtil(chainId),
    [CHAIN_METADATA],
  );

  const resolveAgentBaseUrl = useCallback((): string => {
    const explicit = (createForm.agentUrl || '').trim();
    if (explicit) return explicit;
    const auto = buildDefaultAgentUrl(createForm.agentName);
    return auto;
  }, [createForm.agentName, createForm.agentUrl]);
  const getBundlerUrlForChain = React.useCallback(
    (chainId: number): string | undefined => {
      // Shared client-side helper reading NEXT_PUBLIC_* at build time
      return getClientBundlerUrl(chainId);
    },
    [],
  );

  const headerAddress = authPrivateKeyMode ? (adminEOA || eoaAddress) : eoaAddress;
  const adminReady = authPrivateKeyMode || authConnected;
  const adminGate = (
    <section
      style={{
        background: 'linear-gradient(135deg, #f6f6f6, #f9f9f9)',
        borderRadius: '24px',
        padding: '3rem',
        border: '1px solid #ededed',
        textAlign: 'center',
      }}
    >
      <p
        style={{
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: '#4f4f4f',
          fontWeight: 700,
          marginBottom: '1rem',
        }}
      >
        Create Smart Agent with 8004 Identity Registration
      </p>
      <h2 style={{ margin: 0, fontSize: '2.25rem', color: '#4a4a4a' }}>
        Connect a wallet to register agents.  Use social login for convenience. It's free and easy.
      </h2>
      <p style={{ marginTop: '1rem', color: '#4a4a4a', fontSize: '1.05rem' }}>
        Register new ERC-8004 agents once authenticated.
      </p>
      <div style={{ marginTop: '2rem' }}>
        <button
          onClick={openLoginModal}
          style={{
            padding: '0.85rem 2rem',
            borderRadius: '999px',
            border: 'none',
            backgroundColor: '#4f4f4f',
            color: '#fff',
            fontSize: '1rem',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Connect to Continue
        </button>
      </div>
    </section>
  );

  const ensureProviderOnChain = React.useCallback(
    async (provider: any, chainId: number, label: string): Promise<boolean> => {
      if (!provider?.request) return false;
      const metadata = CHAIN_METADATA[chainId];
      if (!metadata) {
        console.warn(`[chain] ensureProviderOnChain(${label}) → missing metadata for chain ${chainId}`);
        return false;
      }

      const chainLabel = metadata.displayName || metadata.chainName || `chain ${chainId}`;
      console.info(`[chain] ensureProviderOnChain(${label}) → requesting ${chainLabel}`);

      try {
        const currentChain = await provider.request({ method: 'eth_chainId' }).catch(() => null);
        if (typeof currentChain === 'string' && currentChain.toLowerCase() === metadata.chainIdHex.toLowerCase()) {
          console.info(`[chain] ${label} already on ${chainLabel}`);
          return true;
        }

        await provider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: metadata.chainIdHex }],
        });
        console.info(`[chain] ${label} switched to ${chainLabel}`);
      } catch (switchErr: any) {
        const errorCode = switchErr?.code ?? switchErr?.data?.originalError?.code;
        if (errorCode !== 4902) {
          console.warn(`Unable to switch provider chain (${chainLabel})`, switchErr);
          return false;
        }

        try {
          await provider.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: metadata.chainIdHex,
              chainName: chainLabel,
              nativeCurrency: metadata.nativeCurrency,
              rpcUrls: metadata.rpcUrls,
              blockExplorerUrls: metadata.blockExplorerUrls,
            }],
          });
          console.info(`[chain] ${label} added ${chainLabel}`);
        } catch (addErr) {
          console.warn(`Unable to add provider chain (${chainLabel})`, addErr);
          return false;
        }
      }

      const finalChain = await provider.request({ method: 'eth_chainId' }).catch(() => null);
      if (typeof finalChain === 'string' && finalChain.toLowerCase() === metadata.chainIdHex.toLowerCase()) {
        console.info(`[chain] ${label} final chain ${chainLabel}`);
        return true;
      }
      console.warn(
        `[chain] ${label} chain mismatch after switch. Expected ${metadata.chainIdHex}, got ${finalChain ?? 'unknown'}`,
      );
      return false;
    },
    [CHAIN_METADATA],
  );

  const synchronizeProvidersWithChain = React.useCallback(
    async (chainId: number): Promise<boolean> => {
      const chainLabel = CHAIN_METADATA[chainId]?.displayName || CHAIN_METADATA[chainId]?.chainName || `chain ${chainId}`;
      console.info('[chain] synchronizeProvidersWithChain', chainId, chainLabel);
      const results: boolean[] = [];

      // Use the consolidated eip1193Provider from useWallet
      if (eip1193Provider && eoaConnected) {
        const isMetaMask = Boolean((eip1193Provider as any)?.isMetaMask);
        const isWeb3Auth = !isMetaMask && Boolean((eip1193Provider as any)?.isWeb3Auth);
        
        if (isWeb3Auth) {
          // Try Web3Auth-specific chain switching first
          const switched = await ensureWeb3AuthChain(chainId);
          if (!switched) {
            console.info('[chain] ensureWeb3AuthChain returned false; falling back to provider request');
            results.push(await ensureProviderOnChain(eip1193Provider, chainId, 'web3auth'));
          } else {
            results.push(true);
          }
        } else if (isMetaMask) {
          results.push(await ensureProviderOnChain(eip1193Provider, chainId, 'metamask'));
        } else {
          // Generic provider
          results.push(await ensureProviderOnChain(eip1193Provider, chainId, 'provider'));
        }
      } else {
        console.info('[chain] skip provider sync (no connected provider)');
      }

      return results.length > 0 && results.every(r => r === true);
    },
    [CHAIN_METADATA, eip1193Provider, eoaConnected, ensureProviderOnChain],
  );

  // Toggle states for Create Agent
  const useAA = true;
  const [ensOrgName, setEnsOrgName] = useState(getEnsOrgName(DEFAULT_CHAIN_ID)); // Default org name
  const [ensChecking, setEnsChecking] = useState(false);
  const [ensAvailable, setEnsAvailable] = useState<boolean | null>(null);
  const [aaAddress, setAaAddress] = useState<string | null>(null);
  const [aaComputing, setAaComputing] = useState(false);
  const [existingAgentInfo, setExistingAgentInfo] = useState<{ account: string; method?: string } | null>(null);
  // Avoid showing a user-facing "switch manually" error on initial page load/refresh.
  // Only show it when the user changes the selected chain after the page has mounted.
  const initialAutoSyncChainRef = useRef<number | null>(null);

  useEffect(() => {
    if (!eip1193Provider || !eoaConnected) {
      console.info('[chain] skip auto-sync (no connected provider)');
      return;
    }
    if (initialAutoSyncChainRef.current == null) {
      initialAutoSyncChainRef.current = selectedChainId;
    }
    (async () => {
      const ready = await synchronizeProvidersWithChain(selectedChainId);
      if (!ready) {
        const isInitialLoad = initialAutoSyncChainRef.current === selectedChainId;
        if (isInitialLoad) {
          console.warn(
            '[chain] Auto-switch failed on initial load; not surfacing user error. ' +
              'Will require manual chain selection only if the user proceeds.',
          );
          return;
        }

        setError('Unable to switch wallet provider to the selected chain. Please switch manually in your wallet.');
        const chainMeta = CHAIN_METADATA[selectedChainId];
        const chainLabel = chainMeta?.displayName || chainMeta?.chainName || `chain ${selectedChainId}`;
        try {
          const envNames = getEnvVarHints(selectedChainId);
          if (envNames) {
            console.error(
              `[chain] Auto-switch failed for ${chainLabel}. Ensure RPC env vars ` +
                `${envNames.rpcClient} (client) and ${envNames.rpcServer} (server) are configured. ` +
                `If you use Smart Accounts, also set ${envNames.bundlerClient} and ${envNames.bundlerServer}.`,
            );
          }
        } catch (envErr) {
          console.error('[chain] Unable to provide env hint for chain', selectedChainId, envErr);
        }
      }
    })();
  }, [selectedChainId, synchronizeProvidersWithChain, eip1193Provider, eoaConnected, CHAIN_METADATA]);

  // Set agent account in EOA mode (when SmartAccount is not enabled)
  useEffect(() => {
    if (!useAA) {
      // Priority: use wallet address if available, otherwise fetch admin EOA address in private key mode
      if (eoaAddress) {
        // Use connected wallet address
        setCreateForm(prev => ({
          ...prev,
          agentAccount: eoaAddress,
        }));
      } else if (privateKeyMode) {
        // Fetch admin EOA address from API
        (async () => {
          try {
            const response = await fetch('/api/admin/address');
            if (response.ok) {
              const data = await response.json();
              setCreateForm(prev => ({
                ...prev,
                agentAccount: data.address,
              }));
            } else {
              console.error('Failed to fetch admin address:', response.status);
            }
          } catch (error) {
            console.error('Error fetching admin address:', error);
          }
        })();
      }
    }
  }, [eoaAddress, useAA, privateKeyMode]);

  // Auto-compute SmartAccount address as the agent name changes
  // Use server-side endpoint for private key mode, client-side function for wallet mode
  useEffect(() => {
    if (!useAA) {
      setAaAddress(null);
      return;
    }
    
    const name = (createForm.agentName || '').trim();
    if (!name) {
      setAaAddress(null);
      setCreateForm(prev => ({ ...prev, agentAccount: '' }));
      return;
    }

    // Private key mode: use server-side endpoint
    if (privateKeyMode) {
      let cancelled = false;
      setAaComputing(true);

      (async () => {
        try {
          // Use server-side endpoint for private key mode
          const resp = await fetch('/api/accounts/counterfactual-account', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              agentName: name,
              chainId: selectedChainId || undefined,
            }),
          });
          
          if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            console.warn('Server-side SmartAccount address computation failed:', err);
            if (!cancelled) {
              setAaAddress(null);
              setCreateForm(prev => ({ ...prev, agentAccount: '' }));
            }
            return;
          }
          
          const data = await resp.json();
          const computed = (data?.address as string) || '';
          if (!cancelled && computed && computed.startsWith('0x')) {
            setAaAddress(computed);
            setCreateForm(prev => ({ ...prev, agentAccount: computed }));
          }
        } catch (error) {
          console.error('Error computing SmartAccount address (server-side):', error);
          if (!cancelled) {
            setAaAddress(null);
            setCreateForm(prev => ({ ...prev, agentAccount: '' }));
          }
        } finally {
          if (!cancelled) {
            setAaComputing(false);
          }
        }
      })();

      return () => {
        cancelled = true;
      };
    }
    
    // Wallet mode: use client-side function
    if (!eip1193Provider || !eoaAddress) {
      setAaAddress(null);
      setCreateForm(prev => ({ ...prev, agentAccount: '' }));
      return;
    }

    let cancelled = false;
    setAaComputing(true);

    (async () => {
      try {
        // Use client-side function to compute SmartAccount address with wallet provider
        const computed = await getCounterfactualSmartAccountAddressByAgentName(
          name,
          eoaAddress as `0x${string}`,
          {
            ethereumProvider: eip1193Provider as any,
            chain: CHAIN_OBJECTS[selectedChainId] ?? CHAIN_OBJECTS[DEFAULT_CHAIN_ID],
          },
        );
        if (!cancelled && computed && computed.startsWith('0x')) {
          setAaAddress(computed);
          setCreateForm(prev => ({ ...prev, agentAccount: computed }));
        }
      } catch (error) {
        console.error('Error computing SmartAccount address (client-side):', error);
        if (!cancelled) {
          setAaAddress(null);
          setCreateForm(prev => ({ ...prev, agentAccount: '' }));
        }
      } finally {
        if (!cancelled) {
          setAaComputing(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [useAA, privateKeyMode, eip1193Provider, eoaAddress, createForm.agentName, selectedChainId, CHAIN_OBJECTS]);

  // Check ENS availability when agent name changes
  useEffect(() => {
    if (!createForm.agentName || !ensOrgName) {
      setEnsAvailable(null);
      setEnsChecking(false);
      setEnsExisting(null);
      return;
    }

    let cancelled = false;
    setEnsChecking(true);
    setEnsAvailable(null);
    setEnsExisting(null);

    (async () => {
      try {
        const encodedEnsDid = buildDidEnsFromAgentAndOrg(
          selectedChainId,
          createForm.agentName,
          ensOrgName
        );

        const response = await fetch(`/api/names/${encodedEnsDid}`, {
          method: 'GET',
        });

        if (cancelled) return;

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          console.warn('ENS availability check failed:', err);
          setEnsAvailable(null);
          setEnsChecking(false);
          return;
        }

        const data = await response.json();
        const available = data?.nameInfo?.available === true;
        setEnsAvailable(available);
        if (!available && data?.nameInfo) {
          setEnsExisting({
            image: data.nameInfo.image || null,
            url: data.nameInfo.url || null,
            description: data.nameInfo.description || null,
          });
        } else {
          setEnsExisting(null);
        }
      } catch (error) {
        console.error('Error checking ENS availability:', error);
        if (!cancelled) {
          setEnsAvailable(null);
        }
      } finally {
        if (!cancelled) {
          setEnsChecking(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [createForm.agentName, ensOrgName, selectedChainId]);

  useEffect(() => {
    setImagePreviewError(false);
  }, [createForm.image]);

  // Keep ENS org name in sync with selected chain
  useEffect(() => {
    try {
      const name = getEnsOrgName(selectedChainId);
      if (name && name !== ensOrgName) {
        setEnsOrgName(name);
      }
    } catch {
      // ignore
    }
  }, [selectedChainId]);


  const ensFullNamePreview =
    createForm.agentName && ensOrgName
      ? `${createForm.agentName.toLowerCase()}.${ensOrgName.toLowerCase()}.eth`
      : '';

  // DID previews (update as inputs change)
  const didEnsPreview = useMemo(() => {
    if (!ensFullNamePreview) return null;
    return `did:ens:${selectedChainId}:${ensFullNamePreview}`;
  }, [ensFullNamePreview, selectedChainId]);

  const didEthrPreview = useMemo(() => {
    const acct = (aaAddress || createForm.agentAccount || '').trim();
    if (!acct || !acct.startsWith('0x') || acct.length !== 42) return null;
    return `did:ethr:${selectedChainId}:${acct.toLowerCase()}`;
  }, [aaAddress, createForm.agentAccount, selectedChainId]);

  const didAgentPreview = useMemo(() => {
    // UAID is generated after registration; show a placeholder
    return `uaid:<generated-after-registration>`;
  }, [selectedChainId]);

  const computeStepValidation = useCallback((): { valid: boolean; message?: string } => {
    switch (createStep) {
      case 0: {
        if (!createForm.agentName.trim()) {
          return { valid: false, message: 'Agent name is required.' };
        }
        if (!ensFullNamePreview) {
          return { valid: false, message: 'ENS name is required.' };
        }
        if (ensAvailable !== true) {
          return { valid: false, message: 'ENS name must be available.' };
        }
        return { valid: true };
      }
      case 1: {
        if (!createForm.description.trim()) {
          return { valid: false, message: 'Please provide a description for your agent.' };
        }
        return { valid: true };
      }
      case 2: {
        return { valid: true };
      }
      case 3: {
        const baseUrl = resolveAgentBaseUrl();
        if (!baseUrl) {
          return { valid: false, message: 'Agent URL is required (or set an agent name to auto-generate).' };
        }
        if (!protocolSettings.protocol) {
          return { valid: false, message: 'Select a protocol (A2A or MCP).' };
        }
        if (protocolSettings.protocol === 'A2A' && !((protocolSettings.a2aEndpoint || '').trim() || baseUrl)) {
          return { valid: false, message: 'Provide an A2A agent card URL (agent.json).' };
        }
        if (protocolSettings.protocol === 'MCP' && !((protocolSettings.mcpEndpoint || '').trim() || baseUrl)) {
          return { valid: false, message: 'Provide an MCP protocol endpoint URL.' };
        }
        if (!ensOrgName.trim()) {
          return { valid: false, message: 'ENS parent name is required when ENS publishing is enabled.' };
        }
        return { valid: true };
      }
      case 4:
      default:
        return { valid: true };
    }
  }, [
    createStep,
    createForm.agentName,
    createForm.agentAccount,
    createForm.description,
    createForm.agentUrl,
    protocolSettings.protocol,
    protocolSettings.a2aEndpoint,
    protocolSettings.mcpEndpoint,
    ensOrgName,
    ensAvailable,
    ensFullNamePreview,
  ]);

  const validateCurrentStep = useCallback((): boolean => {
    const result = computeStepValidation();
    if (!result.valid) {
      setError(result.message ?? 'Please complete all required fields.');
      return false;
    }
    setError(null);
    return true;
  }, [computeStepValidation]);

  const isCurrentStepValid = useMemo(
    () => computeStepValidation().valid,
    [computeStepValidation],
  );

  const handleNextStep = useCallback(() => {
    if (!validateCurrentStep()) {
      return;
    }
    const nextStep = Math.min(createStep + 1, totalCreateSteps - 1);
    setCreateStep(nextStep);
    
    // Generate UAID when entering review step (step 4)
    // Use the Smart Account address (AA) when available so UAID is based on the associated smart account did:ethr.
    const uaidAccount = (aaAddress || createForm.agentAccount || '').trim();
    if (nextStep === 4 && uaidAccount) {
      setUaidLoading(true);
      (async () => {
        try {
          const response = await fetch('/api/agents/generate-uaid', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              agentAccount: uaidAccount,
              chainId: selectedChainId,
                // Use did:ethr for uid (not ENS)
                uid: `did:ethr:${selectedChainId}:${uaidAccount}`,
            }),
          });
          if (response.ok) {
            const data = await response.json();
            setUaid(data.uaid || null);
          } else {
            console.warn('Failed to generate UAID:', response.status);
            setUaid(null);
          }
        } catch (error) {
          console.warn('Error generating UAID:', error);
          setUaid(null);
        } finally {
          setUaidLoading(false);
        }
      })();
    }
  }, [validateCurrentStep, totalCreateSteps, createStep, aaAddress, createForm.agentAccount, createForm.agentName, ensOrgName, selectedChainId]);

  const handlePrevStep = useCallback(() => {
    setError(null);
    setCreateStep(prev => Math.max(prev - 1, 0));
  }, []);

  const handleJumpToStep = useCallback(
    (index: number) => {
      if (index > createStep) {
        return;
      }
      setError(null);
      setCreateStep(index);
    },
    [createStep],
  );

  const handleRegisterAgent = async () => {
    if (registering) {
      return;
    }
    if (!isReviewStep) {
      setCreateStep(totalCreateSteps - 1);
      return;
    }
    if (!validateCurrentStep()) {
      return;
    }
    try {
      setError(null);
      setSuccess(null);

      const baseUrl = resolveAgentBaseUrl();
      const resolvedA2A =
        protocolSettings.protocol === 'A2A' &&
        (protocolSettings.a2aEndpoint.trim() || (baseUrl ? `${baseUrl}/.well-known/agent-card.json` : ''));
      const resolvedMcp =
        protocolSettings.protocol === 'MCP' &&
        (protocolSettings.mcpEndpoint.trim() || (baseUrl ? `${baseUrl}/api/mcp` : ''));

      if (!privateKeyMode) {
        const ready = await synchronizeProvidersWithChain(selectedChainId);
        if (!ready) {
          resetRegistrationProgress();
          setError('Unable to switch wallet provider to the selected chain. Please switch manually in your wallet and retry.');
          return;
        }
        // Ensure provider is authorized before any core calls
        try {
          if (eip1193Provider && typeof eip1193Provider.request === 'function') {
            // Switch to selected chain (if wallet supports it)
            const chainIdHex = getChainIdHex(selectedChainId);
            try {
              const current = await eip1193Provider.request({ method: 'eth_chainId' }).catch(() => null);
              if (!current || current.toLowerCase() !== chainIdHex.toLowerCase()) {
                await eip1193Provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainIdHex }] });
              }
            } catch {
              // ignore; core will also attempt chain selection
            }
            const accs = await eip1193Provider.request({ method: 'eth_accounts' }).catch(() => []);
            if (!Array.isArray(accs) || accs.length === 0) {
              await eip1193Provider.request({ method: 'eth_requestAccounts' });
            }
          }
        } catch {
          // ignore; core will also attempt authorization
        }
      }

      // Use the agent account from the form by default
      let agentAccountToUse = createForm.agentAccount as `0x${string}`;

      // If using SmartAccount, compute or confirm the SmartAccount address
      if (useAA) {
        if (privateKeyMode) {
          // Private key mode: prefer already-computed SmartAccount address from state,
          // otherwise call the server-side endpoint to compute it.
          let computedAa = aaAddress;

          if (!computedAa) {
            const resp = await fetch('/api/accounts/counterfactual-account', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                agentName: createForm.agentName,
                chainId: selectedChainId || undefined,
              }),
            });

            if (!resp.ok) {
              const err = await resp.json().catch(() => ({}));
              throw new Error(
                err?.message ||
                  err?.error ||
                  'Server-side SmartAccount address computation failed. Ensure private key mode is configured.',
              );
            }

            const data = await resp.json();
            computedAa = (data?.address as string) || '';
          }

          if (!computedAa || !computedAa.startsWith('0x')) {
            throw new Error('Failed to compute SmartAccount address. Please retry.');
          }

          setAaAddress(computedAa);
          agentAccountToUse = computedAa as `0x${string}`;
          setSuccess('Using Smart Account address (server-side)…');
        } else {
          // Wallet mode: compute SmartAccount address using wallet provider (client-side)
          if (!eip1193Provider) {
            throw new Error('Wallet provider is required to compute SmartAccount address. Please connect your wallet.');
          }
          if (!eoaAddress) {
            throw new Error('EOA address is required to compute SmartAccount address.');
          }

          const computedAa = await getCounterfactualSmartAccountAddressByAgentName(
            createForm.agentName,
            eoaAddress as `0x${string}`,
            {
              ethereumProvider: eip1193Provider as any,
              chain: CHAIN_OBJECTS[selectedChainId] ?? CHAIN_OBJECTS[DEFAULT_CHAIN_ID],
            },
          );
          if (!computedAa || !computedAa.startsWith('0x')) {
            throw new Error('Failed to compute SmartAccount address. Please retry.');
          }
          setAaAddress(computedAa);
          agentAccountToUse = computedAa as `0x${string}`;
          setSuccess('Using Smart Account address...');
        }
      }

      // Validate agentAccountToUse before proceeding
      if (!agentAccountToUse || agentAccountToUse.trim() === '' || !agentAccountToUse.startsWith('0x')) {
        throw new Error('Agent account address is required. Please provide an agent account address or enable Smart Account.');
      }

      // Use SmartAccount creation path
        if (privateKeyMode) {
          startRegistrationProgress();
          // Server-only path (admin private key signs on server)
          // Build endpoints array using provided values or auto-generated defaults
          const endpoints: Array<{
            name: string;
            endpoint: string;
            version?: string;
            a2aSkills?: string[];
            a2aDomains?: string[];
            mcpSkills?: string[];
            mcpDomains?: string[];
          }> = [];
          if (protocolSettings.protocol === 'A2A' && resolvedA2A) {
            endpoints.push({
              name: 'A2A',
              endpoint: resolvedA2A,
              version: '0.3.0',
              a2aSkills: protocolSettings.a2aSkills.length > 0 ? protocolSettings.a2aSkills : undefined,
              a2aDomains: protocolSettings.a2aDomains.length > 0 ? protocolSettings.a2aDomains : undefined,
            });
          }
          if (protocolSettings.protocol === 'MCP' && resolvedMcp) {
            endpoints.push({
              name: 'MCP',
              endpoint: resolvedMcp,
              version: '2025-06-18',
              mcpSkills: protocolSettings.mcpSkills.length > 0 ? protocolSettings.mcpSkills : undefined,
              mcpDomains: protocolSettings.mcpDomains.length > 0 ? protocolSettings.mcpDomains : undefined,
            });
          }

          const directPlan = await createAgentDirect({
            mode: 'smartAccount',
            agentName: createForm.agentName,
            agentAccount: agentAccountToUse,
            supportedTrust: supportedTrust.length > 0 ? supportedTrust : undefined,
            description: createForm.description || undefined,
            image: createForm.image || undefined,
            agentUrl: baseUrl || undefined,
            endpoints: endpoints.length > 0 ? endpoints : undefined,
            chainId: selectedChainId,
            ensOptions: {
              enabled: true,
              orgName: ensOrgName,
            },
          });

          let finalAgentId: string | number | undefined;
          if (directPlan.agentId) {
            finalAgentId = directPlan.agentId;
            setSuccess(`Agent created successfully! Agent ID: ${directPlan.agentId}, TX: ${directPlan.txHash}`);
            openCompletionModal({
              agentId: String(directPlan.agentId),
              txHash: String(directPlan.txHash || ''),
            });
            // Best-effort: trigger knowledge base sync after agent creation.
            try {
              const kbChainId =
                selectedChainId === 1 || selectedChainId === 59144 ? String(selectedChainId) : 'all';
              void fetch(`/api/sync/agent-pipeline?chainId=${encodeURIComponent(kbChainId)}`, { method: 'POST' });
            } catch {
              // ignore
            }
          } else if (directPlan.txHash) {
            setSuccess(`Agent creation transaction confirmed! TX: ${directPlan.txHash} (Agent ID will be available after indexing)`);
            openCompletionModal({
              txHash: String(directPlan.txHash || ''),
            });
            // Best-effort: trigger knowledge base sync after agent creation.
            try {
              const kbChainId =
                selectedChainId === 1 || selectedChainId === 59144 ? String(selectedChainId) : 'all';
              void fetch(`/api/sync/agent-pipeline?chainId=${encodeURIComponent(kbChainId)}`, { method: 'POST' });
            } catch {
              // ignore
            }
          } else {
            setSuccess('Agent SmartAccount creation requested. Check server logs for details.');
            openCompletionModal({});
          }

          // Note: Validation request is skipped in private key mode as we don't have wallet provider
          // It can be done separately via the admin-tools test tab
        } else {
          // Client path (requires connected wallet/provider)
          // Build endpoints array using provided values or auto-generated defaults
          const endpoints: Array<{
            name: string;
            endpoint: string;
            version?: string;
            a2aSkills?: string[];
            a2aDomains?: string[];
            mcpSkills?: string[];
            mcpDomains?: string[];
          }> = [];
          if (protocolSettings.protocol === 'A2A' && resolvedA2A) {
            endpoints.push({
              name: 'A2A',
              endpoint: resolvedA2A,
              version: '0.3.0',
              a2aSkills: protocolSettings.a2aSkills.length > 0 ? protocolSettings.a2aSkills : undefined,
              a2aDomains: protocolSettings.a2aDomains.length > 0 ? protocolSettings.a2aDomains : undefined,
            });
          }
          if (protocolSettings.protocol === 'MCP' && resolvedMcp) {
            endpoints.push({
              name: 'MCP',
              endpoint: resolvedMcp,
              version: '2025-06-18',
              mcpSkills: protocolSettings.mcpSkills.length > 0 ? protocolSettings.mcpSkills : undefined,
              mcpDomains: protocolSettings.mcpDomains.length > 0 ? protocolSettings.mcpDomains : undefined,
            });
          }

          // Friendly pre-confirm before MetaMask shows the raw UserOperation typed-data.
          if (!walletConfirmOpen) {
            const chainLabel =
              CHAIN_METADATA[selectedChainId]?.displayName ||
              CHAIN_METADATA[selectedChainId]?.chainName ||
              `Chain ${selectedChainId}`;
            const ensName = ensFullNamePreview || `${createForm.agentName.toLowerCase()}.${ensOrgName.toLowerCase()}.eth`;
            const agentUrl = baseUrl || '';
            setWalletConfirmPayload({
              chainLabel,
              chainId: selectedChainId,
              ensName,
              agentAccount: agentAccountToUse,
              agentUrl,
              a2aEndpoint: resolvedA2A || null,
              mcpEndpoint: resolvedMcp || null,
            });
            pendingWalletActionRef.current = async () => {
              startRegistrationProgress();
              const result = await createAgentWithWallet({
                agentData: {
                  agentName: createForm.agentName,
                  agentAccount: agentAccountToUse,
                  supportedTrust: supportedTrust.length > 0 ? supportedTrust : undefined,
                  description: createForm.description || undefined,
                  image: createForm.image || undefined,
                  agentUrl: baseUrl || undefined,
                  endpoints: endpoints.length > 0 ? endpoints : undefined,
                },
                account: eoaAddress as Address,
                ethereumProvider: eip1193Provider as any,
                onStatusUpdate: setSuccess,
                useAA: true,
                ensOptions: {
                  enabled: true,
                  orgName: ensOrgName,
                },
                chainId: selectedChainId,
              });

              if (result.agentId) {
                setSuccess(`Agent created successfully! Agent ID: ${result.agentId}, TX: ${result.txHash}`);
                openCompletionModal({ agentId: String(result.agentId), txHash: String(result.txHash || '') });
              } else {
                setSuccess(`Agent creation transaction confirmed! TX: ${result.txHash} (Agent ID will be available after indexing)`);
                openCompletionModal({ txHash: String(result.txHash || '') });
              }

              // Best-effort: trigger knowledge base sync after agent creation.
              try {
                const kbChainId =
                  selectedChainId === 1 || selectedChainId === 59144 ? String(selectedChainId) : 'all';
                void fetch(`/api/sync/agent-pipeline?chainId=${encodeURIComponent(kbChainId)}`, { method: 'POST' });
              } catch {
                // ignore
              }

              // Refresh owned agents cache so new agents appear quickly
              try {
                await refreshOwnedAgents();
              } catch {
                // ignore
              }

              setRegisterProgress(100);
              if (registerTimerRef.current) {
                clearInterval(registerTimerRef.current);
                registerTimerRef.current = null;
              }
              resetRegistrationProgress();
            };
            setWalletConfirmOpen(true);
            return;
          }
      }
      

      
      
      setCreateForm({ agentName: '', agentAccount: '', description: '', image: getDefaultImageUrl(), agentUrl: '' });
      setSupportedTrust([]);
      setAgentUrlAutofillDisabled(false);
      setAaAddress(null);
      setCreateStep(0);
      setProtocolSettings({ protocol: 'A2A', a2aEndpoint: '', mcpEndpoint: '', a2aSkills: [], a2aDomains: [], mcpSkills: [], mcpDomains: [] });

      // Refresh owned agents cache so new agents appear in dropdowns immediately
      await refreshOwnedAgents();

      setRegisterProgress(100);
      if (registerTimerRef.current) {
        clearInterval(registerTimerRef.current);
        registerTimerRef.current = null;
      }
      resetRegistrationProgress();
    } catch (err) {
      console.error('Error creating agent:', err);
      resetRegistrationProgress();
      setError(err instanceof Error ? err.message : 'Failed to create agent');
    }
  };

  const normalizedAgentBaseUrl = (createForm.agentUrl || '').trim().replace(/\/$/, '');
  const ipfsGateway = (process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL || 'https://gateway.pinata.cloud/ipfs/').replace(/\/+$/, '');

  const imagePreviewUrl = useMemo(() => {
    const trimmed = (createForm.image || '').trim();
    if (!trimmed) {
      return '';
    }
    if (trimmed.startsWith('ipfs://')) {
      const cid = trimmed.replace('ipfs://', '').replace(/^\/+/, '');
      const base = ipfsGateway.replace(/\/+$/, '');
      return `${base}/${cid}`;
    }
    return trimmed;
  }, [createForm.image, ipfsGateway]);
  const handleImageUploadClick = () => {
    setImageUploadError(null);
    imageFileInputRef.current?.click();
  };

  const handleImageFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    setUploadingImage(true);
    setImageUploadError(null);
    try {
      const formData = new FormData();
      formData.append('file', file, file.name);
      const response = await fetch('/api/ipfs/upload', {
        method: 'POST',
        body: formData,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body?.error || body?.message || 'Upload failed');
      }
      setCreateForm(prev => ({
        ...prev,
        image: body?.tokenUri || body?.url || prev.image,
      }));
    } catch (uploadError) {
      console.error('Image upload failed', uploadError);
      setImageUploadError(
        uploadError instanceof Error ? uploadError.message : 'Image upload failed. Please try again.',
      );
    } finally {
      setUploadingImage(false);
      if (event.target) {
        event.target.value = '';
      }
    }
  };
  const handleAgentUrlInputChange = useCallback((value: string) => {
    setAgentUrlAutofillDisabled(true);
    setCreateForm(prev => ({ ...prev, agentUrl: value }));
  }, []);

  const handleResetAgentUrlToDefault = useCallback(() => {
    setAgentUrlAutofillDisabled(false);
    const defaultUrl = buildDefaultAgentUrl(createForm.agentName);
    setCreateForm(prev => ({ ...prev, agentUrl: defaultUrl }));
  }, [createForm.agentName]);
  // Default A2A endpoint to the canonical agent card URL (/.well-known/agent-card.json) and MCP to /api/mcp
  const defaultA2AEndpoint = normalizedAgentBaseUrl ? `${normalizedAgentBaseUrl}/.well-known/agent-card.json` : '';
  const defaultMcpEndpoint = normalizedAgentBaseUrl ? `${normalizedAgentBaseUrl}/api/mcp` : '';
  const previousDefaultsRef = useRef({ a2a: '', mcp: '' });

  useEffect(() => {
    const prevDefaults = previousDefaultsRef.current;
    setProtocolSettings(prev => {
      const next: typeof prev = { ...prev };
      let changed = false;
      if (prev.protocol === 'A2A' && defaultA2AEndpoint) {
        const shouldUpdate = !prev.a2aEndpoint || prev.a2aEndpoint === prevDefaults.a2a;
        if (shouldUpdate) {
          next.a2aEndpoint = defaultA2AEndpoint;
          changed = true;
        }
      }
      if (prev.protocol === 'MCP' && defaultMcpEndpoint) {
        const shouldUpdate = !prev.mcpEndpoint || prev.mcpEndpoint === prevDefaults.mcp;
        if (shouldUpdate) {
          next.mcpEndpoint = defaultMcpEndpoint;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    previousDefaultsRef.current = { a2a: defaultA2AEndpoint, mcp: defaultMcpEndpoint };
  }, [defaultA2AEndpoint, defaultMcpEndpoint]);

  const renderStepContent = () => {
    switch (createStep) {
      case 0:
        return (
          <>
            <div style={{ marginBottom: '1rem', display: 'inline-block' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                Chain
              </label>
              <select
                value={selectedChainId}
                onChange={(e) => {
                  const nextChainId = Number(e.target.value);
                  const nextMetadata = CHAIN_METADATA[nextChainId];
                  console.info(
                    '[chain] UI selected chain',
                    nextChainId,
                    nextMetadata?.displayName || nextMetadata?.chainName || '',
                  );
                  setSelectedChainId(nextChainId);
                  setEnsAvailable(null);
                  setAaAddress(null);
                  synchronizeProvidersWithChain(nextChainId);
                }}
                style={{
                  padding: '0.5rem 1.75rem 0.5rem 0.75rem',
                  border: '1px solid #dcdcdc',
                  borderRadius: '8px',
                  minWidth: '220px',
                  width: 'auto',
                }}
              >
                {(registerChainIds.length ? registerChainIds : supportedChainIds).map(chainId => {
                  const metadata = CHAIN_METADATA[chainId];
                  const label = metadata?.displayName || metadata?.chainName || `Chain ${chainId}`;
                  return (
                    <option key={chainId} value={chainId}>
                      {label}
                    </option>
                  );
                })}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                Agent Name *
              </label>
              <input
                type="text"
                value={createForm.agentName}
                onChange={(e) => setCreateForm({ ...createForm, agentName: e.target.value })}
                required
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #dcdcdc', borderRadius: '4px' }}
              />
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ fontSize: '0.9rem', color: 'green', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span style={{ fontFamily: 'monospace' }}>
                  {ensFullNamePreview || 'Enter an agent name to check ENS availability'}
                </span>
                <span style={{ fontSize: '0.85rem', color: ensChecking ? '#4f4f4f' : (ensAvailable === true ? '#2a2a2a' : (ensAvailable === false ? '#5a5a5a' : '#4f4f4f')) }}>
                  {ensChecking
                    ? 'Checking...'
                    : ensAvailable === true
                      ? 'Available'
                      : ensAvailable === false
                        ? 'Not available'
                        : 'Awaiting input'}
                </span>
              </div>
              <div style={{ marginTop: '0.25rem' }}>
                {didEnsPreview && (
                  <div style={{ fontSize: '0.8rem', color: '#6a6a6a', marginBottom: '0.1rem' }}>
                    <span style={{ fontFamily: 'monospace' }}>{didEnsPreview}</span>
                  </div>
                )}
                {didEthrPreview && (
                  <div style={{ fontSize: '0.8rem', color: '#6a6a6a', marginBottom: '0' }}>
                    <span style={{ fontFamily: 'monospace' }}>{didEthrPreview}</span>
                  </div>
                )}
              </div>
              {ensAvailable === false && ensExisting && (
                <div style={{ marginTop: '0.5rem', border: '1px solid #dcdcdc', borderRadius: '6px', padding: '0.5rem', backgroundColor: '#f7f7f7' }}>
                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    {ensExisting.image && (
                      <img src={ensExisting.image} alt="ENS avatar" style={{ height: '40px', width: 'auto', borderRadius: '6px' }} />
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontFamily: 'monospace', color: '#2a2a2a' }}>{ensFullNamePreview}</span>
                      {ensExisting.url && (
                        <a href={ensExisting.url} target="_blank" rel="noreferrer" style={{ color: '#2a2a2a', textDecoration: 'underline', fontSize: '0.85rem' }}>
                          {ensExisting.url}
                        </a>
                      )}
                      {ensExisting.description && (
                        <span style={{ fontSize: '0.85rem', color: '#4f4f4f' }}>{ensExisting.description}</span>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.4rem', fontWeight: 'bold' }}>
                Agent Account (auto-assigned)
              </label>
              <div
                style={{
                  width: '100%',
                  padding: '0.6rem 0.75rem',
                  border: '1px solid #dcdcdc',
                  borderRadius: '6px',
                  fontFamily: 'monospace',
                  backgroundColor: '#f6f6f6',
                  color: '#1f1f1f',
                  minHeight: '44px',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                {useAA
                  ? aaAddress || (createForm.agentName ? 'Generating smart account...' : 'Enter an agent name to generate address')
                  : createForm.agentAccount || eoaAddress || 'Connect a wallet to populate owner address'}
              </div>
              {aaComputing && (
                <p style={{ marginTop: '0.3rem', fontSize: '0.85rem', color: '#2f2f2f' }}>
                  Computing smart account address from agent name...
                </p>
              )}
              {existingAgentInfo && (
                <p style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: '#505050' }}>
                  Existing agent detected at <span style={{ fontFamily: 'monospace' }}>{existingAgentInfo?.account}</span>
                  {existingAgentInfo?.method ? ` (resolved via ${existingAgentInfo.method})` : ''}. Creating a new agent will overwrite on-chain metadata for this name.
                </p>
              )}
            </div>
          </>
        );
      case 1:
        return (
          <>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                Agent Description *
              </label>
              <textarea
                value={createForm.description}
                onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                rows={3}
                placeholder="A natural language description of the agent..."
                required
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #dcdcdc', borderRadius: '4px', fontFamily: 'inherit' }}
              />
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                Agent Image *
              </label>
              <input
                type="url"
                value={createForm.image}
                onChange={(e) => setCreateForm({ ...createForm, image: e.target.value })}
                placeholder="https://example.com/agent-image.png"
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #dcdcdc', borderRadius: '4px' }}
              />
              <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <input
                  type="file"
                  accept="image/*"
                  ref={imageFileInputRef}
                  style={{ display: 'none' }}
                  onChange={handleImageFileSelected}
                />
                <button
                  type="button"
                  onClick={handleImageUploadClick}
                  disabled={uploadingImage}
                  style={{
                    padding: '0.45rem 0.9rem',
                    borderRadius: '6px',
                    border: '1px solid #dcdcdc',
                    backgroundColor: uploadingImage ? '#e0e0e0' : '#f9f9f9',
                    color: '#2a2a2a',
                    fontWeight: 600,
                    cursor: uploadingImage ? 'not-allowed' : 'pointer',
                  }}
                >
                  {uploadingImage ? 'Uploading…' : 'Upload & pin image'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setImageUploadError(null);
                    setImagePreviewError(false);
                    setCreateForm(prev => ({ ...prev, image: getDefaultImageUrl() }));
                  }}
                  style={{
                    padding: '0.45rem 0.9rem',
                    borderRadius: '6px',
                    border: '1px solid #dcdcdc',
                    backgroundColor: '#f9f9f9',
                    color: '#2a2a2a',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Use default image
                </button>
                {imageUploadError && (
                  <span style={{ color: '#a33c3c', fontSize: '0.85rem' }}>{imageUploadError}</span>
                )}
              </div>
              {imagePreviewUrl && (
                <div
                  style={{
                    marginTop: '0.75rem',
                    border: '1px solid #dcdcdc',
                    borderRadius: '8px',
                    padding: '0.5rem',
                    backgroundColor: '#f6f6f6',
                    display: 'inline-block',
                  }}
                >
                  <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.85rem', color: '#4f4f4f' }}>Preview</p>
                  {!imagePreviewError ? (
                    <img
                      src={imagePreviewUrl}
                      alt="Agent preview"
                      style={{ height: '100px', width: 'auto', borderRadius: '6px' }}
                      onLoad={handleImagePreviewLoad}
                      onError={handleImagePreviewError}
                    />
                  ) : (
                    <p style={{ margin: 0, fontSize: '0.85rem', color: '#3a3a3a' }}>
                      Unable to load preview. Please check the image URL.
                    </p>
                  )}
                </div>
              )}
            </div>
            <p style={{ marginTop: '0.5rem', marginBottom: '0', fontSize: '0.85rem', color: '#666666' }}>
              Registration JSON will be automatically created and uploaded to IPFS per ERC-8004 specification.
            </p>
          </>
        );
      case 2:
        return (
          <>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                Supported Trust Mechanisms (optional)
              </label>
              <p style={{ marginTop: 0, marginBottom: '0.75rem', fontSize: '0.85rem', color: '#666' }}>
                Select the trust mechanisms your agent supports for validation and reputation
              </p>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', cursor: 'pointer', padding: '0.75rem', border: '1px solid #eee', borderRadius: '6px', backgroundColor: '#fafafa' }}>
                  <input
                    type="checkbox"
                    checked={supportedTrust.includes('reputation')}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSupportedTrust([...supportedTrust, 'reputation']);
                      } else {
                        setSupportedTrust(supportedTrust.filter(t => t !== 'reputation'));
                      }
                    }}
                    style={{ marginTop: '0.25rem' }}
                  />
                  <div>
                    <div style={{ fontWeight: 600 }}>Reputation-based Trust</div>
                    <div style={{ fontSize: '0.85rem', color: '#555' }}>
                    Participants give subjective feedback on agent performance and behavior (e.g., thumbs up/down, star ratings, text reviews).
                    </div>
                  </div>
                </label>
                
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', cursor: 'pointer', padding: '0.75rem', border: '1px solid #eee', borderRadius: '6px', backgroundColor: '#fafafa' }}>
                  <input
                    type="checkbox"
                    checked={supportedTrust.includes('crypto-economic')}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSupportedTrust([...supportedTrust, 'crypto-economic']);
                      } else {
                        setSupportedTrust(supportedTrust.filter(t => t !== 'crypto-economic'));
                      }
                    }}
                    style={{ marginTop: '0.25rem' }}
                  />
                  <div>
                    <div style={{ fontWeight: 600 }}>Crypto-economic Trust</div>
                    <div style={{ fontSize: '0.85rem', color: '#555' }}>
                    Tokens are locked as a guarantee of good agent behavior; they are forfeited if the agent acts maliciously.
                    </div>
                  </div>
                </label>
                
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', cursor: 'pointer', padding: '0.75rem', border: '1px solid #eee', borderRadius: '6px', backgroundColor: '#fafafa' }}>
                  <input
                    type="checkbox"
                    checked={supportedTrust.includes('tee-attestation')}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSupportedTrust([...supportedTrust, 'tee-attestation']);
                      } else {
                        setSupportedTrust(supportedTrust.filter(t => t !== 'tee-attestation'));
                      }
                    }}
                    style={{ marginTop: '0.25rem' }}
                  />
                  <div>
                    <div style={{ fontWeight: 600 }}>TEE Attestation Trust</div>
                    <div style={{ fontSize: '0.85rem', color: '#555' }}>
                    A Trusted Execution Environment provides cryptographic proof of the agent’s code integrity and correct execution.</div>
                  </div>
                </label>
              </div>
            </div>
          </>
        );
      case 3:
        return (
          <>
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                  Agent URL (Base URL for A2A and MCP endpoints) *
                </label>
                {agentUrlAutofillDisabled && (
                  <button
                    type="button"
                    onClick={handleResetAgentUrlToDefault}
                    style={{
                      padding: '0.35rem 0.85rem',
                      borderRadius: '999px',
                      border: '1px solid #dcdcdc',
                      backgroundColor: '#f9f9f9',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      color: '#2a2a2a',
                    }}
                  >
                    Use default domain
                  </button>
                )}
              </div>
              <input
                type="url"
                value={createForm.agentUrl}
                onChange={(e) => handleAgentUrlInputChange(e.target.value)}
                placeholder="https://agent.example.com"
                required
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #dcdcdc', borderRadius: '4px' }}
              />
              <p style={{ marginTop: '0.25rem', fontSize: '0.85rem', color: '#666666' }}>
                This base URL seeds the default A2A agent card (`/.well-known/agent-card.json`) and MCP (`/api/mcp`) endpoints below.
              </p>
            </div>
            <div style={{ marginBottom: '1rem', padding: '1rem', backgroundColor: '#f6f6f6', borderRadius: '8px', border: '1px solid #dcdcdc' }}>
              <label style={{ display: 'block', marginBottom: '0.75rem', fontWeight: 600 }}>
                Select Protocol *
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '0.75rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', padding: '0.5rem', borderRadius: '4px', backgroundColor: protocolSettings.protocol === 'A2A' ? '#e3f2fd' : 'transparent' }}>
                  <input
                    type="radio"
                    name="protocol"
                    value="A2A"
                    checked={protocolSettings.protocol === 'A2A'}
                    onChange={(e) => {
                      setProtocolSettings(prev => ({
                        ...prev,
                        protocol: 'A2A',
                        a2aEndpoint: prev.a2aEndpoint || defaultA2AEndpoint || '',
                      }));
                    }}
                  />
                  <span style={{ fontWeight: 600 }}>A2A Protocol</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', padding: '0.5rem', borderRadius: '4px', backgroundColor: protocolSettings.protocol === 'MCP' ? '#e3f2fd' : 'transparent' }}>
                  <input
                    type="radio"
                    name="protocol"
                    value="MCP"
                    checked={protocolSettings.protocol === 'MCP'}
                    onChange={(e) => {
                      setProtocolSettings(prev => ({
                        ...prev,
                        protocol: 'MCP',
                        mcpEndpoint: prev.mcpEndpoint || defaultMcpEndpoint || '',
                      }));
                    }}
                  />
                  <span style={{ fontWeight: 600 }}>MCP Protocol</span>
                </label>
              </div>
              {protocolSettings.protocol === 'A2A' && (
                <div style={{ marginTop: '0.75rem' }}>
                  <label style={{ display: 'block', marginBottom: '0.35rem', fontWeight: 600 }}>
                    Endpoint URL
                  </label>
                  <input
                    type="url"
                    value={protocolSettings.a2aEndpoint}
                    onChange={(e) =>
                      setProtocolSettings(prev => ({ ...prev, a2aEndpoint: e.target.value }))
                    }
                    placeholder={defaultA2AEndpoint || 'https://agent.example.com'}
                    style={{ width: '100%', padding: '0.5rem', border: '1px solid #d7d7d7', borderRadius: '6px' }}
                  />
                  {(() => {
                    // Calculate the agent.json path from the A2A endpoint or base URL
                    let agentCardPath = '';
                    try {
                      const urlToUse = protocolSettings.a2aEndpoint || defaultA2AEndpoint || normalizedAgentBaseUrl;
                      if (urlToUse) {
                        const url = new URL(urlToUse);
                        agentCardPath = `${url.origin}/.well-known/agent-card.json`;
                      }
                    } catch (e) {
                      // Invalid URL, skip display
                    }
                    
                    if (agentCardPath) {
                      return (
                        <div style={{ marginTop: '0.5rem', padding: '0.5rem', backgroundColor: '#f0f0f0', borderRadius: '4px', fontSize: '0.85rem' }}>
                          <div style={{ marginBottom: '0.25rem' }}>
                            <strong>Agent Card Path:</strong>{' '}
                            <code style={{ 
                              fontFamily: 'monospace', 
                              backgroundColor: '#fff', 
                              padding: '0.125rem 0.25rem', 
                              borderRadius: '3px',
                              fontSize: '0.8rem'
                            }}>
                              {agentCardPath}
                            </code>
                          </div>
                          <div style={{ color: '#666', fontSize: '0.8rem', fontStyle: 'italic' }}>
                            This path is calculated from your domain. You can override it by setting a <code style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>c=</code> TXT record in your DNS configuration.
                          </div>
                        </div>
                      );
                    }
                    return null;
                  })()}
                  <div style={{ marginTop: '1rem' }}>
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>
                      OASF Skills
                    </label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem', minHeight: '2rem' }}>
                      {protocolSettings.a2aSkills.map((skillId) => {
                        const skill = oasfSkills.find(s => s.id === skillId);
                        return (
                          <span
                            key={skillId}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.5rem',
                              padding: '0.25rem 0.5rem',
                              backgroundColor: '#e3f2fd',
                              border: '1px solid #90caf9',
                              borderRadius: '16px',
                              fontSize: '0.85rem',
                            }}
                          >
                            <span>
                              {skill?.category ? `${skill.category}: ` : ''}
                              {skill ? skill.label : skillId}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setProtocolSettings(prev => ({
                                  ...prev,
                                  a2aSkills: prev.a2aSkills.filter(s => s !== skillId),
                                }));
                              }}
                              style={{
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                padding: 0,
                                margin: 0,
                                fontSize: '1rem',
                                lineHeight: 1,
                                color: '#1976d2',
                                fontWeight: 'bold',
                              }}
                            >
                              ×
                            </button>
                          </span>
                        );
                      })}
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <select
                        value=""
                        onChange={(e) => {
                          const skillId = e.target.value;
                          if (skillId && !protocolSettings.a2aSkills.includes(skillId)) {
                            setProtocolSettings(prev => ({
                              ...prev,
                              a2aSkills: [...prev.a2aSkills, skillId],
                            }));
                          }
                          e.target.value = '';
                        }}
                        style={{
                          flex: 1,
                          padding: '0.5rem',
                          border: '1px solid #d7d7d7',
                          borderRadius: '4px',
                          fontSize: '0.9rem',
                        }}
                        disabled={loadingSkills || oasfSkills.length === 0}
                      >
                        <option value="">
                          {loadingSkills
                            ? 'Loading skills...'
                            : oasfSkills.length === 0
                              ? 'No skills loaded from discovery'
                              : '+ Add skill...'}
                        </option>
                        {renderCategorizedOptions(oasfSkills, protocolSettings.a2aSkills)}
                      </select>
                    </div>
                    {oasfSkillsError && (
                      <p style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: '#b00020' }}>
                        {oasfSkillsError}
                      </p>
                    )}
                  </div>
                  <div style={{ marginTop: '1rem' }}>
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>
                      OASF Domains
                    </label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem', minHeight: '2rem' }}>
                      {protocolSettings.a2aDomains.map((domainId) => {
                        const domain = oasfDomains.find(d => d.id === domainId);
                        return (
                          <span
                            key={domainId}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.5rem',
                              padding: '0.25rem 0.5rem',
                              backgroundColor: '#e3f2fd',
                              border: '1px solid #90caf9',
                              borderRadius: '16px',
                              fontSize: '0.85rem',
                            }}
                          >
                            <span>
                              {domain?.category ? `${domain.category}: ` : ''}
                              {domain ? domain.label : domainId}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setProtocolSettings(prev => ({
                                  ...prev,
                                  a2aDomains: prev.a2aDomains.filter(d => d !== domainId),
                                }));
                              }}
                              style={{
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                padding: 0,
                                margin: 0,
                                fontSize: '1rem',
                                lineHeight: 1,
                                color: '#1976d2',
                                fontWeight: 'bold',
                              }}
                            >
                              ×
                            </button>
                          </span>
                        );
                      })}
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <select
                        value=""
                        onChange={(e) => {
                          const domainId = e.target.value;
                          if (domainId && !protocolSettings.a2aDomains.includes(domainId)) {
                            setProtocolSettings(prev => ({
                              ...prev,
                              a2aDomains: [...prev.a2aDomains, domainId],
                            }));
                          }
                          e.target.value = '';
                        }}
                        style={{
                          flex: 1,
                          padding: '0.5rem',
                          border: '1px solid #d7d7d7',
                          borderRadius: '4px',
                          fontSize: '0.9rem',
                        }}
                        disabled={loadingDomains || oasfDomains.length === 0}
                      >
                        <option value="">
                          {loadingDomains
                            ? 'Loading domains...'
                            : oasfDomains.length === 0
                              ? 'No domains loaded from discovery'
                              : '+ Add domain...'}
                        </option>
                        {renderCategorizedOptions(oasfDomains, protocolSettings.a2aDomains)}
                      </select>
                    </div>
                    {oasfDomainsError && (
                      <p style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: '#b00020' }}>
                        {oasfDomainsError}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
            {protocolSettings.protocol === 'MCP' && (
              <div style={{ marginTop: '0.75rem' }}>
                <label style={{ display: 'block', marginBottom: '0.35rem', fontWeight: 600 }}>
                  Endpoint URL
                </label>
                <input
                  type="url"
                  value={protocolSettings.mcpEndpoint}
                  onChange={(e) =>
                    setProtocolSettings(prev => ({ ...prev, mcpEndpoint: e.target.value }))
                  }
                  placeholder={defaultMcpEndpoint || 'https://agent.example.com/api/mcp'}
                  style={{ width: '100%', padding: '0.5rem', border: '1px solid #d7d7d7', borderRadius: '6px' }}
                />
                <div style={{ marginTop: '1rem' }}>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>
                    OASF Skills
                  </label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem', minHeight: '2rem' }}>
                    {protocolSettings.mcpSkills.map((skillId) => {
                      const skill = oasfSkills.find(s => s.id === skillId);
                      return (
                        <span
                          key={skillId}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            padding: '0.25rem 0.5rem',
                            backgroundColor: '#e3f2fd',
                            border: '1px solid #90caf9',
                            borderRadius: '16px',
                            fontSize: '0.85rem',
                          }}
                        >
                          <span>
                            {skill?.category ? `${skill.category}: ` : ''}
                            {skill ? skill.label : skillId}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setProtocolSettings(prev => ({
                                ...prev,
                                mcpSkills: prev.mcpSkills.filter(s => s !== skillId),
                              }));
                            }}
                            style={{
                              background: 'none',
                              border: 'none',
                              cursor: 'pointer',
                              padding: 0,
                              margin: 0,
                              fontSize: '1rem',
                              lineHeight: 1,
                              color: '#1976d2',
                              fontWeight: 'bold',
                            }}
                          >
                            ×
                          </button>
                        </span>
                      );
                    })}
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <select
                      value=""
                      onChange={(e) => {
                        const skillId = e.target.value;
                        if (skillId && !protocolSettings.mcpSkills.includes(skillId)) {
                          setProtocolSettings(prev => ({
                            ...prev,
                            mcpSkills: [...prev.mcpSkills, skillId],
                          }));
                        }
                        e.target.value = '';
                      }}
                      style={{
                        flex: 1,
                        padding: '0.5rem',
                        border: '1px solid #d7d7d7',
                        borderRadius: '4px',
                        fontSize: '0.9rem',
                      }}
                      disabled={loadingSkills || oasfSkills.length === 0}
                    >
                      <option value="">
                        {loadingSkills
                          ? 'Loading skills...'
                          : oasfSkills.length === 0
                            ? 'No skills loaded from discovery'
                            : '+ Add skill...'}
                      </option>
                      {renderCategorizedOptions(oasfSkills, protocolSettings.mcpSkills)}
                    </select>
                  </div>
                  {oasfSkillsError && (
                    <p style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: '#b00020' }}>
                      {oasfSkillsError}
                    </p>
                  )}
                </div>
                <div style={{ marginTop: '1rem' }}>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>
                    OASF Domains
                  </label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem', minHeight: '2rem' }}>
                    {protocolSettings.mcpDomains.map((domainId) => {
                      const domain = oasfDomains.find(d => d.id === domainId);
                      return (
                        <span
                          key={domainId}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            padding: '0.25rem 0.5rem',
                            backgroundColor: '#e3f2fd',
                            border: '1px solid #90caf9',
                            borderRadius: '16px',
                            fontSize: '0.85rem',
                          }}
                        >
                          <span>
                            {domain?.category ? `${domain.category}: ` : ''}
                            {domain ? domain.label : domainId}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setProtocolSettings(prev => ({
                                ...prev,
                                mcpDomains: prev.mcpDomains.filter(d => d !== domainId),
                              }));
                            }}
                            style={{
                              background: 'none',
                              border: 'none',
                              cursor: 'pointer',
                              padding: 0,
                              margin: 0,
                              fontSize: '1rem',
                              lineHeight: 1,
                              color: '#1976d2',
                              fontWeight: 'bold',
                            }}
                          >
                            ×
                          </button>
                        </span>
                      );
                    })}
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <select
                      value=""
                      onChange={(e) => {
                        const domainId = e.target.value;
                        if (domainId && !protocolSettings.mcpDomains.includes(domainId)) {
                          setProtocolSettings(prev => ({
                            ...prev,
                            mcpDomains: [...prev.mcpDomains, domainId],
                          }));
                        }
                        e.target.value = '';
                      }}
                      style={{
                        flex: 1,
                        padding: '0.5rem',
                        border: '1px solid #d7d7d7',
                        borderRadius: '4px',
                        fontSize: '0.9rem',
                      }}
                    disabled={loadingDomains || oasfDomains.length === 0}
                    >
                    <option value="">
                      {loadingDomains
                        ? 'Loading domains...'
                        : oasfDomains.length === 0
                          ? 'No domains loaded from discovery'
                          : '+ Add domain...'}
                    </option>
                    {renderCategorizedOptions(oasfDomains, protocolSettings.mcpDomains)}
                    </select>
                  </div>
                {oasfDomainsError && (
                  <p style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: '#b00020' }}>
                    {oasfDomainsError}
                  </p>
                )}
                </div>
              </div>
            )}
          </>
        );
      case 4: {
        return (
          <>
            <div style={{ border: '1px solid #dcdcdc', borderRadius: '10px', padding: '1rem', marginBottom: '1rem', backgroundColor: '#f6f6f6' }}>
              <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.1rem', color: '#1f1f1f' }}>Agent Overview</h3>
              <p style={{ margin: '0.25rem 0', color: '#4f4f4f' }}><strong>Chain:</strong> {CHAIN_METADATA[selectedChainId]?.displayName || selectedChainId}</p>
              <p style={{ margin: '0.25rem 0', color: '#4f4f4f' }}><strong>Name:</strong> {createForm.agentName || '—'}</p>

              {didEnsPreview && (
                <p style={{ margin: '0.15rem 0', color: '#4f4f4f' }}>
                  
                  <span style={{ fontFamily: 'monospace' }}>{didEnsPreview}</span>
                </p>
              )}
              {didEthrPreview && (
                <p style={{ margin: '0.15rem 0', color: '#4f4f4f' }}>
                  
                  <span style={{ fontFamily: 'monospace' }}>{didEthrPreview}</span>
                </p>
              )}
              {imagePreviewUrl && (
                <div
                  style={{
                    margin: '0.75rem 0',
                    borderRadius: '10px',
                    border: '1px solid #dcdcdc',
                    overflow: 'hidden',
                    backgroundColor: '#fff',
                  }}
                >
                  {!imagePreviewError ? (
                    <img
                      src={imagePreviewUrl}
                      alt="Agent preview"
                      style={{ height: '80px', width: 'auto', display: 'block' }}
                      onLoad={handleImagePreviewLoad}
                      onError={handleImagePreviewError}
                    />
                  ) : (
                    <p style={{ margin: '0.75rem', color: '#3a3a3a', fontSize: '0.9rem' }}>
                      Unable to load agent image preview.
                    </p>
                  )}
                </div>
              )}
              <p style={{ margin: '0.25rem 0', color: '#4f4f4f' }}><strong>Description:</strong> {createForm.description || '—'}</p>
            </div>
            <div style={{ border: '1px solid #dcdcdc', borderRadius: '10px', padding: '1rem', marginBottom: '1rem', backgroundColor: '#f6f6f6' }}>
              <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.1rem', color: '#2f2f2f' }}>Protocols</h3>
              <p style={{ margin: '0.25rem 0', color: '#2f2f2f' }}>
                <strong>Protocol:</strong> {protocolSettings.protocol || 'Not selected'}
              </p>
              {protocolSettings.protocol === 'A2A' && (
                <p style={{ margin: '0.25rem 0', color: '#2f2f2f' }}>
                  <strong>Agent Card:</strong> {protocolSettings.a2aEndpoint || defaultA2AEndpoint || 'Pending Agent URL'}
                </p>
              )}
              {protocolSettings.protocol === 'MCP' && (
                <p style={{ margin: '0.25rem 0', color: '#2f2f2f' }}>
                  <strong>MCP Endpoint:</strong> {protocolSettings.mcpEndpoint || defaultMcpEndpoint || 'Pending Agent URL'}
                </p>
              )}
            </div>
            <div style={{ border: '1px solid #dcdcdc', borderRadius: '10px', padding: '1rem', marginBottom: '1rem', backgroundColor: '#f6f6f6' }}>
              <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.1rem', color: '#2f2f2f' }}>UAID (HCS-14 Identifier)</h3>
              {uaidLoading ? (
                <p style={{ margin: '0.25rem 0', color: '#4f4f4f' }}>Generating UAID...</p>
              ) : uaid ? (
                <div>
                  <p style={{ margin: '0.25rem 0', color: '#2f2f2f' }}>
                    <strong>UAID:</strong>
                  </p>
                  <p style={{ margin: '0.25rem 0', color: '#2f2f2f' }}>
                    <span style={{ fontFamily: 'monospace', fontSize: '0.9rem', wordBreak: 'break-all', backgroundColor: '#fff', padding: '0.5rem', borderRadius: '4px', display: 'block', border: '1px solid #ddd' }}>{uaid}</span>
                  </p>
                </div>
              ) : (
                <p style={{ margin: '0.25rem 0', color: '#666', fontSize: '0.9rem' }}>
                  UAID will be generated during registration
                </p>
              )}
            </div>
            <p style={{ marginTop: '1rem', fontSize: '0.95rem', color: '#4f4f4f' }}>
              Review the details above. When ready, click <strong>Register Agent</strong> to publish this agent to the selected chain.
            </p>
          </>
        );
      }
      default:
        return null;
    }
  };

  return (
    <>
      <Header
        displayAddress={headerAddress ?? null}
        privateKeyMode={authPrivateKeyMode}
        isConnected={authConnected}
        onConnect={openLoginModal}
        onDisconnect={authHandleDisconnect}
        disableConnect={authLoading}
      />
      <main style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto' }}>
        {!adminReady ? (
          adminGate
        ) : (
          <>
            {registrationCompleteOpen && (
              <div
                role="dialog"
                aria-modal="true"
                style={{
                  position: 'fixed',
                  inset: 0,
                  backgroundColor: 'rgba(0,0,0,0.5)',
                  zIndex: 2100,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '1rem',
                }}
              >
                <div
                  style={{
                    width: '100%',
                    maxWidth: '640px',
                    backgroundColor: '#fff',
                    borderRadius: '16px',
                    border: '1px solid #dcdcdc',
                    padding: '1.25rem',
                    boxShadow: '0 20px 60px rgba(15,23,42,0.25)',
                  }}
                >
                  <h3 style={{ margin: 0, fontSize: '1.25rem' }}>Agent registration complete</h3>
                  <p style={{ marginTop: '0.75rem', color: '#4f4f4f', fontSize: '0.95rem' }}>
                    Your agent has been created successfully.
                  </p>
                  <div
                    style={{
                      marginTop: '0.75rem',
                      padding: '0.75rem',
                      borderRadius: '12px',
                      backgroundColor: '#f6f6f6',
                      border: '1px solid #e5e5e5',
                      color: '#2f2f2f',
                      fontSize: '0.95rem',
                    }}
                  >
                    {registrationCompleteDetails?.agentId && (
                      <div>
                        <strong>Agent ID:</strong>{' '}
                        <span style={{ fontFamily: 'monospace' }}>{registrationCompleteDetails.agentId}</span>
                      </div>
                    )}
                    {registrationCompleteDetails?.txHash && (
                      <div style={{ marginTop: registrationCompleteDetails?.agentId ? '0.35rem' : 0 }}>
                        <strong>TX:</strong>{' '}
                        <span style={{ fontFamily: 'monospace' }}>{registrationCompleteDetails.txHash}</span>
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
                    <button
                      type="button"
                      onClick={() => {
                        setRegistrationCompleteOpen(false);
                        setRegistrationCompleteDetails(null);
                        setSuccess(null);
                        router.push('/agents');
                      }}
                      style={{
                        padding: '0.75rem 1rem',
                        borderRadius: '10px',
                        border: 'none',
                        backgroundColor: '#2f2f2f',
                        color: '#fff',
                        cursor: 'pointer',
                        fontWeight: 800,
                      }}
                    >
                      OK
                    </button>
                  </div>
                </div>
              </div>
            )}

            {walletConfirmOpen && (
              <div
                role="dialog"
                aria-modal="true"
                style={{
                  position: 'fixed',
                  inset: 0,
                  backgroundColor: 'rgba(0,0,0,0.5)',
                  zIndex: 2000,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '1rem',
                }}
                onClick={() => {
                  // click backdrop to cancel
                  setWalletConfirmOpen(false);
                  setWalletConfirmPayload(null);
                  pendingWalletActionRef.current = null;
                }}
              >
                <div
                  style={{
                    width: '100%',
                    maxWidth: '640px',
                    backgroundColor: '#fff',
                    borderRadius: '16px',
                    border: '1px solid #dcdcdc',
                    padding: '1.25rem',
                    boxShadow: '0 20px 60px rgba(15,23,42,0.25)',
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <h3 style={{ margin: 0, fontSize: '1.25rem' }}>Confirm registration</h3>
                  <div
                    style={{
                      marginTop: '0.75rem',
                      padding: '0.75rem',
                      borderRadius: '12px',
                      backgroundColor: '#ecfdf5',
                      border: '1px solid #86efac',
                      color: '#14532d',
                      fontWeight: 800,
                    }}
                  >
                    Sponsored by a paymaster — gasless.
                  </div>
                  <p style={{ marginTop: '0.75rem', color: '#4f4f4f', fontSize: '0.95rem' }}>
                    You&apos;ll be asked to sign a smart-account <strong>UserOperation</strong>. Verify the network + smart
                    account address below before continuing.
                  </p>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '160px 1fr',
                      gap: '0.5rem 1rem',
                      marginTop: '1rem',
                      fontSize: '0.95rem',
                    }}
                  >
                    <div style={{ color: '#6a6a6a' }}>Network</div>
                    <div>{walletConfirmPayload?.chainLabel}</div>
                    <div style={{ color: '#6a6a6a' }}>ENS name</div>
                    <div style={{ fontFamily: 'monospace' }}>{walletConfirmPayload?.ensName}</div>
                    <div style={{ color: '#6a6a6a' }}>Smart account</div>
                    <div style={{ fontFamily: 'monospace' }}>{walletConfirmPayload?.agentAccount}</div>
                    <div style={{ color: '#6a6a6a' }}>A2A endpoint</div>
                    <div style={{ fontFamily: 'monospace' }}>{walletConfirmPayload?.a2aEndpoint ?? '—'}</div>
                    <div style={{ color: '#6a6a6a' }}>MCP endpoint</div>
                    <div style={{ fontFamily: 'monospace' }}>{walletConfirmPayload?.mcpEndpoint ?? '—'}</div>
                  </div>

                  <div
                    style={{
                      marginTop: '0.9rem',
                      padding: '0.75rem',
                      borderRadius: '10px',
                      backgroundColor: '#f6f6f6',
                      border: '1px solid #e5e5e5',
                      color: '#2f2f2f',
                      fontSize: '0.9rem',
                    }}
                  >
                    In MetaMask, confirm you see <strong>Sepolia</strong> (or your selected network) and the smart account address above.
                  </div>

                  <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
                    <button
                      type="button"
                      onClick={() => {
                        setWalletConfirmOpen(false);
                        setWalletConfirmPayload(null);
                        pendingWalletActionRef.current = null;
                      }}
                      style={{
                        flex: 1,
                        padding: '0.75rem',
                        borderRadius: '10px',
                        border: '1px solid #dcdcdc',
                        backgroundColor: '#fff',
                        cursor: 'pointer',
                        fontWeight: 700,
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        const fn = pendingWalletActionRef.current;
                        if (!fn) {
                          setWalletConfirmOpen(false);
                          return;
                        }
                        try {
                          setWalletConfirmOpen(false);
                          await fn();
                        } catch (e: any) {
                          resetRegistrationProgress();
                          setError(e?.message || 'Failed to create agent');
                        } finally {
                          setWalletConfirmPayload(null);
                          pendingWalletActionRef.current = null;
                        }
                      }}
                      style={{
                        flex: 1,
                        padding: '0.75rem',
                        borderRadius: '10px',
                        border: 'none',
                        backgroundColor: '#2f2f2f',
                        color: '#fff',
                        cursor: 'pointer',
                        fontWeight: 800,
                      }}
                    >
                      Continue in MetaMask
                    </button>
                  </div>
                </div>
              </div>
            )}

        {error && (
          <div style={{ 
            marginBottom: '1rem', 
            padding: '1rem', 
            backgroundColor: '#f5f5f5', 
            borderRadius: '4px', 
            border: '1px solid #3a3a3a',
            color: '#3a3a3a'
          }}>
            Error: {error}
          </div>
        )}

      {success && (
        <div style={{ 
          marginBottom: '1rem', 
          padding: '1rem', 
          backgroundColor: '#f2f2f2', 
          borderRadius: '4px', 
          border: '1px solid #3c3c3c',
          color: '#3c3c3c'
        }}>
          Success: {success}
        </div>
      )}

      <div
        style={{
          padding: isMobile ? '0' : '1.5rem',
          backgroundColor: isMobile ? 'transparent' : '#fff',
          borderRadius: isMobile ? '0' : '8px',
          border: isMobile ? 'none' : '1px solid #dcdcdc',
        }}
      >
        {!isMobile && <h2 style={{ marginBottom: '1rem', fontSize: '1.5rem' }}>ERC-8004 Agent Registration</h2>}
        <form onSubmit={(event) => event.preventDefault()}>
          <div style={{ display: 'flex', gap: isMobile ? '0.35rem' : '0.5rem', flexWrap: isMobile ? 'nowrap' : 'wrap', marginBottom: isMobile ? '0.75rem' : '1.0rem', overflowX: isMobile ? 'auto' : undefined }}>
            {CREATE_STEPS.map((label, index) => {
              const isActive = index === createStep;
              const isComplete = index < createStep;
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => handleJumpToStep(index)}
                  disabled={index > createStep}
                  style={{
                    flex: isMobile ? '1 1 0' : '1 1 140px',
                    minWidth: isMobile ? '0' : '140px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.35rem',
                    padding: isMobile ? '0.4rem 0.6rem' : '0.5rem 0.75rem',
                    borderRadius: '999px',
                    border: '1px solid',
                    borderColor: isActive ? '#2f2f2f' : isComplete ? '#3c3c3c' : '#dcdcdc',
                    backgroundColor: isActive ? '#f3f3f3' : isComplete ? '#f4f4f4' : '#fff',
                    color: isActive ? '#2f2f2f' : isComplete ? '#3c3c3c' : '#4f4f4f',
                    fontWeight: 600,
                    fontSize: isMobile ? '0.85rem' : '1rem',
                    whiteSpace: 'nowrap',
                    cursor: index > createStep ? 'not-allowed' : 'pointer',
                    opacity: index > createStep ? 0.6 : 1,
                  }}
                >
                  {!isMobile && (
                    <span style={{ fontWeight: 700, fontSize: '1rem' }}>{index + 1}.</span>
                  )}
                  <span style={{ fontSize: isMobile ? '0.85rem' : '1rem' }}>{getStepLabel(label)}</span>
                </button>
              );
            })}
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: isMobile ? '0.5rem' : '1rem',
              padding: isMobile ? '0.5rem' : '1.25rem',
              border: isMobile ? 'none' : '1px solid #dcdcdc',
              borderRadius: isMobile ? '0' : '12px',
              backgroundColor: isMobile ? 'transparent' : '#f8f8f8',
            }}
          >
            {renderStepContent()}
          </div>
          <div
            style={{
              marginTop: isMobile ? '0.75rem' : '1.5rem',
              display: 'flex',
              justifyContent: 'space-between',
              gap: '1rem',
              flexWrap: 'wrap',
            }}
          >
            {createStep > 0 && (
              <button
                type="button"
                onClick={handlePrevStep}
                style={{
                  flex: '1 1 160px',
                  padding: '0.75rem',
                  borderRadius: '8px',
                  border: '1px solid #dcdcdc',
                  backgroundColor: '#fff',
                  color: '#2a2a2a',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Back
              </button>
            )}
            {!isReviewStep ? (
              <button
                type="button"
                onClick={handleNextStep}
                disabled={!isCurrentStepValid}
                style={{
                  flex: '1 1 200px',
                  padding: '0.75rem',
                  borderRadius: '8px',
                  border: 'none',
                  backgroundColor: isCurrentStepValid ? '#2f2f2f' : '#929292',
                  color: '#fff',
                  fontWeight: 600,
                  cursor: isCurrentStepValid ? 'pointer' : 'not-allowed',
                  opacity: isCurrentStepValid ? 1 : 0.6,
                }}
              >
                Next: {getStepLabel(CREATE_STEPS[createStep + 1])}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleRegisterAgent}
                disabled={registering}
                style={{
                  flex: '1 1 240px',
                  padding: '0.85rem',
                  borderRadius: '8px',
                  border: 'none',
                  backgroundColor: registering ? '#787878' : '#2f2f2f',
                  color: '#fff',
                  fontSize: '1rem',
                  fontWeight: 'bold',
                  cursor: registering ? 'not-allowed' : 'pointer',
                  opacity: registering ? 0.7 : 1,
                }}
              >
                {isMobile ? 'Register' : 'ERC-8004 Agent Registration'}
              </button>
            )}
          </div>
          {registering && (
            <div style={{ width: '100%', marginTop: '1rem' }}>
              <div
                style={{
                  height: '8px',
                  borderRadius: '999px',
                  backgroundColor: '#dedede',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${registerProgress}%`,
                    height: '100%',
                    backgroundColor: '#2a2a2a',
                    transition: 'width 0.2s ease',
                  }}
                />
              </div>
              <p style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: '#4f4f4f' }}>
                Registering agent… {Math.round(registerProgress)}%
              </p>
            </div>
          )}
        </form>
      </div>
          </>
        )}
      </main>
    </>
  );
}
