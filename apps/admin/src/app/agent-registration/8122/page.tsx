'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Address } from 'viem';
import {
  createPublicClient,
  createWalletClient,
  custom,
  decodeEventLog,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  http,
  toHex,
} from 'viem';
import { mainnet, sepolia, baseSepolia, optimismSepolia } from 'viem/chains';

import { Header } from '@/components/Header';
import { useAuth } from '@/components/AuthProvider';
import { useWallet } from '@/components/WalletProvider';
import { grayscalePalette as palette } from '@/styles/palette';
import { getClientBundlerUrl } from '@/lib/clientChainEnv';

import {
  getCounterfactualSmartAccountAddressByAgentName,
  getDeployedAccountClientByAgentName,
  sendSponsoredUserOperation,
  waitForUserOperationReceipt,
} from '@agentic-trust/core/client';
import { DEFAULT_CHAIN_ID, getEnsOrgName } from '@agentic-trust/core/server';
import { buildDidEnsFromAgentAndOrg } from '@/app/api/names/_lib/didEns';
import { SUPPORTED_TRUST_MECHANISMS } from '@/models/agentRegistration';

import type { Erc8122MetadataEntry } from '@agentic-trust/8122-sdk';
import { agentRegistryAbi, agentRegistrarAbi } from '@agentic-trust/8122-sdk';

const REGISTRAR_ERROR_EXPLANATIONS: Record<string, string> = {
  // AgentRegistrar custom errors (idchain-world/agent-registry)
  '0x50e90ba2':
    'MintingNotOpen: minting is closed on this registrar. An admin must call openMinting(true) (public) or openMinting(false) + grant MINTER_ROLE.',
  '0xf8d2906c':
    'NotMinter: registrar is in private mode and your wallet is missing MINTER_ROLE.',
  '0x8bf9b99f': 'FunctionLocked: registrar config is locked.',
  '0xb99e2ab7': 'InsufficientPayment: msg.value is less than required mintPrice.',
  '0xea058246': 'MaxSupplyExceeded: maxSupply would be exceeded.',
};

function formatViemError(err: unknown): string {
  if (err && typeof err === 'object') {
    const anyErr = err as any;
    const revertData: string | null = (() => {
      const candidates = [
        anyErr?.data,
        anyErr?.cause?.data,
        anyErr?.cause?.cause?.data,
        anyErr?.cause?.cause?.cause?.data,
      ];
      for (const c of candidates) {
        if (typeof c === 'string' && c.startsWith('0x') && c.length >= 10) return c;
      }
      return null;
    })();
    if (revertData) {
      const selector = revertData.slice(0, 10).toLowerCase();
      const explanation = REGISTRAR_ERROR_EXPLANATIONS[selector];
      return explanation ? `${explanation} (selector ${selector})` : `execution reverted (selector ${selector})`;
    }
    if (typeof anyErr.shortMessage === 'string' && anyErr.shortMessage.trim()) return anyErr.shortMessage;
    if (typeof anyErr.details === 'string' && anyErr.details.trim()) return anyErr.details;
    if (typeof anyErr.message === 'string' && anyErr.message.trim()) return anyErr.message;
  }
  return String(err);
}

const CREATE_STEPS = [
  'Name',
  'Information',
  'Supported trust',
  'Protocols',
  'Review & Register',
] as const;

const SUPPORTED_CHAINS = [
  { id: 1, label: 'Ethereum Mainnet' },
  { id: 11155111, label: 'Sepolia' },
  { id: 84532, label: 'Base Sepolia' },
  { id: 11155420, label: 'Optimism Sepolia' },
] as const;

const CHAIN_BY_ID: Record<number, any> = {
  1: mainnet,
  11155111: sepolia,
  84532: baseSepolia,
  11155420: optimismSepolia,
};

type Registry8122 = {
  iri?: string | null;
  chainId: number;
  registryAddress: string;
  registrarAddress?: string | null;
  registryName?: string | null;
  registryImplementationAddress?: string | null;
  registrarImplementationAddress?: string | null;
  registeredAgentCount?: number | null;
  lastAgentUpdatedAtTime?: number | null;
};

function chainIdToHex(chainId: number) {
  return `0x${chainId.toString(16)}`;
}

async function ensureEip1193Chain(provider: any, chainId: number) {
  if (!provider?.request) {
    throw new Error('Missing wallet provider (EIP-1193). Connect a wallet to continue.');
  }
  const currentHex = await provider.request({ method: 'eth_chainId' });
  const currentId = typeof currentHex === 'string' ? parseInt(currentHex, 16) : Number.NaN;
  if (Number.isFinite(currentId) && currentId === chainId) return;
  await provider.request({
    method: 'wallet_switchEthereumChain',
    params: [{ chainId: chainIdToHex(chainId) }],
  });
}

function formatEther18Dp(wei: bigint): string {
  const base = 10n ** 18n;
  const whole = wei / base;
  const frac = wei % base;
  const fracStr = frac.toString().padStart(18, '0');
  return `${whole.toString()}.${fracStr}`;
}

function safeUrl(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function buildDid8122(params: { chainId: number; registry: Address; agentId: bigint }): string {
  return `did:8122:${params.chainId}:${params.registry}:${params.agentId.toString()}`;
}

function buildUaidFromDid(did: string): string {
  return `uaid:${did}`;
}

export default function AgentRegistration8122WizardPage() {
  const router = useRouter();
  const { isConnected, privateKeyMode, loading, walletAddress, openLoginModal, handleDisconnect } =
    useAuth();
  const { eip1193Provider } = useWallet();

  const [createStep, setCreateStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [selectedChainId, setSelectedChainId] = useState<number>(DEFAULT_CHAIN_ID);
  const chain = CHAIN_BY_ID[selectedChainId] ?? CHAIN_BY_ID[DEFAULT_CHAIN_ID];
  const chainLabel = useMemo(
    () => SUPPORTED_CHAINS.find((c) => c.id === selectedChainId)?.label ?? String(selectedChainId),
    [selectedChainId],
  );

  const canSign = Boolean(isConnected && walletAddress && eip1193Provider && !privateKeyMode);

  // Step 1: chain + collection + name + ENS + AA
  const [collectionsLoading, setCollectionsLoading] = useState(false);
  const [collectionsError, setCollectionsError] = useState<string | null>(null);
  const [collections, setCollections] = useState<Registry8122[]>([]);
  const [selectedRegistryAddress, setSelectedRegistryAddress] = useState<string>('');
  const selectedCollection = useMemo(() => {
    return collections.find((c) => c.registryAddress === selectedRegistryAddress) ?? null;
  }, [collections, selectedRegistryAddress]);

  const [ensOrgName, setEnsOrgName] = useState<string | null>(null);
  const [ensChecking, setEnsChecking] = useState(false);
  const [ensAvailable, setEnsAvailable] = useState<boolean | null>(null);
  const [ensExisting, setEnsExisting] = useState<{ image: string | null; url: string | null; description: string | null } | null>(null);

  const [useAA, setUseAA] = useState(true);
  const [aaComputing, setAaComputing] = useState(false);
  const [aaAddress, setAaAddress] = useState<string | null>(null);

  const [chainBalanceWei, setChainBalanceWei] = useState<bigint | null>(null);
  const [chainBalanceLoading, setChainBalanceLoading] = useState(false);
  const [chainBalanceError, setChainBalanceError] = useState<string | null>(null);

  const [registrarMintPriceWei, setRegistrarMintPriceWei] = useState<bigint | null>(null);
  const [registrarIsOpen, setRegistrarIsOpen] = useState<boolean | null>(null);
  const [registrarIsPublicMinting, setRegistrarIsPublicMinting] = useState<boolean | null>(null);
  const [registrarStatusLoading, setRegistrarStatusLoading] = useState(false);
  const [registrarStatusError, setRegistrarStatusError] = useState<string | null>(null);

  const [createForm, setCreateForm] = useState(() => {
    const getDefaultImageUrl = () =>
      typeof window !== 'undefined' ? `${window.location.origin}/8004Agent.png` : '/8004Agent.png';
    return {
      agentName: '',
      agentAccount: '',
      description: '',
      image: getDefaultImageUrl(),
      agentUrl: '',
    };
  });

  const imageFileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [imageUploadError, setImageUploadError] = useState<string | null>(null);

  const normalizedAgentBaseUrl = (createForm.agentUrl || '').trim().replace(/\/$/, '');
  const defaultA2AEndpoint = normalizedAgentBaseUrl ? `${normalizedAgentBaseUrl}/.well-known/agent-card.json` : '';
  const defaultMcpEndpoint = normalizedAgentBaseUrl ? `${normalizedAgentBaseUrl}/api/mcp` : '';
  const previousDefaultsRef = useRef({ a2a: '', mcp: '' });

  const [protocolSettings, setProtocolSettings] = useState<{
    protocol: 'A2A' | 'MCP' | null;
    a2aEndpoint: string;
    mcpEndpoint: string;
  }>({
    protocol: 'A2A',
    a2aEndpoint: '',
    mcpEndpoint: '',
  });

  const [supportedTrust, setSupportedTrust] = useState<string[]>([]);

  const [registering, setRegistering] = useState(false);
  const [registrationCompleteOpen, setRegistrationCompleteOpen] = useState(false);
  const [registrationCompleteDetails, setRegistrationCompleteDetails] = useState<{
    agentId?: string;
    txHash?: string;
    did?: string;
    uaid?: string;
    registry?: string;
    registrar?: string;
  } | null>(null);

  // keep ENS org name synced
  useEffect(() => {
    try {
      const name = getEnsOrgName(selectedChainId);
      setEnsOrgName(name || null);
    } catch {
      setEnsOrgName(null);
    }
  }, [selectedChainId]);

  // load collections from KB
  useEffect(() => {
    let cancelled = false;
    setCollectionsError(null);
    setCollections([]);
    setSelectedRegistryAddress('');

    (async () => {
      setCollectionsLoading(true);
      try {
        const res = await fetch('/api/registries/8122', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chainId: selectedChainId, first: 250, skip: 0 }),
        });
        const json = (await res.json().catch(() => null)) as any;
        if (!res.ok) throw new Error(json?.error || `Failed to fetch collections (${res.status})`);
        const rows = Array.isArray(json?.registries) ? (json.registries as Registry8122[]) : [];
        if (cancelled) return;
        setCollections(rows);
      } catch (e) {
        if (cancelled) return;
        setCollectionsError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setCollectionsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedChainId]);

  // chain balance
  useEffect(() => {
    let cancelled = false;
    setChainBalanceError(null);
    setChainBalanceWei(null);

    const payer = useAA ? aaAddress : walletAddress;
    if (!payer) return;
    const rpcUrl = chain?.rpcUrls?.default?.http?.[0];
    if (typeof rpcUrl !== 'string' || !rpcUrl.trim()) {
      setChainBalanceError(`No RPC URL available for chainId ${selectedChainId}.`);
      return;
    }

    (async () => {
      setChainBalanceLoading(true);
      try {
        const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
        const balance = await publicClient.getBalance({ address: getAddress(payer) as Address });
        if (cancelled) return;
        setChainBalanceWei(balance);
      } catch (e) {
        if (cancelled) return;
        setChainBalanceError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setChainBalanceLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [walletAddress, aaAddress, useAA, chain, selectedChainId]);

  // ENS availability
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
        const encodedEnsDid = buildDidEnsFromAgentAndOrg(selectedChainId, createForm.agentName, ensOrgName);
        const response = await fetch(`/api/names/${encodedEnsDid}`, { method: 'GET' });
        if (cancelled) return;
        if (!response.ok) {
          setEnsAvailable(null);
          return;
        }
        const data = await response.json().catch(() => ({} as any));
        const available = data?.nameInfo?.available === true;
        setEnsAvailable(available);
        if (!available && data?.nameInfo) {
          setEnsExisting({
            image: data.nameInfo.image || null,
            url: data.nameInfo.url || null,
            description: data.nameInfo.description || null,
          });
        }
      } catch {
        if (!cancelled) setEnsAvailable(null);
      } finally {
        if (!cancelled) setEnsChecking(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [createForm.agentName, ensOrgName, selectedChainId]);

  // compute AA address like 8004 flow
  useEffect(() => {
    const name = createForm.agentName.trim();
    if (!useAA || !name) {
      setAaAddress(null);
      setCreateForm((prev) => ({ ...prev, agentAccount: '' }));
      return;
    }

    let cancelled = false;
    setAaComputing(true);

    (async () => {
      try {
        if (privateKeyMode) {
          const resp = await fetch('/api/accounts/counterfactual-account', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agentName: name, chainId: selectedChainId || undefined }),
          });
          if (!resp.ok) {
            setAaAddress(null);
            setCreateForm((prev) => ({ ...prev, agentAccount: '' }));
            return;
          }
          const data = await resp.json().catch(() => ({}));
          const computed = (data?.address as string) || '';
          if (!cancelled && computed && computed.startsWith('0x')) {
            setAaAddress(computed);
            setCreateForm((prev) => ({ ...prev, agentAccount: computed }));
          }
          return;
        }

        if (!eip1193Provider || !walletAddress) {
          setAaAddress(null);
          setCreateForm((prev) => ({ ...prev, agentAccount: '' }));
          return;
        }

        const computed = await getCounterfactualSmartAccountAddressByAgentName(
          name,
          walletAddress as `0x${string}`,
          {
            ethereumProvider: eip1193Provider as any,
            chain: CHAIN_BY_ID[selectedChainId] ?? CHAIN_BY_ID[DEFAULT_CHAIN_ID],
          },
        );
        if (!cancelled && computed && computed.startsWith('0x')) {
          setAaAddress(computed);
          setCreateForm((prev) => ({ ...prev, agentAccount: computed }));
        }
      } catch {
        if (!cancelled) {
          setAaAddress(null);
          setCreateForm((prev) => ({ ...prev, agentAccount: '' }));
        }
      } finally {
        if (!cancelled) setAaComputing(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [useAA, privateKeyMode, eip1193Provider, walletAddress, createForm.agentName, selectedChainId]);

  // protocol defaults like 8004 flow
  useEffect(() => {
    const prevDefaults = previousDefaultsRef.current;
    setProtocolSettings((prev) => {
      const next = { ...prev };
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

  // registrar status (mint price + open/public)
  useEffect(() => {
    let cancelled = false;
    setRegistrarMintPriceWei(null);
    setRegistrarIsOpen(null);
    setRegistrarIsPublicMinting(null);
    setRegistrarStatusError(null);

    const registrarRaw = selectedCollection?.registrarAddress?.trim() || '';
    if (!registrarRaw) return;

    const rpcUrl = chain?.rpcUrls?.default?.http?.[0];
    if (typeof rpcUrl !== 'string' || !rpcUrl.trim()) {
      setRegistrarStatusError(`No RPC URL available for chainId ${selectedChainId}.`);
      return;
    }

    (async () => {
      setRegistrarStatusLoading(true);
      try {
        const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
        const registrar = getAddress(registrarRaw) as Address;
        const code = await publicClient.getBytecode({ address: registrar });
        if (!code || code === '0x') {
          throw new Error('Registrar address has no bytecode on this chain.');
        }

        const [mintPrice, isOpen, isPublic] = await Promise.all([
          publicClient.readContract({
            address: registrar,
            abi: agentRegistrarAbi,
            functionName: 'mintPrice',
          }) as Promise<bigint>,
          publicClient.readContract({
            address: registrar,
            abi: agentRegistrarAbi,
            functionName: 'open',
          }) as Promise<boolean>,
          publicClient.readContract({
            address: registrar,
            abi: agentRegistrarAbi,
            functionName: 'publicMinting',
          }) as Promise<boolean>,
        ]);

        if (cancelled) return;
        setRegistrarMintPriceWei(mintPrice);
        setRegistrarIsOpen(isOpen);
        setRegistrarIsPublicMinting(isPublic);
      } catch (e) {
        if (!cancelled) setRegistrarStatusError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setRegistrarStatusLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedCollection?.registrarAddress, chain, selectedChainId]);

  const ensFullNamePreview =
    createForm.agentName && ensOrgName
      ? `${createForm.agentName.toLowerCase()}.${ensOrgName.toLowerCase()}.eth`
      : '';

  const resolvedRegistrarAddress = (selectedCollection?.registrarAddress || '').trim();
  const remainingAfterMintWei =
    chainBalanceWei != null && registrarMintPriceWei != null ? chainBalanceWei - registrarMintPriceWei : null;

  const canProceed = useMemo(() => {
    switch (createStep) {
      case 0: {
        if (!createForm.agentName.trim()) return { ok: false, message: 'Agent name is required.' };
        if (!ensOrgName) return { ok: false, message: 'ENS org name is not configured for this chain.' };
        if (ensAvailable !== true) return { ok: false, message: 'ENS name must be available.' };
        if (!selectedCollection?.registryAddress) return { ok: false, message: 'Select an 8122 collection.' };
        if (!resolvedRegistrarAddress) return { ok: false, message: 'Selected collection has no registrar.' };
        if (useAA && !createForm.agentAccount.trim().startsWith('0x')) {
          return { ok: false, message: 'Smart account address is not ready yet.' };
        }
        return { ok: true };
      }
      case 1: {
        if (!createForm.description.trim()) return { ok: false, message: 'Description is required.' };
        return { ok: true };
      }
      case 2: {
        return { ok: true };
      }
      case 3: {
        if (!protocolSettings.protocol) return { ok: false, message: 'Select a protocol.' };
        const url =
          protocolSettings.protocol === 'A2A' ? protocolSettings.a2aEndpoint : protocolSettings.mcpEndpoint;
        if (!safeUrl(url || '')) return { ok: false, message: 'Endpoint URL must be a valid http(s) URL.' };
        return { ok: true };
      }
      case 4:
        return { ok: true };
      default:
        return { ok: true };
    }
  }, [
    createStep,
    createForm.agentName,
    createForm.agentAccount,
    createForm.description,
    ensOrgName,
    ensAvailable,
    selectedCollection?.registryAddress,
    resolvedRegistrarAddress,
    useAA,
    protocolSettings,
  ]);

  const handleImageUploadClick = useCallback(() => {
    setImageUploadError(null);
    imageFileInputRef.current?.click();
  }, []);

  const handleImageFileSelected = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploadingImage(true);
    setImageUploadError(null);
    try {
      const formData = new FormData();
      formData.append('file', file, file.name);
      const response = await fetch('/api/ipfs/upload', { method: 'POST', body: formData });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || body?.message || 'Upload failed');
      setCreateForm((prev) => ({ ...prev, image: body?.tokenUri || body?.url || prev.image }));
    } catch (e) {
      setImageUploadError(e instanceof Error ? e.message : 'Image upload failed.');
    } finally {
      setUploadingImage(false);
      if (event.target) event.target.value = '';
    }
  }, []);

  const openCompletionModal = useCallback((details: any) => {
    setRegistrationCompleteDetails(details);
    setRegistrationCompleteOpen(true);
  }, []);

  const handleRegister = useCallback(async () => {
    setError(null);
    setSuccess(null);

    if (privateKeyMode) {
      throw new Error('ERC-8122 registration requires a connected wallet (private key mode is not supported).');
    }
    if (!walletAddress) {
      throw new Error('Connect a wallet to register an agent.');
    }
    if (!eip1193Provider) {
      throw new Error('Missing wallet provider (EIP-1193).');
    }
    if (!selectedCollection?.registryAddress) {
      throw new Error('Missing selected collection registry.');
    }
    if (!resolvedRegistrarAddress) {
      throw new Error('Selected collection is missing registrarAddress.');
    }
    if (!useAA) {
      throw new Error('Enable "Assign Smart Account" (ERC-8122 minting uses AA + bundler).');
    }

    const eoa = getAddress(walletAddress) as Address;
    const registrar = getAddress(resolvedRegistrarAddress) as Address;

    const endpointType = protocolSettings.protocol === 'MCP' ? 'mcp' : 'a2a';
    const endpointRaw =
      protocolSettings.protocol === 'MCP' ? protocolSettings.mcpEndpoint : protocolSettings.a2aEndpoint;
    const endpoint = safeUrl(endpointRaw || '');
    if (!endpoint) {
      throw new Error('Invalid endpoint URL.');
    }

    setRegistering(true);
    try {
      await ensureEip1193Chain(eip1193Provider, selectedChainId);
      const rpcUrl = chain?.rpcUrls?.default?.http?.[0];
      if (typeof rpcUrl !== 'string' || !rpcUrl.trim()) {
        throw new Error(`No RPC URL available for chainId ${selectedChainId}.`);
      }
      const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
      const walletClient = createWalletClient({ chain, transport: custom(eip1193Provider) });

      // Wrong-chain / wrong-address sanity check
      const code = await publicClient.getBytecode({ address: registrar });
      if (!code || code === '0x') {
        throw new Error(`Registrar address has no bytecode (wrong chain or wrong address): ${registrar}`);
      }

      const mintPrice = (await publicClient.readContract({
        address: registrar,
        abi: agentRegistrarAbi,
        functionName: 'mintPrice',
      })) as bigint;

      const metadata: Erc8122MetadataEntry[] = [
        { key: 'name', value: toHex(createForm.agentName.trim()) as `0x${string}` },
        { key: 'description', value: toHex(createForm.description.trim()) as `0x${string}` },
        { key: 'image', value: toHex((createForm.image || '').trim()) as `0x${string}` },
        { key: 'endpoint_type', value: toHex(endpointType) as `0x${string}` },
        { key: 'endpoint', value: toHex(endpoint) as `0x${string}` },
      ];
      if (ensFullNamePreview) {
        metadata.push({ key: 'ens_name', value: toHex(ensFullNamePreview) as `0x${string}` });
      }

      // =========================================================================
      // Mint via Smart Account (AA) + bundler (like ERC-8004 flow)
      // =========================================================================
      const bundlerUrl = getClientBundlerUrl(selectedChainId);
      if (!bundlerUrl) {
        throw new Error(`Missing bundler URL for chainId ${selectedChainId}.`);
      }

      // Ensure the MetaMask smart account client exists (and deploy it if needed) so MetaMask can sign the UserOp.
      const accountClient = await getDeployedAccountClientByAgentName(bundlerUrl, createForm.agentName.trim(), eoa, {
        ethereumProvider: eip1193Provider,
        chain,
      });

      const aaAddr = getAddress(String(accountClient?.address || '')) as Address;
      const requestedAgentAccount = getAddress(createForm.agentAccount) as Address;
      if (requestedAgentAccount !== aaAddr) {
        throw new Error(`Agent account mismatch. Expected computed AA ${aaAddr} but got ${requestedAgentAccount}.`);
      }

      // Owner ("to") should be the smart account contract.
      const toOwner = aaAddr;

      // IMPORTANT: sponsorship covers gas, NOT msg.value. If mintPrice > 0, the AA must hold that ETH.
      if (mintPrice > 0n) {
        const aaBal = await publicClient.getBalance({ address: aaAddr });
        if (aaBal < mintPrice) {
          throw new Error(
            `Smart Account needs >= mintPrice ETH. AA balance=${formatEther18Dp(aaBal)} ETH, mintPrice=${formatEther18Dp(
              mintPrice,
            )} ETH. Fund ${aaAddr} then retry.`,
          );
        }
      }

      // IMPORTANT: AgentRegistry decodes this as `abi.decode(value, (address))`,
      // so it MUST be ABI-encoded (32-byte) address, not the utf-8 bytes of "0x...".
      metadata.push({
        key: 'agent_account',
        value: encodeAbiParameters([{ type: 'address' }], [aaAddr]) as `0x${string}`,
      });

      // Preflight: plain RPC simulation from AA address.
      // This often yields the real revert selector (vs bundler "reason: 0x").
      await publicClient.simulateContract({
        address: registrar,
        abi: agentRegistrarAbi,
        functionName: 'mint',
        args: [aaAddr, metadata],
        value: mintPrice,
        account: aaAddr,
      });

      const data = encodeFunctionData({
        abi: agentRegistrarAbi,
        functionName: 'mint',
        args: [toOwner, metadata],
      });

      const userOpHash = await sendSponsoredUserOperation({
        bundlerUrl,
        chain,
        accountClient,
        calls: [{ to: registrar, data, value: mintPrice }],
      });

      const uoReceipt = await waitForUserOperationReceipt({
        bundlerUrl,
        chain,
        hash: userOpHash,
      });

      const txHash =
        ((uoReceipt as any)?.receipt?.transactionHash as `0x${string}` | undefined) ||
        ((uoReceipt as any)?.transactionHash as `0x${string}` | undefined) ||
        null;

      if (!txHash) {
        throw new Error(`UserOperation sent but transactionHash was not returned. userOp=${userOpHash}`);
      }

      const mintReceipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      if ((mintReceipt as any)?.status && String((mintReceipt as any).status) !== 'success') {
        throw new Error(`Mint transaction reverted. tx=${txHash}`);
      }

      let agentId: bigint | null = null;
      for (const log of (mintReceipt as any)?.logs || []) {
        try {
          const decoded = decodeEventLog({
            abi: agentRegistrarAbi,
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName === 'AgentMinted') {
            agentId = (decoded.args as any).agentId as bigint;
            break;
          }
        } catch {
          // ignore
        }
      }
      if (agentId == null) {
        throw new Error(`Mint mined but AgentMinted event was not found. tx=${txHash}`);
      }

      const registry = (await publicClient.readContract({
        address: registrar,
        abi: agentRegistrarAbi,
        functionName: 'registry',
      })) as Address;

      const did = buildDid8122({ chainId: selectedChainId, registry: getAddress(registry) as Address, agentId });
      const uaid = buildUaidFromDid(did);

      // Best-effort: write UAID metadata after mint.
      // Send it as a second UserOperation from the SmartAccount (since it owns the token).
      try {
        const data = encodeFunctionData({
          abi: agentRegistryAbi,
          functionName: 'setMetadata',
          args: [agentId, 'uaid', toHex(uaid) as `0x${string}`],
        });
        const uoHash = await sendSponsoredUserOperation({
          bundlerUrl,
          chain,
          accountClient,
          calls: [{ to: getAddress(registry) as Address, data }],
        });
        await waitForUserOperationReceipt({ bundlerUrl, chain, hash: uoHash });
      } catch {
        // ignore
      }

      setSuccess(`Minted 8122 agent #${agentId.toString()} on ${chainLabel}.`);
      openCompletionModal({
        agentId: agentId.toString(),
        txHash: txHash ?? undefined,
        did,
        uaid,
        registry: String(registry),
        registrar: String(registrar),
      });
    } catch (e) {
      // Ensure UI always shows something
      setError(formatViemError(e));
      throw e;
    } finally {
      setRegistering(false);
    }
  }, [
    privateKeyMode,
    walletAddress,
    eip1193Provider,
    selectedCollection?.registryAddress,
    resolvedRegistrarAddress,
    createForm.agentAccount,
    createForm.agentName,
    createForm.description,
    createForm.image,
    protocolSettings,
    ensFullNamePreview,
    selectedChainId,
    chain,
    chainLabel,
    openCompletionModal,
    useAA,
  ]);

  const renderStep = () => {
    switch (createStep) {
      case 0: {
        return (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: '0.75rem' }}>
              <label style={{ color: palette.textSecondary, paddingTop: '0.55rem', fontWeight: 700 }}>
                Chain
              </label>
              <select
                value={String(selectedChainId)}
                onChange={(e) => {
                  setSelectedChainId(Number(e.target.value));
                  setEnsAvailable(null);
                  setAaAddress(null);
                }}
                style={{
                  padding: '0.55rem 0.7rem',
                  borderRadius: '10px',
                  border: `1px solid ${palette.border}`,
                  background: palette.surfaceMuted,
                  color: palette.textPrimary,
                }}
              >
                {SUPPORTED_CHAINS.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.label} ({c.id})
                  </option>
                ))}
              </select>

              <label style={{ color: palette.textSecondary, paddingTop: '0.55rem', fontWeight: 700 }}>
                8122 collection
              </label>
              <select
                value={selectedRegistryAddress}
                onChange={(e) => setSelectedRegistryAddress(String(e.target.value || ''))}
                style={{
                  padding: '0.55rem 0.7rem',
                  borderRadius: '10px',
                  border: `1px solid ${palette.border}`,
                  background: palette.surfaceMuted,
                  color: palette.textPrimary,
                }}
              >
                <option value="">
                  {collectionsLoading ? 'Loading collections…' : 'Select a collection'}
                </option>
                {collections.map((c) => {
                  const label =
                    typeof c.registryName === 'string' && c.registryName.trim()
                      ? c.registryName.trim()
                      : c.registryAddress;
                  return (
                    <option key={`${c.chainId}:${c.registryAddress}`} value={c.registryAddress}>
                      {label}
                    </option>
                  );
                })}
              </select>

              <div />
              <div style={{ color: palette.textSecondary, fontSize: '0.9rem', lineHeight: 1.45 }}>
                {collectionsError ? (
                  <span style={{ color: palette.dangerText }}>
                    Failed to load collections: <code>{collectionsError}</code>
                  </span>
                ) : (
                  <span>
                    Need a collection? Create/manage in{' '}
                    <button
                      type="button"
                      onClick={() => router.push('/registries/8122')}
                      style={{
                        padding: 0,
                        border: 'none',
                        background: 'transparent',
                        color: palette.textPrimary,
                        textDecoration: 'underline',
                        cursor: 'pointer',
                        fontWeight: 700,
                      }}
                    >
                      8122 Collections
                    </button>
                    .
                  </span>
                )}
              </div>

              <label style={{ color: palette.textSecondary, paddingTop: '0.55rem', fontWeight: 700 }}>
                Agent name *
              </label>
              <input
                value={createForm.agentName}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, agentName: e.target.value }))}
                style={{
                  padding: '0.55rem 0.7rem',
                  borderRadius: '10px',
                  border: `1px solid ${palette.border}`,
                  background: palette.surfaceMuted,
                  color: palette.textPrimary,
                }}
              />

              <div />
              <div style={{ color: palette.textSecondary, fontSize: '0.92rem', lineHeight: 1.45 }}>
                <div style={{ fontFamily: 'monospace' }}>{ensFullNamePreview || 'Enter an agent name…'}</div>
                <div style={{ marginTop: '0.25rem' }}>
                  {ensChecking
                    ? 'Checking ENS…'
                    : ensAvailable === true
                      ? 'Available'
                      : ensAvailable === false
                        ? 'Not available'
                        : 'Awaiting input'}
                </div>
                {ensExisting && (
                  <div style={{ marginTop: '0.25rem', opacity: 0.9 }}>
                    Existing ENS record detected.
                  </div>
                )}
              </div>

              <label style={{ color: palette.textSecondary, paddingTop: '0.55rem', fontWeight: 700 }}>
                Assign Smart Account
              </label>
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    checked={useAA}
                    onChange={(e) => setUseAA(Boolean(e.target.checked))}
                  />
                  Use counterfactual AA address
                </label>
                <div style={{ color: palette.textSecondary, fontSize: '0.9rem' }}>
                  {aaComputing ? 'Computing…' : aaAddress ? <code>{aaAddress}</code> : '—'}
                </div>
              </div>

              <label style={{ color: palette.textSecondary, paddingTop: '0.55rem', fontWeight: 700 }}>
                Agent account
              </label>
              <input
                value={createForm.agentAccount}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, agentAccount: e.target.value }))}
                placeholder="0x..."
                style={{
                  padding: '0.55rem 0.7rem',
                  borderRadius: '10px',
                  border: `1px solid ${palette.border}`,
                  background: palette.surfaceMuted,
                  color: palette.textPrimary,
                }}
              />

              <div />
              <div style={{ color: palette.textSecondary, fontSize: '0.92rem', lineHeight: 1.45 }}>
                {registrarStatusError ? (
                  <div style={{ color: palette.dangerText }}>
                    Registrar status error: <code>{registrarStatusError}</code>
                  </div>
                ) : registrarStatusLoading ? (
                  <div>Loading registrar status…</div>
                ) : (
                  <>
                    <div>
                      Registrar mint price:{' '}
                      <code>{registrarMintPriceWei == null ? '—' : formatEther18Dp(registrarMintPriceWei)}</code> ETH
                    </div>
                    <div style={{ marginTop: '0.25rem' }}>
                      Minting status:{' '}
                      {registrarIsOpen ? (
                        registrarIsPublicMinting ? (
                          <span style={{ color: palette.successText, fontWeight: 700 }}>Open (public)</span>
                        ) : (
                          <span style={{ color: palette.successText, fontWeight: 700 }}>Open (private)</span>
                        )
                      ) : registrarIsOpen === false ? (
                        <span style={{ color: palette.dangerText, fontWeight: 700 }}>Closed</span>
                      ) : (
                        '—'
                      )}
                    </div>
                    <div style={{ marginTop: '0.25rem' }}>
                      Balance on {chainLabel}:{' '}
                      {chainBalanceLoading ? (
                        'Loading…'
                      ) : chainBalanceError ? (
                        <span style={{ color: palette.dangerText }}>Failed</span>
                      ) : (
                        <code>{chainBalanceWei == null ? '—' : formatEther18Dp(chainBalanceWei)}</code>
                      )}{' '}
                      ETH
                    </div>
                    <div style={{ marginTop: '0.25rem' }}>
                      Remaining after mint (excluding gas):{' '}
                      {remainingAfterMintWei == null ? (
                        '—'
                      ) : remainingAfterMintWei >= 0n ? (
                        <code>{formatEther18Dp(remainingAfterMintWei)}</code>
                      ) : (
                        <span style={{ color: palette.dangerText, fontWeight: 700 }}>insufficient</span>
                      )}{' '}
                      ETH
                    </div>
                    <div style={{ marginTop: '0.25rem', opacity: 0.9 }}>
                      Total cost = mint price + gas (network fee).
                    </div>
                  </>
                )}
              </div>
            </div>
          </>
        );
      }
      case 1: {
        return (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: '0.75rem' }}>
              <label style={{ color: palette.textSecondary, paddingTop: '0.55rem', fontWeight: 700 }}>
                Description *
              </label>
              <textarea
                value={createForm.description}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, description: e.target.value }))}
                rows={5}
                style={{
                  padding: '0.55rem 0.7rem',
                  borderRadius: '10px',
                  border: `1px solid ${palette.border}`,
                  background: palette.surfaceMuted,
                  color: palette.textPrimary,
                }}
              />

              <label style={{ color: palette.textSecondary, paddingTop: '0.55rem', fontWeight: 700 }}>
                Image URL
              </label>
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  value={createForm.image}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, image: e.target.value }))}
                  style={{
                    flex: '1 1 360px',
                    padding: '0.55rem 0.7rem',
                    borderRadius: '10px',
                    border: `1px solid ${palette.border}`,
                    background: palette.surfaceMuted,
                    color: palette.textPrimary,
                  }}
                />
                <button
                  type="button"
                  onClick={handleImageUploadClick}
                  disabled={uploadingImage}
                  style={{
                    padding: '0.55rem 0.85rem',
                    borderRadius: '10px',
                    border: `1px solid ${palette.borderStrong}`,
                    background: palette.surfaceMuted,
                    color: palette.textPrimary,
                    fontWeight: 700,
                    cursor: uploadingImage ? 'not-allowed' : 'pointer',
                    opacity: uploadingImage ? 0.7 : 1,
                  }}
                >
                  {uploadingImage ? 'Uploading…' : 'Upload'}
                </button>
                <input
                  ref={imageFileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageFileSelected}
                  style={{ display: 'none' }}
                />
              </div>
              <div />
              {imageUploadError ? (
                <div style={{ color: palette.dangerText }}>
                  Upload error: <code>{imageUploadError}</code>
                </div>
              ) : (
                <div style={{ color: palette.textSecondary, fontSize: '0.9rem' }}>
                  Optional. Upload uses `/api/ipfs/upload`.
                </div>
              )}

              <label style={{ color: palette.textSecondary, paddingTop: '0.55rem', fontWeight: 700 }}>
                Agent URL
              </label>
              <input
                value={createForm.agentUrl}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, agentUrl: e.target.value }))}
                placeholder="https://your-agent.com"
                style={{
                  padding: '0.55rem 0.7rem',
                  borderRadius: '10px',
                  border: `1px solid ${palette.border}`,
                  background: palette.surfaceMuted,
                  color: palette.textPrimary,
                }}
              />
              <div />
              <div style={{ color: palette.textSecondary, fontSize: '0.9rem' }}>
                Used to default the A2A endpoint to `/.well-known/agent-card.json` and MCP to `/api/mcp`.
              </div>
            </div>
          </>
        );
      }
      case 2: {
        return (
          <>
            <div style={{ color: palette.textSecondary, marginBottom: '0.75rem', lineHeight: 1.45 }}>
              Select supported trust mechanisms (optional).
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.6rem' }}>
              {SUPPORTED_TRUST_MECHANISMS.map((m) => {
                const checked = supportedTrust.includes(m.value);
                return (
                  <label
                    key={m.value}
                    style={{
                      display: 'block',
                      border: `1px solid ${palette.border}`,
                      borderRadius: '12px',
                      padding: '0.7rem 0.85rem',
                      background: palette.surfaceMuted,
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const next = Boolean(e.target.checked);
                          setSupportedTrust((prev) => {
                            if (next) return prev.includes(m.value) ? prev : [...prev, m.value];
                            return prev.filter((x) => x !== m.value);
                          });
                        }}
                      />
                      <div style={{ fontWeight: 800 }}>{m.label}</div>
                    </div>
                    <div style={{ marginTop: '0.25rem', color: palette.textSecondary, fontSize: '0.9rem' }}>
                      {m.description}
                    </div>
                  </label>
                );
              })}
            </div>
          </>
        );
      }
      case 3: {
        return (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: '0.75rem' }}>
              <label style={{ color: palette.textSecondary, paddingTop: '0.55rem', fontWeight: 700 }}>
                Protocol
              </label>
              <select
                value={protocolSettings.protocol ?? ''}
                onChange={(e) =>
                  setProtocolSettings((prev) => ({
                    ...prev,
                    protocol: e.target.value === 'MCP' ? 'MCP' : 'A2A',
                  }))
                }
                style={{
                  padding: '0.55rem 0.7rem',
                  borderRadius: '10px',
                  border: `1px solid ${palette.border}`,
                  background: palette.surfaceMuted,
                  color: palette.textPrimary,
                }}
              >
                <option value="A2A">A2A</option>
                <option value="MCP">MCP</option>
              </select>

              <label style={{ color: palette.textSecondary, paddingTop: '0.55rem', fontWeight: 700 }}>
                A2A endpoint
              </label>
              <input
                value={protocolSettings.a2aEndpoint}
                onChange={(e) => setProtocolSettings((prev) => ({ ...prev, a2aEndpoint: e.target.value }))}
                placeholder={defaultA2AEndpoint || 'https://.../.well-known/agent-card.json'}
                style={{
                  padding: '0.55rem 0.7rem',
                  borderRadius: '10px',
                  border: `1px solid ${palette.border}`,
                  background: palette.surfaceMuted,
                  color: palette.textPrimary,
                }}
              />

              <label style={{ color: palette.textSecondary, paddingTop: '0.55rem', fontWeight: 700 }}>
                MCP endpoint
              </label>
              <input
                value={protocolSettings.mcpEndpoint}
                onChange={(e) => setProtocolSettings((prev) => ({ ...prev, mcpEndpoint: e.target.value }))}
                placeholder={defaultMcpEndpoint || 'https://.../api/mcp'}
                style={{
                  padding: '0.55rem 0.7rem',
                  borderRadius: '10px',
                  border: `1px solid ${palette.border}`,
                  background: palette.surfaceMuted,
                  color: palette.textPrimary,
                }}
              />
            </div>
          </>
        );
      }
      case 4: {
        const endpointType = protocolSettings.protocol === 'MCP' ? 'mcp' : 'a2a';
        const endpointRaw =
          protocolSettings.protocol === 'MCP' ? protocolSettings.mcpEndpoint : protocolSettings.a2aEndpoint;
        const endpoint = safeUrl(endpointRaw || '');
        return (
          <>
            <div style={{ color: palette.textSecondary, lineHeight: 1.5 }}>
              <div>
                Chain: <b>{chainLabel}</b>
              </div>
              <div>
                Collection:{' '}
                <b>
                  {selectedCollection?.registryName?.trim()
                    ? selectedCollection.registryName
                    : selectedCollection?.registryAddress || '—'}
                </b>
              </div>
              <div>
                Registrar: <code>{resolvedRegistrarAddress || '—'}</code>
              </div>
              <div>
                Agent name: <b>{createForm.agentName || '—'}</b>
              </div>
              <div>
                ENS: <code>{ensFullNamePreview || '—'}</code>
              </div>
              <div>
                Agent account: <code>{createForm.agentAccount || '—'}</code>
              </div>
              <div>
                Protocol: <b>{protocolSettings.protocol || '—'}</b>
              </div>
              <div>
                Endpoint: <code>{endpoint || '—'}</code>
              </div>
              <div>
                Supported trust: <code>{supportedTrust.length ? supportedTrust.join(', ') : '—'}</code>
              </div>
              <div style={{ marginTop: '0.75rem' }}>
                UAID metadata: will attempt to set <code>uaid</code> after mint.
              </div>
            </div>
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
        displayAddress={walletAddress ?? null}
        privateKeyMode={privateKeyMode}
        isConnected={isConnected}
        onConnect={openLoginModal}
        onDisconnect={handleDisconnect}
        disableConnect={loading}
      />

      <main style={{ padding: '2rem', maxWidth: '1100px', margin: '0 auto' }}>
        <div style={{ marginBottom: '1.25rem' }}>
          <div style={{ color: palette.textSecondary, fontSize: '0.9rem' }}>Agent Registration</div>
          <h1 style={{ margin: '0.25rem 0 0', fontSize: '1.6rem' }}>ERC-8122</h1>
        </div>

        {!canSign && (
          <div
            style={{
              border: `1px solid ${palette.border}`,
              borderRadius: '10px',
              padding: '1rem',
              marginBottom: '1rem',
              background: palette.surfaceMuted,
            }}
          >
            <div style={{ fontWeight: 800, marginBottom: '0.35rem' }}>Wallet required</div>
            <div style={{ color: palette.textSecondary, lineHeight: 1.45 }}>
              This flow requires an EIP-1193 wallet connection. Private key mode is not supported for 8122 minting.
            </div>
          </div>
        )}

        {error && (
          <div
            style={{
              border: `1px solid ${palette.borderStrong}`,
              borderRadius: '10px',
              padding: '0.85rem 1rem',
              marginBottom: '1rem',
              background: palette.surfaceMuted,
              color: palette.textPrimary,
            }}
          >
            <div style={{ fontWeight: 800, color: palette.dangerText, marginBottom: '0.25rem' }}>Error</div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{error}</div>
          </div>
        )}

        {success && (
          <div
            style={{
              border: `1px solid ${palette.borderStrong}`,
              borderRadius: '10px',
              padding: '0.85rem 1rem',
              marginBottom: '1rem',
              background: palette.surfaceMuted,
              color: palette.textPrimary,
            }}
          >
            <div style={{ fontWeight: 800, color: palette.successText, marginBottom: '0.25rem' }}>Success</div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{success}</div>
          </div>
        )}

        <section
          style={{
            border: `1px solid ${palette.border}`,
            borderRadius: '12px',
            padding: '1rem',
            background: palette.surface,
          }}
        >
          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.9rem' }}>
            {CREATE_STEPS.map((label, idx) => {
              const active = idx === createStep;
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => setCreateStep(idx)}
                  style={{
                    padding: '0.4rem 0.75rem',
                    borderRadius: '999px',
                    border: `1px solid ${palette.borderStrong}`,
                    background: active ? palette.accent : palette.surfaceMuted,
                    color: active ? palette.surface : palette.textPrimary,
                    fontWeight: 700,
                    cursor: 'pointer',
                    fontSize: '0.9rem',
                  }}
                >
                  {idx + 1}. {label}
                </button>
              );
            })}
          </div>

          {renderStep()}

          <div
            style={{
              marginTop: '1.25rem',
              display: 'flex',
              justifyContent: 'space-between',
              gap: '0.75rem',
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            <button
              type="button"
              onClick={() => setCreateStep((s) => Math.max(0, s - 1))}
              disabled={createStep === 0 || registering}
              style={{
                padding: '0.55rem 0.85rem',
                borderRadius: '10px',
                border: `1px solid ${palette.borderStrong}`,
                background: palette.surfaceMuted,
                color: palette.textPrimary,
                fontWeight: 800,
                cursor: createStep === 0 || registering ? 'not-allowed' : 'pointer',
                opacity: createStep === 0 || registering ? 0.6 : 1,
              }}
            >
              Back
            </button>

            <div style={{ color: palette.textSecondary, fontSize: '0.9rem' }}>
              {canProceed.ok ? '' : canProceed.message}
            </div>

            {createStep < CREATE_STEPS.length - 1 ? (
              <button
                type="button"
                onClick={() => {
                  if (!canProceed.ok) return;
                  setCreateStep((s) => Math.min(CREATE_STEPS.length - 1, s + 1));
                }}
                disabled={!canProceed.ok || registering}
                style={{
                  padding: '0.55rem 0.85rem',
                  borderRadius: '10px',
                  border: `1px solid ${palette.borderStrong}`,
                  background: palette.accent,
                  color: palette.surface,
                  fontWeight: 800,
                  cursor: !canProceed.ok || registering ? 'not-allowed' : 'pointer',
                  opacity: !canProceed.ok || registering ? 0.6 : 1,
                }}
              >
                Next
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  handleRegister().catch((e) => {
                    // eslint-disable-next-line no-console
                    console.error('[8122 register] failed', e);
                    const msg = formatViemError(e);
                    setError(msg && msg.trim() ? msg : 'Registration failed (see console for details).');
                  });
                }}
                disabled={!canProceed.ok || !canSign || registering}
                style={{
                  padding: '0.55rem 0.85rem',
                  borderRadius: '10px',
                  border: `1px solid ${palette.borderStrong}`,
                  background: palette.accent,
                  color: palette.surface,
                  fontWeight: 800,
                  cursor: !canProceed.ok || !canSign || registering ? 'not-allowed' : 'pointer',
                  opacity: !canProceed.ok || !canSign || registering ? 0.6 : 1,
                }}
              >
                {registering ? 'Registering…' : 'Register'}
              </button>
            )}
          </div>
        </section>

        {registrationCompleteOpen && registrationCompleteDetails && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '1.25rem',
              zIndex: 50,
            }}
            onClick={() => setRegistrationCompleteOpen(false)}
          >
            <div
              style={{
                background: palette.surface,
                borderRadius: '14px',
                border: `1px solid ${palette.border}`,
                maxWidth: '720px',
                width: '100%',
                padding: '1.1rem 1.2rem',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ fontWeight: 900, fontSize: '1.1rem' }}>Registration complete</div>
              <div style={{ marginTop: '0.75rem', color: palette.textSecondary, lineHeight: 1.5 }}>
                {registrationCompleteDetails.uaid && (
                  <div>
                    UAID: <code>{registrationCompleteDetails.uaid}</code>
                  </div>
                )}
                {registrationCompleteDetails.did && (
                  <div>
                    DID: <code>{registrationCompleteDetails.did}</code>
                  </div>
                )}
                {registrationCompleteDetails.agentId && (
                  <div>
                    Agent ID: <code>{registrationCompleteDetails.agentId}</code>
                  </div>
                )}
                {registrationCompleteDetails.registry && (
                  <div>
                    Registry: <code>{registrationCompleteDetails.registry}</code>
                  </div>
                )}
                {registrationCompleteDetails.registrar && (
                  <div>
                    Registrar: <code>{registrationCompleteDetails.registrar}</code>
                  </div>
                )}
                {registrationCompleteDetails.txHash && (
                  <div>
                    Tx: <code>{registrationCompleteDetails.txHash}</code>
                  </div>
                )}
              </div>
              <div style={{ marginTop: '1rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => setRegistrationCompleteOpen(false)}
                  style={{
                    padding: '0.55rem 0.85rem',
                    borderRadius: '10px',
                    border: `1px solid ${palette.borderStrong}`,
                    background: palette.surfaceMuted,
                    color: palette.textPrimary,
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  Close
                </button>
                {registrationCompleteDetails.uaid && (
                  <button
                    type="button"
                    onClick={() => router.push(`/agents/${encodeURIComponent(registrationCompleteDetails.uaid || '')}`)}
                    style={{
                      padding: '0.55rem 0.85rem',
                      borderRadius: '10px',
                      border: `1px solid ${palette.borderStrong}`,
                      background: palette.accent,
                      color: palette.surface,
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    Open agent details
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </>
  );
}

