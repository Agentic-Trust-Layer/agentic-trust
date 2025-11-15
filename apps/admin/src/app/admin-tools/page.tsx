'use client';

import React, { useState, useEffect, useCallback } from 'react';
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
        background: 'linear-gradient(135deg, #fef3c7, #fffbeb)',
        borderRadius: '24px',
        padding: '3rem',
        border: '1px solid #fde68a',
        textAlign: 'center',
      }}
    >
      <p
        style={{
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: '#d97706',
          fontWeight: 700,
          marginBottom: '1rem',
        }}
      >
        Admin Tools
      </p>
      <h2 style={{ margin: 0, fontSize: '2.25rem', color: '#92400e' }}>
        Connect a wallet or admin key to manage agents.
      </h2>
      <p style={{ marginTop: '1rem', color: '#854d0e', fontSize: '1.05rem' }}>
        Create, update, delete, and transfer ERC-8004 agents once authenticated.
      </p>
      <div style={{ marginTop: '2rem' }}>
        <button
          onClick={openLoginModal}
          style={{
            padding: '0.85rem 2rem',
            borderRadius: '999px',
            border: 'none',
            backgroundColor: '#d97706',
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


  const handleCreateAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setError(null);
      setSuccess(null);
      


      if (!privateKeyMode) {
      const ready = await synchronizeProvidersWithChain(selectedChainId);
      if (!ready) {
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
      
      // Refresh agents list after a short delay to allow indexing
      setTimeout(() => {
      }, 2000);
    } catch (err) {
      console.error('Error creating agent:', err);
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
            backgroundColor: '#ffebee', 
            borderRadius: '4px', 
            border: '1px solid #f44336',
            color: '#c62828'
          }}>
            Error: {error}
          </div>
        )}

      {success && (
        <div style={{ 
          marginBottom: '1rem', 
          padding: '1rem', 
          backgroundColor: '#e8f5e9', 
          borderRadius: '4px', 
          border: '1px solid #4caf50',
          color: '#2e7d32'
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
            border: '1px solid #bfdbfe',
            backgroundColor: '#eff6ff',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '1rem',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <div style={{ fontWeight: 700, color: '#1d4ed8' }}>
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
            border: '1px solid #ddd',
          }}
        >
          <h2 style={{ marginBottom: '1rem', fontSize: '1.5rem' }}>Create Agent</h2>

          {/* Chain Selection */}
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
                // Clear ENS availability when chain changes
                setEnsAvailable(null);
                setAaAddress(null);
                synchronizeProvidersWithChain(nextChainId);
              }}
              style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
            >
              {supportedChainIds.map(chainId => {
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

          {/* EOA/AA Toggle */}
          <div style={{ marginBottom: '1rem', padding: '0.75rem', backgroundColor: '#f8f9fa', borderRadius: '4px', border: '1px solid #e1e4e8' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={useAA}
                onChange={(e) => {
                  setUseAA(e.target.checked);
                  if (!e.target.checked) {
                    // Reset to EOA address when disabling AA
                    if (eoaAddress) {
                      setCreateForm(prev => ({ ...prev, agentAccount: eoaAddress }));
                    }
                    setAaAddress(null);
                  }
                }}
                style={{ width: '18px', height: '18px', cursor: 'pointer' }}
              />
              <span style={{ fontWeight: 'bold' }}>Use Account Abstraction (AA)</span>
            </label>
            <p style={{ marginTop: '0.25rem', marginLeft: '1.75rem', fontSize: '0.85rem', color: '#666' }}>
              {useAA 
                ? 'Agent Account will be computed from Agent Name (tries ENS resolution first, then deterministic computation).'
                : 'Use your connected wallet address as the controller of the agent account.'}
            </p>
          </div>

          {/* Create ENS Name Toggle - Only show when AA is enabled */}
          {useAA && (
            <div style={{ marginBottom: '1rem', padding: '0.75rem', backgroundColor: '#f8f9fa', borderRadius: '4px', border: '1px solid #e1e4e8' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={createENS}
                  onChange={(e) => setCreateENS(e.target.checked)}
                  style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                />
                <span style={{ fontWeight: 'bold' }}>Create ENS Name</span>
              </label>
              <p style={{ marginTop: '0.25rem', marginLeft: '1.75rem', fontSize: '0.85rem', color: '#666' }}>
                Create an ENS subdomain record for this agent (e.g., agentname.orgname.eth). Only available for Account Abstraction agents.
              </p>
            {createENS && (
              <div style={{ marginTop: '0.5rem', marginLeft: '1.75rem' }}>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', fontWeight: 'bold' }}>
                  ENS Org Name (parent domain):
                </label>
                <input
                  type="text"
                  value={ensOrgName}
                  onChange={(e) => setEnsOrgName(e.target.value)}
                  placeholder="8004-agent"
                  style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px', fontSize: '0.85rem' }}
                />
                <p style={{ marginTop: '0.25rem', fontSize: '0.75rem', color: '#666' }}>
                  Full ENS name will be: {createForm.agentName ? `${createForm.agentName.toLowerCase()}.${ensOrgName.toLowerCase()}.eth` : 'agentname.orgname.eth'}
                </p>
                {ensChecking && (
                  <p style={{ marginTop: '0.25rem', fontSize: '0.85rem', color: '#007bff' }}>
                    Checking ENS availability...
                  </p>
                )}
                {ensAvailable === true && (
                  <p style={{ marginTop: '0.25rem', fontSize: '0.85rem', color: '#28a745' }}>
                    ✓ ENS name is available
                  </p>
                )}
                {ensAvailable === false && (
                  <p style={{ marginTop: '0.25rem', fontSize: '0.85rem', color: '#dc3545' }}>
                    ✗ ENS name is not available
                  </p>
                )}
              </div>
            )}
            </div>
          )}

          <form onSubmit={handleCreateAgent}>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                Agent Name *
              </label>
              <input
                type="text"
                value={createForm.agentName}
                onChange={(e) => setCreateForm({ ...createForm, agentName: e.target.value })}
                required
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
              />
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                Agent Account (0x...) {useAA ? '(Auto-generated)' : '*'}
              </label>
              <input
                type="text"
                value={createForm.agentAccount}
                onChange={(e) => {
                  // Allow manual editing only if AA is disabled
                  if (!useAA) {
                    setCreateForm({ ...createForm, agentAccount: e.target.value });
                  }
                }}
                required={!useAA}
                disabled={useAA}
                pattern="^0x[a-fA-F0-9]{40}$"
                style={{ 
                  width: '100%', 
                  padding: '0.5rem', 
                  border: '1px solid #ddd', 
                  borderRadius: '4px', 
                  fontFamily: 'monospace',
                  backgroundColor: useAA ? '#f8f9fa' : '#fff',
                  cursor: useAA ? 'not-allowed' : 'text'
                }}
              />
              {useAA && !aaAddress && !aaComputing && (
                <p style={{ marginTop: '0.25rem', fontSize: '0.85rem', color: '#dc3545' }}>
                  Enter an Agent Name above to generate the AA address
                </p>
              )}
              {useAA && aaComputing && (
                <p style={{ marginTop: '0.25rem', fontSize: '0.85rem', color: '#007bff' }}>
                  Computing AA address from agent name...
                </p>
              )}
              {useAA && existingAgentInfo && (
                <p style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: '#856404' }}>
                  Existing agent detected at <span style={{ fontFamily: 'monospace' }}>{existingAgentInfo.account}</span>
                  {existingAgentInfo.method ? ` (resolved via ${existingAgentInfo.method})` : ''}. Creating a new agent will overwrite on-chain metadata for this name.
                </p>
              )}
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                Description
              </label>
              <textarea
                value={createForm.description}
                onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                rows={3}
                placeholder="A natural language description of the agent..."
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px', fontFamily: 'inherit' }}
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
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
              />
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                Agent URL (Base URL)
              </label>
              <input
                type="url"
                value={createForm.agentUrl}
                onChange={(e) => setCreateForm({ ...createForm, agentUrl: e.target.value })}
                placeholder="https://agent.example.com"
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
              />
              <p style={{ marginTop: '0.25rem', fontSize: '0.85rem', color: '#666' }}>
                Used to automatically create A2A and MCP endpoints. A2A: {createForm.agentUrl ? `${createForm.agentUrl.replace(/\/$/, '')}/.well-known/agent-card.json` : '.../.well-known/agent-card.json'}, MCP: {createForm.agentUrl ? `${createForm.agentUrl.replace(/\/$/, '')}/` : '.../'}
              </p>
            </div>
            <p style={{ marginTop: '0.5rem', marginBottom: '1rem', fontSize: '0.85rem', color: '#666' }}>
              Registration JSON will be automatically created and uploaded to IPFS per ERC-8004 specification
            </p>
            <button
              type="submit"
              style={{
                width: '100%',
                padding: '0.75rem',
                backgroundColor: '#007bff',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '1rem',
                fontWeight: 'bold',
              }}
            >
              Create Agent
            </button>
          </form>
        </div>
        )}

        {showManagementPanes && (
        <div style={{ padding: '1.5rem', backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #ddd' }}>
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
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
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
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
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
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
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
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
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
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
              />
            </div>
            <button
              type="submit"
              style={{
                width: '100%',
                padding: '0.75rem',
                backgroundColor: '#28a745',
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
        <div style={{ padding: '1.5rem', backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #ddd' }}>
          <h2 style={{ marginBottom: '1rem', fontSize: '1.5rem', color: '#dc3545' }}>Delete Agent</h2>
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
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
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
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
              />
            </div>
            <button
              type="submit"
              style={{
                width: '100%',
                padding: '0.75rem',
                backgroundColor: '#dc3545',
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
        <div style={{ padding: '1.5rem', backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #ddd' }}>
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
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
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
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
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
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px', fontFamily: 'monospace' }}
              />
            </div>
            <button
              type="submit"
              style={{
                width: '100%',
                padding: '0.75rem',
                backgroundColor: '#ffc107',
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

