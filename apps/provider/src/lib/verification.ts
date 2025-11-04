/**
 * Verification utilities for provider app
 * Verifies raw signatures over canonical challenges
 */

import type { VeramoAgent } from '@agentic-trust/core';
import { verifyMessage } from 'viem';

interface AuthChallenge {
  did: string;
  kid: string;
  algorithm: string;
  challenge: string;
  signature: string;
  ethereumAddress?: string; // For direct verification without DID resolution
}

/**
 * Verify a signed challenge
 */
export async function verifyChallenge(
  agent: VeramoAgent,
  auth: AuthChallenge,
  expectedAudience: string
): Promise<{ valid: boolean; error?: string }> {
  try {
    // Parse challenge to extract fields
    const lines = auth.challenge.split('\n');
    if (lines[0] !== 'orgtrust-challenge') {
      return { valid: false, error: 'Invalid challenge format' };
    }

    const challengeData: Record<string, string> = {};
    for (let i = 1; i < lines.length; i++) {
      const [key, value] = lines[i].split('=');
      if (key && value) {
        challengeData[key] = value;
      }
    }

    const iss = challengeData.iss;
    const aud = challengeData.aud;
    const nonce = challengeData.nonce;
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
    let ethereumAddress: string | null = null;
    let valid = false;

    if (auth.did.startsWith('did:ethr:') && auth.algorithm === 'eth_signMessage') {
      // Try to resolve the DID first (if it's on-chain)
      let resolvedAddress: string | null = null;
      try {
        const didResolutionResult = await agent.resolveDid({ didUrl: auth.did });
        if (didResolutionResult && didResolutionResult.didDocument) {
          console.log('Successfully resolved DID document:', JSON.stringify(didResolutionResult.didDocument, null, 2));
          
          // Try to extract address from verification method
          const verificationMethod = didResolutionResult.didDocument.verificationMethod?.find(
            (vm: any) => vm.ethereumAddress || vm.blockchainAccountId
          );
          
          if (verificationMethod) {
            const vmAddress = verificationMethod.ethereumAddress || 
                             (verificationMethod.blockchainAccountId?.split(':').pop() || null);
            if (vmAddress) {
              resolvedAddress = vmAddress.toLowerCase();
              console.log('Extracted address from resolved DID document:', resolvedAddress);
            }
          }
        } else {
          console.log('DID resolved but no document found (DID may not be on-chain)');
        }
      } catch (error) {
        console.log('Could not resolve DID (may not be on-chain), will use direct address verification:', error);
      }

      // Determine which address to use for verification
      if (resolvedAddress) {
        // Use address from resolved DID document
        ethereumAddress = resolvedAddress;
        console.log('Using address from resolved DID document for verification');
      } else if (auth.ethereumAddress) {
        // Use provided address
        ethereumAddress = auth.ethereumAddress.toLowerCase();
        console.log('Using provided Ethereum address for verification:', ethereumAddress);
      } else {
        // Fallback: extract from DID
        const didParts = auth.did.split(':');
        let addressPart = didParts[didParts.length - 1];
        addressPart = addressPart.split('#')[0];
        if (didParts.length === 4) {
          addressPart = didParts[3];
        } else if (didParts.length === 3) {
          addressPart = didParts[2];
        }
        ethereumAddress = addressPart.startsWith('0x') ? addressPart : `0x${addressPart}`;
        ethereumAddress = ethereumAddress.toLowerCase();
        console.log('Extracted Ethereum address from DID (fallback):', ethereumAddress);
      }

      // Verify signature directly using the address
      if (!ethereumAddress) {
        return { valid: false, error: 'No Ethereum address available for verification' };
      }

      try {
        valid = await verifyMessage({
          address: ethereumAddress as `0x${string}`,
          message: auth.challenge,
          signature: auth.signature as `0x${string}`,
        });
        console.log('Address verification result:', valid);
      } catch (error) {
        console.error('Ethereum signature verification error:', error);
        return { valid: false, error: 'Signature verification failed' };
      }
    } else {
      // For other DID methods or algorithms, resolve DID and use verification method
      const didResolutionResult = await agent.resolveDid({ didUrl: auth.did });
      if (!didResolutionResult || !didResolutionResult.didDocument) {
        return { valid: false, error: 'Could not resolve DID' };
      }

      const didDocument = didResolutionResult.didDocument;
      
      // Find verification method by kid
      const verificationMethod = didDocument.verificationMethod?.find(
        (vm: any) => vm.id === auth.kid || vm.id.endsWith(`#${auth.kid.split('#').pop()}`)
      );

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
            address: vmAddress as `0x${string}`,
            message: auth.challenge,
            signature: auth.signature as `0x${string}`,
          });
        } catch (error) {
          console.error('Ethereum signature verification error:', error);
          return { valid: false, error: 'Signature verification failed' };
        }
      } else if (auth.algorithm === 'ES256K' || auth.algorithm === 'EdDSA') {
        // For ES256K/EdDSA, we need to use Veramo's verification
        // This is a simplified check - in production, use proper crypto verification
        // For now, we'll check that the signature exists and is non-empty
        if (!auth.signature || auth.signature.length === 0) {
          return { valid: false, error: 'Invalid signature' };
        }

        // TODO: Implement proper ES256K/EdDSA verification using Veramo
        // For now, we'll accept the signature if it exists (not secure in production)
        console.warn('ES256K/EdDSA verification not fully implemented, accepting signature');
        valid = true;
      } else {
        return { valid: false, error: `Unsupported algorithm: ${auth.algorithm}` };
      }
    }

    return { valid, error: valid ? undefined : 'Signature verification failed' };
  } catch (error) {
    console.error('Challenge verification error:', error);
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Unknown verification error',
    };
  }
}

/**
 * Nonce store for replay protection (in-memory, should be persistent in production)
 */
class NonceStore {
  private nonces: Set<string> = new Set();
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    // Clean up old nonces every 10 minutes
    this.cleanupInterval = setInterval(() => {
      // In production, implement TTL-based cleanup
      // For now, we'll keep nonces for the session
      if (this.nonces.size > 10000) {
        this.nonces.clear();
      }
    }, 10 * 60 * 1000);
  }

  /**
   * Check if nonce exists (replay attack)
   */
  has(nonce: string): boolean {
    return this.nonces.has(nonce);
  }

  /**
   * Add nonce to store
   */
  add(nonce: string): void {
    this.nonces.add(nonce);
  }

  /**
   * Clean up
   */
  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.nonces.clear();
  }
}

export const nonceStore = new NonceStore();

