'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Address } from 'viem';
import { encodeFunctionData, getAddress, toHex } from 'viem';

import { Header } from '@/components/Header';
import { useAuth } from '@/components/AuthProvider';
import { useWallet } from '@/components/WalletProvider';
import { grayscalePalette as palette } from '@/styles/palette';
import { SUPPORTED_TRUST_MECHANISMS } from '@/models/agentRegistration';
import { getClientBundlerUrl } from '@/lib/clientChainEnv';
import { buildDidEnsFromAgentAndOrg } from '@/app/api/names/_lib/didEns';

import {
  getCounterfactualSmartAccountAddressByAgentName,
  getDeployedAccountClientByAgentName,
  sendSponsoredUserOperation,
  waitForUserOperationReceipt,
  signAndSendTransaction,
} from '@agentic-trust/core/client';
import { DEFAULT_CHAIN_ID, getChainById, getEnsOrgName } from '@agentic-trust/core/server';

const UPGRADE_STEPS = ['Smart Account', 'ENS', 'Metadata', 'Review & Upgrade'] as const;

const identityRegistrySetMetadataAbi = [
  {
    type: 'function',
    name: 'setMetadata',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'metadataKey', type: 'string' },
      { name: 'metadataValue', type: 'bytes' },
    ],
    outputs: [],
  },
] as const;

function parseDid8004FromUaid(uaid: string): { chainId: number; agentId: string } {
  const raw = String(uaid || '').trim();
  const m = /^uaid:did:8004:(\d+):(\d+)\b/.exec(raw);
  if (!m) {
    throw new Error('This upgrade flow currently supports only UAIDs targeting did:8004 (uaid:did:8004:{chainId}:{agentId}).');
  }
  const chainId = Number(m[1]);
  const agentId = String(m[2]);
  if (!Number.isFinite(chainId) || chainId <= 0) throw new Error('Invalid chainId in UAID.');
  if (!/^\d+$/.test(agentId)) throw new Error('Invalid agentId in UAID.');
  return { chainId, agentId };
}

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

function isL1ChainId(chainId: number): boolean {
  return chainId === 1 || chainId === 11155111;
}

function normalizeEnsOrgName(orgName: string): string {
  return String(orgName || '')
    .trim()
    .replace(/\.eth$/i, '')
    .replace(/^\.+/, '') // strip leading dots
    .replace(/\.+$/, '') // strip trailing dots
    .toLowerCase();
}

function normalizeEnsLabel(label: string, orgName?: string | null): string {
  const raw = String(label || '').trim();
  if (!raw) return '';
  const cleanOrg = orgName ? normalizeEnsOrgName(orgName) : '';
  let v = raw.toLowerCase();
  // If user pasted a full ENS name, reduce to the label part.
  v = v.replace(/\.eth$/i, '');
  if (cleanOrg) {
    // Remove ".<org>" suffix if present.
    v = v.replace(new RegExp(`\\.${cleanOrg}$`, 'i'), '');
  }
  // Strip any trailing dots left over from user input.
  v = v.replace(/\.+$/, '');
  return v;
}

function buildEnsFullName(params: { label: string; orgName: string }): string {
  const cleanOrg = normalizeEnsOrgName(params.orgName);
  const cleanLabel = normalizeEnsLabel(params.label, cleanOrg);
  if (!cleanLabel || !cleanOrg) return '';
  return `${cleanLabel}.${cleanOrg}.eth`;
}

export default function AgentUpgradePage({ params }: { params: { uaid: string } }) {
  const router = useRouter();
  const uaid = decodeURIComponent(params.uaid || '');

  const { isConnected, privateKeyMode, loading, walletAddress, openLoginModal, handleDisconnect } = useAuth();
  const { eip1193Provider } = useWallet();

  const parsed = useMemo(() => parseDid8004FromUaid(uaid), [uaid]);
  const chainId = parsed.chainId ?? DEFAULT_CHAIN_ID;
  const agentId = parsed.agentId;

  const chain = useMemo(() => getChainById(chainId), [chainId]);
  const canSign = Boolean(isConnected && walletAddress && eip1193Provider && !privateKeyMode);
  const eoaAddress: Address | null = useMemo(() => {
    try {
      return walletAddress ? (getAddress(walletAddress) as Address) : null;
    } catch {
      return null;
    }
  }, [walletAddress]);

  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [nextWalletPrompt, setNextWalletPrompt] = useState<string | null>(null);
  const [upgrading, setUpgrading] = useState(false);

  const [agentLoading, setAgentLoading] = useState(true);
  const [agentInfo, setAgentInfo] = useState<any | null>(null);
  const [isOwner, setIsOwner] = useState<boolean | null>(null);

  const [chainEnv, setChainEnv] = useState<{
    identityRegistry: Address;
    bundlerUrl: string;
  } | null>(null);

  const [ensOrgName, setEnsOrgName] = useState<string | null>(null);
  useEffect(() => {
    try {
      const v = getEnsOrgName(chainId);
      setEnsOrgName(v || null);
    } catch {
      setEnsOrgName(null);
    }
  }, [chainId]);

  const getDefaultImageUrl = () =>
    typeof window !== 'undefined' ? `${window.location.origin}/8004Agent.png` : '/8004Agent.png';

  const [form, setForm] = useState(() => ({
    agentName: '',
    description: '',
    image: getDefaultImageUrl(),
    agentUrl: '',
  }));

  const [agentUrlAutofillDisabled, setAgentUrlAutofillDisabled] = useState(false);
  const handleAgentUrlInputChange = useCallback((value: string) => {
    setAgentUrlAutofillDisabled(true);
    setForm((prev) => ({ ...prev, agentUrl: value }));
  }, []);
  const handleResetAgentUrlToDefault = useCallback(() => {
    setAgentUrlAutofillDisabled(false);
    const defaultUrl = buildDefaultAgentUrl(form.agentName);
    setForm((prev) => ({ ...prev, agentUrl: defaultUrl }));
  }, [form.agentName]);

  // Keep agentUrl synced like 8004 (unless user edited it)
  useEffect(() => {
    if (agentUrlAutofillDisabled) return;
    const defaultUrl = buildDefaultAgentUrl(form.agentName);
    setForm((prev) => {
      const current = (prev.agentUrl || '').trim();
      if ((current || '') === (defaultUrl || '')) return prev;
      if (!current && !defaultUrl) return prev;
      return { ...prev, agentUrl: defaultUrl };
    });
  }, [agentUrlAutofillDisabled, form.agentName]);

  const resolvedAgentBaseUrl = useMemo(() => {
    const explicit = (form.agentUrl || '').trim();
    if (explicit) return explicit;
    return buildDefaultAgentUrl(form.agentName);
  }, [form.agentName, form.agentUrl]);
  const normalizedBaseUrl = useMemo(
    () => (resolvedAgentBaseUrl || '').trim().replace(/\/$/, ''),
    [resolvedAgentBaseUrl],
  );

  const [supportedTrust, setSupportedTrust] = useState<string[]>([]);
  const [a2aEndpoint, setA2aEndpoint] = useState('');

  const defaultA2AEndpoint = normalizedBaseUrl ? `${normalizedBaseUrl}/.well-known/agent-card.json` : '';
  const previousDefaultsRef = useRef({ a2a: '' });
  useEffect(() => {
    const prevDefaults = previousDefaultsRef.current;
    if (defaultA2AEndpoint) {
      setA2aEndpoint((prev) => {
        const shouldUpdate = !prev.trim() || prev.trim() === prevDefaults.a2a;
        return shouldUpdate ? defaultA2AEndpoint : prev;
      });
    }
    previousDefaultsRef.current = { a2a: defaultA2AEndpoint };
  }, [defaultA2AEndpoint]);

  // ENS availability
  const [ensChecking, setEnsChecking] = useState(false);
  const [ensAvailable, setEnsAvailable] = useState<boolean | null>(null);
  const [ensExisting, setEnsExisting] = useState<{ image: string | null; url: string | null; description: string | null } | null>(null);
  const ensFullNamePreview = useMemo(() => {
    if (!form.agentName || !ensOrgName) return '';
    return buildEnsFullName({ label: form.agentName, orgName: ensOrgName });
  }, [ensOrgName, form.agentName]);

  useEffect(() => {
    if (!form.agentName || !ensOrgName) {
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
        const encodedEnsDid = buildDidEnsFromAgentAndOrg(chainId, form.agentName, ensOrgName);
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
  }, [form.agentName, ensOrgName, chainId]);

  const [aaComputing, setAaComputing] = useState(false);
  const [aaAddress, setAaAddress] = useState<Address | null>(null);

  useEffect(() => {
    const name = form.agentName.trim();
    if (!name || !eip1193Provider || !eoaAddress) {
      setAaAddress(null);
      return;
    }
    let cancelled = false;
    setAaComputing(true);
    (async () => {
      try {
        const computed = await getCounterfactualSmartAccountAddressByAgentName(name, eoaAddress, {
          ethereumProvider: eip1193Provider as any,
          chain,
        });
        if (cancelled) return;
        setAaAddress(getAddress(computed) as Address);
      } catch {
        if (!cancelled) setAaAddress(null);
      } finally {
        if (!cancelled) setAaComputing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [form.agentName, eoaAddress, eip1193Provider, chain]);

  // Load agent info + ownership + chain env
  useEffect(() => {
    let cancelled = false;
    setAgentLoading(true);
    setAgentInfo(null);
    setIsOwner(null);
    setChainEnv(null);
    (async () => {
      try {
        const [agentRes, envRes] = await Promise.all([
          fetch(`/api/agents/${encodeURIComponent(uaid)}`, { method: 'GET' }),
          fetch(`/api/chain-env?chainId=${encodeURIComponent(String(chainId))}`, { method: 'GET' }),
        ]);
        const agentJson = await agentRes.json().catch(() => null);
        const envJson = await envRes.json().catch(() => null);
        if (cancelled) return;
        if (!agentRes.ok) throw new Error(agentJson?.message || agentJson?.error || 'Failed to load agent');
        if (!envRes.ok) throw new Error(envJson?.message || envJson?.error || 'Failed to load chain env');

        setAgentInfo(agentJson);
        const existingName =
          typeof agentJson?.agentName === 'string'
            ? agentJson.agentName
            : typeof agentJson?.name === 'string'
              ? agentJson.name
              : '';
        setForm((prev) => ({
          ...prev,
          agentName: prev.agentName || existingName || prev.agentName,
          description: prev.description || (typeof agentJson?.description === 'string' ? agentJson.description : ''),
          image: prev.image || (typeof agentJson?.image === 'string' ? agentJson.image : prev.image),
        }));
        if (typeof agentJson?.supportedTrust !== 'undefined' && Array.isArray(agentJson.supportedTrust)) {
          setSupportedTrust(agentJson.supportedTrust.filter((x: any) => typeof x === 'string'));
        }
        if (typeof agentJson?.a2aEndpoint === 'string' && agentJson.a2aEndpoint.trim()) {
          setA2aEndpoint(agentJson.a2aEndpoint.trim());
        }

        const identityRegistry = getAddress(String(envJson?.identityRegistry || '')) as Address;
        const bundlerUrl = String(envJson?.bundlerUrl || '');
        if (!bundlerUrl) throw new Error('Missing bundlerUrl for chain.');
        setChainEnv({ identityRegistry, bundlerUrl });

        if (eoaAddress) {
          const ownerRes = await fetch(`/api/agents/${encodeURIComponent(uaid)}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'isOwner', walletAddress: eoaAddress }),
          });
          const ownerJson = await ownerRes.json().catch(() => null);
          if (!cancelled && ownerRes.ok) {
            setIsOwner(ownerJson?.isOwner === true);
          }
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load agent');
      } finally {
        if (!cancelled) setAgentLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uaid, chainId, eoaAddress]);

  const deploySmartAccount = useCallback(async () => {
    if (!canSign || !eoaAddress || !eip1193Provider) throw new Error('Connect a wallet to continue.');
    const bundlerUrl = chainEnv?.bundlerUrl || getClientBundlerUrl(chainId);
    if (!bundlerUrl) throw new Error('Missing bundler URL.');
    await ensureEip1193Chain(eip1193Provider, chainId);
    setNextWalletPrompt('MetaMask: deploy/activate Smart Account (if prompted)');
    const client = await getDeployedAccountClientByAgentName(bundlerUrl, form.agentName.trim(), eoaAddress, {
      ethereumProvider: eip1193Provider,
      chain,
    });
    const aaAddr = getAddress(String(client?.address || '')) as Address;
    setAaAddress(aaAddr);
    return { bundlerUrl, accountClient: client, aaAddr };
  }, [canSign, eoaAddress, eip1193Provider, chainEnv?.bundlerUrl, chainId, chain, form.agentName]);

  const executeUpgrade = useCallback(async () => {
    if (upgrading) return;
    if (privateKeyMode) throw new Error('Upgrade requires a connected wallet (private key mode is not supported).');
    if (!canSign || !eoaAddress || !eip1193Provider) throw new Error('Connect a wallet to continue.');
    if (!chainEnv?.identityRegistry) throw new Error('Missing identity registry address.');
    if (!form.agentName.trim()) throw new Error('Agent name is required.');
    if (!ensOrgName) throw new Error('ENS org name is not configured for this chain.');
    if (ensAvailable !== true) throw new Error('ENS name must be available.');
    if (!ensFullNamePreview) throw new Error('ENS name is not ready.');
    if (isOwner === false) throw new Error('Connected wallet is not the owner of this agent NFT.');

    setUpgrading(true);
    setError(null);
    setStatus(null);
    setNextWalletPrompt(null);
    try {
      // 1) Deploy smart account (if needed)
      setStatus('Deploying Smart Account…');
      const { bundlerUrl, accountClient, aaAddr } = await deploySmartAccount();
      setNextWalletPrompt(null);

      // 2) ENS registration (same endpoints/shape as 8004 flow)
      const baseUrl = String(normalizedBaseUrl || '').trim();
      const agentDescription = String(form.description || '').trim();
      const agentLabel = form.agentName.trim();
      const ensLabel = normalizeEnsLabel(agentLabel, ensOrgName);
      const ensNameFull = ensFullNamePreview;

      if (isL1ChainId(chainId)) {
        setStatus('Creating ENS subdomain…');
        await fetch('/api/names/add-to-l1-org', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            agentAccount: aaAddr,
            orgName: ensOrgName,
            agentName: ensLabel,
            agentUrl: baseUrl,
            chainId,
          }),
        });

        setStatus('Preparing ENS metadata update…');
        const infoRes = await fetch('/api/names/set-l1-name-info', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            agentAddress: aaAddr,
            orgName: ensOrgName,
            agentName: ensLabel,
            agentUrl: baseUrl,
            agentDescription,
            chainId,
          }),
        });
        const infoJson = (await infoRes.json().catch(() => null)) as any;
        const infoCallsRaw = Array.isArray(infoJson?.calls) ? (infoJson.calls as any[]) : [];
        const infoCalls = infoCallsRaw
          .map((c) => {
            const to = typeof c?.to === 'string' ? (c.to as `0x${string}`) : null;
            const data = typeof c?.data === 'string' ? (c.data as `0x${string}`) : null;
            if (!to || !data) return null;
            let value: bigint | undefined = undefined;
            if (c?.value !== null && c?.value !== undefined) {
              try {
                value = BigInt(c.value);
              } catch {
                value = undefined;
              }
            }
            return { to, data, value };
          })
          .filter(Boolean) as Array<{ to: `0x${string}`; data: `0x${string}`; value?: bigint }>;
        if (infoCalls.length > 0) {
          setStatus('Updating ENS metadata…');
          setNextWalletPrompt('MetaMask: approve ENS metadata update (UserOperation)');
          const uoHash = await sendSponsoredUserOperation({
            bundlerUrl,
            chain,
            accountClient,
            calls: infoCalls,
          });
          await waitForUserOperationReceipt({ bundlerUrl, chain, hash: uoHash });
          setNextWalletPrompt(null);
        }
      } else {
        // L2 ENS: execute calls via smart account userOp
        setStatus('Preparing L2 ENS calls…');
        const addRes = await fetch('/api/names/add-to-l2-org', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            agentAddress: aaAddr,
            orgName: ensOrgName,
            agentName: ensLabel,
            agentUrl: baseUrl,
            agentDescription,
            agentImage: form.image || undefined,
            chainId,
          }),
        });
        const addJson = (await addRes.json().catch(() => null)) as any;
        const addCallsRaw = Array.isArray(addJson?.calls) ? (addJson.calls as any[]) : [];
        const addCalls = addCallsRaw
          .map((c) => {
            const to = typeof c?.to === 'string' ? (c.to as `0x${string}`) : null;
            const data = typeof c?.data === 'string' ? (c.data as `0x${string}`) : null;
            if (!to || !data) return null;
            let value: bigint | undefined = undefined;
            if (c?.value !== null && c?.value !== undefined) {
              try {
                value = BigInt(c.value);
              } catch {
                value = undefined;
              }
            }
            return { to, data, value };
          })
          .filter(Boolean) as Array<{ to: `0x${string}`; data: `0x${string}`; value?: bigint }>;
        if (addCalls.length > 0) {
          setStatus('Registering ENS on L2…');
          setNextWalletPrompt('MetaMask: approve ENS registration (UserOperation)');
          const uoHash = await sendSponsoredUserOperation({
            bundlerUrl,
            chain,
            accountClient,
            calls: addCalls,
          });
          await waitForUserOperationReceipt({ bundlerUrl, chain, hash: uoHash });
          setNextWalletPrompt(null);
        }

        const infoRes = await fetch('/api/names/set-l2-name-info', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            agentAddress: aaAddr,
            orgName: ensOrgName,
            agentName: ensLabel,
            agentUrl: baseUrl,
            agentDescription,
            chainId,
          }),
        });
        const infoJson = (await infoRes.json().catch(() => null)) as any;
        const infoCallsRaw = Array.isArray(infoJson?.calls) ? (infoJson.calls as any[]) : [];
        const infoCalls = infoCallsRaw
          .map((c) => {
            const to = typeof c?.to === 'string' ? (c.to as `0x${string}`) : null;
            const data = typeof c?.data === 'string' ? (c.data as `0x${string}`) : null;
            if (!to || !data) return null;
            let value: bigint | undefined = undefined;
            if (c?.value !== null && c?.value !== undefined) {
              try {
                value = BigInt(c.value);
              } catch {
                value = undefined;
              }
            }
            return { to, data, value };
          })
          .filter(Boolean) as Array<{ to: `0x${string}`; data: `0x${string}`; value?: bigint }>;
        if (infoCalls.length > 0) {
          setStatus('Updating ENS metadata on L2…');
          setNextWalletPrompt('MetaMask: approve ENS metadata update (UserOperation)');
          const uoHash = await sendSponsoredUserOperation({
            bundlerUrl,
            chain,
            accountClient,
            calls: infoCalls,
          });
          await waitForUserOperationReceipt({ bundlerUrl, chain, hash: uoHash });
          setNextWalletPrompt(null);
        }
      }

      // 3) UAID should anchor to the Smart Account did:ethr (like the full 8004 smart account flow)
      const uaidEthr = await (async () => {
        try {
          const domain =
            baseUrl && baseUrl.trim()
              ? (() => {
                  try {
                    return new URL(baseUrl).hostname;
                  } catch {
                    return undefined;
                  }
                })()
              : undefined;
          const uid = `did:ethr:${chainId}:${aaAddr.toLowerCase()}`;
          const res = await fetch('/api/agents/generate-uaid', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              agentAccount: aaAddr,
              chainId,
              uid,
              registry: 'erc-8004',
              proto: 'a2a',
              nativeId: `eip155:${chainId}:${aaAddr}`,
              domain,
            }),
          });
          const json = (await res.json().catch(() => null)) as any;
          if (!res.ok) {
            throw new Error(json?.message || json?.error || `UAID generation failed (${res.status})`);
          }
          const v = typeof json?.uaid === 'string' ? json.uaid.trim() : '';
          if (!v) {
            throw new Error('UAID generation returned empty UAID');
          }
          return v;
        } catch {
          throw new Error('Failed to generate UAID for upgraded agent');
        }
      })();

      // 4) Update 8004 on-chain metadata (EOA must do this because EOA owns the NFT)
      // Mirror the keys we set during the full 8004 registration flow and ensure UAID is included.
      setStatus('Updating 8004 metadata…');
      await ensureEip1193Chain(eip1193Provider, chainId);
      const encoder = new TextEncoder();
      const metadataEntries: Array<{ key: string; value: string }> = [
        // When upgrading to a Smart Agent, set the displayed agent name to the ENS name we created.
        { key: 'agentName', value: ensNameFull },
        { key: 'agentAccount', value: aaAddr },
        { key: 'registeredBy', value: 'agentic-trust' },
        { key: 'registryNamespace', value: 'erc-8004' },
        { key: 'uaid', value: uaidEthr },
      ].filter((m) => m.key && m.value !== undefined);

      for (let i = 0; i < metadataEntries.length; i++) {
        const entry = metadataEntries[i]!;
        setNextWalletPrompt(`MetaMask: approve metadata update (${i + 1}/${metadataEntries.length}) (${entry.key})`);
        const bytes = encoder.encode(String(entry.value ?? ''));
        const data = encodeFunctionData({
          abi: identityRegistrySetMetadataAbi,
          functionName: 'setMetadata',
          args: [BigInt(agentId), entry.key, toHex(bytes)],
        });
        await signAndSendTransaction({
          transaction: {
            to: chainEnv.identityRegistry,
            data,
            value: '0x0',
            chainId,
          },
          account: eoaAddress,
          chain,
          ethereumProvider: eip1193Provider as any,
          onStatusUpdate: setStatus,
          extractAgentId: false,
        });
      }
      setNextWalletPrompt(null);

      // 5) Update 8004 agentUri registration JSON (EOA must do setAgentURI because EOA owns the NFT)
      const registrationPayload = {
        type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
        // Keep registration JSON name aligned to the ENS name.
        name: ensNameFull,
        description: form.description.trim() ? form.description.trim() : undefined,
        image: form.image.trim() ? form.image.trim() : undefined,
        active: true,
        uaid: uaidEthr,
        agentAccount: aaAddr,
        registeredBy: 'agentic-trust',
        registryNamespace: 'erc-8004',
        supportedTrust: supportedTrust.length > 0 ? supportedTrust : undefined,
        services: a2aEndpoint.trim()
          ? [
              {
                type: 'a2a',
                endpoint: a2aEndpoint.trim(),
                version: '0.3.0',
              },
            ]
          : undefined,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      setStatus('Preparing agentUri update (tokenURI)…');
      const did8004 = `did:8004:${chainId}:${agentId}`;
      const updRes = await fetch(`/api/agents/${encodeURIComponent(did8004)}/registration`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode: 'eoa',
          registration: registrationPayload,
        }),
      });
      const updJson = (await updRes.json().catch(() => null)) as any;
      if (!updRes.ok) {
        throw new Error(updJson?.message || updJson?.error || `Upgrade update failed (${updRes.status})`);
      }
      if (updJson?.mode !== 'eoa' || !updJson?.transaction?.to || !updJson?.transaction?.data) {
        throw new Error('Update response missing EOA transaction details');
      }
      const txChainId = Number(updJson.transaction.chainId ?? updJson.chainId ?? chainId);
      await ensureEip1193Chain(eip1193Provider, txChainId);
      setStatus('Updating tokenURI (agentUri)…');
      setNextWalletPrompt('MetaMask: approve tokenURI update (setAgentURI)');
      await signAndSendTransaction({
        transaction: {
          to: updJson.transaction.to,
          data: updJson.transaction.data,
          value: (updJson.transaction.value ?? '0x0') as `0x${string}`,
          chainId: txChainId,
        },
        account: eoaAddress,
        chain: getChainById(txChainId),
        ethereumProvider: eip1193Provider as any,
        onStatusUpdate: setStatus,
        extractAgentId: false,
      });
      setNextWalletPrompt(null);

      setStatus('Upgrade complete.');
    } catch (e: any) {
      setError(e?.message || 'Upgrade failed');
    } finally {
      setUpgrading(false);
      setNextWalletPrompt(null);
    }
  }, [
    upgrading,
    privateKeyMode,
    canSign,
    eoaAddress,
    eip1193Provider,
    chainEnv?.identityRegistry,
    chainEnv?.bundlerUrl,
    deploySmartAccount,
    chainId,
    chain,
    agentId,
    form.agentName,
    form.description,
    form.image,
    normalizedBaseUrl,
    ensOrgName,
    ensAvailable,
    isOwner,
    supportedTrust,
    a2aEndpoint,
  ]);

  const renderStep = () => {
    if (agentLoading) {
      return <div style={{ color: palette.textSecondary }}>Loading…</div>;
    }

    if (step === 0) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: '0.75rem' }}>
            <div style={{ color: palette.textSecondary, fontWeight: 700 }}>UAID</div>
            <div style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{uaid}</div>

            <div style={{ color: palette.textSecondary, fontWeight: 700 }}>Chain</div>
            <div style={{ color: palette.textPrimary }}>{chainId}</div>

            <div style={{ color: palette.textSecondary, fontWeight: 700 }}>Agent ID</div>
            <div style={{ color: palette.textPrimary }}>{agentId}</div>

            <div style={{ color: palette.textSecondary, fontWeight: 700 }}>Owner</div>
            <div style={{ color: palette.textPrimary }}>
              {isOwner === null ? '—' : isOwner ? 'Connected wallet' : 'Not connected wallet'}
            </div>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 700 }}>Agent name</label>
            <input
              value={form.agentName}
              onChange={(e) => setForm((p) => ({ ...p, agentName: e.target.value }))}
              style={{
                width: '100%',
                padding: '0.55rem 0.75rem',
                border: `1px solid ${palette.border}`,
                borderRadius: '10px',
                backgroundColor: palette.surface,
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 700 }}>Smart Account</label>
            <div style={{ fontFamily: 'monospace', wordBreak: 'break-all', color: palette.textPrimary }}>
              {aaComputing ? 'Computing…' : aaAddress ?? '—'}
            </div>
            <div style={{ marginTop: '0.5rem' }}>
              <button
                type="button"
                onClick={async () => {
                  setError(null);
                  setStatus(null);
                  try {
                    setStatus('Deploying Smart Account…');
                    await deploySmartAccount();
                    setStatus('Smart Account ready.');
                  } catch (e: any) {
                    setError(e?.message || 'Failed to deploy Smart Account');
                  }
                }}
                disabled={!canSign || upgrading}
                style={{
                  padding: '0.6rem 0.95rem',
                  borderRadius: '12px',
                  border: `1px solid ${palette.border}`,
                  backgroundColor: palette.surface,
                  cursor: !canSign || upgrading ? 'not-allowed' : 'pointer',
                  fontWeight: 800,
                }}
              >
                Deploy Smart Account
              </button>
            </div>
          </div>
        </div>
      );
    }

    if (step === 1) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
          <div style={{ color: palette.textSecondary }}>
            ENS name: <strong style={{ color: palette.textPrimary }}>{ensFullNamePreview || '—'}</strong>
          </div>
          <div style={{ color: palette.textSecondary }}>
            Availability: <strong style={{ color: palette.textPrimary }}>{ensChecking ? 'Checking…' : ensAvailable === null ? '—' : ensAvailable ? 'Available' : 'Not available'}</strong>
          </div>
          {!ensChecking && ensAvailable === false && ensExisting && (
            <div style={{ color: palette.textSecondary, fontSize: '0.9rem' }}>
              Existing: {ensExisting.url ? <a href={ensExisting.url} target="_blank" rel="noreferrer">{ensExisting.url}</a> : '—'}
            </div>
          )}
        </div>
      );
    }

    if (step === 2) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 700 }}>Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              rows={4}
              style={{
                width: '100%',
                padding: '0.55rem 0.75rem',
                border: `1px solid ${palette.border}`,
                borderRadius: '10px',
                backgroundColor: palette.surface,
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 700 }}>Image</label>
            <input
              value={form.image}
              onChange={(e) => setForm((p) => ({ ...p, image: e.target.value }))}
              style={{
                width: '100%',
                padding: '0.55rem 0.75rem',
                border: `1px solid ${palette.border}`,
                borderRadius: '10px',
                backgroundColor: palette.surface,
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 700 }}>Agent URL</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                value={form.agentUrl}
                onChange={(e) => handleAgentUrlInputChange(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.55rem 0.75rem',
                  border: `1px solid ${palette.border}`,
                  borderRadius: '10px',
                  backgroundColor: palette.surface,
                }}
              />
              {agentUrlAutofillDisabled && (
                <button
                  type="button"
                  onClick={handleResetAgentUrlToDefault}
                  style={{
                    padding: '0.55rem 0.9rem',
                    borderRadius: '10px',
                    border: `1px solid ${palette.border}`,
                    backgroundColor: palette.surfaceMuted,
                    color: palette.textPrimary,
                    fontWeight: 700,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Reset
                </button>
              )}
            </div>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 700 }}>A2A endpoint</label>
            <input
              value={a2aEndpoint}
              onChange={(e) => setA2aEndpoint(e.target.value)}
              placeholder={defaultA2AEndpoint}
              style={{
                width: '100%',
                padding: '0.55rem 0.75rem',
                border: `1px solid ${palette.border}`,
                borderRadius: '10px',
                backgroundColor: palette.surface,
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 700 }}>Supported trust</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {SUPPORTED_TRUST_MECHANISMS.map((m) => {
                const checked = supportedTrust.includes(m.value);
                return (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => {
                      setSupportedTrust((prev) =>
                        checked ? prev.filter((x) => x !== m.value) : [...prev, m.value],
                      );
                    }}
                    style={{
                      padding: '0.4rem 0.7rem',
                      borderRadius: '999px',
                      border: `1px solid ${palette.border}`,
                      backgroundColor: checked ? palette.accent : palette.surfaceMuted,
                      color: checked ? palette.surface : palette.textPrimary,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                    title={m.description}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      );
    }

    // Review
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: '0.75rem' }}>
        <div style={{ color: palette.textSecondary, fontWeight: 700 }}>UAID</div>
        <div style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{uaid}</div>

        <div style={{ color: palette.textSecondary, fontWeight: 700 }}>Smart Account</div>
        <div style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{aaAddress ?? '—'}</div>

        <div style={{ color: palette.textSecondary, fontWeight: 700 }}>ENS</div>
        <div style={{ color: palette.textPrimary }}>{ensFullNamePreview || '—'}</div>

        <div style={{ color: palette.textSecondary, fontWeight: 700 }}>Agent URL</div>
        <div style={{ color: palette.textPrimary }}>{normalizedBaseUrl || '—'}</div>

        <div style={{ color: palette.textSecondary, fontWeight: 700 }}>A2A</div>
        <div style={{ color: palette.textPrimary }}>{a2aEndpoint.trim() || '—'}</div>
      </div>
    );
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: palette.background }}>
      <Header
        displayAddress={walletAddress || undefined}
        privateKeyMode={privateKeyMode}
        isConnected={isConnected}
        onConnect={openLoginModal}
        onDisconnect={handleDisconnect}
        disableConnect={upgrading}
      />

      <main style={{ maxWidth: '1100px', margin: '0 auto', padding: '2rem 1.25rem' }}>
        {(upgrading || nextWalletPrompt) && (
          <div
            style={{
              position: 'sticky',
              top: 0,
              zIndex: 20,
              marginBottom: '1rem',
              borderRadius: '16px',
              border: `1px solid ${palette.border}`,
              background: 'linear-gradient(135deg, #0b1220, #111827)',
              color: '#fff',
              padding: '1rem 1.1rem',
              boxShadow: '0 12px 28px rgba(15,23,42,0.25)',
            }}
          >
            <div style={{ fontWeight: 900, fontSize: '1rem' }}>Smart Agent upgrade in progress</div>
            <div style={{ marginTop: '0.35rem', opacity: 0.92, fontSize: '0.95rem' }}>
              {nextWalletPrompt ? (
                <>
                  <span style={{ fontWeight: 800 }}>Next:</span> {nextWalletPrompt}
                </>
              ) : (
                <>
                  <span style={{ fontWeight: 800 }}>Status:</span> {status || 'Working…'}
                </>
              )}
            </div>
            <div style={{ marginTop: '0.35rem', opacity: 0.85, fontSize: '0.85rem' }}>
              Keep MetaMask open. If you don’t see a prompt, check the MetaMask extension window.
            </div>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '1rem' }}>
          <div>
            <div style={{ fontSize: '1.35rem', fontWeight: 900, color: palette.textPrimary }}>Agent Upgrade</div>
            <div style={{ marginTop: '0.35rem', color: palette.textSecondary }}>
              Make this agent a Smart Account-owned 8004 agent with ENS + updated registration.
            </div>
          </div>
          <button
            type="button"
            onClick={() => router.back()}
            style={{
              padding: '0.55rem 0.9rem',
              borderRadius: '12px',
              border: `1px solid ${palette.border}`,
              backgroundColor: palette.surface,
              cursor: 'pointer',
              fontWeight: 800,
            }}
          >
            Back
          </button>
        </div>

        <div style={{ marginTop: '1.25rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {UPGRADE_STEPS.map((label, idx) => {
            const active = idx === step;
            return (
              <button
                key={label}
                type="button"
                onClick={() => {
                  if (idx > step) return;
                  setError(null);
                  setStep(idx);
                }}
                style={{
                  padding: '0.45rem 0.75rem',
                  borderRadius: '999px',
                  border: `1px solid ${palette.border}`,
                  backgroundColor: active ? palette.accent : palette.surfaceMuted,
                  color: active ? palette.surface : palette.textPrimary,
                  fontWeight: 800,
                  cursor: idx > step ? 'not-allowed' : 'pointer',
                  opacity: idx > step ? 0.6 : 1,
                }}
              >
                {idx + 1}. {label}
              </button>
            );
          })}
        </div>

        {(error || status) && (
          <div style={{ marginTop: '1rem' }}>
            {error && (
              <div style={{ padding: '0.75rem 1rem', borderRadius: '12px', background: '#fee2e2', color: '#7f1d1d' }}>
                {error}
              </div>
            )}
            {status && (
              <div style={{ marginTop: error ? '0.75rem' : 0, padding: '0.75rem 1rem', borderRadius: '12px', background: '#e0f2fe', color: '#075985' }}>
                {status}
              </div>
            )}
          </div>
        )}

        <section
          style={{
            marginTop: '1rem',
            border: `1px solid ${palette.border}`,
            borderRadius: '16px',
            backgroundColor: palette.surface,
            padding: '1.25rem',
          }}
        >
          {renderStep()}
        </section>

        <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
          <button
            type="button"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0 || upgrading}
            style={{
              padding: '0.65rem 1rem',
              borderRadius: '12px',
              border: `1px solid ${palette.border}`,
              backgroundColor: palette.surfaceMuted,
              cursor: step === 0 || upgrading ? 'not-allowed' : 'pointer',
              fontWeight: 800,
              opacity: step === 0 || upgrading ? 0.7 : 1,
            }}
          >
            Back
          </button>

          {step < UPGRADE_STEPS.length - 1 ? (
            <button
              type="button"
              onClick={() => setStep((s) => Math.min(UPGRADE_STEPS.length - 1, s + 1))}
              disabled={upgrading}
              style={{
                padding: '0.65rem 1rem',
                borderRadius: '12px',
                border: `1px solid ${palette.border}`,
                backgroundColor: palette.surface,
                cursor: upgrading ? 'not-allowed' : 'pointer',
                fontWeight: 900,
              }}
            >
              Next
            </button>
          ) : (
            <button
              type="button"
              onClick={executeUpgrade}
              disabled={!canSign || upgrading}
              style={{
                padding: '0.65rem 1rem',
                borderRadius: '12px',
                border: `1px solid ${palette.border}`,
                backgroundColor: palette.accent,
                color: palette.surface,
                cursor: !canSign || upgrading ? 'not-allowed' : 'pointer',
                fontWeight: 900,
                opacity: !canSign || upgrading ? 0.7 : 1,
              }}
            >
              Upgrade agent
            </button>
          )}
        </div>
      </main>
    </div>
  );
}

