'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useWallet } from '@/components/WalletProvider';
import { Header } from '@/components/Header';
import { useAuth } from '@/components/AuthProvider';
import type { Address } from 'viem';
import { createAgentWithWalletForEOA, createAgentWithWalletForAA, getCounterfactualAAAddressByAgentName } from '@agentic-trust/core/client';
import type { Chain } from 'viem';
import {
  getEnsOrgName,
  getSupportedChainIds,
  getChainDisplayMetadata,
  getChainById,
  getChainIdHex as getChainIdHexUtil,
  DEFAULT_CHAIN_ID,
} from '@agentic-trust/core/server';
import { ensureWeb3AuthChain } from '@/lib/web3auth';
import { buildDid8004 } from '@agentic-trust/core';
import { buildDidEnsFromAgentAndOrg } from '@/app/api/names/_lib/didEns';
import type { DiscoverParams as AgentSearchParams, DiscoverResponse } from '@agentic-trust/core/server';
type Agent = DiscoverResponse['agents'][number];

const CREATE_STEPS = ['Name', 'Information', 'Protocols', 'Review & Register'] as const;
const REGISTRATION_PROGRESS_DURATION_MS = 60_000;
const REGISTRATION_UPDATE_INTERVAL_MS = 200;

const CHAIN_SUFFIX_MAP: Record<number, string> = {
  11155111: 'SEPOLIA',
  84532: 'BASE_SEPOLIA',
  11155420: 'OPTIMISM_SEPOLIA',
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

export default function AdminPage() {

  // Get consolidated wallet state from useWallet hook
  // This includes: connected, address, eip1193Provider, privateKeyMode
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
  const searchParams = useSearchParams();
  const modeParam = searchParams?.get('mode') ?? null;
  const queryAgentId = searchParams?.get('agentId') ?? null;
  const queryChainId = searchParams?.get('chainId') ?? null;
  const isEditMode = modeParam === 'edit';
  const createOnlyMode = modeParam === 'create';
  const showCreatePane = !isEditMode;
  const showManagementPanes = !createOnlyMode;
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Create agent form state
  const [createForm, setCreateForm] = useState({
    agentName: '',
    agentAccount: '',
    description: '',
    image: '',
    agentUrl: '',
  });
  const [imagePreviewError, setImagePreviewError] = useState(false);
  const handleImagePreviewLoad = useCallback(() => setImagePreviewError(false), []);
  const handleImagePreviewError = useCallback(() => setImagePreviewError(true), []);
  const [createStep, setCreateStep] = useState(0);
  const [protocolSettings, setProtocolSettings] = useState({
    publishA2A: true,
    publishMcp: true,
    a2aEndpoint: '',
    mcpEndpoint: '',
  });
  const [registering, setRegistering] = useState(false);
  const [registerProgress, setRegisterProgress] = useState(0);
  const registerTimerRef = useRef<number | null>(null);
  const totalCreateSteps = CREATE_STEPS.length;
  const isReviewStep = createStep === totalCreateSteps - 1;

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

  useEffect(() => {
    return () => resetRegistrationProgress();
  }, [resetRegistrationProgress]);

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
        Admin Tools
      </p>
      <h2 style={{ margin: 0, fontSize: '2.25rem', color: '#4a4a4a' }}>
        Connect a wallet or admin key to manage agents.
      </h2>
      <p style={{ marginTop: '1rem', color: '#4a4a4a', fontSize: '1.05rem' }}>
        Create, update, delete, and transfer ERC-8004 agents once authenticated.
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
        if (eip1193Provider) {
          const isMetaMask = Boolean((eip1193Provider as any)?.isMetaMask);
          console.info(`[chain] skipping ${isMetaMask ? 'MetaMask' : 'provider'} auto-switch (not connected)`);
        }
      }

      return results.length === 0 || results.every(Boolean);
    },
    [eip1193Provider, eoaConnected, ensureProviderOnChain, CHAIN_METADATA],
  );

  // Toggle states for Create Agent
  const [useAA, setUseAA] = useState(false);
  const [createENS, setCreateENS] = useState(false);
  const [ensOrgName, setEnsOrgName] = useState(getEnsOrgName(DEFAULT_CHAIN_ID)); // Default org name
  const [ensChecking, setEnsChecking] = useState(false);
  const [ensAvailable, setEnsAvailable] = useState<boolean | null>(null);
  const [aaAddress, setAaAddress] = useState<string | null>(null);
  const [aaComputing, setAaComputing] = useState(false);
const [existingAgentInfo, setExistingAgentInfo] = useState<{ account: string; method?: string } | null>(null);

  // Update agent form state
  const [updateForm, setUpdateForm] = useState({
    agentId: '',
    chainId: DEFAULT_CHAIN_ID.toString(),
    tokenURI: '',
    metadataKey: '',
    metadataValue: '',
  });

  // Delete agent form state
  const [deleteForm, setDeleteForm] = useState({
    agentId: '',
    chainId: DEFAULT_CHAIN_ID.toString(),
  });

  // Transfer agent form state
  const [transferForm, setTransferForm] = useState({
    agentId: '',
    chainId: DEFAULT_CHAIN_ID.toString(),
    to: '',
  });

  useEffect(() => {
    if (!isEditMode || !queryAgentId || !queryChainId) {
      return;
    }
    const parsedChainId = Number(queryChainId);
    if (!Number.isFinite(parsedChainId)) {
      return;
    }
    setUpdateForm({
      agentId: queryAgentId,
      chainId: queryChainId,
      tokenURI: '',
      metadataKey: '',
      metadataValue: '',
    });
    setDeleteForm({
      agentId: queryAgentId,
      chainId: queryChainId,
    });
    setTransferForm({
      agentId: queryAgentId,
      chainId: queryChainId,
      to: '',
    });
  }, [isEditMode, queryAgentId, queryChainId]);

  useEffect(() => {
    if (!eip1193Provider && !eoaConnected) {
      console.info('[chain] skip auto-sync (no connected provider)');
      return;
    }
    (async () => {
      const ready = await synchronizeProvidersWithChain(selectedChainId);
      if (!ready) {
        setError('Unable to switch wallet provider to the selected chain. Please switch manually in your wallet.');
        const chainMeta = CHAIN_METADATA[selectedChainId];
        const chainLabel = chainMeta?.displayName || chainMeta?.chainName || `chain ${selectedChainId}`;
        try {
          const envNames = getEnvVarHints(selectedChainId);
          if (envNames) {
            console.error(
              `[chain] Auto-switch failed for ${chainLabel}. Ensure RPC env vars ` +
                `${envNames.rpcClient} (client) and ${envNames.rpcServer} (server) are configured. ` +
                `If you use AA, also set ${envNames.bundlerClient} and ${envNames.bundlerServer}.`,
            );
          }
        } catch (envErr) {
          console.error('[chain] Unable to provide env hint for chain', selectedChainId, envErr);
        }
      }
    })();
  }, [selectedChainId, synchronizeProvidersWithChain, eip1193Provider, eoaConnected]);

  // Set agent account in EOA mode (when AA is not enabled)
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

  // Auto-compute AA address as the agent name changes
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
            console.warn('Server-side AA address computation failed:', err);
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
          console.error('Error computing AA address (server-side):', error);
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
        // Use client-side function to compute AA address with wallet provider
        const computed = await getCounterfactualAAAddressByAgentName(
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
        console.error('Error computing AA address (client-side):', error);
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

  // Check ENS availability when createENS is enabled and agent name changes
  // Only check if AA is enabled (ENS only makes sense for AA agents)
  useEffect(() => {
    if (!useAA || !createENS || !createForm.agentName || !ensOrgName) {
      setEnsAvailable(null);
      return;
    }

    let cancelled = false;
    setEnsChecking(true);

    (async () => {
      try {
        // Build ENS DID from agent name and org name
        const encodedEnsDid = buildDidEnsFromAgentAndOrg(
          selectedChainId,
          createForm.agentName,
          ensOrgName
        );

        // Check ENS availability via API
        const response = await fetch(`/api/names/${encodedEnsDid}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          throw new Error(`API request failed: ${response.status}`);
        }

        const data = await response.json();
        const isAvailable = data.available;
        
        if (!cancelled) {
          setEnsAvailable(isAvailable);
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
  }, [useAA, createENS, createForm.agentName, ensOrgName, selectedChainId]);
  

  // Reset ENS toggle when AA is disabled
  useEffect(() => {
    if (!useAA) {
      setCreateENS(false);
    }
  }, [useAA]);

  useEffect(() => {
    setImagePreviewError(false);
  }, [createForm.image]);

  // Keep ENS org name in sync with selected chain
  useEffect(() => {
    try {
      const name = getEnsOrgName(selectedChainId);
      setEnsOrgName(name);
    } catch (e) {
      // If missing, surface error, but don't crash UI
      console.warn('Missing chain-specific ENS org name for chain', selectedChainId, e);
      setEnsOrgName('');
    }
  }, [selectedChainId]);


  const validateCurrentStep = useCallback((): boolean => {
    setError(null);
    switch (createStep) {
      case 0: {
        if (!createForm.agentName.trim()) {
          setError('Agent name is required.');
          return false;
        }
        if (!useAA) {
          const account = createForm.agentAccount.trim();
          if (!/^0x[a-fA-F0-9]{40}$/.test(account)) {
            setError('Provide a valid agent account address or enable Account Abstraction.');
            return false;
          }
        }
        return true;
      }
      case 1: {
        if (!createForm.description.trim()) {
          setError('Please provide a description for your agent.');
          return false;
        }
        return true;
      }
      case 2: {
        if ((protocolSettings.publishA2A || protocolSettings.publishMcp) && !createForm.agentUrl.trim()) {
          setError('Agent URL is required to configure protocol endpoints.');
          return false;
        }
        if (protocolSettings.publishA2A && !protocolSettings.a2aEndpoint.trim()) {
          setError('Provide an A2A protocol endpoint URL.');
          return false;
        }
        if (protocolSettings.publishMcp && !protocolSettings.mcpEndpoint.trim()) {
          setError('Provide an MCP protocol endpoint URL.');
          return false;
        }
        if (createENS && !ensOrgName.trim()) {
          setError('ENS parent name is required when ENS publishing is enabled.');
          return false;
        }
        return true;
      }
      case 3:
      default:
        return true;
    }
  }, [
    createStep,
    createForm.agentName,
    createForm.agentAccount,
    createForm.description,
    createForm.agentUrl,
    useAA,
    protocolSettings.publishA2A,
    protocolSettings.publishMcp,
    protocolSettings.a2aEndpoint,
    protocolSettings.mcpEndpoint,
    createENS,
    ensOrgName,
  ]);

  const handleNextStep = useCallback(() => {
    if (!validateCurrentStep()) {
      return;
    }
    setCreateStep(prev => Math.min(prev + 1, totalCreateSteps - 1));
  }, [validateCurrentStep, totalCreateSteps]);

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
      startRegistrationProgress();

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

      // If using AA, compute or confirm the AA address
      if (useAA) {
        if (privateKeyMode) {
          // Private key mode: prefer already-computed AA address from state,
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
                  'Server-side AA address computation failed. Ensure private key mode is configured.',
              );
            }

            const data = await resp.json();
            computedAa = (data?.address as string) || '';
          }

          if (!computedAa || !computedAa.startsWith('0x')) {
            throw new Error('Failed to compute AA address. Please retry.');
          }

          setAaAddress(computedAa);
          agentAccountToUse = computedAa as `0x${string}`;
          setSuccess('Using Account Abstraction address (server-side)…');
        } else {
          // Wallet mode: compute AA address using wallet provider (client-side)
          if (!eip1193Provider) {
            throw new Error('Wallet provider is required to compute AA address. Please connect your wallet.');
          }
          if (!eoaAddress) {
            throw new Error('EOA address is required to compute AA address.');
          }

          const computedAa = await getCounterfactualAAAddressByAgentName(
            createForm.agentName,
            eoaAddress as `0x${string}`,
            {
              ethereumProvider: eip1193Provider as any,
              chain: CHAIN_OBJECTS[selectedChainId] ?? CHAIN_OBJECTS[DEFAULT_CHAIN_ID],
            },
          );
          if (!computedAa || !computedAa.startsWith('0x')) {
            throw new Error('Failed to compute AA address. Please retry.');
          }
          setAaAddress(computedAa);
          agentAccountToUse = computedAa as `0x${string}`;
          setSuccess('Using Account Abstraction address...');
        }
      }

      // Validate agentAccountToUse before proceeding
      if (!agentAccountToUse || agentAccountToUse.trim() === '' || !agentAccountToUse.startsWith('0x')) {
        throw new Error('Agent account address is required. Please provide an agent account address or enable Account Abstraction.');
      }


      // Use core utility to create agent (handles API call, signing, and refresh)
      // Only agentData is required - account, chain, and provider are auto-detected
      if (useAA == false) {
        // EOA agent creation
        if (privateKeyMode) {
          // Server-only path (admin private key signs on server)
          const resp = await fetch('/api/agents/create-for-eoa-pk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              agentName: createForm.agentName,
              agentAccount: agentAccountToUse,
              description: createForm.description || undefined,
              image: createForm.image || undefined,
              agentUrl: createForm.agentUrl || undefined,
              chainId: selectedChainId,
            }),
          });
          if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err?.message || err?.error || 'Server EOA agent creation failed');
          }
          const data = await resp.json();
          if (data?.agentId) {
            setSuccess(`Agent created successfully! Agent ID: ${data.agentId}, TX: ${data.txHash}`);
          } else if (data?.txHash) {
            setSuccess(`Agent creation transaction confirmed! TX: ${data.txHash} (Agent ID will be available after indexing)`);
          } else {
            setSuccess('Agent creation requested. Check server logs for details.');
          }
        } else {
          // Client path (requires connected wallet/provider)
        const result = await createAgentWithWalletForEOA({
          agentData: {
              agentName: createForm.agentName,
            agentAccount: agentAccountToUse,
            description: createForm.description || undefined,
            image: createForm.image || undefined,
            agentUrl: createForm.agentUrl || undefined,
          },
          account: eoaAddress as Address,
          ethereumProvider: eip1193Provider as any,
          onStatusUpdate: setSuccess,
          useAA: useAA || undefined,
          chainId: selectedChainId,
        });

        if (result.agentId) {
          setSuccess(`Agent created successfully! Agent ID: ${result.agentId}, TX: ${result.txHash}`);
        } else {
          setSuccess(`Agent creation transaction confirmed! TX: ${result.txHash} (Agent ID will be available after indexing)`);
          }
        }
      }
      else {
        // Account Abstraction (AA) creation
        if (privateKeyMode) {
          // Server-only path (admin private key signs on server)
          const resp = await fetch('/api/agents/create-for-aa-pk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              agentName: createForm.agentName,
              agentAccount: agentAccountToUse,
              description: createForm.description || undefined,
              image: createForm.image || undefined,
              agentUrl: createForm.agentUrl || undefined,
              chainId: selectedChainId,
              ensOptions: {
                enabled: !!createENS,
                orgName: createENS ? ensOrgName : undefined,
              },
            }),
          });
          if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err?.message || err?.error || 'Server AA agent creation failed');
          }
          const data = await resp.json();
          if (data?.agentId) {
            setSuccess(`Agent created successfully! Agent ID: ${data.agentId}, TX: ${data.txHash}`);
          } else if (data?.txHash) {
            setSuccess(`Agent creation transaction confirmed! TX: ${data.txHash} (Agent ID will be available after indexing)`);
          } else {
            setSuccess('Agent AA creation requested. Check server logs for details.');
          }
        } else {
          // Client path (requires connected wallet/provider)
        const result = await createAgentWithWalletForAA({
          agentData: {
              agentName: createForm.agentName,
            agentAccount: agentAccountToUse,
            description: createForm.description || undefined,
            image: createForm.image || undefined,
            agentUrl: createForm.agentUrl || undefined,
          },
          account: eoaAddress as Address,
          ethereumProvider: eip1193Provider as any,
          onStatusUpdate: setSuccess,
          useAA: useAA || undefined,
          ensOptions: {
            enabled: !!createENS,
            orgName: createENS ? ensOrgName : undefined,
          },
          chainId: selectedChainId,
        });

        if (result.agentId) {
          setSuccess(`Agent created successfully! Agent ID: ${result.agentId}, TX: ${result.txHash}`);
        } else {
          setSuccess(`Agent creation transaction confirmed! TX: ${result.txHash} (Agent ID will be available after indexing)`);
          }
        }
      }
      

      
      
      setCreateForm({ agentName: '', agentAccount: '', description: '', image: '', agentUrl: '' });
      setUseAA(false);
      setCreateENS(false);
      setAaAddress(null);
      setCreateStep(0);
      setProtocolSettings({ publishA2A: true, publishMcp: true, a2aEndpoint: '', mcpEndpoint: '' });

      setRegisterProgress(100);
      if (registerTimerRef.current) {
        clearInterval(registerTimerRef.current);
        registerTimerRef.current = null;
      }
      setTimeout(() => {
        resetRegistrationProgress();
        router.push('/agents');
      }, 800);
    } catch (err) {
      console.error('Error creating agent:', err);
      resetRegistrationProgress();
      setError(err instanceof Error ? err.message : 'Failed to create agent');
    }
  };

  const handleUpdateAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setError(null);
      setSuccess(null);

      const metadata =
        updateForm.metadataKey && updateForm.metadataValue
          ? [{ key: updateForm.metadataKey, value: updateForm.metadataValue }]
          : undefined;

      const parsedChainId = Number.parseInt(updateForm.chainId, 10);
      const chainId = Number.isFinite(parsedChainId)
        ? parsedChainId
        : DEFAULT_CHAIN_ID;

      const did8004 = buildDid8004(chainId, updateForm.agentId);

      const response = await fetch(`/api/agents/${did8004}/update`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenURI: updateForm.tokenURI || undefined,
          chainId,
          metadata,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || errorData.error || 'Failed to update agent');
      }

      const data = await response.json();
      setSuccess(`Agent updated successfully! TX: ${data.txHash}`);
      setUpdateForm({
        agentId: '',
        chainId: DEFAULT_CHAIN_ID.toString(),
        tokenURI: '',
        metadataKey: '',
        metadataValue: '',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update agent');
    }
  };

  const normalizedAgentBaseUrl = (createForm.agentUrl || '').trim().replace(/\/$/, '');
  const imagePreviewUrl = (createForm.image || '').trim();
  const defaultA2AEndpoint = normalizedAgentBaseUrl ? `${normalizedAgentBaseUrl}/.well-known/agent-card.json` : '';
  const defaultMcpEndpoint = normalizedAgentBaseUrl ? `${normalizedAgentBaseUrl}/mcp` : '';
  const previousDefaultsRef = useRef({ a2a: '', mcp: '' });
  const ensFullNamePreview =
    createENS && createForm.agentName && ensOrgName
      ? `${createForm.agentName.toLowerCase()}.${ensOrgName.toLowerCase()}.eth`
      : null;

  useEffect(() => {
    const prevDefaults = previousDefaultsRef.current;
    setProtocolSettings(prev => {
      const next: typeof prev = { ...prev };
      let changed = false;
      if (prev.publishA2A && defaultA2AEndpoint) {
        const shouldUpdate = !prev.a2aEndpoint || prev.a2aEndpoint === prevDefaults.a2a;
        if (shouldUpdate) {
          next.a2aEndpoint = defaultA2AEndpoint;
          changed = true;
        }
      }
      if (prev.publishMcp && defaultMcpEndpoint) {
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
            <div style={{ marginBottom: '1rem' }}>
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
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #dcdcdc', borderRadius: '4px' }}
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
            <div style={{ marginBottom: '1rem', padding: '0.75rem', backgroundColor: '#f5f5f5', borderRadius: '8px', border: '1px solid #dcdcdc' }}>
              <p style={{ margin: 0, fontWeight: 600, color: '#1f1f1f', marginBottom: '0.5rem' }}>Agent Owner Type</p>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => {
                    setUseAA(false);
                    if (eoaAddress) {
                      setCreateForm(prev => ({ ...prev, agentAccount: eoaAddress }));
                    }
                    setAaAddress(null);
                  }}
                  style={{
                    flex: '1 1 160px',
                    padding: '0.5rem 0.75rem',
                    borderRadius: '10px',
                    border: '1px solid',
                    borderColor: useAA ? '#dcdcdc' : '#2f2f2f',
                    backgroundColor: useAA ? '#fff' : '#2f2f2f',
                    color: useAA ? '#2a2a2a' : '#fff',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  EOA Agent Owner
                </button>
                <button
                  type="button"
                  onClick={() => setUseAA(true)}
                  style={{
                    flex: '1 1 160px',
                    padding: '0.5rem 0.75rem',
                    borderRadius: '10px',
                    border: '1px solid',
                    borderColor: useAA ? '#2f2f2f' : '#dcdcdc',
                    backgroundColor: useAA ? '#2f2f2f' : '#fff',
                    color: useAA ? '#fff' : '#2a2a2a',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Smart Account Agent Owner
                </button>
              </div>
              <p style={{ marginTop: '0.25rem', fontSize: '0.85rem', color: '#666666' }}>
                {useAA
                  ? 'Agent ownership is managed through a smart account generated from the agent name.'
                  : 'Use your connected wallet address as the agent owner (EOA).'}
              </p>
            </div>
            <div style={{ marginBottom: '1rem' }}>
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
              <label style={{ display: 'block', marginBottom: '0.4rem', fontWeight: 'bold' }}>
                Agent Account (0x...) {useAA ? '(Auto-generated)' : '*'}
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
              {!useAA && !createForm.agentAccount && (
                <p style={{ marginTop: '0.3rem', fontSize: '0.85rem', color: '#3a3a3a' }}>
                  Connect a wallet to set the owning EOA address.
                </p>
              )}
              {useAA && aaComputing && (
                <p style={{ marginTop: '0.3rem', fontSize: '0.85rem', color: '#2f2f2f' }}>
                  Computing smart account address from agent name...
                </p>
              )}
              {useAA && existingAgentInfo && (
                <p style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: '#505050' }}>
                  Existing agent detected at <span style={{ fontFamily: 'monospace' }}>{existingAgentInfo?.account}</span>
                  {existingAgentInfo?.method ? ` (resolved via ${existingAgentInfo.method})` : ''}. Creating a new agent will overwrite on-chain metadata for this name.
                </p>
              )}
            </div>
            <div style={{ marginBottom: '1rem', padding: '0.85rem', backgroundColor: '#f5f5f5', borderRadius: '6px', border: '1px solid #dcdcdc' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: useAA ? 'pointer' : 'not-allowed' }}>
                <input
                  type="checkbox"
                  checked={createENS}
                  disabled={!useAA}
                  onChange={(e) => setCreateENS(e.target.checked)}
                  style={{ width: '18px', height: '18px', cursor: useAA ? 'pointer' : 'not-allowed' }}
                />
                <span style={{ fontWeight: 'bold' }}>Register ENS Name</span>
              </label>
              <p style={{ marginTop: '0.25rem', marginLeft: '1.75rem', fontSize: '0.85rem', color: '#666666' }}>
                {useAA
                  ? 'Create an ENS subdomain for this smart-account-owned agent (agentname.orgname.eth).'
                  : 'ENS registration is only available for Smart Account agent owners.'}
              </p>
              {useAA && createENS && (
                <div style={{ marginTop: '0.5rem', marginLeft: '1.75rem' }}>
                  <p style={{ margin: 0, fontSize: '0.85rem', fontWeight: 'bold' }}>ENS Org Name (parent domain)</p>
                  <div
                    style={{
                      marginTop: '0.35rem',
                      padding: '0.5rem 0.75rem',
                      border: '1px solid #dcdcdc',
                      borderRadius: '6px',
                      backgroundColor: '#fff',
                      fontFamily: 'monospace',
                    }}
                  >
                    {ensOrgName || 'Not configured'}
                  </div>
                  <p style={{ marginTop: '0.35rem', fontSize: '0.8rem', color: '#4f4f4f' }}>
                    Full ENS name will be: {ensFullNamePreview || 'agentname.orgname.eth'}
                  </p>
                  {ensChecking && (
                    <p style={{ marginTop: '0.25rem', fontSize: '0.85rem', color: '#2f2f2f' }}>
                      Checking ENS availability...
                    </p>
                  )}
                  {ensAvailable === true && (
                    <p style={{ marginTop: '0.25rem', fontSize: '0.85rem', color: '#3c3c3c' }}>
                      ✓ ENS name is available
                    </p>
                  )}
                  {ensAvailable === false && (
                    <p style={{ marginTop: '0.25rem', fontSize: '0.85rem', color: '#3a3a3a' }}>
                      ✗ ENS name is not available
                    </p>
                  )}
                </div>
              )}
            </div>
          </>
        );
      case 1:
        return (
          <>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                Description
              </label>
              <textarea
                value={createForm.description}
                onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                rows={3}
                placeholder="A natural language description of the agent..."
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #dcdcdc', borderRadius: '4px', fontFamily: 'inherit' }}
              />
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                Image URL
              </label>
              <input
                type="url"
                value={createForm.image}
                onChange={(e) => setCreateForm({ ...createForm, image: e.target.value })}
                placeholder="https://example.com/agent-image.png"
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #dcdcdc', borderRadius: '4px' }}
              />
              {imagePreviewUrl && (
                <div
                  style={{
                    marginTop: '0.75rem',
                    border: '1px solid #dcdcdc',
                    borderRadius: '8px',
                    padding: '0.75rem',
                    backgroundColor: '#f6f6f6',
                  }}
                >
                  <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.85rem', color: '#4f4f4f' }}>Preview</p>
                  {!imagePreviewError ? (
                    <img
                      src={imagePreviewUrl}
                      alt="Agent preview"
                      style={{ width: '100%', maxHeight: '240px', objectFit: 'cover', borderRadius: '6px' }}
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
                Agent URL (Base URL)
              </label>
              <input
                type="url"
                value={createForm.agentUrl}
                onChange={(e) => setCreateForm({ ...createForm, agentUrl: e.target.value })}
                placeholder="https://agent.example.com"
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #dcdcdc', borderRadius: '4px' }}
              />
              <p style={{ marginTop: '0.25rem', fontSize: '0.85rem', color: '#666666' }}>
                This base URL seeds the default A2A (`/.well-known/agent-card.json`) and MCP (`/mcp`) endpoints below.
              </p>
            </div>
            <div style={{ marginBottom: '1rem', padding: '1rem', backgroundColor: '#f6f6f6', borderRadius: '8px', border: '1px solid #dcdcdc' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={protocolSettings.publishA2A}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setProtocolSettings(prev => ({
                      ...prev,
                      publishA2A: checked,
                      a2aEndpoint: checked
                        ? prev.a2aEndpoint || defaultA2AEndpoint || prev.a2aEndpoint
                        : prev.a2aEndpoint,
                    }));
                  }}
                />
                <span style={{ fontWeight: 600 }}>A2A Protocol Endpoint</span>
              </label>
              <p style={{ marginTop: '0.25rem', fontSize: '0.85rem', color: '#4f4f4f' }}>
                {defaultA2AEndpoint
                  ? `Default: ${defaultA2AEndpoint}`
                  : 'Set an Agent URL above to preview the agent card endpoint.'}
              </p>
              {protocolSettings.publishA2A && (
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
                    placeholder={defaultA2AEndpoint || 'https://agent.example.com/.well-known/agent-card.json'}
                    style={{ width: '100%', padding: '0.5rem', border: '1px solid #d7d7d7', borderRadius: '6px' }}
                  />
                </div>
              )}
            </div>
            <div style={{ marginBottom: '1rem', padding: '1rem', backgroundColor: '#f6f6f6', borderRadius: '8px', border: '1px solid #f6f6f6' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={protocolSettings.publishMcp}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setProtocolSettings(prev => ({
                      ...prev,
                      publishMcp: checked,
                      mcpEndpoint: checked
                        ? prev.mcpEndpoint || defaultMcpEndpoint || prev.mcpEndpoint
                        : prev.mcpEndpoint,
                    }));
                  }}
                />
                <span style={{ fontWeight: 600 }}>MCP Protocol Endpoint</span>
              </label>
              <p style={{ marginTop: '0.25rem', fontSize: '0.85rem', color: '#4c4c4c' }}>
                {defaultMcpEndpoint
                  ? `Default: ${defaultMcpEndpoint}`
                  : 'Set an Agent URL above to preview the MCP endpoint.'}
              </p>
              {protocolSettings.publishMcp && (
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
                    placeholder={defaultMcpEndpoint || 'https://agent.example.com/mcp'}
                    style={{ width: '100%', padding: '0.5rem', border: '1px solid #d7d7d7', borderRadius: '6px' }}
                  />
                </div>
              )}
            </div>
          </>
        );
      case 3: {
        return (
          <>
            <div style={{ border: '1px solid #dcdcdc', borderRadius: '10px', padding: '1rem', marginBottom: '1rem', backgroundColor: '#f6f6f6' }}>
              <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.1rem', color: '#1f1f1f' }}>Agent Overview</h3>
              <p style={{ margin: '0.25rem 0', color: '#4f4f4f' }}><strong>Chain:</strong> {CHAIN_METADATA[selectedChainId]?.displayName || selectedChainId}</p>
              <p style={{ margin: '0.25rem 0', color: '#4f4f4f' }}><strong>Name:</strong> {createForm.agentName || '—'}</p>
              <p style={{ margin: '0.25rem 0', color: '#4f4f4f' }}>
                <strong>ENS:</strong>{' '}
                {createENS && ensFullNamePreview
                  ? `${ensFullNamePreview}${ensAvailable === false ? ' (unavailable)' : ''}`
                  : createENS
                    ? 'Pending agent details'
                    : 'Not registering'}
              </p>
              <p style={{ margin: '0.25rem 0', color: '#4f4f4f', fontFamily: 'monospace' }}><strong>Account:</strong> {createForm.agentAccount || '—'}</p>
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
                      style={{ width: '100%', maxHeight: '240px', objectFit: 'cover', display: 'block' }}
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
                <strong>Agent Card:</strong> {protocolSettings.publishA2A ? protocolSettings.a2aEndpoint || defaultA2AEndpoint || 'Pending Agent URL' : 'Disabled'}
              </p>
              <p style={{ margin: '0.25rem 0', color: '#2f2f2f' }}>
                <strong>MCP:</strong> {protocolSettings.publishMcp ? protocolSettings.mcpEndpoint || defaultMcpEndpoint || 'Pending Agent URL' : 'Disabled'}
              </p>
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

  const handleDeleteAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!confirm(`Are you sure you want to delete agent ${deleteForm.agentId}? This action cannot be undone.`)) {
      return;
    }

    try {
      setError(null);
      setSuccess(null);
      const parsedChainId = Number.parseInt(deleteForm.chainId, 10);
      const chainId = Number.isFinite(parsedChainId)
        ? parsedChainId
        : DEFAULT_CHAIN_ID;
      const did8004 = buildDid8004(chainId, deleteForm.agentId);

      const response = await fetch(`/api/agents/${did8004}/delete`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || errorData.error || 'Failed to delete agent');
      }

      const data = await response.json();
      setSuccess(`Agent deleted successfully! TX: ${data.txHash}`);
      setDeleteForm({ agentId: '', chainId: DEFAULT_CHAIN_ID.toString() });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete agent');
    }
  };

  const handleTransferAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setError(null);
      setSuccess(null);

      const parsedChainId = Number.parseInt(transferForm.chainId, 10);
      const chainId = Number.isFinite(parsedChainId)
        ? parsedChainId
        : DEFAULT_CHAIN_ID;
      const did8004 = buildDid8004(chainId, transferForm.agentId);

      const response = await fetch(`/api/agents/${did8004}/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: transferForm.to,
          chainId,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || errorData.error || 'Failed to transfer agent');
      }

      const data = await response.json();
      setSuccess(`Agent transferred successfully! TX: ${data.txHash}`);
      setTransferForm({ agentId: '', chainId: DEFAULT_CHAIN_ID.toString(), to: '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to transfer agent');
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

      {isEditMode && queryAgentId && queryChainId && (
        <div
          style={{
            marginBottom: '1.5rem',
            padding: '1rem 1.5rem',
            borderRadius: '14px',
            border: '1px solid #dadada',
            backgroundColor: '#f3f3f3',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '1rem',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <div style={{ fontWeight: 700, color: '#2f2f2f' }}>
              Editing agent #{queryAgentId} (chain {queryChainId})
            </div>

          </div>

        </div>
      )}



      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: '1.5rem',
          marginBottom: '2rem',
        }}
      >
        {showCreatePane && (
        <div
          style={{
            gridColumn: showManagementPanes ? '1 / -1' : 'auto',
            padding: '1.5rem',
            backgroundColor: '#fff',
            borderRadius: '8px',
            border: '1px solid #dcdcdc',
          }}
        >
          <h2 style={{ marginBottom: '1rem', fontSize: '1.5rem' }}>Register Agent</h2>
          <form onSubmit={(event) => event.preventDefault()}>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
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
                      flex: '1 1 140px',
                      minWidth: '140px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.35rem',
                      padding: '0.5rem 0.75rem',
                      borderRadius: '999px',
                      border: '1px solid',
                      borderColor: isActive ? '#2f2f2f' : isComplete ? '#3c3c3c' : '#dcdcdc',
                      backgroundColor: isActive ? '#f3f3f3' : isComplete ? '#f4f4f4' : '#fff',
                      color: isActive ? '#2f2f2f' : isComplete ? '#3c3c3c' : '#4f4f4f',
                      fontWeight: 600,
                      cursor: index > createStep ? 'not-allowed' : 'pointer',
                      opacity: index > createStep ? 0.6 : 1,
                    }}
                  >
                    <span style={{ fontWeight: 700 }}>{index + 1}.</span>
                    {label}
                  </button>
                );
              })}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {renderStepContent()}
            </div>
            <div
              style={{
                marginTop: '1.5rem',
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
                  style={{
                    flex: '1 1 200px',
                    padding: '0.75rem',
                    borderRadius: '8px',
                    border: 'none',
                    backgroundColor: '#2f2f2f',
                    color: '#fff',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Next: {CREATE_STEPS[createStep + 1]}
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
                  Register Agent
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
        )}

        {showManagementPanes && (
        <div style={{ padding: '1.5rem', backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #dcdcdc' }}>
          <h2 style={{ marginBottom: '1rem', fontSize: '1.5rem' }}>Update Agent</h2>
          <form onSubmit={handleUpdateAgent}>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                Agent ID *
              </label>
              <input
                type="text"
                value={updateForm.agentId}
                onChange={(e) => setUpdateForm({ ...updateForm, agentId: e.target.value })}
                required
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #dcdcdc', borderRadius: '4px' }}
              />
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                Chain ID *
              </label>
              <input
                type="number"
                value={updateForm.chainId}
                onChange={(e) =>
                  setUpdateForm({ ...updateForm, chainId: e.target.value })
                }
                required
                min={0}
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #dcdcdc', borderRadius: '4px' }}
              />
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                New Token URI (optional)
              </label>
              <input
                type="text"
                value={updateForm.tokenURI}
                onChange={(e) => setUpdateForm({ ...updateForm, tokenURI: e.target.value })}
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #dcdcdc', borderRadius: '4px' }}
              />
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                Metadata Key (optional)
              </label>
              <input
                type="text"
                value={updateForm.metadataKey}
                onChange={(e) => setUpdateForm({ ...updateForm, metadataKey: e.target.value })}
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #dcdcdc', borderRadius: '4px' }}
              />
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                Metadata Value (optional)
              </label>
              <input
                type="text"
                value={updateForm.metadataValue}
                onChange={(e) => setUpdateForm({ ...updateForm, metadataValue: e.target.value })}
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #dcdcdc', borderRadius: '4px' }}
              />
            </div>
            <button
              type="submit"
              style={{
                width: '100%',
                padding: '0.75rem',
                backgroundColor: '#3c3c3c',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '1rem',
                fontWeight: 'bold',
              }}
            >
              Update Agent
            </button>
          </form>
        </div>
        )}
        {showManagementPanes && (
        <div style={{ padding: '1.5rem', backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #dcdcdc' }}>
          <h2 style={{ marginBottom: '1rem', fontSize: '1.5rem', color: '#3a3a3a' }}>Delete Agent</h2>
          <form onSubmit={handleDeleteAgent}>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                Agent ID *
              </label>
              <input
                type="text"
                value={deleteForm.agentId}
                onChange={(e) => setDeleteForm({ ...deleteForm, agentId: e.target.value })}
                required
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #dcdcdc', borderRadius: '4px' }}
              />
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                Chain ID *
              </label>
              <input
                type="number"
                value={deleteForm.chainId}
                onChange={(e) =>
                  setDeleteForm({ ...deleteForm, chainId: e.target.value })
                }
                required
                min={0}
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #dcdcdc', borderRadius: '4px' }}
              />
            </div>
            <button
              type="submit"
              style={{
                width: '100%',
                padding: '0.75rem',
                backgroundColor: '#3a3a3a',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '1rem',
                fontWeight: 'bold',
              }}
            >
              Delete Agent
            </button>
          </form>
        </div>
        )}

        {showManagementPanes && (
        <div style={{ padding: '1.5rem', backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #dcdcdc' }}>
          <h2 style={{ marginBottom: '1rem', fontSize: '1.5rem' }}>Transfer Agent</h2>
          <form onSubmit={handleTransferAgent}>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                Agent ID *
              </label>
              <input
                type="text"
                value={transferForm.agentId}
                onChange={(e) => setTransferForm({ ...transferForm, agentId: e.target.value })}
                required
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #dcdcdc', borderRadius: '4px' }}
              />
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                Chain ID *
              </label>
              <input
                type="number"
                value={transferForm.chainId}
                onChange={(e) =>
                  setTransferForm({ ...transferForm, chainId: e.target.value })
                }
                required
                min={0}
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #dcdcdc', borderRadius: '4px' }}
              />
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                Transfer To (0x...) *
              </label>
              <input
                type="text"
                value={transferForm.to}
                onChange={(e) => setTransferForm({ ...transferForm, to: e.target.value })}
                required
                pattern="^0x[a-fA-F0-9]{40}$"
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #dcdcdc', borderRadius: '4px', fontFamily: 'monospace' }}
              />
            </div>
            <button
              type="submit"
              style={{
                width: '100%',
                padding: '0.75rem',
                backgroundColor: '#d4d4d4',
                color: '#000',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '1rem',
                fontWeight: 'bold',
              }}
            >
              Transfer Agent
            </button>
          </form>
        </div>
        )}
      </div>


          </>
        )}

    </main>
    </>
  );
}

