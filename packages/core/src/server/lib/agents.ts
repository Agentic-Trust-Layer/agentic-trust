import { parseDid8004 } from '@agentic-trust/8004-ext-sdk';

async function getAccountNonce(accountClient: any): Promise<bigint | undefined> {
  if (typeof accountClient?.getNonce === 'function') {
    try {
      const value = await accountClient.getNonce();
      if (typeof value === 'bigint') {
        (accountClient as any).nonce = value;
        return value;
      }
    } catch {}
  }
  if (typeof accountClient?.nonce === 'bigint') {
    return accountClient.nonce;
  }
  return undefined;
}

async function sendUserOpWithTimeout(params: {
  bundlerUrl: string;
  chain: Chain;
  accountClient: any;
  calls: { to: `0x${string}`; data: `0x${string}`; value?: bigint }[];
  nonce?: bigint;
  timeoutMs?: number;
}): Promise<{ hash: `0x${string}`; receipt?: any }> {
  const { timeoutMs = 20000, nonce, ...rest } = params;

  if (typeof nonce === 'bigint') {
    (rest.accountClient as any).nonce = nonce;
  }

  const sendPromise = (async () => {
    const hash = await sendSponsoredUserOperation(rest);
    const receipt = await waitForUserOperationReceipt({
      bundlerUrl: rest.bundlerUrl,
      chain: rest.chain,
      hash,
    });
    return { hash, receipt };
  })();

  return await Promise.race([
    sendPromise,
    new Promise<{ hash: `0x${string}`; receipt?: any }>((_, reject) =>
      setTimeout(() => reject(new Error('Timeout waiting for UserOperation')), timeoutMs),
    ),
  ]);
}

/**
 * Agents API for AgenticTrust Client
 */

import type { AgenticTrustClient } from '../singletons/agenticTrustClient';
import {
  AIAgentIdentityClient,
  type AgentData,
  type GiveFeedbackParams,
} from '@agentic-trust/8004-ext-sdk';
import {
  ViemAccountProvider,
  BaseIdentityClient,
} from '@agentic-trust/8004-sdk';
import { Agent, loadAgentDetail } from './agent';
import type { AgentDetail } from '../models/agentDetail';

import { getDiscoveryClient } from '../singletons/discoveryClient';
import {
  getChainEnvVar,
  requireChainEnvVar,
  getChainById,
  getChainRpcUrl,
  getChainBundlerUrl,
  DEFAULT_CHAIN_ID,
  isL1,
  getChainConfig,
} from './chainConfig';
import { parseEthrDid } from './accounts';
import { uploadRegistration, createRegistrationJSON } from './agentRegistration';
import { generateHcs14UaidDidTarget } from './uaid';
import { buildDidEthr } from '../../shared/didEthr';
import { createPublicClient, encodeFunctionData, http } from 'viem';
import type { Address } from 'viem';
import { getAdminApp } from '../userApps/adminApp';
import IdentityRegistryABIJson from '@agentic-trust/8004-ext-sdk/abis/IdentityRegistry.json';
import { Implementation, toMetaMaskSmartAccount } from '@metamask/smart-accounts-kit';
import { createBundlerClient } from 'viem/account-abstraction';
import { addToL1OrgPK } from './names';
import { sendSponsoredUserOperation, waitForUserOperationReceipt } from '../../client/accountClient';
import type { Chain } from 'viem';
import { getENSClient } from '../singletons/ensClient';
import { rethrowDiscoveryError } from './discoveryErrors';

const identityRegistryAbi: any = (IdentityRegistryABIJson as any).default ?? IdentityRegistryABIJson;


// Re-export AgentData for compatibility
export type { AgentData };

export interface DiscoverParams {
  chains?: number[] | 'all';

  /**
   * Agent name filter (maps to agentName_* in the indexer).
   */
  agentName?: string;

  /**
   * Agent category filter (maps to agentCategory_* in the indexer).
   */
  agentCategory?: string;

  /**
   * Exact agentId (string form).
   * Used to build AgentWhereInput.agentId / agentId_in filters.
   */
  agentId?: string;

  /**
   * Single agent account (EOA/AA address).
   * For discovery this is the primary "account" concept.
   */
  agentAccount?: Address;

  /**
   * Multiple account addresses to filter by.
   * Maps to agentOwner_in in the indexer.
   */
  accounts?: Address[];

  description?: string;
  operators?: Address[];
  mcp?: boolean;
  a2a?: boolean;
  ens?: string;
  did?: string;
  supportedTrust?: string[];
  a2aSkills?: string[];
  mcpTools?: string[];
  mcpPrompts?: string[];
  mcpResources?: string[];
  active?: boolean;
  x402support?: boolean;

  /**
   * Aggregated reputation / validation filters.
   */
  minFeedbackCount?: number;
  minValidationCompletedCount?: number;
  minFeedbackAverageScore?: number;

  /**
   * Minimum total associations (initiated + approved).
   * Note: this is applied as a post-filter in the search route handler to avoid relying on
   * indexer-specific AgentWhereInput fields.
   */
  minAssociations?: number;

  /**
   * Minimum ATI overall score (maps to atiOverallScore_gte in the indexer).
   */
  minAtiOverallScore?: number;

  /**
   * Restrict ATI results to those computed within the last N days.
   * Maps to atiComputedAt_gte in the indexer (seconds since epoch).
   */
  atiComputedWithinDays?: number;

  /**
   * Restrict results to agents created within the last N days.
   * Maps to createdAtTime_gte in the indexer.
   */
  createdWithinDays?: number;

}

export interface DiscoverAgentsOptions {
  page?: number;
  pageSize?: number;
  query?: string;
  params?: DiscoverParams;
  orderBy?: string;
  orderDirection?: 'ASC' | 'DESC';
}

export interface ListAgentsOptions extends DiscoverAgentsOptions {}

export interface ListAgentsResponse {
  agents: Agent[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

function safeParseJson<T = unknown>(value: string): T | undefined {
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

function normalizeToStringArray(...values: Array<unknown>): string[] {
  for (const value of values) {
    if (Array.isArray(value)) {
      return value.map((item) => String(item));
    }
    if (typeof value === 'string') {
      return [value];
    }
  }
  return [];
}

function includesEveryCaseInsensitive(source: string[], expected: string[]): boolean {
  if (!expected.length) {
    return true;
  }
  if (!source.length) {
    return false;
  }
  const sourceLower = source.map((value) => value.toLowerCase());
  return expected.every((value) => sourceLower.includes(value.toLowerCase()));
}

export class AgentsAPI {
  constructor(
    private client: AgenticTrustClient
  ) {}

  /**
   * List all agents
   * Query uses the actual schema fields from the API
   * Returns agents sorted by agentId in descending order
   * Fetches all agents using pagination if needed
   */
  async listAgents(options?: ListAgentsOptions): Promise<ListAgentsResponse> {
    return this.searchAgents(options ?? {});
  }

  /**
   * Get a single agent by ID
   * @param agentId - The agent ID as a string
   * @param chainId - Optional chain ID (defaults to 11155111 for Sepolia)
   */
  async getAgent(agentId: string, chainId: number = 11155111): Promise<Agent | null> {
    return this.client.getAgent(agentId, chainId);
  }

  async getAgentByDid(did8004: string): Promise<Agent | null> {
    return this.client.getAgentByDid(did8004);
  }

  /**
   * Get a fully-hydrated AgentDetail for a given agentId and chainId.
   * This method is kept for backwards compatibility but simply delegates
   * to the top-level AgenticTrustClient.getAgentDetails helper.
   */
  async getAgentDetails(
    agentId: string,
    chainId?: number,
  ): Promise<AgentDetail> {
    return this.client.getAgentDetails(agentId, chainId);
  }

  /**
   * Get raw agent data from discovery (for internal use)
   * Returns the raw AgentData from the discovery indexer
   */
  async getAgentFromDiscovery(chainId: number, agentId: string): Promise<AgentData | null> {
    const discoveryClient = await getDiscoveryClient();
    try {
      return await discoveryClient.getAgent(chainId, agentId);
    } catch (error) {
      // Check if this is an access code/auth error and provide a clearer message
      rethrowDiscoveryError(error, 'agents.getAgentFromDiscovery');
    }
  }

  async getAgentFromDiscoveryByDid(did8004: string): Promise<AgentData | null> {
    const { agentId, chainId } = parseDid8004(did8004);
    return this.getAgentFromDiscovery(chainId, agentId);
  }

  /**
   * Refresh/Index an agent in the GraphQL indexer
   * Triggers the indexer to re-index the specified agent
   * @param agentId - Agent ID to refresh (required)
   * @param chainId - Optional chain ID (defaults to 11155111 for Sepolia)
   */
  async refreshAgent(agentId: string, chainId: number = 11155111): Promise<any> {
    const discoveryClient = await getDiscoveryClient();
    try {
    return await discoveryClient.refreshAgent(agentId, chainId);
    } catch (error) {
      rethrowDiscoveryError(error, 'agents.refreshAgent');
    }
  }

  async refreshAgentByDid(agentDid: string): Promise<any> {
    const { agentId, chainId } = parseDid8004(agentDid);
    return this.refreshAgent(agentId, chainId);
  }

  /**
   * Get the approved NFT operator address for an agent
   * Returns the address approved to operate on the agent's NFT token, or null if no operator is set
   * 
   * @param agentId - The agent ID (string or number)
   * @param chainId - Optional chain ID (defaults to 11155111 for Sepolia)
   * @returns The approved operator address, or null if no operator is set
   */
  async getNFTOperator(agentId: string | number, chainId: number = 11155111): Promise<`0x${string}` | null> {
    try {
      const { getIdentityRegistryClient } = await import('../singletons/identityClient');
      const resolvedChainId = chainId || DEFAULT_CHAIN_ID;
      const agentIdBigInt = BigInt(agentId);
      
      const identityClient = await getIdentityRegistryClient(resolvedChainId);
      const operatorAddress = await (identityClient as any).getNFTOperator(agentIdBigInt);
      
      if (typeof operatorAddress === 'string' && /^0x[a-fA-F0-9]{40}$/.test(operatorAddress)) {
        return operatorAddress as `0x${string}`;
      }
      return null;
    } catch (error) {
      console.warn('[AgentsAPI.getNFTOperator] Failed to get NFT operator:', error);
      return null;
    }
  }

  /**
   * Create a new agent
   * Requires AdminApp to be initialized (server-side)
   * @param params - Agent creation parameters
   * @returns Created agent ID and transaction hash, or prepared transaction for client-side signing
   */
  async createAgentWithEOAOwnerUsingWallet(params: {
    agentName: string;
    agentAccount: `0x${string}`;
    agentCategory?: string;
    description?: string;
    image?: string;
    agentUrl?: string;
    supportedTrust?: string[];
    endpoints?: Array<{
      name: string;
      endpoint: string;
      version?: string;
      capabilities?: Record<string, any>;
      a2aSkills?: string[];
      a2aDomains?: string[];
      mcpSkills?: string[];
      mcpDomains?: string[];
    }>;
    chainId?: number;

  }): Promise<
    | { agentId: bigint; txHash: string }
    | {
        requiresClientSigning: true;
        transaction: {
          to: `0x${string}`;
          data: `0x${string}`;
          value: string;
          gas?: string;
          gasPrice?: string;
          maxFeePerGas?: string;
          maxPriorityFeePerGas?: string;
          nonce?: number;
          chainId: number;
        };
        tokenUri: string;
        metadata: Array<{ key: string; value: string }>;
      }
  > {
    const targetChainId = params.chainId || DEFAULT_CHAIN_ID;
    const adminApp = await getAdminApp(undefined, targetChainId);
    if (!adminApp) {
      throw new Error(
        'AdminApp not initialized. Ensure AGENTIC_TRUST_APP_ROLES includes "admin" and provide either AGENTIC_TRUST_ADMIN_PRIVATE_KEY or connect via wallet'
      );
    }

      const identityRegistry = requireChainEnvVar('AGENTIC_TRUST_IDENTITY_REGISTRY', targetChainId);

      const identityRegistryHex = identityRegistry.startsWith('0x') 
        ? identityRegistry 
        : `0x${identityRegistry}`;

      // Create registration JSON and upload to IPFS
      let tokenUri = '';
      const chainId: number = targetChainId;
      console.log('[agents.createAgentWithEOAOwnerUsingWallet] Using chainId', chainId);
      let uaid: string | undefined;
      try {
        const didEthr = buildDidEthr(chainId, params.agentAccount, { encode: false });
        const uid = didEthr;
        const nativeId = `eip155:${chainId}:${params.agentAccount}`;
        const domain =
          typeof params.agentUrl === 'string' && params.agentUrl.trim()
            ? (() => {
                try {
                  return new URL(params.agentUrl).hostname;
                } catch {
                  return undefined;
                }
              })()
            : undefined;
        uaid = (
          await generateHcs14UaidDidTarget({
            targetDid: didEthr,
            routing: {
              registry: 'erc-8004',
              proto: 'a2a',
              nativeId,
              uid,
              domain,
            },
          })
        ).uaid;
      } catch (error) {
        console.warn('[agents.createAgentWithEOAOwnerUsingWallet] Failed to generate UAID:', error);
      }
      
      try {
        const registrationJSON = createRegistrationJSON({
          name: params.agentName,
          agentAccount: params.agentAccount,
          description: params.description,
          image: params.image,
          agentUrl: params.agentUrl,
          chainId,
          identityRegistry: identityRegistryHex as `0x${string}`,
          supportedTrust: params.supportedTrust,
          endpoints: params.endpoints,
          uaid,
        });
        
        const uploadResult = await uploadRegistration(registrationJSON);
        tokenUri = uploadResult.tokenUri;
      } catch (error) {
        console.error('Failed to upload registration JSON to IPFS:', error);
        throw new Error(`Failed to create registration JSON: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    
    // If no private key, prepare transaction for client-side signing
    if (!adminApp.hasPrivateKey) {
      // Prepare transaction for client-side signing


      // Build metadata array
      const metadata = [
        { key: 'agentName', value: params.agentName ? String(params.agentName) : '' },
        { key: 'agentAccount', value: params.agentAccount ? String(params.agentAccount) : '' },
        ...(params.agentCategory ? [{ key: 'agentCategory', value: String(params.agentCategory) }] : []),
        { key: 'registeredBy', value: 'agentic-trust' },
        { key: 'registryNamespace', value: 'erc-8004' },
        ...(uaid ? [{ key: 'uaid', value: uaid }] : []),
      ].filter(m => m.value !== '');

      

      // Prepare transaction using AIAgentIdentityClient (all Ethereum logic server-side)

      // Get chain by ID
      const chain = getChainById(chainId);

      const rpcUrl = getChainRpcUrl(chainId);
      const publicClient = createPublicClient({
        chain: chain as any,
        transport: http(rpcUrl),
      });

      const accountProvider = new ViemAccountProvider({
        publicClient: publicClient as any,
        walletClient: null, // Read-only for transaction preparation
        chainConfig: {
          id: chainId,
          rpcUrl: rpcUrl,
          name: chain.name,
          chain: chain as any,
        },
      });

      const aiIdentityClient = new AIAgentIdentityClient({
        accountProvider,
        identityRegistryAddress: identityRegistryHex as `0x${string}`,
      });

      // Prepare complete transaction (encoding, gas estimation, nonce, etc.)
      // AIAgentIdentityClient handles all Ethereum logic internally using its publicClient
      const transaction = await aiIdentityClient.prepareRegisterTransaction(
        tokenUri,
        metadata,
        adminApp.address // Only address needed - no publicClient passed
      );

      return {
        requiresClientSigning: true,
        transaction,
        tokenUri,
        metadata: metadata.map(m => ({ key: m.key, value: m.value })),
      };
    }
    
    // Check wallet balance before attempting transaction
    try {
      const balance = await adminApp.publicClient.getBalance({ address: adminApp.address });
      if (balance === 0n) {
        throw new Error(`Wallet ${adminApp.address} has zero balance. Please fund the wallet with Sepolia ETH to pay for gas.`);
      }
      console.log(`Wallet balance: ${balance.toString()} wei (${(Number(balance) / 1e18).toFixed(6)} ETH)`);
    } catch (balanceError: any) {
      if (balanceError.message.includes('zero balance')) {
        throw balanceError;
      }
      console.warn('Could not check wallet balance:', balanceError.message);
    }
    

    // Create write-capable IdentityClient using AdminApp AccountProvider
    const identityClient = new BaseIdentityClient(
      adminApp.accountProvider,
      identityRegistryHex as `0x${string}`
    );

    // Build metadata array
    // For agentAccount (address), we need to pass it as-is since it's already a hex string
    // IdentityClient.stringToBytes will encode strings as UTF-8, which is fine for agentName
    // but agentAccount should be treated as an address string (which will be encoded as UTF-8)
    // Note: The contract expects bytes, and encoding the address string as UTF-8 is acceptable
    // as long as it's consistently decoded on read
    const metadata = [
      { key: 'agentName', value: params.agentName ? String(params.agentName) : '' },
      { key: 'agentAccount', value: params.agentAccount ? String(params.agentAccount) : '' },
      ...(params.agentCategory ? [{ key: 'agentCategory', value: String(params.agentCategory) }] : []),
      { key: 'registeredBy', value: 'agentic-trust' },
      { key: 'registryNamespace', value: 'erc-8004' },
      ...(uaid ? [{ key: 'uaid', value: uaid }] : []),
    ].filter(m => m.value !== ''); // Remove empty values


    // Use direct EOA transaction path (existing behavior)
    const result = await identityClient.registerWithMetadata(tokenUri, metadata);

    // After we have an agentId, write it back by updating tokenUri so registrations[].agentId is populated.
    try {
      const agentIdStr = result.agentId.toString();
      const updatedRegistrationJSON = createRegistrationJSON({
        name: params.agentName,
        agentAccount: params.agentAccount,
        agentId: agentIdStr,
        description: params.description,
        image: params.image,
        agentUrl: params.agentUrl,
        chainId,
        identityRegistry: identityRegistryHex as `0x${string}`,
        supportedTrust: params.supportedTrust,
        endpoints: params.endpoints,
        uaid,
      });
      const updatedUpload = await uploadRegistration(updatedRegistrationJSON);
      await identityClient.setAgentUri(BigInt(agentIdStr), updatedUpload.tokenUri);
    } catch (uaidError) {
      console.warn('[agents.createAgentWithEOAOwnerUsingWallet] Failed to finalize tokenUri update with agentId:', uaidError);
    }

    // Refresh the agent in the GraphQL indexer
    try {
      const discoveryClient = await getDiscoveryClient();
      await discoveryClient.refreshAgent(result.agentId.toString(), chainId);
      console.log(`✅ Refreshed agent ${result.agentId} in GraphQL indexer`);
    } catch (refreshError) {
      // Log error but don't fail agent creation if refresh fails
      console.warn(`⚠️ Failed to refresh agent ${result.agentId} in GraphQL indexer:`, refreshError);
    }

    return result;
  }

  /**
   * Create a new agent for EOA using the server admin private key.
   * Same interface as createAgentWithEOAOwnerUsingWallet, but always executes the transaction server-side.
   */
  async createAgentWithEOAOwnerUsingPrivateKey(params: {
    agentName: string;
    agentAccount: `0x${string}`;
    agentCategory?: string;
    description?: string;
    image?: string;
    agentUrl?: string;
    supportedTrust?: string[];
    endpoints?: Array<{
      name: string;
      endpoint: string;
      version?: string;
      capabilities?: Record<string, any>;
      a2aSkills?: string[];
      a2aDomains?: string[];
      mcpSkills?: string[];
      mcpDomains?: string[];
    }>;
    chainId?: number;
  }): Promise<{ agentId: bigint; txHash: string }> {
    const targetChainId = params.chainId || DEFAULT_CHAIN_ID;
    const adminApp = await getAdminApp(undefined, targetChainId);
    if (!adminApp) {
      throw new Error(
        'AdminApp not initialized. Ensure AGENTIC_TRUST_APP_ROLES includes "admin" and provide AGENTIC_TRUST_ADMIN_PRIVATE_KEY'
      );
    }
    if (!adminApp.hasPrivateKey) {
      throw new Error('Admin private key not available on server. Cannot execute server-side transaction.');
    }

    const identityRegistry = requireChainEnvVar('AGENTIC_TRUST_IDENTITY_REGISTRY', targetChainId);
    const identityRegistryHex = identityRegistry.startsWith('0x') ? identityRegistry : `0x${identityRegistry}`;

    // Create registration JSON and upload to IPFS
    let tokenUri = '';
    let uaid: string | undefined;
    try {
      const didEthr = buildDidEthr(targetChainId, params.agentAccount, { encode: false });
      const uid = didEthr;
      const nativeId = `eip155:${targetChainId}:${params.agentAccount}`;
      const domain =
        typeof params.agentUrl === 'string' && params.agentUrl.trim()
          ? (() => {
              try {
                return new URL(params.agentUrl).hostname;
              } catch {
                return undefined;
              }
            })()
          : undefined;
      uaid = (
        await generateHcs14UaidDidTarget({
          targetDid: didEthr,
          routing: {
            registry: 'erc-8004',
            proto: 'a2a',
            nativeId,
            uid,
            domain,
          },
        })
      ).uaid;
    } catch (error) {
      console.warn('[agents.createAgentWithEOAOwnerUsingPrivateKey] Failed to generate UAID:', error);
    }
    try {
      const registrationJSON = createRegistrationJSON({
        name: params.agentName,
        agentAccount: params.agentAccount,
        description: params.description,
        image: params.image,
        agentUrl: params.agentUrl,
        chainId: targetChainId,
        identityRegistry: identityRegistryHex as `0x${string}`,
        supportedTrust: params.supportedTrust,
        endpoints: params.endpoints,
        uaid,
      });
      const uploadResult = await uploadRegistration(registrationJSON);
      tokenUri = uploadResult.tokenUri;
    } catch (error) {
      console.error('Failed to upload registration JSON to IPFS:', error);
      throw new Error(`Failed to create registration JSON: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Create write-capable IdentityClient using AdminApp AccountProvider
    const identityClient = new BaseIdentityClient(adminApp.accountProvider, identityRegistryHex as `0x${string}`);

    // Build metadata
    const metadata = [
      { key: 'agentName', value: params.agentName ? String(params.agentName) : '' },
      { key: 'agentAccount', value: params.agentAccount ? String(params.agentAccount) : '' },
      ...(params.agentCategory ? [{ key: 'agentCategory', value: String(params.agentCategory) }] : []),
      { key: 'registeredBy', value: 'agentic-trust' },
      { key: 'registryNamespace', value: 'erc-8004' },
      ...(uaid ? [{ key: 'uaid', value: uaid }] : []),
    ].filter(m => m.value !== '');

    // Execute registration
    const result = await identityClient.registerWithMetadata(tokenUri, metadata);

    // After we have an agentId, write it back by updating tokenUri so registrations[].agentId is populated.
    try {
      const agentIdStr = result.agentId.toString();
      const updatedRegistrationJSON = createRegistrationJSON({
        name: params.agentName,
        agentAccount: params.agentAccount,
        agentId: agentIdStr,
        description: params.description,
        image: params.image,
        agentUrl: params.agentUrl,
        chainId: targetChainId,
        identityRegistry: identityRegistryHex as `0x${string}`,
        supportedTrust: params.supportedTrust,
        endpoints: params.endpoints,
        uaid,
      });
      const updatedUpload = await uploadRegistration(updatedRegistrationJSON);
      await identityClient.setAgentUri(BigInt(agentIdStr), updatedUpload.tokenUri);
    } catch (uaidError) {
      console.warn('[agents.createAgentWithEOAOwnerUsingPrivateKey] Failed to finalize tokenUri update with agentId:', uaidError);
    }

    // Refresh in indexer (best-effort)
    try {
      const discoveryClient = await getDiscoveryClient();
      await discoveryClient.refreshAgent(result.agentId.toString(), targetChainId);
    } catch (refreshError) {
      console.warn(`⚠️ Failed to refresh agent ${result.agentId} in GraphQL indexer:`, refreshError);
    }

    return result;
  }

  async createAgentWithSmartAccountOwnerUsingWallet(params: {
    agentName: string;
    agentAccount: `0x${string}`;
    /**
     * Optional agentId (only available after the agent has been registered on-chain).
     * When present, we can generate a UAID that includes chainId:agentId in routing params.
     */
    agentId?: string;
    agentCategory?: string;
    description?: string;
    image?: string;
    agentUrl?: string;
    supportedTrust?: string[];
    endpoints?: Array<{
      name: string;
      endpoint: string;
      version?: string;
      capabilities?: Record<string, any>;
      a2aSkills?: string[];
      a2aDomains?: string[];
      mcpSkills?: string[];
      mcpDomains?: string[];
    }>;
    chainId?: number;

  }): Promise<{
    success: true;
    bundlerUrl: string;
    tokenUri: string;
    chainId: number;
    calls: Array<{ to: `0x${string}`; data: `0x${string}` }>;
  }> {
    const chainId: number = params.chainId || DEFAULT_CHAIN_ID;
    const adminApp = await getAdminApp(undefined, chainId);
    if (!adminApp) {
      throw new Error(
        'AdminApp not initialized. Ensure AGENTIC_TRUST_APP_ROLES includes "admin" and provide either AGENTIC_TRUST_ADMIN_PRIVATE_KEY or connect via wallet'
      );
    }

    const identityRegistry = requireChainEnvVar('AGENTIC_TRUST_IDENTITY_REGISTRY', chainId);

    const identityRegistryHex = identityRegistry.startsWith('0x') 
      ? identityRegistry 
      : `0x${identityRegistry}`;

    // UAID in DID-target form using agent account did:ethr (available pre-registration).
    let uaid: string | undefined;
    try {
      const didEthr = buildDidEthr(chainId, params.agentAccount, { encode: false });
      const uid = didEthr;
      const nativeId = `eip155:${chainId}:${params.agentAccount}`;
      const domain =
        typeof params.agentUrl === 'string' && params.agentUrl.trim()
          ? (() => {
              try {
                return new URL(params.agentUrl).hostname;
              } catch {
                return undefined;
              }
            })()
          : undefined;
      const result = await generateHcs14UaidDidTarget({
        targetDid: didEthr,
        routing: {
          registry: 'erc-8004',
          proto: 'a2a',
          nativeId,
          uid,
          domain,
        },
      });
      uaid = result.uaid;
    } catch (error) {
      console.warn('[agents.createAgentWithSmartAccountOwnerUsingWallet] Failed to generate UAID:', error);
    }

    // Create registration JSON and upload to IPFS
    let tokenUri = '';
    console.log('[agents.createAgentWithSmartAccountOwnerUsingWallet] Using chainId', chainId);
    
    try {
      const registrationJSON = createRegistrationJSON({
        name: params.agentName,
        agentAccount: params.agentAccount,
        description: params.description,
        image: params.image,
        agentUrl: params.agentUrl,
        chainId,
        identityRegistry: identityRegistryHex as `0x${string}`,
        supportedTrust: params.supportedTrust,
        endpoints: params.endpoints,
        uaid,
      });
      
      const uploadResult = await uploadRegistration(registrationJSON);
      tokenUri = uploadResult.tokenUri;
    } catch (error) {
      console.error('Failed to upload registration JSON to IPFS:', error);
      throw new Error(`Failed to create registration JSON: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Determine chain based on chainId
    const chain = getChainById(chainId);

    const rpcUrl = getChainRpcUrl(chainId);
    const publicClient = createPublicClient({
      chain: chain as any,
      transport: http(rpcUrl),
    });

    const accountProvider = new ViemAccountProvider({
      publicClient: publicClient as any,
      walletClient: null,
      chainConfig: {
        id: chainId,
        rpcUrl: rpcUrl,
        name: chain.name,
        chain: chain as any,
      },
    });

    const aiIdentityClient = new AIAgentIdentityClient({
      accountProvider,
      identityRegistryAddress: identityRegistryHex as `0x${string}`,
    });

    const additionalMetadata = [
      ...(params.agentCategory ? [{ key: 'agentCategory', value: params.agentCategory }] : []),
      { key: 'registeredBy', value: 'agentic-trust' },
      { key: 'registryNamespace', value: 'erc-8004' },
      ...(uaid ? [{ key: 'uaid', value: uaid }] : []),
    ];
    const { calls: registerCalls } = await aiIdentityClient.prepareRegisterCalls(
      params.agentName,
      params.agentAccount,
      tokenUri,
      additionalMetadata
    );

    const bundlerUrl = getChainBundlerUrl(params.chainId || DEFAULT_CHAIN_ID);

    return {
      success: true as const,
      bundlerUrl,
      tokenUri,
      chainId,
        calls: registerCalls,
    };
  }

  /**
   * Create a new agent for AA and execute via server admin private key (no client prompts).
   * Same input interface as createAgentWithSmartAccountOwnerUsingWallet, but performs the UserOperation using the server key.
   */
  async createAgentWithSmartAccountOwnerUsingPrivateKey(params: {
    agentName: string;
    agentAccount: `0x${string}`;
    agentCategory?: string;
    description?: string;
    image?: string;
    agentUrl?: string;
    supportedTrust?: string[];
    endpoints?: Array<{
      name: string;
      endpoint: string;
      version?: string;
      capabilities?: Record<string, any>;
      a2aSkills?: string[];
      a2aDomains?: string[];
      mcpSkills?: string[];
      mcpDomains?: string[];
    }>;
    chainId?: number;
    ensOptions?: {
      enabled?: boolean;
      orgName?: string;
    };
  }): Promise<{ txHash: string; agentId?: string }> {
    const chainId: number = params.chainId || DEFAULT_CHAIN_ID;
    const adminApp = await getAdminApp(undefined, chainId);
    if (!adminApp) {
      throw new Error(
        'AdminApp not initialized. Ensure AGENTIC_TRUST_APP_ROLES includes "admin" and provide AGENTIC_TRUST_ADMIN_PRIVATE_KEY'
      );
    }

    // First reuse existing preparation to get register calls
    const prepared = await this.createAgentWithSmartAccountOwnerUsingWallet({
      ...params,
      chainId,
    });

    // Build AA account client using admin signer
    const chain = getChainById(chainId);

    // Deterministic salt based on agentName (matches client computation)
    const { keccak256, stringToHex } = await import('viem');
    const deploySalt = keccak256(stringToHex(params.agentName)) as `0x${string}`;

    const accountClient = await toMetaMaskSmartAccount({
      client: adminApp.publicClient as any,
      implementation: Implementation.Hybrid,
      signer: adminApp.walletClient
        ? { walletClient: adminApp.walletClient as any }
        : (adminApp.account ? { account: adminApp.account } : {}),
      deployParams: [adminApp.address as `0x${string}`, [], [], []],
      deploySalt,
    } as any);

    // Send UserOperation via bundler
    const bundlerUrl = prepared.bundlerUrl;
    const bundlerClient = createBundlerClient({
      transport: http(bundlerUrl),
      paymaster: true as any,
      chain: chain as any,
      paymasterContext: { mode: 'SPONSORED' },
    } as any);

    // permissionless gas price (optional)
    let fee: any = {};
    try {
      const { createPimlicoClient } = await import('permissionless/clients/pimlico');
      const pimlico = createPimlicoClient({ transport: http(bundlerUrl) } as any);
      const gas = await (pimlico as any).getUserOperationGasPrice();
      fee = gas.fast || {};
    } catch {
      // optional
    }

    const userOperationHash = await (bundlerClient as any).sendUserOperation({
      account: accountClient as any,
      calls: prepared.calls,
      ...fee,
    });

    const receipt = await (bundlerClient as any).waitForUserOperationReceipt({ hash: userOperationHash });

    // Try to extract agentId (best-effort)
    let agentId: string | undefined;
    try {
      const id = await this.extractAgentIdFromReceipt(receipt, chainId);
      if (id) agentId = id;
    } catch {}

    // If we have an agentId, update tokenUri on-chain so registrations[].agentId is populated.
    if (agentId) {
      try {
        const didEthr = buildDidEthr(chainId, params.agentAccount, { encode: false });
        const uid = didEthr;
        const nativeId = `eip155:${chainId}:${params.agentAccount}`;
        const domain =
          typeof params.agentUrl === 'string' && params.agentUrl.trim()
            ? (() => {
                try {
                  return new URL(params.agentUrl).hostname;
                } catch {
                  return undefined;
                }
              })()
            : undefined;
        const { uaid } = await generateHcs14UaidDidTarget({
          targetDid: didEthr,
          routing: {
            registry: 'erc-8004',
            proto: 'a2a',
            nativeId,
            uid,
            domain,
          },
        });

        const identityRegistry = requireChainEnvVar('AGENTIC_TRUST_IDENTITY_REGISTRY', chainId);
        const identityRegistryHex = identityRegistry.startsWith('0x') ? identityRegistry : `0x${identityRegistry}`;

        const updatedRegistrationJSON = createRegistrationJSON({
          name: params.agentName,
          agentAccount: params.agentAccount,
          agentId,
          description: params.description,
          image: params.image,
          agentUrl: params.agentUrl,
          chainId,
          identityRegistry: identityRegistryHex as `0x${string}`,
          supportedTrust: params.supportedTrust,
          endpoints: params.endpoints,
          uaid,
        });

        const updatedUpload = await uploadRegistration(updatedRegistrationJSON);
        const preparedUpdate = await this.admin.prepareUpdateAgent({
          agentId,
          tokenUri: updatedUpload.tokenUri,
          chainId,
        });

        const nextNonce = await getAccountNonce(accountClient);
        await sendUserOpWithTimeout({
          bundlerUrl,
          chain,
          accountClient,
          calls: preparedUpdate.calls,
          nonce: nextNonce,
        });
      } catch (uaidError) {
        console.warn('[createAgentWithSmartAccountOwnerUsingPrivateKey] Failed to finalize tokenUri update with agentId:', uaidError);
      }
    }

    if (params.ensOptions?.enabled && params.ensOptions.orgName) {
      try {
        const ensClient = await getENSClient(chainId);
        if (isL1(chainId)) {
          await addToL1OrgPK({
            orgName: params.ensOptions.orgName,
            agentName: params.agentName,
            agentAddress: params.agentAccount,
            agentUrl: params.agentUrl,
            chainId,
          });

          const { calls: infoCalls } = await ensClient.prepareSetAgentNameInfoCalls({
            orgName: params.ensOptions.orgName,
            agentName: params.agentName,
            agentAddress: params.agentAccount,
            agentUrl: params.agentUrl,
            agentDescription: params.description,
          });

          let nextNonce = await getAccountNonce(accountClient);

          if (infoCalls.length > 0) {
            const formattedCalls = infoCalls.map((call) => ({
              to: call.to,
              data: call.data,
              value: (call as any).value ?? 0n,
            }));

            console.info('[createAgentWithSmartAccountOwnerUsingPrivateKey] Submitting L1 ENS metadata calls');
            await sendUserOpWithTimeout({
              bundlerUrl,
              chain,
              accountClient,
              calls: formattedCalls,
              nonce: nextNonce,
            });

            if (typeof nextNonce === 'bigint') {
              nextNonce += 1n;
            }
          }
        } else {
          console.info('[createAgentWithSmartAccountOwnerUsingPrivateKey] Running L2 ENS setup via agent account');
          const { calls: addCalls } = await ensClient.prepareAddAgentNameToOrgCalls({
            orgName: params.ensOptions.orgName,
            agentName: params.agentName,
            agentAddress: params.agentAccount,
            agentUrl: params.agentUrl || '',
          });

          let nextNonce = await getAccountNonce(accountClient);

          if (addCalls.length > 0) {
            const formattedAddCalls = addCalls.map((call) => ({
              to: call.to,
              data: call.data,
              value: 'value' in call && typeof call.value === 'bigint' ? call.value : 0n,
            }));

            console.info('[createAgentWithSmartAccountOwnerUsingPrivateKey] Submitting L2 ENS subdomain registration');
            await sendUserOpWithTimeout({
              bundlerUrl,
              chain,
              accountClient,
              calls: formattedAddCalls,
              nonce: nextNonce,
            });

            if (typeof nextNonce === 'bigint') {
              nextNonce += 1n;
            }
          }

          const { calls: infoCalls } = await ensClient.prepareAddAgentInfoCalls({
            orgName: params.ensOptions.orgName,
            agentName: params.agentName,
            agentAddress: params.agentAccount,
            agentUrl: params.agentUrl || '',
            agentDescription: params.description,
          });

          if (infoCalls.length > 0) {
            const formattedInfoCalls = infoCalls.map((call) => ({
              to: call.to,
              data: call.data,
              value: (call as any).value ?? 0n,
            }));

            console.info('[createAgentWithSmartAccountOwnerUsingPrivateKey] Submitting L2 ENS metadata calls');
            await sendUserOpWithTimeout({
              bundlerUrl,
              chain,
              accountClient,
              calls: formattedInfoCalls,
              nonce: nextNonce,
            });

            if (typeof nextNonce === 'bigint') {
              nextNonce += 1n;
            }
          }
        }
      } catch (ensError) {
        console.warn('[createAgentWithSmartAccountOwnerUsingPrivateKey] ENS setup failed:', ensError);
      }
    }

    return { txHash: userOperationHash as string, agentId };
  }

 
  async extractAgentIdFromReceipt(
    receipt: any,
    chainId: number = 11155111
  ): Promise<string | null> {
    if (!receipt) {
      return null;
    }

    const identityRegistry = requireChainEnvVar('AGENTIC_TRUST_IDENTITY_REGISTRY', chainId);

    const identityRegistryHex = identityRegistry.startsWith('0x')
      ? identityRegistry
      : `0x${identityRegistry}`;

    const chain = getChainById(chainId);

    const aiIdentityClient = new AIAgentIdentityClient({
      accountProvider: {
        chainId: async () => chain.id,
      } as any,
      identityRegistryAddress: identityRegistryHex as `0x${string}`,
    });

    try {
      const agentId = aiIdentityClient.extractAgentIdFromReceiptPublic(receipt);
      return agentId ? agentId.toString() : null;
    } catch (error) {
      console.warn('extractAgentIdFromReceipt failed:', error);
      return null;
    }
  }

  async searchAgents(options?: DiscoverAgentsOptions | string): Promise<ListAgentsResponse> {
    if (typeof options === 'string') {
      return this.searchAgents({ query: options });
    }

    const discoveryClient = await getDiscoveryClient();
    const advancedDiscoveryClient = discoveryClient as typeof discoveryClient & {
      searchAgentsAdvanced?: (options: {
        query?: string;
        params?: Record<string, unknown>;
        limit?: number;
        offset?: number;
        orderBy?: string;
        orderDirection?: 'ASC' | 'DESC';
      }) => Promise<{ agents: AgentData[]; total?: number | null } | null>;
      searchAgentsGraph?: (options: {
        where?: Record<string, unknown>;
        first?: number;
        skip?: number;
        orderBy?: string;
        orderDirection?: 'ASC' | 'DESC';
      }) => Promise<{ agents: AgentData[]; total: number; hasMore: boolean }>;
    };

    const requestedPage =
      typeof options?.page === 'number' && Number.isFinite(options.page) ? options.page : 1;
    const rawPageSize =
      typeof options?.pageSize === 'number' && options.pageSize > 0
        ? options.pageSize
        : undefined;

    const hasQuery =
      typeof options?.query === 'string' && options.query.trim().length > 0;
    const where = this.buildAgentWhereInput(options?.params);

    // Always ensure we have a pageSize when performing discovery so that
    // advanced search is used consistently (even when no filters are provided).
    const effectivePageSize = rawPageSize ?? 50;

    const hasAdvancedGraph =
      typeof advancedDiscoveryClient.searchAgentsGraph === 'function';
    const hasAdvancedLegacy =
      typeof advancedDiscoveryClient.searchAgentsAdvanced === 'function';

    // Prefer the advanced discovery APIs (Graph/advanced) whenever available so
    // that we get an accurate total count and consistent pagination, even when
    // no filters are supplied.
    //
    // IMPORTANT:
    // - The Graph-based API (`searchAgentsGraph`) currently only supports structured
    //   filters via `where` and does NOT take the free-text `query` string.
    // - The legacy advanced API (`searchAgentsAdvanced`) is the one that wires the
    //   general search query into the discovery backend (and can also take params).
    //
    // To ensure the general search box actually filters results, we route:
    //   - requests WITH a query string through `searchAgentsAdvanced` when available
    //   - requests WITHOUT a query string (filters / pagination only) through
    //     `searchAgentsGraph` when available
    if (effectivePageSize && (hasAdvancedGraph || hasAdvancedLegacy)) {
      const offset = (Math.max(requestedPage, 1) - 1) * effectivePageSize;

      try {
        // If we have a text query and the legacy advanced API is available,
        // use it so the query string is honored by the discovery service.
        if (hasQuery && hasAdvancedLegacy) {
          const advanced = await advancedDiscoveryClient.searchAgentsAdvanced({
            query: options?.query,
            params: options?.params as Record<string, unknown> | undefined,
            limit: effectivePageSize,
            offset,
            orderBy: options?.orderBy,
            orderDirection: options?.orderDirection,
          });

          if (advanced && Array.isArray(advanced.agents)) {
            const total =
              typeof advanced.total === 'number' && advanced.total >= 0
                ? advanced.total
                : advanced.agents.length + offset;
            const totalPages = Math.max(1, Math.ceil(total / effectivePageSize));
            const safePage = Math.min(Math.max(requestedPage, 1), totalPages);
            const agentInstances = advanced.agents.map(
              (data: AgentData) => new Agent(data, this.client),
            );

            return {
              agents: agentInstances,
              total,
              page: safePage,
              pageSize: effectivePageSize,
              totalPages,
            };
          }
        } else if (hasAdvancedGraph) {
          const advanced = await advancedDiscoveryClient.searchAgentsGraph({
            where,
            first: effectivePageSize,
            skip: offset,
            orderBy: options?.orderBy,
            orderDirection: options?.orderDirection,
          });

          if (advanced && Array.isArray(advanced.agents)) {
            const total =
              typeof advanced.total === 'number' && advanced.total >= 0
                ? advanced.total
                : advanced.agents.length + offset;
            const totalPages = Math.max(1, Math.ceil(total / effectivePageSize));
            const safePage = Math.min(Math.max(requestedPage, 1), totalPages);
            const agentInstances = advanced.agents.map(
              (data: AgentData) => new Agent(data, this.client),
            );

            return {
              agents: agentInstances,
              total,
              page: safePage,
              pageSize: effectivePageSize,
              totalPages,
            };
          }
        } else if (hasAdvancedLegacy) {
          // Fallback: no Graph API, but legacy advanced is available (with or
          // without a query string).
          const advanced = await advancedDiscoveryClient.searchAgentsAdvanced({
            query: options?.query,
            params: options?.params as Record<string, unknown> | undefined,
            limit: effectivePageSize,
            offset,
            orderBy: options?.orderBy,
            orderDirection: options?.orderDirection,
          });

          if (advanced && Array.isArray(advanced.agents)) {
            const total =
              typeof advanced.total === 'number' && advanced.total >= 0
                ? advanced.total
                : advanced.agents.length + offset;
            const totalPages = Math.max(1, Math.ceil(total / effectivePageSize));
            const safePage = Math.min(Math.max(requestedPage, 1), totalPages);
            const agentInstances = advanced.agents.map(
              (data: AgentData) => new Agent(data, this.client),
            );

            return {
              agents: agentInstances,
              total,
              page: safePage,
              pageSize: effectivePageSize,
              totalPages,
            };
          }
        }
      } catch (error) {
        console.warn(
          '[AgentsAPI.searchAgents] Advanced search failed, returning empty results.',
          error,
        );
      }

      // If advanced search fails or returns null, fall back to the default
      // pagination logic below which uses listAgents.
    }

    // If no filters, use listAgents to get default list from GraphQL endpoint.
    // Default to 50 agents if no pageSize specified.
    const defaultPageSize = effectivePageSize ?? 50;
    const offset = (Math.max(requestedPage, 1) - 1) * defaultPageSize;

    try {
      const allAgents = await discoveryClient.listAgents(defaultPageSize, offset);
      
      // For listAgents, we don't know the total, so we estimate based on returned results
      // If we got a full page, there might be more; if less, we're at the end
      const hasMore = allAgents.length === defaultPageSize;
      const estimatedTotal = hasMore ? allAgents.length + offset + 1 : allAgents.length + offset;
      const totalPages = Math.max(1, Math.ceil(estimatedTotal / defaultPageSize));
      
      const agentInstances = allAgents.map((data: AgentData) => new Agent(data, this.client));
      
      return {
        agents: agentInstances,
        total: estimatedTotal,
        page: requestedPage,
        pageSize: defaultPageSize,
        totalPages,
      };
    } catch (error) {
      console.warn(
        '[AgentsAPI.searchAgents] listAgents failed, returning empty results.',
        error,
      );
      return {
        agents: [],
        total: 0,
        page: requestedPage ?? 1,
        pageSize: defaultPageSize,
        totalPages: 0,
      };
    }
  }

  /**
   * Map high-level DiscoverParams to the indexer's AgentWhereInput shape.
   * This is used for the searchAgentsGraph(where: AgentWhereInput, ...) API.
   */
  private buildAgentWhereInput(params?: DiscoverParams): Record<string, unknown> | undefined {
    if (!params) return undefined;

    const where: Record<string, unknown> = {};

    if (params.chains && params.chains !== 'all' && params.chains.length > 0) {
      where.chainId_in = params.chains;
    }

    if (params.agentName?.trim()) {
      where.agentName_contains_nocase = params.agentName.trim();
    }

    if (params.agentCategory?.trim()) {
      // Best-effort; indexer schemas generally support *_contains_nocase for string fields.
      (where as any).agentCategory_contains_nocase = params.agentCategory.trim();
    }

    if (params.agentId?.trim()) {
      // Exact match on agentId; you could also expose agentId_in if you later
      // support multiple IDs.
      where.agentId = params.agentId.trim();
    }

    if (params.description?.trim()) {
      where.description_contains_nocase = params.description.trim();
    }

    if (params.accounts && params.accounts.length > 0) {
      where.agentOwner_in = params.accounts.map((addr) => addr.toLowerCase());
    }

    if (params.operators && params.operators.length > 0) {
      where.operator_in = params.operators.map((addr) => addr.toLowerCase());
    }

    if (typeof params.mcp === 'boolean') {
      where.mcp = params.mcp;
    }

    if (typeof params.a2a === 'boolean') {
      if (params.a2a) {
        where.hasA2aEndpoint = true;
      }
    }

    if (params.ens?.trim()) {
      where.ensEndpoint_contains_nocase = params.ens.trim();
    }

    if (params.did?.trim()) {
      where.did_contains_nocase = params.did.trim();
    }

    if (params.agentAccount) {
      // Treat the agent account as the owner in the indexer schema.
      where.agentOwner = params.agentAccount.toLowerCase();
    }

    if (params.supportedTrust && params.supportedTrust.length > 0) {
      where.supportedTrust_in = params.supportedTrust;
    }

    if (params.a2aSkills && params.a2aSkills.length > 0) {
      where.a2aSkills_in = params.a2aSkills;
    }

    if (params.mcpTools && params.mcpTools.length > 0) {
      where.mcpTools_in = params.mcpTools;
    }

    if (params.mcpPrompts && params.mcpPrompts.length > 0) {
      where.mcpPrompts_in = params.mcpPrompts;
    }

    if (params.mcpResources && params.mcpResources.length > 0) {
      where.mcpResources_in = params.mcpResources;
    }

    if (typeof params.active === 'boolean') {
      where.active = params.active;
    }

    if (typeof params.x402support === 'boolean') {
      where.x402support = params.x402support;
    }

    if (typeof params.minFeedbackCount === 'number' && params.minFeedbackCount > 0) {
      (where as any).feedbackCount_gte = params.minFeedbackCount;
    }

    if (
      typeof params.minValidationCompletedCount === 'number' &&
      params.minValidationCompletedCount > 0
    ) {
      (where as any).validationCompletedCount_gte = params.minValidationCompletedCount;
    }

    if (
      typeof params.minFeedbackAverageScore === 'number' &&
      params.minFeedbackAverageScore > 0
    ) {
      (where as any).feedbackAverageScore_gte = params.minFeedbackAverageScore;
    }

    if (typeof params.minAtiOverallScore === 'number' && params.minAtiOverallScore > 0) {
      (where as any).atiOverallScore_gte = params.minAtiOverallScore;
    }

    if (typeof params.atiComputedWithinDays === 'number' && params.atiComputedWithinDays > 0) {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const windowSeconds = Math.floor(params.atiComputedWithinDays * 24 * 60 * 60);
      const threshold = nowSeconds - windowSeconds;
      if (threshold > 0) {
        (where as any).atiComputedAt_gte = threshold;
      }
    }

    if (typeof params.createdWithinDays === 'number' && params.createdWithinDays > 0) {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const windowSeconds = Math.floor(params.createdWithinDays * 24 * 60 * 60);
      const threshold = nowSeconds - windowSeconds;
      if (threshold > 0) {
        (where as any).createdAtTime_gte = threshold;
      }
    }

    return Object.keys(where).length > 0 ? where : undefined;
  }

  private applySearchAndPagination(
    agentData: AgentData[],
    options?: DiscoverAgentsOptions,
  ): ListAgentsResponse {
    const normalizedQuery =
      options?.query && typeof options.query === 'string'
        ? options.query.trim().toLowerCase()
        : '';
    const params = options?.params;

    const sortedAgents = (() => {
      const orderBy = options?.orderBy?.trim();
      const orderDirection = (options?.orderDirection ?? 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
      const list = [...agentData];
      if (orderBy === 'agentName') {
        list.sort((a, b) => {
          const aName = (a.agentName ?? '').toLowerCase();
          const bName = (b.agentName ?? '').toLowerCase();
          return orderDirection === 'ASC' ? aName.localeCompare(bName) : bName.localeCompare(aName);
        });
        return list;
      }
      // Default: newest first by agentId desc (back-compat)
      list.sort((a, b) => {
      const idA = typeof a.agentId === 'number' ? a.agentId : Number(a.agentId) || 0;
      const idB = typeof b.agentId === 'number' ? b.agentId : Number(b.agentId) || 0;
      return idB - idA;
    });
      return list;
    })();

    const filteredAgents = sortedAgents.filter((data) => {
      if (normalizedQuery) {
        const haystack = [
          typeof data.agentId === 'number' ? data.agentId.toString() : data.agentId,
          data.agentName,
          data.agentAccount,
          data.agentOwner,
          data.description,
          data.type,
          data.a2aEndpoint,
          data.ensEndpoint,
          data.agentAccountEndpoint,
          data.tokenUri,
          data.supportedTrust,
          data.rawJson,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(normalizedQuery)) {
          return false;
        }
      }

      if (!params) {
        return true;
      }

      return this.matchesSearchParams(data, params);
    });

    const total = filteredAgents.length;
    const pageSize =
      typeof options?.pageSize === 'number' && options.pageSize > 0
        ? options.pageSize
        : total || 1;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const requestedPage =
      typeof options?.page === 'number' && Number.isFinite(options.page) ? options.page : 1;
    const safePage = Math.min(Math.max(requestedPage, 1), totalPages);
    const startIndex = (safePage - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    const pageAgents = filteredAgents.slice(startIndex, endIndex);

    const agentInstances = pageAgents.map((data) => new Agent(data, this.client));

    return {
      agents: agentInstances,
      total,
      page: safePage,
      pageSize,
      totalPages,
    };
  }

  private matchesSearchParams(agent: AgentData, params: DiscoverParams): boolean {
    const parsedRaw =
      typeof agent.rawJson === 'string'
        ? safeParseJson(agent.rawJson)
        : agent.rawJson && typeof agent.rawJson === 'object'
          ? agent.rawJson
          : undefined;
    const metadata =
      parsedRaw && typeof parsedRaw === 'object'
        ? (parsedRaw as Record<string, any>)
        : undefined;

    if (params.chains && params.chains !== 'all') {
      const chainId = typeof agent.chainId === 'number' ? agent.chainId : undefined;
      if (!chainId || !params.chains.includes(chainId)) {
        return false;
      }
    }

    if (params.agentName) {
      const name = agent.agentName ?? '';
      if (!name.toLowerCase().includes(params.agentName.trim().toLowerCase())) {
        return false;
      }
    }

    if (params.agentCategory) {
      const cat = (agent as any).agentCategory ?? '';
      const catStr = typeof cat === 'string' ? cat : String(cat ?? '');
      if (!catStr.toLowerCase().includes(params.agentCategory.trim().toLowerCase())) {
        return false;
      }
    }

    if (params.description) {
      const description = agent.description ?? '';
      if (!description.toLowerCase().includes(params.description.trim().toLowerCase())) {
        return false;
      }
    }

    if (params.accounts && params.accounts.length > 0) {
      const owner = agent.agentOwner?.toLowerCase();
      if (!owner || !params.accounts.some((addr) => addr.toLowerCase() === owner)) {
        return false;
      }
    }

    if (params.agentAccount) {
      const accountValue = agent.agentAccount;
      const wallet = typeof accountValue === 'string' ? accountValue.toLowerCase() : undefined;
      if (!wallet || wallet !== params.agentAccount.toLowerCase()) {
        return false;
      }
    }

    if (params.ens) {
      const ensEndpoint = agent.ensEndpoint ?? '';
      if (!ensEndpoint.toLowerCase().includes(params.ens.trim().toLowerCase())) {
        return false;
      }
    }

    if (params.did) {
      const rawDid =
        (metadata && typeof metadata.did === 'string' && metadata.did) ||
        (metadata?.identity && typeof metadata.identity?.did === 'string'
          ? metadata.identity.did
          : undefined);
      if (!rawDid || rawDid.toLowerCase() !== params.did.trim().toLowerCase()) {
        return false;
      }
    }

    if (params.supportedTrust && params.supportedTrust.length > 0) {
      const supportedTrust = normalizeToStringArray(
        agent.supportedTrust,
        metadata?.supportedTrust,
      );
      if (!includesEveryCaseInsensitive(supportedTrust, params.supportedTrust)) {
        return false;
      }
    }

    if (params.a2aSkills && params.a2aSkills.length > 0) {
      const skills = normalizeToStringArray(
        metadata?.a2aSkills,
        metadata?.a2a?.skills,
        metadata?.skills,
      );
      if (!includesEveryCaseInsensitive(skills, params.a2aSkills)) {
        return false;
      }
    }

    if (params.mcpTools && params.mcpTools.length > 0) {
      const tools = normalizeToStringArray(
        metadata?.mcpTools,
        metadata?.mcp?.tools,
      );
      if (!includesEveryCaseInsensitive(tools, params.mcpTools)) {
        return false;
      }
    }

    if (params.mcpPrompts && params.mcpPrompts.length > 0) {
      const prompts = normalizeToStringArray(
        metadata?.mcpPrompts,
        metadata?.mcp?.prompts,
      );
      if (!includesEveryCaseInsensitive(prompts, params.mcpPrompts)) {
        return false;
      }
    }

    if (params.mcpResources && params.mcpResources.length > 0) {
      const resources = normalizeToStringArray(
        metadata?.mcpResources,
        metadata?.mcp?.resources,
      );
      if (!includesEveryCaseInsensitive(resources, params.mcpResources)) {
        return false;
      }
    }

    if (params.mcp !== undefined) {
      const hasMcp =
        metadata?.mcp === true ||
        metadata?.mcp?.enabled === true ||
        (Array.isArray(metadata?.mcp?.tools) && metadata.mcp.tools.length > 0);
      if (params.mcp !== hasMcp) {
        return false;
      }
    }

    if (params.a2a !== undefined) {
      const hasA2a = typeof agent.a2aEndpoint === 'string' && agent.a2aEndpoint.length > 0;
      if (params.a2a !== hasA2a) {
        return false;
      }
    }

    if (params.operators && params.operators.length > 0) {
      const operators = normalizeToStringArray(
        metadata?.operators,
        metadata?.agentOperators,
        metadata?.operatorAddresses,
      ).map((value) => value.toLowerCase());
      if (
        operators.length === 0 ||
        !params.operators.some((addr) => operators.includes(addr.toLowerCase()))
      ) {
        return false;
      }
    }

    if (params.active !== undefined) {
      const active =
        typeof metadata?.active === 'boolean'
          ? metadata.active
          : typeof metadata?.status === 'string'
            ? metadata.status.toLowerCase() === 'active'
            : undefined;
      if (active !== undefined && params.active !== active) {
        return false;
      }
    }

    if (params.x402support !== undefined) {
      const support =
        metadata?.x402support === true ||
        metadata?.x402Support === true ||
        (Array.isArray(metadata?.protocols) &&
          metadata.protocols.map((p: string) => p.toLowerCase()).includes('x402'));
      if (params.x402support !== support) {
        return false;
      }
    }

    if (typeof params.minAtiOverallScore === 'number' && params.minAtiOverallScore > 0) {
      const scoreRaw = (agent as any).atiOverallScore;
      const score = typeof scoreRaw === 'number' ? scoreRaw : Number(scoreRaw);
      if (!Number.isFinite(score) || score < params.minAtiOverallScore) {
        return false;
      }
    }

    if (typeof params.atiComputedWithinDays === 'number' && params.atiComputedWithinDays > 0) {
      const computedRaw = (agent as any).atiComputedAt;
      const computedAt = typeof computedRaw === 'number' ? computedRaw : Number(computedRaw);
      if (!Number.isFinite(computedAt) || computedAt <= 0) {
        return false;
      }
      const nowSeconds = Math.floor(Date.now() / 1000);
      const windowSeconds = Math.floor(params.atiComputedWithinDays * 24 * 60 * 60);
      const threshold = nowSeconds - windowSeconds;
      if (computedAt < threshold) {
        return false;
      }
    }

    return true;
  }

  /**
   * Admin API for agent management
   * These methods require AdminApp to be initialized
   * Note: createAgent is now available directly on agents (not agents.admin)
   */
  admin = {
    /**
     * Prepare low-level contract calls to update an agent's token URI and/or
     * on-chain metadata. These calls can be executed client-side via a bundler
         * or wallet, similar to createAgentWithSmartAccountOwnerUsingWallet.
     */
    prepareUpdateAgent: async (params: {
      agentId: bigint | string;
      tokenUri?: string;
      metadata?: Array<{ key: string; value: string }>;
      chainId?: number;
    }): Promise<{
      chainId: number;
      identityRegistry: `0x${string}`;
      bundlerUrl: string;
      calls: Array<{ to: `0x${string}`; data: `0x${string}`; value?: bigint }>;
    }> => {
      const chainId = params.chainId || DEFAULT_CHAIN_ID;

      const identityRegistry = requireChainEnvVar(
        'AGENTIC_TRUST_IDENTITY_REGISTRY',
        chainId,
      );
      const identityRegistryHex = identityRegistry.startsWith('0x')
        ? (identityRegistry as `0x${string}`)
        : (`0x${identityRegistry}` as `0x${string}`);

      const agentId = BigInt(params.agentId);
      const calls: Array<{ to: `0x${string}`; data: `0x${string}`; value?: bigint }> = [];

      // Token URI update call
      if (params.tokenUri !== undefined) {
        const data = encodeFunctionData({
          abi: identityRegistryAbi as any,
          // Updated ABI name is setAgentURI (capital URI)
          functionName: 'setAgentURI',
          args: [agentId, params.tokenUri],
        });
        calls.push({
          to: identityRegistryHex,
          data: data as `0x${string}`,
          value: 0n,
        });
      }

      // Metadata update calls
      if (params.metadata && params.metadata.length > 0) {
        const encoder = new TextEncoder();
        for (const entry of params.metadata) {
          const valueBytes = encoder.encode(entry.value);
          const data = encodeFunctionData({
            abi: identityRegistryAbi as any,
            functionName: 'setMetadata',
            args: [agentId, entry.key, valueBytes],
          });
          calls.push({
            to: identityRegistryHex,
            data: data as `0x${string}`,
            value: 0n,
          });
        }
      }

      if (calls.length === 0) {
        throw new Error('No updates provided. Specify tokenUri and/or metadata.');
      }

      const bundlerUrl = getChainBundlerUrl(chainId);

      return {
        chainId,
        identityRegistry: identityRegistryHex,
        bundlerUrl,
        calls,
      };
    },


    /**
     * Prepare a create agent transaction for client-side signing
     * Returns transaction data that can be signed and submitted by the client
     */
    prepareCreateAgentTransaction: async (params: {
      agentName: string;
      agentAccount: `0x${string}`;
      agentCategory?: string;
      description?: string;
      image?: string;
      agentUrl?: string;
      supportedTrust?: string[];
      endpoints?: Array<{
        name: string;
        endpoint: string;
        version?: string;
        capabilities?: Record<string, any>;
        a2aSkills?: string[];
        a2aDomains?: string[];
        mcpSkills?: string[];
        mcpDomains?: string[];
      }>;
      chainId?: number;
    }): Promise<{
      requiresClientSigning: true;
      transaction: {
        to: `0x${string}`;
        data: `0x${string}`;
        value: string;
        gas?: string;
        gasPrice?: string;
        maxFeePerGas?: string;
        maxPriorityFeePerGas?: string;
        nonce?: number;
        chainId: number;
      };
      tokenUri: string;
      metadata: Array<{ key: string; value: string }>;
    }> => {
      const chainId = params.chainId || DEFAULT_CHAIN_ID;
      const adminApp = await getAdminApp(undefined, chainId);
      if (!adminApp) {
        throw new Error(
          'AdminApp not initialized. Ensure AGENTIC_TRUST_APP_ROLES includes "admin" and connect via wallet'
        );
      }

      if (adminApp.hasPrivateKey) {
        throw new Error('prepareCreateAgentTransaction should only be used when no private key is available');
      }

      const identityRegistry = requireChainEnvVar('AGENTIC_TRUST_IDENTITY_REGISTRY', chainId);

      const identityRegistryHex = identityRegistry.startsWith('0x') 
        ? identityRegistry 
        : `0x${identityRegistry}`;

      // Create read-only IdentityClient using AdminApp's AccountProvider
      const identityClient = new BaseIdentityClient(
        adminApp.accountProvider,
        identityRegistryHex as `0x${string}`
      );

      // Build metadata array
      const metadata = [
        { key: 'agentName', value: params.agentName ? String(params.agentName) : '' },
        { key: 'agentAccount', value: params.agentAccount ? String(params.agentAccount) : '' },
        ...(params.agentCategory ? [{ key: 'agentCategory', value: String(params.agentCategory) }] : []),
        { key: 'registeredBy', value: 'agentic-trust' },
        { key: 'registryNamespace', value: 'erc-8004' },
      ].filter(m => m.value !== '');

      // Create registration JSON and upload to IPFS
      let tokenUri = '';
      
      try {
        const registrationJSON = createRegistrationJSON({
          name: params.agentName,
          agentAccount: params.agentAccount,
          description: params.description,
          image: params.image,
          agentUrl: params.agentUrl,
          chainId,
          identityRegistry: identityRegistryHex as `0x${string}`,
          supportedTrust: params.supportedTrust,
          endpoints: params.endpoints
        });
        
        const uploadResult = await uploadRegistration(registrationJSON);
        tokenUri = uploadResult.tokenUri;
      } catch (error) {
        console.error('Failed to upload registration JSON to IPFS:', error);
        throw new Error(`Failed to create registration JSON: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

      // Get chain-specific RPC URL
      const rpcUrl = getChainRpcUrl(chainId);

      // Encode the transaction data
      const aiIdentityClient = new AIAgentIdentityClient({
        chainId,
        rpcUrl,
        identityRegistryAddress: identityRegistryHex as `0x${string}`,
      });

      // Encode registerWithMetadata function call
      const encodedData = await aiIdentityClient.encodeRegisterWithMetadata(tokenUri, metadata);

      // Simulate transaction to get gas estimates
      let gasEstimate: bigint | undefined;
      let gasPrice: bigint | undefined;
      let maxFeePerGas: bigint | undefined;
      let maxPriorityFeePerGas: bigint | undefined;
      let nonce: number | undefined;

      try {
        // Get current gas prices
        const [gasPriceData, blockData] = await Promise.all([
          adminApp.publicClient.getGasPrice(),
          adminApp.publicClient.getBlock({ blockTag: 'latest' }),
        ]);

        gasPrice = gasPriceData;
        
        // Try EIP-1559 gas prices if available
        if (blockData && 'baseFeePerGas' in blockData && blockData.baseFeePerGas) {
          maxFeePerGas = (blockData.baseFeePerGas * 2n) / 10n; // 2x base fee
          maxPriorityFeePerGas = blockData.baseFeePerGas / 10n; // 10% of base fee
        }

        // Estimate gas
        gasEstimate = await adminApp.publicClient.estimateGas({
          account: adminApp.address,
          to: identityRegistryHex as `0x${string}`,
          data: encodedData as `0x${string}`,
        });

        // Get nonce
        nonce = await adminApp.publicClient.getTransactionCount({
          address: adminApp.address,
          blockTag: 'pending',
        });
      } catch (error) {
        console.warn('Could not estimate gas or get transaction parameters:', error);
        // Continue without gas estimates - client can estimate
      }

      return {
        requiresClientSigning: true,
        transaction: {
          to: identityRegistryHex as `0x${string}`,
          data: encodedData as `0x${string}`,
          value: '0',
          gas: gasEstimate ? gasEstimate.toString() : undefined,
          gasPrice: gasPrice ? gasPrice.toString() : undefined,
          maxFeePerGas: maxFeePerGas ? maxFeePerGas.toString() : undefined,
          maxPriorityFeePerGas: maxPriorityFeePerGas ? maxPriorityFeePerGas.toString() : undefined,
          nonce,
          chainId,
        },
        tokenUri,
        metadata: metadata.map(m => ({ key: m.key, value: m.value })),
      };
    },

    /**
     * Update an agent's token URI
     * @param agentId - The agent ID to update
     * @param tokenUri - New token URI
     * @returns Transaction hash
     */
    /**
     * Server-side helper that actually sends the prepared update calls using
     * AdminApp's AccountProvider. For browser/bundler flows, prefer
     * prepareUpdateAgent instead.
     */
    updateAgent: async (params: {
      agentId: bigint | string;
      tokenUri?: string;
      metadata?: Array<{ key: string; value: string }>;
      chainId?: number;
    }): Promise<{ txHash: string }> => {
      const chainId = params.chainId || DEFAULT_CHAIN_ID;
      const adminApp = await getAdminApp(undefined, chainId);

      if (!adminApp) {
        throw new Error(
          'AdminApp not initialized. Ensure AGENTIC_TRUST_APP_ROLES includes "admin" and AGENTIC_TRUST_ADMIN_PRIVATE_KEY is set',
        );
      }

      const prepared = await this.admin.prepareUpdateAgent({
        agentId: params.agentId,
        tokenUri: params.tokenUri,
        metadata: params.metadata,
        chainId,
      });

      const results: Array<{ txHash: string }> = [];
      for (const call of prepared.calls) {
        const tx = await adminApp.accountProvider.send({
          to: call.to,
          data: call.data,
          value: call.value ?? 0n,
        });
        results.push({ txHash: tx.hash });
      }

      if (results.length === 0) {
        throw new Error('No updates provided. Specify tokenUri and/or metadata.');
      }

      const lastResult = results[results.length - 1];
      if (!lastResult) {
        throw new Error('Failed to get transaction hash from update operation');
      }
      return { txHash: lastResult.txHash };
    },

    updateAgentByDid: async (
      agentDid: string,
      params: {
        tokenUri?: string;
        metadata?: Array<{ key: string; value: string }>;
        chainId?: number;
      } = {},
    ): Promise<{ txHash: string }> => {
      const { agentId, chainId } = parseDid8004(agentDid);
      return this.admin.updateAgent({
        agentId,
        chainId: params.chainId ?? chainId,
        tokenUri: params.tokenUri,
        metadata: params.metadata,
      });
    },

    /**
     * Delete an agent by transferring it to the zero address (burn)
     * Note: This requires the contract to support transfers to address(0)
     * @param agentId - The agent ID to delete
     * @returns Transaction hash
     */
    deleteAgent: async (params: {
      agentId: bigint | string;
      chainId?: number;
    }): Promise<{ txHash: string }> => {
      const chainId = params.chainId || DEFAULT_CHAIN_ID;
      const adminApp = await getAdminApp(undefined, chainId);

      if (!adminApp) {
        throw new Error(
          'AdminApp not initialized. Ensure AGENTIC_TRUST_APP_ROLES includes "admin" and AGENTIC_TRUST_ADMIN_PRIVATE_KEY is set'
        );
      }

      const identityRegistry = requireChainEnvVar('AGENTIC_TRUST_IDENTITY_REGISTRY', chainId);

      // Import IdentityRegistry ABI for transferFrom
      const IdentityRegistryABI = identityRegistryAbi;
      
      const agentId = BigInt(params.agentId);
      const from = adminApp.address;
      const to = '0x0000000000000000000000000000000000000000' as `0x${string}`;

      // Transfer to zero address (burn)
      const data = await adminApp.accountProvider.encodeFunctionData({
        abi: IdentityRegistryABI,
        functionName: 'transferFrom',
        args: [from, to, agentId],
      });

      const result = await adminApp.accountProvider.send({
        to: identityRegistry as `0x${string}`,
        data,
        value: 0n,
      });

      return { txHash: result.hash };
    },

    deleteAgentByDid: async (
      agentDid: string,
      options: { chainId?: number } = {},
    ): Promise<{ txHash: string }> => {
      const { agentId, chainId } = parseDid8004(agentDid);
      return this.admin.deleteAgent({
        agentId,
        chainId: options.chainId ?? chainId,
      });
    },

    /**
     * Transfer an agent to a new owner
     * @param agentId - The agent ID to transfer
     * @param to - The new owner address
     * @returns Transaction hash
     */
    transferAgent: async (params: {
      agentId: bigint | string;
      to: `0x${string}`;
      chainId?: number;
    }): Promise<{ txHash: string }> => {
      const chainId = params.chainId || DEFAULT_CHAIN_ID;
      const adminApp = await getAdminApp(undefined, chainId);

      if (!adminApp) {
        throw new Error(
          'AdminApp not initialized. Ensure AGENTIC_TRUST_APP_ROLES includes "admin" and AGENTIC_TRUST_ADMIN_PRIVATE_KEY is set'
        );
      }

      const identityRegistry = requireChainEnvVar('AGENTIC_TRUST_IDENTITY_REGISTRY', chainId);

      // Import IdentityRegistry ABI for transferFrom
      const IdentityRegistryABI = identityRegistryAbi;
      
      const agentId = BigInt(params.agentId);
      const from = adminApp.address;

      // Transfer to new owner
      const data = await adminApp.accountProvider.encodeFunctionData({
        abi: IdentityRegistryABI,
        functionName: 'transferFrom',
        args: [from, params.to, agentId],
      });

      const result = await adminApp.accountProvider.send({
        to: identityRegistry as `0x${string}`,
        data,
        value: 0n,
      });

      return { txHash: result.hash };
    },

    transferAgentByDid: async (
      fromDid: string,
      toDid: string,
    ): Promise<{ txHash: string }> => {
      const { agentId, chainId } = parseDid8004(fromDid);

      // For now we support toDid as did:ethr:... and derive the destination
      // account from it. Other DID methods can be added later as needed.
      if (!toDid.startsWith('did:ethr:')) {
        throw new Error(
          `Unsupported toDid format for transferAgentByDid: ${toDid}. Expected did:ethr:...`,
        );
      }

      const { account } = parseEthrDid(toDid);

      return this.admin.transferAgent({
        agentId,
        chainId,
        to: account,
      });
    },
  };
}

