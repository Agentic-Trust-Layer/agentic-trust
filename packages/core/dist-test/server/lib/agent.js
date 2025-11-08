/**
 * Agent class
 *
 * Represents a discovered agent with protocol support (A2A, MCP, etc.)
 * Abstracts protocol details so clients can interact with agents without
 * knowing the underlying protocol implementation.
 */
import { A2AProtocolProvider } from './a2aProtocolProvider';
import { createFeedbackAuth } from './agentFeedback';
import { getProviderApp } from '../userApps/providerApp';
/**
 * Agent class - represents a discovered agent with protocol support
 */
export class Agent {
    data;
    client;
    a2aProvider = null;
    agentCard = null;
    endpoint = null;
    initialized = false;
    constructor(data, client) {
        this.data = data;
        this.client = client;
        // Auto-initialize if agent has an a2aEndpoint
        if (this.data.a2aEndpoint) {
            this.initialize();
        }
    }
    /**
     * Get agent ID
     */
    get agentId() {
        const { agentId } = this.data;
        if (typeof agentId === 'number') {
            return agentId;
        }
        if (typeof agentId === 'string') {
            const parsed = Number(agentId);
            return Number.isFinite(parsed) ? parsed : undefined;
        }
        return undefined;
    }
    /**
     * Get agent name
     */
    get agentName() {
        return this.data.agentName;
    }
    /**
     * Get A2A endpoint URL
     */
    get a2aEndpoint() {
        return typeof this.data.a2aEndpoint === 'string'
            ? this.data.a2aEndpoint
            : undefined;
    }
    initialize() {
        if (this.initialized) {
            return;
        }
        if (!this.data.a2aEndpoint) {
            return; // No endpoint, agent cannot be initialized
        }
        // Get Veramo agent from the client
        const veramoAgent = this.client.veramo.getAgent();
        // Create A2A Protocol Provider for this agent
        // This does NOT fetch the agent card - card is fetched lazily when needed
        this.a2aProvider = new A2AProtocolProvider(this.data.a2aEndpoint, veramoAgent);
        this.initialized = true;
    }
    isInitialized() {
        return this.initialized;
    }
    async fetchCard() {
        if (!this.a2aProvider) {
            throw new Error('Agent not initialized. Call initialize(client) first.');
        }
        // Lazy load: only fetch if not already cached
        if (!this.agentCard) {
            this.agentCard = await this.a2aProvider.fetchAgentCard();
        }
        return this.agentCard;
    }
    getCard() {
        return this.agentCard;
    }
    async getSkills() {
        const card = await this.fetchCard(); // Lazy load
        return card?.skills || [];
    }
    async getCapabilities() {
        const card = await this.fetchCard(); // Lazy load
        return card?.capabilities || null;
    }
    async supportsProtocol() {
        if (!this.a2aProvider) {
            return false;
        }
        const card = await this.fetchCard();
        return card !== null &&
            card.skills !== undefined &&
            card.skills.length > 0 &&
            card.url !== undefined;
    }
    async getEndpoint() {
        if (!this.a2aProvider) {
            throw new Error('Agent not initialized. Call initialize(client) first.');
        }
        if (!this.endpoint) {
            const endpointInfo = await this.a2aProvider.getA2AEndpoint();
            if (endpointInfo) {
                this.endpoint = {
                    providerId: endpointInfo.providerId,
                    endpoint: endpointInfo.endpoint,
                    method: endpointInfo.method,
                };
            }
        }
        return this.endpoint;
    }
    /**
     * Send a message to the agent
     */
    async sendMessage(request) {
        if (!this.a2aProvider) {
            throw new Error('Agent not initialized. Call initialize(client) first.');
        }
        // Check if agent has a valid A2A endpoint
        if (!this.data.a2aEndpoint) {
            throw new Error('Agent does not have an A2A endpoint configured. ' +
                'The agent must have a valid A2A endpoint URL to receive messages.');
        }
        // Build A2A request format
        const endpointInfo = await this.getEndpoint();
        if (!endpointInfo) {
            throw new Error('Agent endpoint not available');
        }
        const a2aRequest = {
            fromAgentId: 'client',
            toAgentId: endpointInfo.providerId,
            message: request.message,
            payload: request.payload,
            metadata: request.metadata,
            skillId: request.skillId,
        };
        const response = await this.a2aProvider.sendMessage(a2aRequest);
        return response;
    }
    /**
     * Verify the agent by sending an authentication challenge
     * Creates a signed challenge and sends it to the agent's endpoint
     * This will force a fresh authentication challenge even if already authenticated
     * @returns true if verification passed, false otherwise
     */
    async verify() {
        if (!this.a2aProvider) {
            throw new Error('Agent not initialized. Call initialize(client) first.');
        }
        try {
            // Get endpoint info
            const endpointInfo = await this.getEndpoint();
            if (!endpointInfo) {
                throw new Error('Agent endpoint not available');
            }
            // Get agent card to determine audience for challenge
            const agentCard = await this.fetchCard();
            if (!agentCard?.provider?.url) {
                throw new Error('Agent card URL is required for verification');
            }
            // Reset authentication state to force a fresh challenge
            // Access the private authenticated flag via type assertion
            this.a2aProvider.authenticated = false;
            // Create a signed challenge using the A2A protocol provider
            // We'll send a minimal message with auth to test verification
            const a2aRequest = {
                fromAgentId: 'client',
                toAgentId: endpointInfo.providerId,
                message: 'verify', // Minimal message for verification
                payload: {},
            };
            // The sendMessage will automatically create and include auth challenge
            // since we reset authenticated to false
            const response = await this.a2aProvider.sendMessage(a2aRequest);
            // If the response is successful and doesn't contain authentication errors,
            // verification passed
            if (response.success === false) {
                // Check if it's an authentication error
                if (response.error?.includes('authentication') ||
                    response.error?.includes('Authentication failed')) {
                    return false;
                }
                // Other errors might be acceptable (e.g., agent doesn't understand the message)
                // but verification itself passed if no auth error
                return true;
            }
            // Success response means verification passed
            return true;
        }
        catch (error) {
            // If error contains authentication failure, verification failed
            const errorMessage = error instanceof Error ? error.message : String(error);
            if (errorMessage.includes('authentication') ||
                errorMessage.includes('Authentication failed')) {
                return false;
            }
            // Other errors might indicate verification failed
            console.error('Verification error:', error);
            return false;
        }
    }
    /**
     * Feedback API
     */
    feedback = {
        requestAuth: async (params) => {
            const providerApp = await getProviderApp();
            if (!providerApp) {
                throw new Error('provider app not initialized');
            }
            const clientAddress = params.clientAddress;
            console.info("----------> clientAddress inside agent.ts -----> ", clientAddress);
            // Use agentId from params, stored agentId, or provider app
            const agentId = params.agentId
                ? BigInt(params.agentId)
                : (this.data.agentId ? BigInt(this.data.agentId) : providerApp.agentId);
            // Get reputation client singleton
            const { getReputationClient } = await import('../singletons/reputationClient');
            const reputationClient = await getReputationClient();
            // Create feedback auth using provider app's wallet client
            const feedbackAuth = await createFeedbackAuth({
                publicClient: providerApp.publicClient,
                agentId,
                clientAddress,
                signer: providerApp.agentAccount,
                walletClient: providerApp.walletClient,
                expirySeconds: params.expirySeconds
            }, reputationClient);
            return {
                feedbackAuth,
                agentId: agentId.toString(),
                clientAddress,
                skill: params.skillId || 'agent.feedback.requestAuth',
            };
        },
        /**
         * Submit client feedback to the reputation contract
         * @param params - Feedback parameters including score, feedback, feedbackAuth, etc.
         * @returns Transaction result with txHash
         * @throws Error if reputation client is not initialized
         */
        giveFeedback: async (params) => {
            const { getReputationClient } = await import('../singletons/reputationClient');
            const { getClientApp } = await import('../userApps/clientApp');
            const reputationClient = await getReputationClient();
            const clientApp = await getClientApp();
            // Use the agentId from the agent data if not provided
            const agentId = params.agentId ?? (this.data.agentId ? this.data.agentId.toString() : undefined);
            if (!agentId) {
                throw new Error('agentId is required. Provide it in params or ensure agent has agentId in data.');
            }
            // Build the full feedback params (without clientAddress as it's not in the type)
            const feedbackParams = {
                ...params,
                agent: agentId,
                agentId,
            };
            return await reputationClient.giveClientFeedback(feedbackParams);
        },
    };
}
//# sourceMappingURL=agent.js.map