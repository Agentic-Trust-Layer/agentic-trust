/**
 * Agents API for AgenticTrust Client
 */

import {
  AIAgentIdentityClient,
  type AgentData,
  type GiveFeedbackParams,
} from '@erc8004/agentic-trust-sdk';
import {
  ViemAccountProvider,
  BaseIdentityClient,
} from '@erc8004/sdk';
import { Agent } from './agent';
import type { AgenticTrustClient } from './index';
import { A2AProtocolProvider } from './a2aProtocolProvider';
import type { AgentCard, AgentSkill, AgentCapabilities } from './agentCard';
import { createFeedbackAuth, type RequestAuthParams } from './agentFeedback';
import { getDiscoveryClient } from '../server/singletons/discoveryClient';
import { sepolia, baseSepolia, optimismSepolia } from 'viem/chains';
import { uploadRegistration, createRegistrationJSON } from './registration';
import { createPublicClient, http } from 'viem';
import {
  sendSponsoredUserOperation,
  waitForUserOperationReceipt,
  deploySmartAccountIfNeeded,
  isSmartContract,
} from './bundlerUtils';
import { getAdminApp } from '../server/userApps/adminApp';
import IdentityRegistryABIJson from '@erc8004/agentic-trust-sdk/abis/IdentityRegistry.json';

const identityRegistryAbi: any = (IdentityRegistryABIJson as any).default ?? IdentityRegistryABIJson;

// Re-export AgentData for compatibility
export type { AgentData };

export interface ListAgentsResponse {
  agents: Agent[];
  total: number;
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
  async listAgents(): Promise<ListAgentsResponse> {
    const graphQLClient = await getDiscoveryClient();
    const allAgents = await graphQLClient.listAgents();

    // Sort all agents by agentId in descending order
    const sortedAgents = allAgents.sort((a: AgentData, b: AgentData) => {
      // Sort by agentId in descending order (highest first)
      const idA = typeof a.agentId === 'number' ? a.agentId : Number(a.agentId) || 0;
      const idB = typeof b.agentId === 'number' ? b.agentId : Number(b.agentId) || 0;
      return idB - idA;
    });

    // Debug: Log the response data
    if (typeof window !== 'undefined') {
      console.log('[listAgents] total agents 123:', sortedAgents.length);
    }

    // Convert AgentData to Agent instances
    const agentInstances = sortedAgents.map((data: AgentData) => new Agent(data, this.client));

    return {
      agents: agentInstances,
      total: agentInstances.length,
    };
  }

  /**
   * Get a single agent by ID
   * @param agentId - The agent ID as a string
   * @param chainId - Optional chain ID (defaults to 11155111 for Sepolia)
   */
  async getAgent(agentId: string, chainId: number = 11155111): Promise<Agent | null> {
    const graphQLClient = await getDiscoveryClient();
    const agentData = await graphQLClient.getAgent(chainId, agentId);
    
    if (!agentData) {
      return null;
    }
    
    return new Agent(agentData, this.client);
  }

  /**
   * Get raw agent data from GraphQL (for internal use)
   * Returns the raw AgentData from the GraphQL indexer
   */
  async getAgentFromGraphQL(chainId: number, agentId: string): Promise<AgentData | null> {
    const graphQLClient = await getDiscoveryClient();
    return await graphQLClient.getAgent(chainId, agentId);
  }

  /**
   * Refresh/Index an agent in the GraphQL indexer
   * Triggers the indexer to re-index the specified agent
   * @param agentId - Agent ID to refresh (required)
   * @param chainId - Optional chain ID (defaults to 11155111 for Sepolia)
   */
  async refreshAgent(agentId: string, chainId: number = 11155111): Promise<any> {
    const graphQLClient = await getDiscoveryClient();
    return await graphQLClient.refreshAgent(agentId, chainId);
  }

  /**
   * Create a new agent
   * Requires AdminApp to be initialized (server-side)
   * @param params - Agent creation parameters
   * @returns Created agent ID and transaction hash, or prepared transaction for client-side signing
   */
  async createAgent(params: {
    agentName: string;
    agentAccount: `0x${string}`;
    description?: string;
    image?: string;
    agentUrl?: string;
    supportedTrust?: string[];
    endpoints?: Array<{
      name: string;
      endpoint: string;
      version?: string;
      capabilities?: Record<string, any>;
    }>;
    // Account Abstraction options
    useAA?: boolean; // If true, use bundler for AA account
    agentAccountClient?: any; // AA account client (required if useAA is true)
    bundlerUrl?: string; // Bundler URL (required if useAA is true)
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
        tokenURI: string;
        metadata: Array<{ key: string; value: string }>;
      }
  > {
    const adminApp = await getAdminApp();
    if (!adminApp) {
      throw new Error('AdminApp not initialized. Set AGENTIC_TRUST_IS_ADMIN_APP=true and provide either AGENTIC_TRUST_ADMIN_PRIVATE_KEY or connect via wallet');
    }
    
    // If no private key, prepare transaction for client-side signing
    if (!adminApp.hasPrivateKey) {
      // Prepare transaction for client-side signing
      const identityRegistry = process.env.AGENTIC_TRUST_IDENTITY_REGISTRY;
      if (!identityRegistry || typeof identityRegistry !== 'string') {
        throw new Error('Missing required environment variable: AGENTIC_TRUST_IDENTITY_REGISTRY');
      }

      const identityRegistryHex = identityRegistry.startsWith('0x') 
        ? identityRegistry 
        : `0x${identityRegistry}`;

      // Build metadata array
      const metadata = [
        { key: 'agentName', value: params.agentName ? String(params.agentName) : '' },
        { key: 'agentAccount', value: params.agentAccount ? String(params.agentAccount) : '' },
      ].filter(m => m.value !== '');

      // Create registration JSON and upload to IPFS
      let tokenURI = '';
      const sepoliaChain = sepolia;
      const chainId: number = sepoliaChain.id;
      
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
        });
        
        const uploadResult = await uploadRegistration(registrationJSON);
        tokenURI = uploadResult.tokenURI;
      } catch (error) {
        console.error('Failed to upload registration JSON to IPFS:', error);
        throw new Error(`Failed to create registration JSON: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

      // Prepare transaction using AIAgentIdentityClient (all Ethereum logic server-side)
      
      // Get chain by ID
      let chain: typeof sepoliaChain | typeof baseSepolia | typeof optimismSepolia = sepoliaChain;
      const baseSepoliaChainId = 84532;
      const optimismSepoliaChainId = 11155420;
      if (chainId === baseSepoliaChainId) {
        chain = baseSepolia;
      } else if (chainId === optimismSepoliaChainId) {
        chain = optimismSepolia;
      }
      
      const publicClient = createPublicClient({
        chain: chain as any,
        transport: http(process.env.AGENTIC_TRUST_RPC_URL || ''),
      });

      const accountProvider = new ViemAccountProvider({
        publicClient: publicClient as any,
        walletClient: null, // Read-only for transaction preparation
        chainConfig: {
          id: chainId,
          rpcUrl: process.env.AGENTIC_TRUST_RPC_URL || '',
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
        tokenURI,
        metadata,
        adminApp.address // Only address needed - no publicClient passed
      );

      return {
        requiresClientSigning: true,
        transaction,
        tokenURI,
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
    
    const identityRegistry = process.env.AGENTIC_TRUST_IDENTITY_REGISTRY;
    if (!identityRegistry || typeof identityRegistry !== 'string') {
      throw new Error('Missing required environment variable: AGENTIC_TRUST_IDENTITY_REGISTRY');
    }
    
    // Ensure identityRegistry is a valid hex string
    const identityRegistryHex = identityRegistry.startsWith('0x') 
      ? identityRegistry 
      : `0x${identityRegistry}`;

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
    ].filter(m => m.value !== ''); // Remove empty values

    // Always create registration JSON and upload to IPFS
    let tokenURI = '';
    // Get chain ID (default to Sepolia)
    const chainId: number = sepolia.id;
    
    try {
      // Import registration utilities
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
      });
      
      // Upload to IPFS and get tokenURI
      const uploadResult = await uploadRegistration(registrationJSON);
      tokenURI = uploadResult.tokenURI;
    } catch (error) {
      console.error('Failed to upload registration JSON to IPFS:', error);
      throw new Error(`Failed to create registration JSON: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Check if we should use Account Abstraction (bundler) mode
    const useAA = params.useAA ?? false;
    let isAAAccount = false;
    
    if (useAA) {
      // If useAA is explicitly set, check if we have required parameters
      if (!params.agentAccountClient) {
        throw new Error('agentAccountClient is required when useAA is true');
      }
      if (!params.bundlerUrl) {
        const bundlerUrl = process.env.AGENTIC_TRUST_BUNDLER_URL;
        if (!bundlerUrl) {
          throw new Error('bundlerUrl is required when useAA is true. Provide it in params or set AGENTIC_TRUST_BUNDLER_URL');
        }
        params.bundlerUrl = bundlerUrl;
      }
      isAAAccount = true;
    } else {
      // Auto-detect if agentAccount is a smart contract
      try {
        const isSmart = await isSmartContract(adminApp.publicClient, params.agentAccount);
        if (isSmart) {
          console.log(`⚠️ Agent account ${params.agentAccount} appears to be a smart contract. Consider using useAA: true with agentAccountClient and bundlerUrl for Account Abstraction support.`);
        }
      } catch (error) {
        console.warn('Could not check if agent account is a contract:', error);
      }
    }

    // Use bundler path for AA accounts
    if (isAAAccount && params.agentAccountClient && params.bundlerUrl) {
      const sepoliaChain = sepolia;
      
      // Get chain by ID
      let chain: typeof sepoliaChain | typeof baseSepolia | typeof optimismSepolia = sepoliaChain;
      const baseSepoliaChainId = 84532;
      const optimismSepoliaChainId = 11155420;
      if (chainId === baseSepoliaChainId) {
        chain = baseSepolia;
      } else if (chainId === optimismSepoliaChainId) {
        chain = optimismSepolia;
      }

      // Create AIAgentIdentityClient for preparing calls
      const publicClient = createPublicClient({
        chain: chain as any,
        transport: http(process.env.AGENTIC_TRUST_RPC_URL || ''),
      });

      const accountProvider = new ViemAccountProvider({
        publicClient: publicClient as any,
        walletClient: null, // Read-only for call preparation
        chainConfig: {
          id: chainId,
          rpcUrl: process.env.AGENTIC_TRUST_RPC_URL || '',
          name: chain.name,
          chain: chain as any,
        },
      });

      const aiIdentityClient = new AIAgentIdentityClient({
        accountProvider,
        identityRegistryAddress: identityRegistryHex as `0x${string}`,
      });

      // Deploy smart account if needed
      await deploySmartAccountIfNeeded({
        bundlerUrl: params.bundlerUrl,
        chain: chain as any,
        account: params.agentAccountClient,
      });

      // Prepare register calls
      const { calls: registerCalls } = await aiIdentityClient.prepareRegisterCalls(
        params.agentName,
        params.agentAccount,
        tokenURI
      );

      console.log('📦 Registering agent via Account Abstraction (bundler)...');

      // Send UserOperation via bundler
      const userOpHash = await sendSponsoredUserOperation({
        bundlerUrl: params.bundlerUrl,
        chain: chain as any,
        accountClient: params.agentAccountClient,
        calls: registerCalls,
      });

      console.log('✅ UserOperation sent:', userOpHash);

      // Wait for receipt
      const receipt = await waitForUserOperationReceipt({
        bundlerUrl: params.bundlerUrl,
        chain: chain as any,
        hash: userOpHash,
      });

      console.log('✅ UserOperation receipt:', receipt);

      // Extract agentId from receipt
      const agentId = aiIdentityClient.extractAgentIdFromReceiptPublic(receipt);

      // Refresh the agent in the GraphQL indexer
      try {
        const graphQLClient = await getDiscoveryClient();
        await graphQLClient.refreshAgent(agentId.toString(), chainId);
        console.log(`✅ Refreshed agent ${agentId} in GraphQL indexer`);
      } catch (refreshError) {
        console.warn(`⚠️ Failed to refresh agent ${agentId} in GraphQL indexer:`, refreshError);
      }

      return {
        agentId,
        txHash: userOpHash,
      };
    }

    // Use direct EOA transaction path (existing behavior)
    const result = await identityClient.registerWithMetadata(tokenURI, metadata);

    // Refresh the agent in the GraphQL indexer
    try {
      const graphQLClient = await getDiscoveryClient();
      // Use the same chainId that was used for registration
      await graphQLClient.refreshAgent(result.agentId.toString(), chainId);
      console.log(`✅ Refreshed agent ${result.agentId} in GraphQL indexer`);
    } catch (refreshError) {
      // Log error but don't fail agent creation if refresh fails
      console.warn(`⚠️ Failed to refresh agent ${result.agentId} in GraphQL indexer:`, refreshError);
    }

    return result;
  }

  /**
   * Search agents by name
   * @param query - Search query string to match against agent names
   * Fetches all matching agents using pagination if needed
   */
  async searchAgents(query: string): Promise<ListAgentsResponse> {
    const graphQLClient = await getDiscoveryClient();
    const allAgents = await graphQLClient.searchAgents(query);

    // Sort all agents by agentId in descending order
    const sortedAgents = allAgents.sort((a: AgentData, b: AgentData) => {
      // Sort by agentId in descending order (highest first)
      const idA = typeof a.agentId === 'number' ? a.agentId : Number(a.agentId) || 0;
      const idB = typeof b.agentId === 'number' ? b.agentId : Number(b.agentId) || 0;
      return idB - idA;
    });

    // Debug: Log the response data
    if (typeof window !== 'undefined') {
      console.log('[searchAgents] total matching agents:', sortedAgents.length);
    }

    // Convert AgentData to Agent instances
    const agentInstances = sortedAgents.map((data: AgentData) => new Agent(data, this.client));

    return {
      agents: agentInstances,
      total: agentInstances.length,
    };
  }

  /**
   * Admin API for agent management
   * These methods require AdminApp to be initialized
   * Note: createAgent is now available directly on agents (not agents.admin)
   */
  admin = {

    /**
     * Prepare a create agent transaction for client-side signing
     * Returns transaction data that can be signed and submitted by the client
     */
    prepareCreateAgentTransaction: async (params: {
      agentName: string;
      agentAccount: `0x${string}`;
      description?: string;
      image?: string;
      agentUrl?: string;
      supportedTrust?: string[];
      endpoints?: Array<{
        name: string;
        endpoint: string;
        version?: string;
        capabilities?: Record<string, any>;
      }>;
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
      tokenURI: string;
      metadata: Array<{ key: string; value: string }>;
    }> => {
      const adminApp = await getAdminApp();
      if (!adminApp) {
        throw new Error('AdminApp not initialized. Set AGENTIC_TRUST_IS_ADMIN_APP=true and connect via wallet');
      }

      if (adminApp.hasPrivateKey) {
        throw new Error('prepareCreateAgentTransaction should only be used when no private key is available');
      }

      const identityRegistry = process.env.AGENTIC_TRUST_IDENTITY_REGISTRY;
      if (!identityRegistry || typeof identityRegistry !== 'string') {
        throw new Error('Missing required environment variable: AGENTIC_TRUST_IDENTITY_REGISTRY');
      }

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
      ].filter(m => m.value !== '');

      // Create registration JSON and upload to IPFS
      let tokenURI = '';
      const chainId = sepolia.id;
      
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
        });
        
        const uploadResult = await uploadRegistration(registrationJSON);
        tokenURI = uploadResult.tokenURI;
      } catch (error) {
        console.error('Failed to upload registration JSON to IPFS:', error);
        throw new Error(`Failed to create registration JSON: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

      // Encode the transaction data
      const aiIdentityClient = new AIAgentIdentityClient({
        chainId,
        rpcUrl: process.env.AGENTIC_TRUST_RPC_URL || '',
        identityRegistryAddress: identityRegistryHex as `0x${string}`,
      });

      // Encode registerWithMetadata function call
      const encodedData = await aiIdentityClient.encodeRegisterWithMetadata(tokenURI, metadata);

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
        tokenURI,
        metadata: metadata.map(m => ({ key: m.key, value: m.value })),
      };
    },

    /**
     * Update an agent's token URI
     * @param agentId - The agent ID to update
     * @param tokenURI - New token URI
     * @returns Transaction hash
     */
    updateAgent: async (params: {
      agentId: bigint | string;
      tokenURI?: string;
      metadata?: Array<{ key: string; value: string }>;
    }): Promise<{ txHash: string }> => {
      const adminApp = await getAdminApp();


      if (!adminApp) {
        throw new Error('AdminApp not initialized. Set AGENTIC_TRUST_IS_ADMIN_APP=true and AGENTIC_TRUST_ADMIN_PRIVATE_KEY');
      }

      const identityRegistry = process.env.AGENTIC_TRUST_IDENTITY_REGISTRY;
      if (!identityRegistry) {
        throw new Error('Missing required environment variable: AGENTIC_TRUST_IDENTITY_REGISTRY');
      }

      // Create write-capable IdentityClient using AdminApp AccountProvider
      const identityClient = new BaseIdentityClient(
        adminApp.accountProvider,
        identityRegistry as `0x${string}`
      );

      const agentId = BigInt(params.agentId);
      const results: Array<{ txHash: string }> = [];

      // Update token URI if provided
      if (params.tokenURI !== undefined) {
        const uriResult = await identityClient.setAgentUri(agentId, params.tokenURI);
        results.push(uriResult);
      }

      // Update metadata if provided
      if (params.metadata && params.metadata.length > 0) {
        for (const entry of params.metadata) {
          const metadataResult = await identityClient.setMetadata(agentId, entry.key, entry.value);
          results.push(metadataResult);
        }
      }

      if (results.length === 0) {
        throw new Error('No updates provided. Specify tokenURI and/or metadata.');
      }

      // Return the last transaction hash (most recent update)
      const lastResult = results[results.length - 1];
      if (!lastResult) {
        throw new Error('Failed to get transaction hash from update operation');
      }
      return { txHash: lastResult.txHash };
    },

    /**
     * Delete an agent by transferring it to the zero address (burn)
     * Note: This requires the contract to support transfers to address(0)
     * @param agentId - The agent ID to delete
     * @returns Transaction hash
     */
    deleteAgent: async (params: {
      agentId: bigint | string;
    }): Promise<{ txHash: string }> => {
      const adminApp = await getAdminApp();

      if (!adminApp) {
        throw new Error('AdminApp not initialized. Set AGENTIC_TRUST_IS_ADMIN_APP=true and AGENTIC_TRUST_ADMIN_PRIVATE_KEY');
      }

      const identityRegistry = process.env.AGENTIC_TRUST_IDENTITY_REGISTRY;
      if (!identityRegistry) {
        throw new Error('Missing required environment variable: AGENTIC_TRUST_IDENTITY_REGISTRY');
      }

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

    /**
     * Transfer an agent to a new owner
     * @param agentId - The agent ID to transfer
     * @param to - The new owner address
     * @returns Transaction hash
     */
    transferAgent: async (params: {
      agentId: bigint | string;
      to: `0x${string}`;
    }): Promise<{ txHash: string }> => {
      const adminApp = await getAdminApp();

      if (!adminApp) {
        throw new Error('AdminApp not initialized. Set AGENTIC_TRUST_IS_ADMIN_APP=true and AGENTIC_TRUST_ADMIN_PRIVATE_KEY');
      }

      const identityRegistry = process.env.AGENTIC_TRUST_IDENTITY_REGISTRY;
      if (!identityRegistry) {
        throw new Error('Missing required environment variable: AGENTIC_TRUST_IDENTITY_REGISTRY');
      }

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
  };
}

