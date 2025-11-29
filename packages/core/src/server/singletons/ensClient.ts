/**
 * ENS Client Singleton
 * 
 * Manages a singleton instance of AIAgentENSClient
 * Initialized from environment variables using AccountProvider
 */

import { AIAgentENSClient, AIAgentL2ENSDurenClient } from '@agentic-trust/8004-ext-sdk';
import { ViemAccountProvider, type AccountProvider } from '@agentic-trust/8004-sdk';
import { sepolia, baseSepolia, optimismSepolia, getEnsOrgName } from '../lib/chainConfig';
import { createPublicClient, createWalletClient, http } from 'viem';
import { getAdminApp } from '../userApps/adminApp';
import { getClientApp } from '../userApps/clientApp';
import { getProviderApp } from '../userApps/providerApp';
import { isUserAppEnabled } from '../userApps/userApp';
import { createBundlerClient } from 'viem/account-abstraction';
import { createPimlicoClient } from 'permissionless/clients/pimlico';
import { privateKeyToAccount } from 'viem/accounts';
import { getChainEnvVar, requireChainEnvVar, getEnsOrgAddress, getEnsPrivateKey } from '../lib/chainConfig';
import { toMetaMaskSmartAccount, Implementation } from '@metamask/delegation-toolkit';
import { DomainClient } from './domainClient';
import { resolveDomainUserApps, resolveENSAccountProvider, type DomainUserApps } from './domainAccountProviders';

interface ENSInitArg {
  userApps?: DomainUserApps;
}

class ENSDomainClient extends DomainClient<AIAgentENSClient, number> {
  constructor() {
    super('ens');
  }

  protected async buildClient(targetChainId: number, initArg?: unknown): Promise<AIAgentENSClient> {
    // Get RPC URL from environment
    const rpcUrl = requireChainEnvVar('AGENTIC_TRUST_RPC_URL', targetChainId);

    // Get ENS registry addresses from environment
    // Default to standard ENS registry on Sepolia if not provided
    const defaultEnsRegistry = targetChainId === 11155111 
      ? '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e' // Standard ENS registry on Sepolia
      : '';
    const ensRegistryRaw = getChainEnvVar('AGENTIC_TRUST_ENS_REGISTRY', targetChainId) || defaultEnsRegistry;
    
    if (!ensRegistryRaw || ensRegistryRaw === '') {
      const chainSuffix = targetChainId === 11155111 ? 'SEPOLIA' : targetChainId === 84532 ? 'BASE_SEPOLIA' : targetChainId === 11155420 ? 'OPTIMISM_SEPOLIA' : String(targetChainId);
      throw new Error(
        `Missing required environment variable: AGENTIC_TRUST_ENS_REGISTRY_${chainSuffix}. ` +
        `This is required for the ENS client to resolve ENS names on chain ${targetChainId}.`
      );
    }
    
    const ensRegistry = ensRegistryRaw as `0x${string}`;

    const ensResolver = (getChainEnvVar('AGENTIC_TRUST_ENS_RESOLVER', targetChainId) || '') as `0x${string}`;

    const identityRegistry = (getChainEnvVar('AGENTIC_TRUST_IDENTITY_REGISTRY', targetChainId) ||
                             '0x0000000000000000000000000000000000000000') as `0x${string}`;

    const init = (initArg || {}) as ENSInitArg;
    const userApps = init.userApps ?? (await resolveDomainUserApps());
    const accountProvider: AccountProvider = await resolveENSAccountProvider(
      targetChainId,
      rpcUrl,
      userApps
    );

    // Select chain object
    const chain =
      targetChainId === 11155111
        ? sepolia
        : targetChainId === 84532
        ? baseSepolia
        : targetChainId === 11155420
        ? optimismSepolia
        : sepolia;

    // Choose L1 vs L2 ENS client implementation
    const isL2 = targetChainId === 84532 || targetChainId === 11155420;
    const ClientCtor = isL2 ? AIAgentL2ENSDurenClient : AIAgentENSClient;

    return new ClientCtor(
      chain,
      rpcUrl,
      accountProvider,
      ensRegistry,
      ensResolver,
      identityRegistry,
    );
  }
}

const ensDomainClient = new ENSDomainClient();

/**
 * Get or create the AIAgentENSClient singleton
 * Initializes from environment variables using AccountProvider from AdminApp, ClientApp, or ProviderApp
 */
export async function getENSClient(
  chainId?: number,
): Promise<AIAgentENSClient> {
  // Default to Sepolia if no chainId provided
  const targetChainId = chainId || 11155111;
  return ensDomainClient.get(targetChainId);
}

/**
 * Check if ENS client is initialized for a specific chain
 */
export function isENSClientInitialized(chainId?: number): boolean {
  const targetChainId = chainId || 11155111;
  return ensDomainClient.isInitialized(targetChainId);
}

/**
 * Reset the ENS client instance for a specific chain (useful for testing)
 */
export function resetENSClient(chainId?: number): void {
  const targetChainId = chainId || 11155111;
  ensDomainClient.reset(targetChainId);
}

/**
 * Check if an ENS name is available
 * 
 * @param agentName - The agent name (e.g., "my-agent")
 * @param orgName - The organization name (e.g., "8004-agent" or "8004-agent.eth")
 * @returns true if the ENS name is available, false if it's taken, null if check failed
 */
/**
 * Check if an ENS name is available (general purpose)
 * 
 * @param ensName - Full ENS name (e.g., "agentname.orgname.eth" or "orgname.eth")
 * @param chainId - Chain ID where the ENS name should be checked
 * @returns true if the ENS name is available, false if it's taken, null if check failed
 */
export async function isENSNameAvailable(
  ensName: string,
  chainId?: number
): Promise<boolean | null> {
  try {
    const ensClient = await getENSClient(chainId);

    // Normalize the ENS name (ensure it ends with .eth if not already)
    const normalizedName = ensName.trim().toLowerCase();
    const fullName = normalizedName.endsWith('.eth') ? normalizedName : `${normalizedName}.eth`;

    // Check if ENS name is available
    console.log('*********** zzz isENSNameAvailable fullName', fullName);
    const existingAccount = await ensClient.getAgentAccountByName(fullName);
    const isAvailable = !existingAccount || existingAccount === '0x0000000000000000000000000000000000000000';

    return isAvailable;
  } catch (error) {
    console.error('Error checking ENS availability:', error);
    return null;
  }
}

/**
 * Check if an ENS name is available (legacy method for backward compatibility)
 * 
 * @param orgName - The organization name (e.g., "8004-agent" or "8004-agent.eth")
 * @param agentName - The agent name (e.g., "my-agent")
 * @param chainId - Chain ID where the ENS name should be checked
 * @returns true if the ENS name is available, false if it's taken, null if check failed
 */
export async function isENSAvailable(
  orgName: string,
  agentName: string,
  chainId?: number
): Promise<boolean | null> {
  try {
    // Format: agentName.orgName.eth
    const agentNameLabel = agentName.toLowerCase().replace(/\s+/g, '-');
    const orgNameClean = orgName.toLowerCase().replace(/\.eth$/, '');
    const fullName = `${agentNameLabel}.${orgNameClean}.eth`;

    return await isENSNameAvailable(fullName, chainId);
  } catch (error) {
    console.error('Error checking ENS availability:', error);
    return null;
  }
}


/**
 * Get comprehensive ENS name info in one call.
 * Returns account/address, image/avatar, url, description, and availability.
 */
export async function getENSInfo(
  ensName: string,
  chainId?: number
): Promise<{
  name: string;
  chainId?: number;
  available: boolean | null;
  account: `0x${string}` | string | null;
  image: string | null;
  url: string | null;
  description: string | null;
}> {
  const normalized = (ensName || '').trim().toLowerCase();
  const fullName = normalized.endsWith('.eth') ? normalized : `${normalized}.eth`;

  const [available, client] = await Promise.all([
    isENSNameAvailable(fullName, chainId),
    getENSClient(chainId),
  ]);
  console.log('*********** zzz isENSNameAvailable:', available);
  console.log('*********** zzz getENSInfo 0 fullName', fullName);
  const [account, image, url, description] = await Promise.all([
    client.getAgentAccountByName(fullName).catch(() => null),
    client.getAgentImageByName(fullName).catch(() => null),
    client.getAgentUrlByName(fullName).catch(() => null),
    client.getAgentDescriptionByName(fullName).catch(() => null),
  ]);

  console.log('*********** zzz getENSInfo 1 fullName', fullName, account, image, url, description);

  return {
    name: fullName,
    chainId,
    available,
    account: account ?? null,
    image: image ?? null,
    url: url ?? null,
    description: description ?? null,
  };
}

export async function sendSponsoredUserOperation(params: {
  bundlerUrl: string,
  chain: any,
  accountClient: any,
  calls: { to: `0x${string}`; data?: `0x${string}`; value?: bigint }[],
}): Promise<`0x${string}`> {
  const { bundlerUrl, chain, accountClient, calls } = params;
  const pimlicoClient = createPimlicoClient({ transport: http(bundlerUrl) } as any);
  const bundlerClient = createBundlerClient({ 
    transport: http(bundlerUrl), 
    paymaster: true as any,
    chain: chain as any, 
    paymasterContext: { mode: 'SPONSORED' } 
  } as any);
  const { fast: fee } = await (pimlicoClient as any).getUserOperationGasPrice();
  
  const userOpHash = await (bundlerClient as any).sendUserOperation({ 
    account: accountClient, 
    calls,
    ...fee
  });
  return userOpHash as `0x${string}`;
}

/**
 * Create an ENS subdomain name for an agent
 * 
 * @param agentName - The agent name (e.g., "my-agent")
 * @param orgName - The organization name (e.g., "8004-agent" or "8004-agent.eth")
 * @param agentAddress - The agent's account address (0x...)
 * @param agentUrl - Optional agent URL to set in ENS text record
 * @param accountProvider - Optional AccountProvider to use (if not provided, will try to get from AdminApp/ClientApp/ProviderApp)
 * @returns Array of transaction hashes for the ENS creation transactions
 * @throws Error if ENS creation fails
 */
/*
export async function createENSName(
  agentName: string,
  orgName: string,
  agentAddress: `0x${string}`,
  agentUrl?: string,
  accountProvider?: AccountProvider
): Promise<string[]> {
  try {
    // Validate inputs
    if (!agentName || !orgName || !agentAddress) {
      throw new Error(`Missing required parameters: agentName=${agentName}, orgName=${orgName}, agentAddress=${agentAddress}`);
    }

    // Validate agentAddress format
    if (typeof agentAddress !== 'string' || !agentAddress.startsWith('0x') || agentAddress.length !== 42) {
      throw new Error(`Invalid agentAddress format: ${agentAddress}. Must be a valid Ethereum address (0x followed by 40 hex characters).`);
    }

    const ensClient = await getENSClient();
    
    // Get AccountProvider for sending transactions
    // Use provided accountProvider, or try to get from apps
    let providerToUse: AccountProvider | null = accountProvider || null;
    
    if (!providerToUse) {
      // Try all apps in order: AdminApp, ClientApp, ProviderApp
      // Don't rely on environment variables - try to get each app and use it if available
      
      // Try AdminApp first
      try {
        const adminApp = await getAdminApp(undefined, targetChainId);
        if (adminApp?.accountProvider) {
          providerToUse = adminApp.accountProvider;
        }
      } catch (error) {
        // AdminApp not available, continue to next option
        console.warn('AdminApp not available for ENS creation:', error);
      }
      
      // Try ClientApp if AdminApp didn't work
      if (!providerToUse) {
        try {
          const clientApp = await getClientApp();
          if (clientApp?.accountProvider) {
            providerToUse = clientApp.accountProvider;
          }
        } catch (error) {
          // ClientApp not available, continue to next option
          console.warn('ClientApp not available for ENS creation:', error);
        }
      }
      
      // Try ProviderApp if ClientApp didn't work
      if (!providerToUse) {
        try {
          const providerApp = await getProviderApp();
          if (providerApp?.accountProvider) {
            providerToUse = providerApp.accountProvider;
          }
        } catch (error) {
          // ProviderApp not available
          console.warn('ProviderApp not available for ENS creation:', error);
        }
      }
    }
    
    if (!providerToUse) {
      throw new Error('No AccountProvider available. Provide accountProvider parameter or ensure AdminApp, ClientApp, or ProviderApp is initialized.');
    }
    
    // Format names
    const agentNameLabel = agentName.toLowerCase().replace(/\s+/g, '-');
    const orgNameClean = orgName.toLowerCase().replace(/\.eth$/, '');
    const fullOrgName = `${orgNameClean}.eth`;
    
    // Prepare ENS creation calls
    console.log('Creating ENS name with:', {
      orgName: fullOrgName,
      agentName: agentNameLabel,
      agentAddress: agentAddress,
      agentUrl: agentUrl || '',
    });

    console.log("*********** zzz prepareAddAgentNameToOrgCalls: ensClient");

    // ENS Owner AA: parent domain controller
    const bundlerUrl = getChainEnvVar('AGENTIC_TRUST_BUNDLER_URL', params.chainId || 11155111) as string;
    const l1RpcUrl = getChainEnvVar('AGENTIC_TRUST_RPC_URL', params.chainId || 11155111) as string;
    const l1PublicClient = createPublicClient({ chain: sepolia, transport: http(l1RpcUrl) });
    const ensPrivateKey = getEnsPrivateKey(params.chainId || 11155111) as `0x${string}`;
    const orgOwnerEOA = privateKeyToAccount(ensPrivateKey);
    const orgOwnerAddress = orgOwnerEOA.address;


    const bundlerClient = createBundlerClient({
      transport: http(bundlerUrl),
      paymaster: true as any,
      chain: sepolia as any,
      paymasterContext: { mode: 'SPONSORED' },
    } as any);
                

    const orgAccountClient = await toMetaMaskSmartAccount({
      address: orgOwnerAddress as `0x${string}`,
      client: l1PublicClient,
      implementation: Implementation.Hybrid,
      signer: { account: orgOwnerEOA },
    } as any);

    const { calls: orgCalls } = await ensClient.prepareAddAgentNameToOrgCalls({
      orgName: fullOrgName,
      agentName: agentNameLabel,
      agentAddress: agentAddress,
      agentUrl: agentUrl || '',
    });
    
    const userOpHash1 = await sendSponsoredUserOperation({
      bundlerUrl,
      chain: sepolia,
      accountClient: orgAccountClient,
      calls: orgCalls
    });
    const { receipt: orgReceipt } = await (bundlerClient as any).waitForUserOperationReceipt({ hash: userOpHash1 });
    console.log('********************* orgReceipt', orgReceipt);
    
    const pimlicoClient = createPimlicoClient({ transport: http(bundlerUrl) } as any);
    const { fast: fee } = await (pimlicoClient as any).getUserOperationGasPrice();


    // 2. Set agent name info within ENS
      // Clean orgName: remove .eth suffix
  const cleanOrgName = orgName.replace(/\.eth$/i, '');
  
  // Clean agentName: remove leading orgName + . and .eth suffix
  const cleanAgentName = agentName
    .replace(new RegExp(`^${cleanOrgName}\\.`, 'i'), '') // Remove leading orgName.
    .replace(/\.eth$/i, ''); // Remove .eth suffix

    console.log('********************* prepareSetAgentNameInfoCalls');
    const { calls: agentCalls } = await ensClient.prepareSetAgentNameInfoCalls({
      orgName: cleanOrgName,
      agentName: cleanAgentName,
      agentAddress: agentAccount,
      agentUrl: agentUrl,
      agentDescription: agentDescription
    });

    const userOpHash2 = await sendSponsoredUserOperation({
      bundlerUrl,
      chain: sepolia,
      accountClient: agentAccountClient,
      calls: agentCalls,
    });

    const { receipt: agentReceipt } = await (bundlerClient as any).waitForUserOperationReceipt({ hash: userOpHash2 });
    console.log('********************* agentReceipt', agentReceipt);

    if (agentImage && agentImage.trim() !== '') {
      const ensFullName = `${cleanAgentName}.${cleanOrgName}.eth`;
      const { calls: imageCalls } = await agentENSClient.prepareSetNameImageCalls(ensFullName, agentImage.trim());
      
      if (imageCalls.length > 0) {
        const userOpHash3 = await sendSponsoredUserOperation({
          bundlerUrl,
          chain: sepolia,
          accountClient: agentAccountClient,
          calls: imageCalls,
        });

        await (bundlerClient as any).waitForUserOperationReceipt({ hash: userOpHash3 });
      }
    }
    
    return [];
  } catch (error) {
    console.error('Error creating ENS name 2:', error);
    throw new Error(`Failed to create ENS name: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
*/

export interface AddAgentToOrgL1Params {
  agentName: string;
  orgName: string;
  agentAddress: `0x${string}`;
  agentUrl?: string;
  chainId?: number;
}

export interface AddAgentToOrgL1Result {
  calls: {
    to: `0x${string}`;
    data: `0x${string}`;
    value?: bigint;
  }[];
}

export interface AddAgentToOrgL2Params {
  agentName: string;
  orgName: string;
  agentAddress: `0x${string}`;
  agentUrl?: string;
  chainId?: number;
}

export interface AddAgentToOrgL2Result {
  calls: {
    to: `0x${string}`;
    data: `0x${string}`;
    value?: bigint;
  }[];
}


export interface PrepareL1AgentNameInfoParams {
  agentAddress: `0x${string}`;
  orgName: string;
  agentName: string;
  agentUrl?: string;
  agentDescription?: string;
  chainId?: number;
}

export interface PrepareL1AgentNameInfoResult {
  calls: {
    to: `0x${string}`;
    data: `0x${string}`;
    value?: bigint;
  }[];
}

export interface PrepareL2AgentNameInfoParams {
  agentAddress: `0x${string}`;
  orgName: string;
  agentName: string;
  agentUrl?: string;
  agentDescription?: string;
  agentImage?: string;
  chainId?: number;
}

export interface PrepareL2AgentNameInfoResult {
  calls: {
    to: `0x${string}`;
    data: `0x${string}`;
    value?: bigint;
  }[];
}

export async function addAgentNameToL1Org(params: AddAgentToOrgL1Params): Promise<string> {
  const { agentAddress, orgName, agentName, agentUrl } = params;
  console.log("addAgentNameToL1Org: ", agentAddress, orgName, agentName, agentUrl);

  if (!agentName || !orgName || !agentAddress) {
    throw new Error('agentName, orgName, and agentAddress are required to add an agent name to an org');
  }

  console.log("ensClient get ens for chain: ", params.chainId);
  const targetChainId = params.chainId || 11155111;
  const ensClient = await getENSClient(targetChainId);

  const agentNameLabel = agentName.toLowerCase().replace(/\s+/g, '-');
  const orgNameClean = orgName.toLowerCase().replace(/\.eth$/, '');
  const orgAddress = getEnsOrgAddress(targetChainId);
                  // optional TTL (defaults to 0)

  console.log('********************* prepareAddAgentNameToOrgCalls: orgName: ', orgName, agentName, agentAddress, agentUrl);
  const { calls: orgCalls } = await ensClient.prepareAddAgentNameToOrgCalls({
    agentAddress,
    orgName: orgNameClean,
    agentName: agentNameLabel,
    agentUrl: agentUrl || '',
  });

  if (ensClient.isL1()) {

    // Optionally submit server-side if configured (no breaking change: still returns calls)
    try {
      const bundlerUrl = getChainEnvVar('AGENTIC_TRUST_BUNDLER_URL', params.chainId || 11155111);
      const rpcUrl = getChainEnvVar('AGENTIC_TRUST_RPC_URL', params.chainId || 11155111);
      let ensPrivKey: `0x${string}` | undefined;
      try {
        ensPrivKey = getEnsPrivateKey(targetChainId) as `0x${string}`;
      } catch {
        ensPrivKey = undefined;
      }

      if (ensPrivKey && bundlerUrl && rpcUrl) {

        const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
        const orgEOA = privateKeyToAccount(ensPrivKey);
        const walletClient = createWalletClient({
          account: orgEOA,
          chain: sepolia,
          transport: http(rpcUrl),
        });



        const orgAccountClient = await toMetaMaskSmartAccount({
          address: orgAddress as `0x${string}`,
          client: publicClient,
          implementation: Implementation.Hybrid,
          signer: { walletClient: walletClient as any },
        } as any);

        const pimlicoClient = createPimlicoClient({ transport: http(bundlerUrl) } as any);
    
        const bundlerClient = createBundlerClient({
          transport: http(bundlerUrl),
          paymaster: true as any,
          chain: sepolia as any,
          paymasterContext: { mode: 'SPONSORED' },
        } as any);

        const { fast: fee } = await (pimlicoClient as any).getUserOperationGasPrice();
    
        const userOpHash = await (bundlerClient as any).sendUserOperation({
          account: orgAccountClient,
          calls: orgCalls,
          ...fee,
        });
        await (bundlerClient as any).waitForUserOperationReceipt({ hash: userOpHash });
      }
    } catch (error) {
      // If server-side submission fails, just return prepared calls
      console.error('Error adding agent name to org:', error);
      throw new Error(`Failed to add agent name to org: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  

  return "success";
}


export async function prepareL1AgentNameInfoCalls(
  params: PrepareL1AgentNameInfoParams
): Promise<PrepareL1AgentNameInfoResult> {
  const { agentAddress, orgName, agentName, agentUrl, agentDescription } = params;

  if (!agentName || !orgName || !agentAddress) {
    throw new Error('agentName, orgName, and agentAddress are required to prepare ENS agent info calls');
  }

  const targetChainId = params.chainId || 11155111;
  const ensClient = await getENSClient(targetChainId);

  const orgNameClean = orgName.replace(/\.eth$/i, '').toLowerCase();
  const orgNamePattern = orgNameClean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const agentNameTrimmed = agentName
    .replace(new RegExp(`^${orgNamePattern}\\.`, 'i'), '')
    .replace(/\.eth$/i, '')
    .trim();
  const agentNameLabel = agentNameTrimmed.toLowerCase().replace(/\s+/g, '-');

  const { calls } = await ensClient.prepareSetAgentNameInfoCalls({
    orgName: orgNameClean,
    agentName: agentNameLabel,
    agentAddress,
    agentUrl: agentUrl || '',
    agentDescription: agentDescription || '',
  });

  return {
    calls,
  };
}

export async function addAgentNameToL2Org(
  params: PrepareL2AgentNameInfoParams
): Promise<PrepareL1AgentNameInfoResult> {
  const { agentAddress, orgName, agentName, agentUrl, agentDescription, agentImage } = params;
  if (!agentName || !orgName || !agentAddress) {
    throw new Error('agentName, orgName, and agentAddress are required to prepare L2 ENS calls');
  }

  console.info("inside addAgentNameToL2Org: ", params);

  const targetChainId = params.chainId || 11155111;
  const ensClient = await getENSClient(targetChainId);

  const orgNameClean = orgName.replace(/\.eth$/i, '').toLowerCase();
  const orgNamePattern = orgNameClean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const agentNameTrimmed = agentName
    .replace(new RegExp(`^${orgNamePattern}\\.`, 'i'), '')
    .replace(/\.eth$/i, '')
    .trim();
  const agentNameLabel = agentNameTrimmed.toLowerCase().replace(/\s+/g, '-');

  const calls: { to: `0x${string}`; data: `0x${string}`; value?: bigint }[] = [];

  // Create subdomain if missing
  console.info("see if agent name is available: ", orgNameClean, agentNameLabel);
  const hasOwner = await ensClient.hasAgentNameOwner(orgNameClean, agentNameLabel);

  console.info("hasOwner: ", hasOwner);
  if (!hasOwner) {
    console.info("agent name is not available, prepare add agent name to org calls");
    const { calls: orgCalls } = await ensClient.prepareAddAgentNameToOrgCalls({
      orgName: orgNameClean,
      agentName: agentNameLabel,
      agentAddress,
      agentUrl: agentUrl || '',
    });
    calls.push(...orgCalls);
  }

  /*
  // Metadata (text records)
  console.info("prepare set agent name info calls");
  const { calls: infoCalls } = await ensClient.prepareSetAgentNameInfoCalls({
    orgName: orgNameClean,
    agentName: agentNameLabel,
    agentAddress,
    agentUrl: agentUrl || '',
    agentDescription: agentDescription || '',
  });
  calls.push(...infoCalls);

  // Optional avatar/image
  console.info("prepare set name image calls");
  if (agentImage && agentImage.trim() !== '') {
    const fullSubname = `${agentNameLabel}.${orgNameClean}.eth`;
    const { calls: imageCalls } = await (ensClient as any).prepareSetNameImageCalls(fullSubname, agentImage.trim());
    calls.push(...imageCalls);
  }
  */

  console.info("addAgentNameToL2Org: calls", calls);

  return { calls };
}

export async function prepareL2AgentNameInfoCalls(
  params: PrepareL2AgentNameInfoParams
): Promise<PrepareL2AgentNameInfoResult> {
  const { agentAddress, orgName, agentName, agentUrl, agentDescription } = params;

  console.info("inside addAgentNameToL2Org: ", params);

  const targetChainId = params.chainId || 11155111;
  const ensClient = await getENSClient(targetChainId);

  const orgNameClean = orgName.replace(/\.eth$/i, '').toLowerCase();
  const orgNamePattern = orgNameClean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const agentNameTrimmed = agentName
    .replace(new RegExp(`^${orgNamePattern}\\.`, 'i'), '')
    .replace(/\.eth$/i, '')
    .trim();
  const agentNameLabel = agentNameTrimmed.toLowerCase().replace(/\s+/g, '-');

  const calls: { to: `0x${string}`; data: `0x${string}`; value?: bigint }[] = [];


  // Metadata (text records)
  console.info("prepare set agent name info calls");
  const { calls: infoCalls } = await ensClient.prepareSetAgentNameInfoCalls({
    orgName: orgNameClean,
    agentName: agentNameLabel,
    agentAddress,
    agentUrl: agentUrl || '',
    agentDescription: agentDescription || '',
  });
  calls.push(...infoCalls);

  // Optional avatar/image
  console.info("prepare set name image calls");
  if (params.agentImage && params.agentImage.trim() !== '') {
    const fullSubname = `${agentNameLabel}.${orgNameClean}.eth`;
    const { calls: imageCalls } = await (ensClient as any).prepareSetNameImageCalls(fullSubname, params.agentImage.trim());
    calls.push(...imageCalls);
  }

  return { calls };

}

