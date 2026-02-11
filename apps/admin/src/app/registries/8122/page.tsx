'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Header } from '@/components/Header';
import { useAuth } from '@/components/AuthProvider';
import { useWallet } from '@/components/WalletProvider';
import { grayscalePalette as palette } from '@/styles/palette';

import type { Address, Hex } from 'viem';
import {
  createPublicClient,
  createWalletClient,
  custom,
  decodeEventLog,
  getAddress,
  http,
  parseEther,
  toHex,
} from 'viem';
import { mainnet, sepolia, baseSepolia, optimismSepolia } from 'viem/chains';

import { agentRegistryAbi, agentRegistrarAbi, agentRegistryFactoryAbi } from '@agentic-trust/8122-sdk';

const DEFAULT_SEPOLIA_FACTORY_ADDRESS = '0xEdd20967A704c2B2065B7adF41c8cA0d6bec01b3';

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

const DEFAULT_ADMIN_ROLE: Hex = `0x${'00'.repeat(32)}` as Hex;

const accessControlAbi = [
  {
    type: 'function',
    name: 'hasRole',
    stateMutability: 'view',
    inputs: [
      { name: 'role', type: 'bytes32' },
      { name: 'account', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

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

function formatError(err: unknown): string {
  if (err && typeof err === 'object') {
    const anyErr = err as any;
    if (typeof anyErr.shortMessage === 'string' && anyErr.shortMessage.trim()) return anyErr.shortMessage;
    if (typeof anyErr.message === 'string' && anyErr.message.trim()) return anyErr.message;
  }
  return String(err);
}

export default function Registries8122AdminPage() {
  const {
    isConnected,
    privateKeyMode,
    loading,
    walletAddress,
    openLoginModal,
    handleDisconnect,
  } = useAuth();
  const { eip1193Provider } = useWallet();

  const [chainId, setChainId] = useState<number>(11155111);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [registries, setRegistries] = useState<Registry8122[]>([]);

  const [filteringOwned, setFilteringOwned] = useState(false);
  const [ownedRegistries, setOwnedRegistries] = useState<Registry8122[]>([]);
  const [ownedError, setOwnedError] = useState<string | null>(null);

  const canSign = Boolean(isConnected && walletAddress && eip1193Provider && !privateKeyMode);

  // Create collection
  const [factoryAddressInput] = useState<string>(DEFAULT_SEPOLIA_FACTORY_ADDRESS);
  const [newName, setNewName] = useState<string>('');
  const [mintPriceEth, setMintPriceEth] = useState<string>('0');
  const [maxSupply, setMaxSupply] = useState<string>('0');
  const [creating, setCreating] = useState(false);
  const [createTxHash, setCreateTxHash] = useState<string | null>(null);
  const [createOpenMintTxHash, setCreateOpenMintTxHash] = useState<string | null>(null);
  const [createNameTxHash, setCreateNameTxHash] = useState<string | null>(null);
  const [createResult, setCreateResult] = useState<{ registry: Address; registrar: Address } | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  // Rename existing collection
  const [renameDrafts, setRenameDrafts] = useState<Record<string, string>>({});
  const [renamingRegistry, setRenamingRegistry] = useState<string | null>(null);
  const [renameTxHash, setRenameTxHash] = useState<string | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);

  const chainLabel = useMemo(
    () => SUPPORTED_CHAINS.find((c) => c.id === chainId)?.label ?? String(chainId),
    [chainId],
  );

  const chain = CHAIN_BY_ID[chainId];

  const refresh = useCallback(async () => {
    setLoadingList(true);
    setListError(null);
    try {
      const res = await fetch('/api/registries/8122', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chainId, first: 250, skip: 0 }),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) {
        throw new Error(json?.error || `Failed to fetch registries (${res.status})`);
      }
      const rows = Array.isArray(json?.registries) ? (json.registries as Registry8122[]) : [];
      setRegistries(rows);
    } catch (e) {
      setRegistries([]);
      setListError(formatError(e));
    } finally {
      setLoadingList(false);
    }
  }, [chainId]);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setOwnedError(null);
      setOwnedRegistries([]);

      if (!walletAddress) return;
      if (!chain) return;

      const rpcUrl = chain?.rpcUrls?.default?.http?.[0];
      if (typeof rpcUrl !== 'string' || !rpcUrl.trim()) {
        setOwnedError(`No RPC URL available for chainId ${chainId}.`);
        return;
      }

      setFilteringOwned(true);
      try {
        const publicClient = createPublicClient({
          chain,
          transport: http(rpcUrl),
        });

        const wallet = getAddress(walletAddress) as Address;

        const checks = registries.map(async (r) => {
          const registrarRaw = typeof r.registrarAddress === 'string' ? r.registrarAddress : '';
          const target = registrarRaw?.trim() ? registrarRaw.trim() : r.registryAddress;
          let addr: Address;
          try {
            addr = getAddress(target) as Address;
          } catch {
            return { ok: false, r };
          }
          try {
            const code = await publicClient.getBytecode({ address: addr });
            if (!code || code === '0x') return { ok: false, r };
            const isAdmin = (await publicClient.readContract({
              address: addr,
              abi: accessControlAbi,
              functionName: 'hasRole',
              args: [DEFAULT_ADMIN_ROLE, wallet],
            })) as boolean;
            return { ok: Boolean(isAdmin), r };
          } catch {
            return { ok: false, r };
          }
        });

        const results = await Promise.all(checks);
        if (cancelled) return;
        setOwnedRegistries(results.filter((x) => x.ok).map((x) => x.r));
      } catch (e) {
        if (cancelled) return;
        setOwnedError(formatError(e));
      } finally {
        if (!cancelled) setFilteringOwned(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [registries, walletAddress, chainId, chain]);

  const handleCreate = useCallback(async () => {
    setCreateError(null);
    setCreateResult(null);
    setCreateTxHash(null);
    setCreateOpenMintTxHash(null);
    setCreateNameTxHash(null);

    if (privateKeyMode) {
      throw new Error('Creating registries requires a connected wallet (private key mode is not supported).');
    }
    if (!walletAddress) {
      throw new Error('Connect a wallet to create a collection.');
    }
    if (!eip1193Provider) {
      throw new Error('Missing wallet provider (EIP-1193). Connect a wallet to continue.');
    }
    if (!chain) {
      throw new Error(`Unsupported chainId ${chainId}.`);
    }
    const factory = getAddress(factoryAddressInput.trim()) as Address;
    const admin = getAddress(walletAddress) as Address;
    const mp = parseEther(mintPriceEth.trim() || '0');
    const ms = BigInt(maxSupply.trim() || '0');
    const name = newName.trim();
    if (!name) {
      throw new Error('Collection name is required.');
    }

    setCreating(true);
    try {
      await ensureEip1193Chain(eip1193Provider, chainId);
      const walletClient = createWalletClient({ chain, transport: custom(eip1193Provider) });
      const publicClient = createPublicClient({ chain, transport: custom(eip1193Provider) });

      const tx = await walletClient.writeContract({
        address: factory,
        abi: agentRegistryFactoryAbi,
        functionName: 'deploy',
        args: [admin, mp, ms],
        account: admin,
      });
      setCreateTxHash(tx);
      const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });

      let registry: Address | null = null;
      let registrar: Address | null = null;
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: agentRegistryFactoryAbi,
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName === 'RegistryAndRegistrarDeployed') {
            registry = getAddress((decoded.args as any).registry) as Address;
            registrar = getAddress((decoded.args as any).registrar) as Address;
            break;
          }
        } catch {
          // ignore
        }
      }
      if (!registry || !registrar) {
        throw new Error('Deploy mined, but RegistryAndRegistrarDeployed event was not found.');
      }

      // Open minting (public) right away.
      const openReq = await publicClient.simulateContract({
        address: registrar,
        abi: agentRegistrarAbi,
        functionName: 'openMinting',
        args: [true],
        account: admin,
      });
      const openTx = await walletClient.writeContract(openReq.request);
      setCreateOpenMintTxHash(openTx);
      await publicClient.waitForTransactionReceipt({ hash: openTx });

      // Set name on the registry via contract metadata (ERC-8049).
      const nameBytes = toHex(name) as `0x${string}`;
      const nameReq = await publicClient.simulateContract({
        address: registry,
        abi: agentRegistryAbi,
        functionName: 'setContractMetadata',
        args: ['name', nameBytes],
        account: admin,
      });
      const nameTx = await walletClient.writeContract(nameReq.request);
      setCreateNameTxHash(nameTx);
      await publicClient.waitForTransactionReceipt({ hash: nameTx });

      setCreateResult({ registry, registrar });
      await refresh();
    } finally {
      setCreating(false);
    }
  }, [
    privateKeyMode,
    walletAddress,
    eip1193Provider,
    chainId,
    chain,
    factoryAddressInput,
    mintPriceEth,
    maxSupply,
    newName,
    refresh,
  ]);

  const handleRename = useCallback(
    async (registryAddress: string, nextName: string) => {
      setRenameError(null);
      setRenameTxHash(null);
      setRenamingRegistry(registryAddress);

      if (privateKeyMode) {
        throw new Error('Renaming requires a connected wallet (private key mode is not supported).');
      }
      if (!walletAddress) {
        throw new Error('Connect a wallet to rename a collection.');
      }
      if (!eip1193Provider) {
        throw new Error('Missing wallet provider (EIP-1193). Connect a wallet to continue.');
      }
      if (!chain) {
        throw new Error(`Unsupported chainId ${chainId}.`);
      }

      const admin = getAddress(walletAddress) as Address;
      const registry = getAddress(registryAddress) as Address;
      const name = nextName.trim();
      if (!name) {
        throw new Error('Name is required.');
      }

      await ensureEip1193Chain(eip1193Provider, chainId);
      const walletClient = createWalletClient({ chain, transport: custom(eip1193Provider) });
      const publicClient = createPublicClient({ chain, transport: custom(eip1193Provider) });

      const nameBytes = toHex(name) as `0x${string}`;
      const req = await publicClient.simulateContract({
        address: registry,
        abi: agentRegistryAbi,
        functionName: 'setContractMetadata',
        args: ['name', nameBytes],
        account: admin,
      });
      const tx = await walletClient.writeContract(req.request);
      setRenameTxHash(tx);
      await publicClient.waitForTransactionReceipt({ hash: tx });

      setRenameDrafts((prev) => {
        const out = { ...prev };
        delete out[registryAddress.toLowerCase()];
        return out;
      });
      await refresh();
    },
    [privateKeyMode, walletAddress, eip1193Provider, chain, chainId, refresh],
  );

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

      <main style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
        <div
          style={{
            marginBottom: '1.25rem',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '1rem',
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div style={{ color: palette.textSecondary, fontSize: '0.9rem' }}>Administration</div>
            <h1 style={{ margin: '0.25rem 0 0', fontSize: '1.6rem' }}>ERC-8122 Collections</h1>
            <div style={{ marginTop: '0.5rem', color: palette.textSecondary, lineHeight: 1.4 }}>
              Lists registries from the Knowledge Base and filters to collections you administer on-chain.
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              window.location.href = '/agent-registration/8122';
            }}
            style={{
              padding: '0.55rem 0.85rem',
              borderRadius: '10px',
              border: `1px solid ${palette.borderStrong}`,
              background: palette.accent,
              color: palette.surface,
              fontWeight: 800,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
            title="Go to Agent ERC-8122 Registration"
          >
            Agent ERC-8122 Registration
          </button>
        </div>

        <section
          style={{
            border: `1px solid ${palette.border}`,
            borderRadius: '12px',
            padding: '1rem',
            background: palette.surface,
            marginBottom: '1rem',
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: '0.75rem' }}>
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

          <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <button
              type="button"
              onClick={() => refresh().catch((e) => setListError(formatError(e)))}
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
              Refresh
            </button>
            <div style={{ color: palette.textSecondary, fontSize: '0.9rem' }}>
              {loadingList ? 'Loading from KB…' : `${registries.length} registries from KB`}
              {walletAddress && (
                <>
                  {' '}
                  · {filteringOwned ? 'Filtering owned…' : `${ownedRegistries.length} owned`}
                </>
              )}
            </div>
          </div>

          {listError && (
            <div style={{ marginTop: '0.75rem', color: palette.dangerText }}>
              KB error: <code>{listError}</code>
            </div>
          )}
          {ownedError && (
            <div style={{ marginTop: '0.5rem', color: palette.dangerText }}>
              Ownership check error: <code>{ownedError}</code>
            </div>
          )}
        </section>

        <section
          style={{
            border: `1px solid ${palette.border}`,
            borderRadius: '12px',
            padding: '1rem',
            background: palette.surface,
            marginBottom: '1rem',
          }}
        >
          <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Create collection</h2>
          <div style={{ marginTop: '0.75rem', display: 'grid', gridTemplateColumns: '200px 1fr', gap: '0.75rem' }}>
            <label style={{ color: palette.textSecondary, paddingTop: '0.55rem' }}>Factory address</label>
            <input
              value={factoryAddressInput}
              disabled
              placeholder="0x..."
              style={{
                padding: '0.55rem 0.7rem',
                borderRadius: '10px',
                border: `1px solid ${palette.border}`,
                background: palette.surfaceMuted,
                color: palette.textPrimary,
                opacity: 0.85,
              }}
            />

            <label style={{ color: palette.textSecondary, paddingTop: '0.55rem' }}>Name (on-chain)</label>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="My Agent Collection"
              style={{
                padding: '0.55rem 0.7rem',
                borderRadius: '10px',
                border: `1px solid ${palette.border}`,
                background: palette.surfaceMuted,
                color: palette.textPrimary,
              }}
            />

            <label style={{ color: palette.textSecondary, paddingTop: '0.55rem' }}>Mint price (ETH)</label>
            <input
              value={mintPriceEth}
              onChange={(e) => setMintPriceEth(e.target.value)}
              placeholder="0"
              style={{
                padding: '0.55rem 0.7rem',
                borderRadius: '10px',
                border: `1px solid ${palette.border}`,
                background: palette.surfaceMuted,
                color: palette.textPrimary,
              }}
            />

            <label style={{ color: palette.textSecondary, paddingTop: '0.55rem' }}>Max supply</label>
            <input
              value={maxSupply}
              onChange={(e) => setMaxSupply(e.target.value)}
              placeholder="0"
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
              disabled={!canSign || creating}
              onClick={() => handleCreate().catch((e) => setCreateError(formatError(e)))}
              style={{
                padding: '0.55rem 0.85rem',
                borderRadius: '10px',
                border: `1px solid ${palette.borderStrong}`,
                background: palette.accent,
                color: palette.surface,
                fontWeight: 700,
                cursor: !canSign || creating ? 'not-allowed' : 'pointer',
                opacity: !canSign || creating ? 0.65 : 1,
              }}
            >
              {creating ? 'Creating…' : 'Create'}
            </button>
            <div style={{ color: palette.textSecondary, fontSize: '0.9rem' }}>
              Creates a registry + registrar, opens public minting, and sets the registry name on-chain.
            </div>
          </div>

          {createError && (
            <div style={{ marginTop: '0.75rem', color: palette.dangerText }}>
              Error: <code>{createError}</code>
            </div>
          )}
          {(createTxHash || createOpenMintTxHash || createNameTxHash) && (
            <div style={{ marginTop: '0.75rem', color: palette.textSecondary, fontSize: '0.9rem', lineHeight: 1.5 }}>
              {createTxHash && (
                <div>
                  Deploy tx: <code>{createTxHash}</code>
                </div>
              )}
              {createOpenMintTxHash && (
                <div>
                  openMinting tx: <code>{createOpenMintTxHash}</code>
                </div>
              )}
              {createNameTxHash && (
                <div>
                  set name tx: <code>{createNameTxHash}</code>
                </div>
              )}
            </div>
          )}
          {createResult && (
            <div style={{ marginTop: '0.75rem', color: palette.textSecondary, lineHeight: 1.45 }}>
              <div>
                Registry: <code>{createResult.registry}</code>
              </div>
              <div>
                Registrar: <code>{createResult.registrar}</code>
              </div>
            </div>
          )}
        </section>

        <section
          style={{
            border: `1px solid ${palette.border}`,
            borderRadius: '12px',
            padding: '1rem',
            background: palette.surface,
          }}
        >
          <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Your collections ({chainLabel})</h2>

          {!walletAddress && (
            <div style={{ marginTop: '0.75rem', color: palette.textSecondary }}>
              Connect a wallet to filter to collections you own/admin.
            </div>
          )}

          {walletAddress && filteringOwned && (
            <div style={{ marginTop: '0.75rem', color: palette.textSecondary }}>Checking on-chain roles…</div>
          )}

          {walletAddress && !filteringOwned && ownedRegistries.length === 0 && (
            <div style={{ marginTop: '0.75rem', color: palette.textSecondary }}>
              No owned registries found on this chain.
            </div>
          )}

          {walletAddress && ownedRegistries.length > 0 && (
            <div style={{ marginTop: '0.75rem', display: 'grid', gridTemplateColumns: '1fr', gap: '0.75rem' }}>
              {ownedRegistries.map((r) => (
                <div
                  key={`${r.chainId}:${r.registryAddress}`}
                  style={{
                    border: `1px solid ${palette.border}`,
                    borderRadius: '12px',
                    padding: '0.85rem 1rem',
                    background: palette.surfaceMuted,
                  }}
                >
                  <div style={{ fontWeight: 800, fontSize: '1rem' }}>
                    {r.registryName?.trim() ? r.registryName : '(Unnamed collection)'}
                  </div>
                  <div style={{ marginTop: '0.35rem', color: palette.textSecondary, fontSize: '0.9rem', lineHeight: 1.45 }}>
                    <div>
                      Registry: <code>{r.registryAddress}</code>
                    </div>
                    {r.registrarAddress && (
                      <div>
                        Registrar: <code>{r.registrarAddress}</code>
                      </div>
                    )}
                    {typeof r.registeredAgentCount === 'number' && (
                      <div>Agents: {r.registeredAgentCount}</div>
                    )}
                    {typeof r.lastAgentUpdatedAtTime === 'number' && (
                      <div>Last update: {r.lastAgentUpdatedAtTime}</div>
                    )}
                  </div>

                  <div style={{ marginTop: '0.8rem', display: 'grid', gridTemplateColumns: '200px 1fr', gap: '0.75rem' }}>
                    <label style={{ color: palette.textSecondary, paddingTop: '0.55rem' }}>Set name</label>
                    <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <input
                        value={renameDrafts[r.registryAddress.toLowerCase()] ?? ''}
                        onChange={(e) =>
                          setRenameDrafts((prev) => ({
                            ...prev,
                            [r.registryAddress.toLowerCase()]: e.target.value,
                          }))
                        }
                        placeholder="New name"
                        style={{
                          flex: '1 1 260px',
                          padding: '0.55rem 0.7rem',
                          borderRadius: '10px',
                          border: `1px solid ${palette.border}`,
                          background: palette.surface,
                          color: palette.textPrimary,
                        }}
                      />
                      <button
                        type="button"
                        disabled={!canSign || renamingRegistry === r.registryAddress}
                        onClick={() => {
                          const draft = renameDrafts[r.registryAddress.toLowerCase()] ?? '';
                          handleRename(r.registryAddress, draft).catch((e) =>
                            setRenameError(formatError(e)),
                          );
                        }}
                        style={{
                          padding: '0.55rem 0.85rem',
                          borderRadius: '10px',
                          border: `1px solid ${palette.borderStrong}`,
                          background: palette.surfaceMuted,
                          color: palette.textPrimary,
                          fontWeight: 700,
                          cursor: !canSign || renamingRegistry === r.registryAddress ? 'not-allowed' : 'pointer',
                          opacity: !canSign || renamingRegistry === r.registryAddress ? 0.65 : 1,
                        }}
                      >
                        {renamingRegistry === r.registryAddress ? 'Setting…' : 'Set'}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {(renameError || renameTxHash) && (
            <div style={{ marginTop: '0.9rem', color: palette.textSecondary, fontSize: '0.9rem', lineHeight: 1.45 }}>
              {renameTxHash && (
                <div>
                  Rename tx: <code>{renameTxHash}</code>
                </div>
              )}
              {renameError && (
                <div style={{ color: palette.dangerText }}>
                  Rename error: <code>{renameError}</code>
                </div>
              )}
            </div>
          )}
        </section>
      </main>
    </>
  );
}

