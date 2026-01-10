/**
 * Veramo Agent integration for AgenticTrustClient
 */
import { verifyMessage } from 'viem';
/**
 * Check if we're running in Cloudflare Workers
 * This check must happen at runtime, not module load time
 */
function isCloudflareWorkers() {
    // Check for Workers-specific globals that exist at runtime
    if (typeof globalThis !== 'undefined') {
        // Workers have these globals
        if (typeof globalThis.caches !== 'undefined') {
            return true;
        }
        // Workers environment binding
        if (typeof globalThis.env !== 'undefined') {
            return true;
        }
    }
    // Workers don't have Node.js process
    if (typeof process === 'undefined') {
        return true;
    }
    // If we have process but no node version, might be Workers
    if (typeof process !== 'undefined' && !process.versions?.node) {
        return true;
    }
    return false;
}
/**
 * Nonce store for replay protection (singleton)
 *
 * In Cloudflare Workers, we don't use setInterval because:
 * 1. It's not allowed at module load time
 * 2. Workers have request isolation, so nonces won't persist across requests anyway
 */
class NonceStore {
    nonces = null;
    cleanupInterval = null; // Use 'any' to avoid NodeJS.Timeout type issues in Workers
    cleanupInitialized = false;
    isWorkers;
    constructor() {
        // Check if we're in Workers at construction time (but don't do anything with it yet)
        // This check is safe because it's just reading globals, not calling disallowed functions
        this.isWorkers = isCloudflareWorkers();
    }
    /**
     * Get or create the nonces Set (lazy initialization)
     */
    getNonces() {
        if (!this.nonces) {
            this.nonces = new Set();
        }
        return this.nonces;
    }
    /**
     * Initialize cleanup interval (only in Node.js, never in Workers)
     * Called lazily when first needed, not in constructor
     */
    initializeCleanup() {
        if (this.cleanupInitialized)
            return;
        this.cleanupInitialized = true;
        // In Workers, never initialize cleanup - just return
        if (this.isWorkers) {
            return;
        }
        // Only in Node.js: try to set up cleanup interval
        // Use dynamic access to setInterval to avoid Workers detecting it
        try {
            const setIntervalFn = globalThis.setInterval || global.setInterval;
            if (typeof setIntervalFn === 'function') {
                // Clean up old nonces every 10 minutes (only in Node.js)
                this.cleanupInterval = setIntervalFn(() => {
                    const nonces = this.getNonces();
                    if (nonces.size > 10000) {
                        nonces.clear();
                    }
                }, 10 * 60 * 1000);
            }
        }
        catch (error) {
            // If setInterval fails, continue without cleanup
            // This is safe because Workers have request isolation
        }
    }
    /**
     * Check if nonce exists (replay attack)
     */
    has(nonce) {
        // In Workers, nonces don't persist anyway, so we can skip initialization
        if (this.isWorkers) {
            return this.getNonces().has(nonce);
        }
        this.initializeCleanup(); // Lazy initialization (Node.js only)
        return this.getNonces().has(nonce);
    }
    /**
     * Add nonce to store
     */
    add(nonce) {
        // In Workers, nonces don't persist anyway, but we still track them per request
        if (this.isWorkers) {
            this.getNonces().add(nonce);
            return;
        }
        this.initializeCleanup(); // Lazy initialization (Node.js only)
        this.getNonces().add(nonce);
    }
    /**
     * Clean up
     */
    destroy() {
        if (!this.isWorkers && this.cleanupInterval) {
            const clearIntervalFn = globalThis.clearInterval || global.clearInterval;
            if (typeof clearIntervalFn === 'function') {
                clearIntervalFn(this.cleanupInterval);
            }
        }
        if (this.nonces) {
            this.nonces.clear();
        }
    }
}
// Lazy singleton nonce store - only create when first accessed
// This prevents setInterval from running at module load time in Cloudflare Workers
let nonceStoreInstance = null;
function getNonceStore() {
    if (!nonceStoreInstance) {
        nonceStoreInstance = new NonceStore();
    }
    return nonceStoreInstance;
}
/**
 * Veramo integration API
 * Provides access to the connected Veramo agent and verification methods
 */
export class VeramoAPI {
    agent = null;
    /**
     * Connect a Veramo agent instance to the client
     */
    connect(agent) {
        this.agent = agent;
    }
    /**
     * Get the connected Veramo agent
     * Agent is always connected after client construction
     */
    getAgent() {
        if (!this.agent) {
            throw new Error('Veramo agent not connected. This should not happen.');
        }
        return this.agent;
    }
    /**
     * Check if an agent is connected
     */
    isConnected() {
        return this.agent !== null;
    }
    /**
     * Disconnect the agent
     */
    disconnect() {
        this.agent = null;
    }
    /**
     * Verify a signed challenge
     * Handles all Veramo agent logic internally - no Veramo exposure at app level
     *
     * @param auth - The authentication challenge with signature
     * @param expectedAudience - Expected audience (provider URL) for validation
     * @returns Verification result with client address if valid
     */
    async verifyChallenge(auth, expectedAudience) {
        if (!this.agent) {
            throw new Error('Veramo agent not connected');
        }
        try {
            // Extract nonce from challenge for replay protection
            const challengeLines = auth.challenge.split('\n');
            const nonceLine = challengeLines.find((line) => line.startsWith('nonce='));
            const nonce = nonceLine?.split('=')[1];
            // Check for replay attacks
            if (nonce && getNonceStore().has(nonce)) {
                return { valid: false, error: 'Replay attack detected: nonce already used' };
            }
            // Parse challenge to extract fields
            if (challengeLines[0] !== 'orgtrust-challenge') {
                return { valid: false, error: 'Invalid challenge format' };
            }
            const challengeData = {};
            for (let i = 1; i < challengeLines.length; i++) {
                const line = challengeLines[i];
                if (line) {
                    const [key, value] = line.split('=');
                    if (key && value) {
                        challengeData[key] = value;
                    }
                }
            }
            const iss = challengeData.iss;
            const aud = challengeData.aud;
            const iat = parseInt(challengeData.iat || '0', 10);
            // Validate issuer matches DID
            if (iss !== auth.did) {
                return { valid: false, error: 'Issuer does not match DID' };
            }
            // Validate audience
            if (aud !== expectedAudience) {
                return { valid: false, error: 'Audience mismatch' };
            }
            // Validate expiration (5 minutes)
            const now = Date.now();
            const expiration = 5 * 60 * 1000; // 5 minutes
            if (now - iat > expiration) {
                return { valid: false, error: 'Challenge expired' };
            }
            // For ethr DIDs with eth_signMessage, try DID resolution first, then fall back to direct verification
            let ethereumAddress = null;
            let valid = false;
            if (auth.did.startsWith('did:ethr:') && auth.algorithm === 'eth_signMessage') {
                // Try to resolve the DID first (if it's on-chain)
                let resolvedAddress = null;
                try {
                    const didResolutionResult = await this.agent.resolveDid({ didUrl: auth.did });
                    if (didResolutionResult && didResolutionResult.didDocument) {
                        // Try to extract address from verification method
                        const verificationMethod = didResolutionResult.didDocument.verificationMethod?.find((vm) => vm.ethereumAddress || vm.blockchainAccountId);
                        if (verificationMethod) {
                            const vmAddress = verificationMethod.ethereumAddress ||
                                (verificationMethod.blockchainAccountId?.split(':').pop() || null);
                            if (vmAddress) {
                                resolvedAddress = vmAddress.toLowerCase();
                            }
                        }
                    }
                }
                catch (error) {
                    // Could not resolve DID (may not be on-chain), will use direct address verification
                }
                // Determine which address to use for verification
                if (resolvedAddress) {
                    ethereumAddress = resolvedAddress;
                }
                else if (auth.ethereumAddress) {
                    ethereumAddress = auth.ethereumAddress.toLowerCase();
                }
                else {
                    // Fallback: extract from DID
                    const didParts = auth.did.split(':');
                    let addressPart = didParts[didParts.length - 1];
                    if (addressPart) {
                        addressPart = addressPart.split('#')[0];
                        if (didParts.length === 4 && didParts[3]) {
                            addressPart = didParts[3];
                        }
                        else if (didParts.length === 3 && didParts[2]) {
                            addressPart = didParts[2];
                        }
                        if (addressPart) {
                            ethereumAddress = addressPart.startsWith('0x') ? addressPart : `0x${addressPart}`;
                            ethereumAddress = ethereumAddress.toLowerCase();
                        }
                    }
                }
                // Verify signature directly using the address
                if (!ethereumAddress) {
                    return { valid: false, error: 'No Ethereum address available for verification' };
                }
                try {
                    valid = await verifyMessage({
                        address: ethereumAddress,
                        message: auth.challenge,
                        signature: auth.signature,
                    });
                }
                catch (error) {
                    return { valid: false, error: 'Signature verification failed' };
                }
            }
            else {
                // For other DID methods or algorithms, resolve DID and use verification method
                const didResolutionResult = await this.agent.resolveDid({ didUrl: auth.did });
                if (!didResolutionResult || !didResolutionResult.didDocument) {
                    return { valid: false, error: 'Could not resolve DID' };
                }
                const didDocument = didResolutionResult.didDocument;
                // Find verification method by kid
                const verificationMethod = didDocument.verificationMethod?.find((vm) => vm.id === auth.kid || vm.id.endsWith(`#${auth.kid.split('#').pop()}`));
                if (!verificationMethod) {
                    return { valid: false, error: 'Verification method not found' };
                }
                // Verify signature based on algorithm
                if (auth.algorithm === 'eth_signMessage' || auth.algorithm.startsWith('eth_')) {
                    const vmAddress = verificationMethod.ethereumAddress ||
                        (verificationMethod.blockchainAccountId?.split(':').pop());
                    if (!vmAddress) {
                        return { valid: false, error: 'No Ethereum address in verification method' };
                    }
                    try {
                        valid = await verifyMessage({
                            address: vmAddress,
                            message: auth.challenge,
                            signature: auth.signature,
                        });
                    }
                    catch (error) {
                        return { valid: false, error: 'Signature verification failed' };
                    }
                }
                else if (auth.algorithm === 'ES256K' || auth.algorithm === 'EdDSA') {
                    // For ES256K/EdDSA, we need to use Veramo's verification
                    // This is a simplified check - in production, use proper crypto verification
                    if (!auth.signature || auth.signature.length === 0) {
                        return { valid: false, error: 'Invalid signature' };
                    }
                    // TODO: Implement proper ES256K/EdDSA verification using Veramo
                    // For now, we'll accept the signature if it exists (not secure in production)
                    console.warn('ES256K/EdDSA verification not fully implemented, accepting signature');
                    valid = true;
                }
                else {
                    return { valid: false, error: `Unsupported algorithm: ${auth.algorithm}` };
                }
            }
            // If valid, add nonce to store and extract client address
            if (valid && nonce) {
                getNonceStore().add(nonce);
            }
            // Extract client address from auth
            let clientAddress;
            if (auth.ethereumAddress) {
                clientAddress = auth.ethereumAddress;
            }
            else if (auth.did?.startsWith('did:ethr:')) {
                // Extract address from ethr DID
                const addressMatch = auth.did.match(/did:ethr:(0x[a-fA-F0-9]{40})/);
                if (addressMatch) {
                    clientAddress = addressMatch[1];
                }
                else if (ethereumAddress) {
                    clientAddress = ethereumAddress;
                }
            }
            else if (ethereumAddress) {
                clientAddress = ethereumAddress;
            }
            return {
                valid,
                error: valid ? undefined : 'Signature verification failed',
                clientAddress,
            };
        }
        catch (error) {
            console.error('Challenge verification error:', error);
            return {
                valid: false,
                error: error instanceof Error ? error.message : 'Unknown verification error',
            };
        }
    }
}
//# sourceMappingURL=veramo.js.map