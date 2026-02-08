'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Address, Hex } from 'viem';
import {
  createPublicClient,
  createWalletClient,
  custom,
  getAddress,
  http,
} from 'viem';
import { mainnet, sepolia, baseSepolia, optimismSepolia } from 'viem/chains';

import { Header } from '@/components/Header';
import { useAuth } from '@/components/AuthProvider';
import { useWallet } from '@/components/WalletProvider';
import { grayscalePalette as palette } from '@/styles/palette';

import { agentRegistrarAbi } from '@agentic-trust/8122-sdk';

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

function chainIdToHex(chainId: number): Hex {
  return `0x${chainId.toString(16)}` as Hex;
}

async function ensureEip1193Chain(provider: any, chainId: number) {
  if (!provider?.request) {
    throw new Error('Missing wallet provider (EIP-1193). Connect a wallet to continue.');
  }
  const currentHex = await provider.request({ method: 'eth_chainId' });
  const currentId = typeof currentHex === 'string' ? parseInt(currentHex, 16) : NaN;
  if (Number.isFinite(currentId) && currentId === chainId) return;

  await provider.request({
    method: 'wallet_switchEthereumChain',
    params: [{ chainId: chainIdToHex(chainId) }],
  });
}

function buildDid8122(params: { chainId: number; registry: Address; agentId: bigint }): string {
  return `did:8122:${params.chainId}:${params.registry}:${params.agentId.toString()}`;
}

function buildUaidFromDid(did: string): string {
  return `uaid:${did}`;
}

const REGISTRAR_ERROR_EXPLANATIONS: Record<string, string> = {
  // AgentRegistrar custom errors (idchain-world/agent-registry)
  // selector = first 4 bytes of keccak256("ErrorName(...)")
  '0x50e90ba2':
    'MintingNotOpen: minting is closed on this registrar. An admin must call openMinting(true) (public) or openMinting(false) + grant MINTER_ROLE.',
  '0xf8d2906c':
    'NotMinter: registrar is in private mode and your wallet is missing MINTER_ROLE.',
  '0x8bf9b99f':
    'FunctionLocked: the registrar has a lock bit set preventing this change.',
  '0x49dcd720': 'InvalidLockBit: invalid lock bit value.',
  '0x90b8ec18': 'TransferFailed: ETH transfer/refund failed.',
  '0xb99e2ab7':
    'InsufficientPayment: msg.value is less than required mintPrice (plus any batch count).',
  '0xea058246': 'MaxSupplyExceeded: maxSupply would be exceeded.',
  '0x5f7eb404': 'MaxSupplyTooLow: new maxSupply is below totalMinted.',
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
      if (explanation) {
        return `${explanation} (selector ${selector})`;
      }
      return `execution reverted (selector ${selector})`;
    }

    if (typeof anyErr.shortMessage === 'string' && anyErr.shortMessage.trim()) {
      return anyErr.shortMessage;
    }
    if (typeof anyErr.details === 'string' && anyErr.details.trim()) {
      return anyErr.details;
    }
    if (typeof anyErr.message === 'string' && anyErr.message.trim()) {
      return anyErr.message;
    }
  }
  return String(err);
}

function formatEther18Dp(wei: bigint): string {
  const base = 10n ** 18n;
  const whole = wei / base;
  const frac = wei % base;
  const fracStr = frac.toString().padStart(18, '0');
  return `${whole.toString()}.${fracStr}`;
}

export default function AgentRegistration8122Page() {
  const router = useRouter();
  const { isConnected, privateKeyMode, loading, walletAddress, openLoginModal, handleDisconnect } =
    useAuth();
  const { eip1193Provider } = useWallet();

  const [chainId, setChainId] = useState<number>(1);
  const [chainBalanceWei, setChainBalanceWei] = useState<bigint | null>(null);
  const [chainBalanceLoading, setChainBalanceLoading] = useState(false);
  const [chainBalanceError, setChainBalanceError] = useState<string | null>(null);

  // Collections (registries) from KB
  const [collectionsLoading, setCollectionsLoading] = useState(false);
  const [collectionsError, setCollectionsError] = useState<string | null>(null);
  const [collections, setCollections] = useState<
    Array<{
      iri?: string | null;
      chainId: number;
      registryAddress: string;
      registrarAddress?: string | null;
      registryName?: string | null;
      registryImplementationAddress?: string | null;
      registrarImplementationAddress?: string | null;
      registeredAgentCount?: number | null;
      lastAgentUpdatedAtTime?: number | null;
    }>
  >([]);
  const [selectedCollectionRegistry, setSelectedCollectionRegistry] = useState<string>('');

  // Mint / register agent
  const [registrarAddressInput, setRegistrarAddressInput] = useState<string>('');
  const [ownerInput, setOwnerInput] = useState<string>('');
  const [agentAccountInput, setAgentAccountInput] = useState<string>('');
  const [endpointType, setEndpointType] = useState<'a2a' | 'mcp'>('a2a');
  const [endpointInput, setEndpointInput] = useState<string>('');
  const [registrarMintPriceWei, setRegistrarMintPriceWei] = useState<bigint | null>(null);
  const [registrarMintPriceLoading, setRegistrarMintPriceLoading] = useState(false);
  const [registrarMintPriceError, setRegistrarMintPriceError] = useState<string | null>(null);
  const [registrarIsOpen, setRegistrarIsOpen] = useState<boolean | null>(null);
  const [registrarIsPublicMinting, setRegistrarIsPublicMinting] = useState<boolean | null>(null);
  const [registrarOpenStateLoading, setRegistrarOpenStateLoading] = useState(false);
  const [registrarOpenStateError, setRegistrarOpenStateError] = useState<string | null>(null);
  const [registrarAutoOpening, setRegistrarAutoOpening] = useState(false);
  const registrarAutoOpenAttemptedRef = useRef<string>('');
  const [minting, setMinting] = useState(false);
  const [mintTxHash, setMintTxHash] = useState<string | null>(null);
  const [mintedAgentId, setMintedAgentId] = useState<bigint | null>(null);
  const [mintedRegistry, setMintedRegistry] = useState<Address | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const chainLabel = useMemo(() => {
    return SUPPORTED_CHAINS.find((c) => c.id === chainId)?.label ?? String(chainId);
  }, [chainId]);

  const canSign = Boolean(isConnected && walletAddress && eip1193Provider && !privateKeyMode);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setChainBalanceError(null);
      setChainBalanceWei(null);

      if (!walletAddress) return;
      const chain = CHAIN_BY_ID[chainId];
      if (!chain) return;

      const rpcUrl = chain?.rpcUrls?.default?.http?.[0];
      if (typeof rpcUrl !== 'string' || !rpcUrl.trim()) {
        setChainBalanceError(`No RPC URL available for chainId ${chainId}.`);
        return;
      }

      setChainBalanceLoading(true);
      try {
        const publicClient = createPublicClient({
          chain,
          transport: http(rpcUrl),
        });
        const balance = await publicClient.getBalance({
          address: getAddress(walletAddress) as Address,
        });
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
  }, [walletAddress, chainId]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setCollectionsError(null);
      setCollections([]);

      setCollectionsLoading(true);
      try {
        const res = await fetch('/api/registries/8122', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chainId, first: 250, skip: 0 }),
        });
        const json = (await res.json().catch(() => null)) as any;
        if (!res.ok) {
          throw new Error(json?.error || `Failed to fetch collections (${res.status})`);
        }
        const rows = Array.isArray(json?.registries) ? json.registries : [];
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
  }, [chainId]);

  const resolvedDefaults = useMemo(() => {
    const addr = walletAddress ? String(walletAddress) : '';
    return {
      owner: ownerInput.trim() ? ownerInput.trim() : addr,
      agentAccount: agentAccountInput.trim() ? agentAccountInput.trim() : addr,
      registrar: registrarAddressInput.trim() ? registrarAddressInput.trim() : '',
    };
  }, [
    walletAddress,
    ownerInput,
    agentAccountInput,
    registrarAddressInput,
  ]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setRegistrarMintPriceError(null);
      setRegistrarMintPriceWei(null);
      setRegistrarOpenStateError(null);
      setRegistrarIsOpen(null);
      setRegistrarIsPublicMinting(null);

      const rawRegistrar = resolvedDefaults.registrar?.trim();
      if (!rawRegistrar) return;
      const chain = CHAIN_BY_ID[chainId];
      if (!chain) return;

      const rpcUrl = chain?.rpcUrls?.default?.http?.[0];
      if (typeof rpcUrl !== 'string' || !rpcUrl.trim()) {
        setRegistrarMintPriceError(`No RPC URL available for chainId ${chainId}.`);
        setRegistrarOpenStateError(`No RPC URL available for chainId ${chainId}.`);
        return;
      }

      let registrar: Address;
      try {
        registrar = getAddress(rawRegistrar) as Address;
      } catch (e) {
        setRegistrarMintPriceError(`Invalid registrar address: ${rawRegistrar}`);
        setRegistrarOpenStateError(`Invalid registrar address: ${rawRegistrar}`);
        return;
      }

      setRegistrarMintPriceLoading(true);
      setRegistrarOpenStateLoading(true);
      try {
        const publicClient = createPublicClient({
          chain,
          transport: http(rpcUrl),
        });

        const code = await publicClient.getBytecode({ address: registrar });
        if (!code || code === '0x') {
          throw new Error(
            `Registrar address has no bytecode on chainId ${chainId}. ` +
              `Wrong chain or wrong address.`,
          );
        }

        // Read open/publicMinting independently from mintPrice so we can still show status
        // even if mintPrice() is missing (ABI mismatch).
        const [openResult, publicResult, mintPriceResult] = await Promise.allSettled([
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
          publicClient.readContract({
            address: registrar,
            abi: agentRegistrarAbi,
            functionName: 'mintPrice',
          }) as Promise<bigint>,
        ]);

        if (cancelled) return;

        if (openResult.status === 'fulfilled') {
          setRegistrarIsOpen(openResult.value);
        } else {
          setRegistrarOpenStateError(formatViemError(openResult.reason));
        }

        if (publicResult.status === 'fulfilled') {
          setRegistrarIsPublicMinting(publicResult.value);
        } else {
          setRegistrarOpenStateError(formatViemError(publicResult.reason));
        }

        // If minting is closed, try to open it automatically (public).
        // This is intentionally silent on failure (e.g. user is not admin).
        if (
          openResult.status === 'fulfilled' &&
          openResult.value === false &&
          canSign &&
          eip1193Provider &&
          walletAddress
        ) {
          const key = `${chainId}:${registrar.toLowerCase()}`;
          if (registrarAutoOpenAttemptedRef.current !== key) {
            registrarAutoOpenAttemptedRef.current = key;
            setRegistrarAutoOpening(true);
            try {
              await ensureEip1193Chain(eip1193Provider, chainId);
              const wc = createWalletClient({
                chain,
                transport: custom(eip1193Provider),
              });
              const pc = createPublicClient({
                chain,
                transport: custom(eip1193Provider),
              });
              const req = await pc.simulateContract({
                address: registrar,
                abi: agentRegistrarAbi,
                functionName: 'openMinting',
                args: [true],
                account: getAddress(walletAddress) as Address,
              });
              const tx = await wc.writeContract(req.request);
              const r = await pc.waitForTransactionReceipt({ hash: tx });
              if ((r as any)?.status && String((r as any).status) !== 'success') {
                throw new Error(`openMinting(true) reverted on-chain. tx=${tx}`);
              }

              // Refresh open/publicMinting after opening.
              const [openNow, publicNow] = await Promise.all([
                pc.readContract({
                  address: registrar,
                  abi: agentRegistrarAbi,
                  functionName: 'open',
                }) as Promise<boolean>,
                pc.readContract({
                  address: registrar,
                  abi: agentRegistrarAbi,
                  functionName: 'publicMinting',
                }) as Promise<boolean>,
              ]);
              try {
                const mp = (await pc.readContract({
                  address: registrar,
                  abi: agentRegistrarAbi,
                  functionName: 'mintPrice',
                })) as bigint;
                if (!cancelled) {
                  setRegistrarMintPriceWei(mp);
                  setRegistrarMintPriceError(null);
                }
              } catch {
                // ignore
              }
              if (!cancelled) {
                setRegistrarIsOpen(openNow);
                setRegistrarIsPublicMinting(publicNow);
                setRegistrarOpenStateError(null);
              }
            } catch {
              // intentionally silent
            } finally {
              if (!cancelled) setRegistrarAutoOpening(false);
            }
          }
        }

        if (mintPriceResult.status === 'fulfilled') {
          setRegistrarMintPriceWei(mintPriceResult.value);
        } else {
          setRegistrarMintPriceError(formatViemError(mintPriceResult.reason));
        }
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setRegistrarMintPriceError(msg);
        setRegistrarOpenStateError(msg);
      } finally {
        if (!cancelled) setRegistrarMintPriceLoading(false);
        if (!cancelled) setRegistrarOpenStateLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [chainId, resolvedDefaults.registrar, canSign, eip1193Provider, walletAddress]);

  const handleMint = useCallback(async () => {
    setError(null);
    setSuccess(null);
    setMintTxHash(null);
    setMintedAgentId(null);
    setMintedRegistry(null);

    if (privateKeyMode) {
      throw new Error('ERC-8122 registration requires a connected wallet (private key mode is not supported).');
    }
    if (!walletAddress) {
      throw new Error('Connect a wallet to mint/register an agent.');
    }
    if (!eip1193Provider) {
      throw new Error('Missing wallet provider (EIP-1193). Connect a wallet to continue.');
    }

    const chain = CHAIN_BY_ID[chainId];
    if (!chain) {
      throw new Error(`Unsupported chainId ${chainId}.`);
    }

    const registrar = getAddress(resolvedDefaults.registrar) as Address;
    const owner = getAddress(resolvedDefaults.owner) as Address;
    const agentAccount = getAddress(resolvedDefaults.agentAccount) as Address;
    const endpoint = endpointInput.trim();
    if (!endpoint) {
      throw new Error('Endpoint URL is required.');
    }

    setMinting(true);
    try {
      await ensureEip1193Chain(eip1193Provider, chainId);

      const publicClient = createPublicClient({ chain, transport: custom(eip1193Provider) });
      const walletClient = createWalletClient({
        chain,
        transport: custom(eip1193Provider),
      });

      const code = await publicClient.getBytecode({ address: registrar });
      if (!code || code === '0x') {
        throw new Error(
          `Registrar address has no bytecode on chainId ${chainId}. Wrong chain or wrong address.`,
        );
      }

      // If minting isn't open yet, try to open it (public minting).
      // This requires the caller to have ADMIN_ROLE on the registrar.
      try {
        const isOpen = (await publicClient.readContract({
          address: registrar,
          abi: agentRegistrarAbi,
          functionName: 'open',
        })) as boolean;
        if (!isOpen) {
          const openReq = await publicClient.simulateContract({
            address: registrar,
            abi: agentRegistrarAbi,
            functionName: 'openMinting',
            args: [true],
            account: getAddress(walletAddress) as Address,
          });
          const openTx = await walletClient.writeContract(openReq.request);
          const openReceipt = await publicClient.waitForTransactionReceipt({ hash: openTx });
          if ((openReceipt as any)?.status && String((openReceipt as any).status) !== 'success') {
            throw new Error(`openMinting(true) reverted on-chain. tx=${openTx}`);
          }
        }
      } catch (e) {
        throw new Error(`Failed to ensure minting is open: ${formatViemError(e)}`);
      }

      // Read mint price after minting is open.
      let mintPrice: bigint;
      try {
        mintPrice = (await publicClient.readContract({
          address: registrar,
          abi: agentRegistrarAbi,
          functionName: 'mintPrice',
        })) as bigint;
      } catch (e) {
        throw new Error(
          `Failed to read mintPrice() from registrar. ` +
            `This address may not be an AgentRegistrar on this chain. ` +
            `${formatViemError(e)}`,
        );
      }

      // Preflight simulation to surface revert reasons before the wallet prompt.
      // (This avoids "likely to fail" with no actionable details.)
      let request: any;
      try {
        const simulated = await publicClient.simulateContract({
          address: registrar,
          abi: agentRegistrarAbi,
          functionName: 'mint',
          args: [owner, endpointType, endpoint, agentAccount],
          value: mintPrice,
          account: getAddress(walletAddress) as Address,
        });
        request = simulated.request;
      } catch (e) {
        throw new Error(`Mint preflight failed: ${formatViemError(e)}`);
      }

      const txHash = await walletClient.writeContract(request);
      setMintTxHash(txHash);

      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      if ((receipt as any)?.status && String((receipt as any).status) !== 'success') {
        throw new Error(`Mint transaction reverted on-chain. tx=${txHash}`);
      }

      let agentId: bigint | null = null;
      for (const log of receipt.logs) {
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
          // ignore non-matching log
        }
      }
      if (agentId == null) {
        throw new Error(
          `Mint transaction mined but AgentMinted event was not found. tx=${txHash}`,
        );
      }

      const registry = (await publicClient.readContract({
        address: registrar,
        abi: agentRegistrarAbi,
        functionName: 'registry',
      })) as Address;

      setMintedAgentId(agentId);
      setMintedRegistry(getAddress(registry) as Address);
      setSuccess(`Minted agent #${agentId.toString()} on ${chainLabel}.`);
    } finally {
      setMinting(false);
    }
  }, [
    privateKeyMode,
    walletAddress,
    eip1193Provider,
    chainId,
    chainLabel,
    resolvedDefaults.registrar,
    resolvedDefaults.owner,
    resolvedDefaults.agentAccount,
    endpointType,
    endpointInput,
  ]);

  const mintedDid = useMemo(() => {
    if (!mintedRegistry || mintedAgentId == null) return null;
    return buildDid8122({ chainId, registry: mintedRegistry, agentId: mintedAgentId });
  }, [chainId, mintedRegistry, mintedAgentId]);

  const mintedUaid = useMemo(() => {
    if (!mintedDid) return null;
    return buildUaidFromDid(mintedDid);
  }, [mintedDid]);

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
      <main style={{ padding: '2rem', maxWidth: '1000px', margin: '0 auto' }}>
        <div style={{ marginBottom: '1.25rem' }}>
          <div style={{ color: palette.textSecondary, fontSize: '0.9rem' }}>Agent Registration</div>
          <h1 style={{ margin: '0.25rem 0 0', fontSize: '1.6rem' }}>ERC-8122</h1>
          <div style={{ marginTop: '0.5rem', color: palette.textSecondary, lineHeight: 1.4 }}>
            Select an ERC-8122 collection (registry) from the KB, then mint/register an agent via its registrar.
          </div>
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
            <div style={{ fontWeight: 700, marginBottom: '0.35rem' }}>Wallet required</div>
            <div style={{ color: palette.textSecondary, lineHeight: 1.45 }}>
              This page requires an EIP-1193 wallet connection (Web3Auth/MetaMask). Private key mode is not
              supported for on-chain ERC-8122 actions.
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
            <div style={{ fontWeight: 700, color: palette.dangerText, marginBottom: '0.25rem' }}>Error</div>
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
            <div style={{ fontWeight: 700, color: palette.successText, marginBottom: '0.25rem' }}>
              Success
            </div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{success}</div>
          </div>
        )}

        <section
          style={{
            border: `1px solid ${palette.border}`,
            borderRadius: '12px',
            padding: '1rem',
            background: palette.surface,
            marginBottom: '1rem',
          }}
        >
          <h2 style={{ margin: 0, fontSize: '1.1rem' }}>1) Choose chain</h2>
          <div style={{ marginTop: '0.75rem', display: 'grid', gridTemplateColumns: '200px 1fr', gap: '0.75rem' }}>
            <label style={{ color: palette.textSecondary, paddingTop: '0.55rem' }}>Chain</label>
            <select
              value={String(chainId)}
              onChange={(e) => setChainId(Number(e.target.value))}
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
          </div>

          <div style={{ marginTop: '0.75rem', color: palette.textSecondary, lineHeight: 1.45 }}>
            {!walletAddress ? (
              <div>Connect a wallet to view your ETH balance.</div>
            ) : chainBalanceLoading ? (
              <div>Balance on {chainLabel}: Loading…</div>
            ) : chainBalanceError ? (
              <div>
                Balance on {chainLabel}: <span style={{ color: palette.dangerText }}>Failed</span>{' '}
                <span style={{ opacity: 0.9 }}>({chainBalanceError})</span>
              </div>
            ) : (
              <div>
                Balance on {chainLabel}:{' '}
                <code>{chainBalanceWei == null ? '—' : formatEther18Dp(chainBalanceWei)}</code> ETH
              </div>
            )}
          </div>
        </section>

        <section
          style={{
            border: `1px solid ${palette.border}`,
            borderRadius: '12px',
            padding: '1rem',
            background: palette.surface,
          }}
        >
          <h2 style={{ margin: 0, fontSize: '1.1rem' }}>2) Mint/register agent</h2>

          <div style={{ marginTop: '0.75rem', display: 'grid', gridTemplateColumns: '200px 1fr', gap: '0.75rem' }}>
            <label style={{ color: palette.textSecondary, paddingTop: '0.55rem' }}>Collection</label>
            <select
              value={selectedCollectionRegistry}
              onChange={(e) => {
                const v = String(e.target.value || '');
                setSelectedCollectionRegistry(v);
                const chosen = collections.find((c) => c.registryAddress === v) ?? null;
                const registrar =
                  chosen && typeof chosen.registrarAddress === 'string' ? chosen.registrarAddress.trim() : '';
                setRegistrarAddressInput(registrar);
              }}
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
                  Manage/create collections in{' '}
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

            <label style={{ color: palette.textSecondary, paddingTop: '0.55rem' }}>Registrar address</label>
            <input
              value={registrarAddressInput}
              onChange={(e) => setRegistrarAddressInput(e.target.value)}
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
              {resolvedDefaults.registrar ? (
                registrarMintPriceLoading ? (
                  <div>Registrar mint price: Loading…</div>
                ) : registrarMintPriceError ? (
                  <div>
                    Registrar mint price: <span style={{ color: palette.dangerText }}>Failed</span>{' '}
                    <span style={{ opacity: 0.9 }}>({registrarMintPriceError})</span>
                  </div>
                ) : (
                  <div>
                    Registrar mint price:{' '}
                    <code>
                      {registrarMintPriceWei == null ? '—' : formatEther18Dp(registrarMintPriceWei)}
                    </code>{' '}
                    ETH
                    <div style={{ marginTop: '0.25rem' }}>
                      Minting status:{' '}
                      {registrarOpenStateLoading ? (
                        'Loading…'
                      ) : registrarOpenStateError ? (
                        <span style={{ color: palette.dangerText }}>Unknown</span>
                      ) : registrarAutoOpening ? (
                        <span style={{ color: palette.textSecondary, fontWeight: 700 }}>
                          Closed (opening…)
                        </span>
                      ) : registrarIsOpen ? (
                        registrarIsPublicMinting ? (
                          <span style={{ color: palette.successText, fontWeight: 700 }}>Open (public)</span>
                        ) : (
                          <span style={{ color: palette.successText, fontWeight: 700 }}>Open (private)</span>
                        )
                      ) : (
                        <span style={{ color: palette.dangerText, fontWeight: 700 }}>Closed</span>
                      )}
                    </div>
                    {chainBalanceWei != null && registrarMintPriceWei != null && (
                      <>
                        <div style={{ marginTop: '0.25rem' }}>
                          Remaining after mint (excluding gas):{' '}
                          {chainBalanceWei >= registrarMintPriceWei ? (
                            <code>
                              {formatEther18Dp(chainBalanceWei - registrarMintPriceWei)}
                            </code>
                          ) : (
                            <span style={{ color: palette.dangerText, fontWeight: 700 }}>insufficient</span>
                          )}{' '}
                          ETH
                        </div>
                      </>
                    )}
                  </div>
                )
              ) : (
                <div>Registrar mint price: enter a registrar address.</div>
              )}
              <div style={{ marginTop: '0.25rem', opacity: 0.9 }}>
                Total cost = mint price + gas (network fee).
              </div>
            </div>

            <label style={{ color: palette.textSecondary, paddingTop: '0.55rem' }}>Owner (defaults to you)</label>
            <input
              value={ownerInput}
              onChange={(e) => setOwnerInput(e.target.value)}
              placeholder={walletAddress ?? '0x...'}
              style={{
                padding: '0.55rem 0.7rem',
                borderRadius: '10px',
                border: `1px solid ${palette.border}`,
                background: palette.surfaceMuted,
                color: palette.textPrimary,
              }}
            />

            <label style={{ color: palette.textSecondary, paddingTop: '0.55rem' }}>
              Agent account (defaults to you)
            </label>
            <input
              value={agentAccountInput}
              onChange={(e) => setAgentAccountInput(e.target.value)}
              placeholder={walletAddress ?? '0x...'}
              style={{
                padding: '0.55rem 0.7rem',
                borderRadius: '10px',
                border: `1px solid ${palette.border}`,
                background: palette.surfaceMuted,
                color: palette.textPrimary,
              }}
            />

            <label style={{ color: palette.textSecondary, paddingTop: '0.55rem' }}>Endpoint type</label>
            <select
              value={endpointType}
              onChange={(e) => setEndpointType(e.target.value === 'mcp' ? 'mcp' : 'a2a')}
              style={{
                padding: '0.55rem 0.7rem',
                borderRadius: '10px',
                border: `1px solid ${palette.border}`,
                background: palette.surfaceMuted,
                color: palette.textPrimary,
              }}
            >
              <option value="a2a">a2a</option>
              <option value="mcp">mcp</option>
            </select>

            <label style={{ color: palette.textSecondary, paddingTop: '0.55rem' }}>Endpoint URL</label>
            <input
              value={endpointInput}
              onChange={(e) => setEndpointInput(e.target.value)}
              placeholder="https://..."
              style={{
                padding: '0.55rem 0.7rem',
                borderRadius: '10px',
                border: `1px solid ${palette.border}`,
                background: palette.surfaceMuted,
                color: palette.textPrimary,
              }}
            />
          </div>

          <div style={{ marginTop: '0.9rem', display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              disabled={!canSign || minting}
              onClick={() => {
                handleMint().catch((e) => setError(e instanceof Error ? e.message : String(e)));
              }}
              style={{
                padding: '0.55rem 0.85rem',
                borderRadius: '10px',
                border: `1px solid ${palette.borderStrong}`,
                background: palette.accent,
                color: palette.surface,
                fontWeight: 700,
                cursor: !canSign || minting ? 'not-allowed' : 'pointer',
                opacity: !canSign || minting ? 0.65 : 1,
              }}
            >
              {minting ? 'Minting…' : 'Mint'}
            </button>

            {mintTxHash && (
              <div style={{ color: palette.textSecondary, fontSize: '0.9rem' }}>
                Tx: <code>{mintTxHash}</code>
              </div>
            )}
          </div>

          {mintedDid && mintedUaid && mintedRegistry && mintedAgentId != null && (
            <div style={{ marginTop: '1rem', borderTop: `1px solid ${palette.border}`, paddingTop: '0.9rem' }}>
              <div style={{ color: palette.textSecondary, marginBottom: '0.35rem' }}>
                Registrar mint price is read on-chain; your wallet will pay it automatically.
              </div>
              <div style={{ marginTop: '0.35rem' }}>
                DID: <code>{mintedDid}</code>
              </div>
              <div style={{ marginTop: '0.35rem' }}>
                UAID: <code>{mintedUaid}</code>
              </div>
              <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => router.push(`/agents/${encodeURIComponent(mintedUaid)}`)}
                  style={{
                    padding: '0.55rem 0.85rem',
                    borderRadius: '10px',
                    border: `1px solid ${palette.borderStrong}`,
                    background: palette.surfaceMuted,
                    color: palette.textPrimary,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Open agent details
                </button>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(mintedUaid).catch(() => {});
                  }}
                  style={{
                    padding: '0.55rem 0.85rem',
                    borderRadius: '10px',
                    border: `1px solid ${palette.borderStrong}`,
                    background: palette.surfaceMuted,
                    color: palette.textPrimary,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Copy UAID
                </button>
              </div>
            </div>
          )}

          <div style={{ marginTop: '0.9rem', color: palette.textSecondary, fontSize: '0.9rem', lineHeight: 1.45 }}>
            Notes:
            <ul style={{ marginTop: '0.35rem' }}>
              <li>
                This flow expects a valid <code>AgentRegistrar</code> contract address (or a factory address to deploy
                one).
              </li>
              <li>
                The minted identifier follows <code>did:8122:&lt;chainId&gt;:&lt;registry&gt;:&lt;agentId&gt;</code>.
              </li>
            </ul>
          </div>
        </section>
      </main>
    </>
  );
}

