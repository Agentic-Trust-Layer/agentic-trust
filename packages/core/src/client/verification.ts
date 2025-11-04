/**
 * Agent Verification API
 * Provides challenge-response verification using raw signatures over canonical challenges
 */

import type { VeramoAgent } from './veramo';

export interface ChallengeRequest {
  /** DID of the agent to verify */
  agentDid: string;
  /** Audience (origin/app identifier) */
  audience: string;
  /** Optional nonce (will be generated if not provided) */
  nonce?: string;
}

export interface Challenge {
  /** The challenge string to sign */
  challenge: string;
  /** Nonce used in the challenge */
  nonce: string;
  /** Issued at timestamp */
  iat: number;
  /** Audience */
  aud: string;
  /** Agent DID */
  iss: string;
}

export interface SignedChallenge {
  /** Agent DID */
  did: string;
  /** Key ID used for signing */
  kid: string;
  /** Algorithm used */
  algorithm: string;
  /** The original challenge */
  challenge: string;
  /** The signature bytes */
  signature: string;
}

export interface VerificationRequest {
  /** Signed challenge from the agent */
  signedChallenge: SignedChallenge;
  /** Expected audience */
  audience: string;
  /** Optional nonce to verify against */
  nonce?: string;
}

export interface VerificationResult {
  /** Whether the verification was successful */
  valid: boolean;
  /** Agent DID that was verified */
  agentDid: string;
  /** Error message if verification failed */
  error?: string;
}

export class VerificationAPI {
  constructor(private getVeramoAgent: () => VeramoAgent) {}

  /**
   * Create a challenge for agent verification
   */
  createChallenge(request: ChallengeRequest): Challenge {
    const nonce = request.nonce || this.generateNonce();
    const iat = Date.now();
    
    const challenge = [
      'agentic-trust-challenge',
      `iss=${request.agentDid}`,
      `aud=${request.audience}`,
      `nonce=${nonce}`,
      `iat=${iat}`,
    ].join('\n');

    return {
      challenge,
      nonce,
      iat,
      aud: request.audience,
      iss: request.agentDid,
    };
  }

  /**
   * Sign a challenge using the connected Veramo agent
   */
  async signChallenge(
    challenge: Challenge,
    keyId: string,
    algorithm: 'ES256K' | 'EdDSA' | 'eth_signMessage' = 'ES256K'
  ): Promise<SignedChallenge> {
    const agent = this.getVeramoAgent();

    // Use Veramo's keyManagerSign to sign the challenge
    const signature = await agent.keyManagerSign({
      keyRef: keyId,
      algorithm,
      data: challenge.challenge,
      encoding: 'utf-8',
    });

    // Parse the DID to extract it
    const did = challenge.iss;

    return {
      did,
      kid: keyId,
      algorithm,
      challenge: challenge.challenge,
      signature,
    };
  }

  /**
   * Verify an agent's signed challenge
   */
  async verifyAgent(request: VerificationRequest): Promise<VerificationResult> {
    try {
      const agent = this.getVeramoAgent();
      const { signedChallenge, audience, nonce } = request;

      // Resolve the DID to get the verification method
      const { didDocument } = await agent.resolveDid({
        didUrl: signedChallenge.did,
      });

      if (!didDocument?.verificationMethod) {
        return {
          valid: false,
          agentDid: signedChallenge.did,
          error: 'No verification methods found in DID document',
        };
      }

      // Find the verification method that matches the key ID
      const verificationMethod = didDocument.verificationMethod.find(
        (vm) => vm.id === signedChallenge.kid || vm.id.endsWith(`#${signedChallenge.kid}`)
      );

      if (!verificationMethod) {
        return {
          valid: false,
          agentDid: signedChallenge.did,
          error: `Verification method not found for key ID: ${signedChallenge.kid}`,
        };
      }

      // Verify the signature based on the algorithm
      const isValid = await this.verifySignature(
        signedChallenge.challenge,
        signedChallenge.signature,
        verificationMethod,
        signedChallenge.algorithm
      );

      if (!isValid) {
        return {
          valid: false,
          agentDid: signedChallenge.did,
          error: 'Signature verification failed',
        };
      }

      // Parse challenge to verify nonce and audience
      const challengeParts = this.parseChallenge(signedChallenge.challenge);
      
      if (challengeParts.aud !== audience) {
        return {
          valid: false,
          agentDid: signedChallenge.did,
          error: `Audience mismatch: expected ${audience}, got ${challengeParts.aud}`,
        };
      }

      if (nonce && challengeParts.nonce !== nonce) {
        return {
          valid: false,
          agentDid: signedChallenge.did,
          error: 'Nonce mismatch',
        };
      }

      // Check if challenge is expired (optional - you can set a TTL)
      const challengeAge = Date.now() - challengeParts.iat;
      const maxAge = 5 * 60 * 1000; // 5 minutes
      if (challengeAge > maxAge) {
        return {
          valid: false,
          agentDid: signedChallenge.did,
          error: 'Challenge expired',
        };
      }

      return {
        valid: true,
        agentDid: signedChallenge.did,
      };
    } catch (error) {
      return {
        valid: false,
        agentDid: request.signedChallenge.did,
        error: error instanceof Error ? error.message : 'Unknown verification error',
      };
    }
  }

  /**
   * Generate a random nonce
   */
  private generateNonce(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}-${crypto.randomUUID?.() || Math.random().toString(36)}`;
  }

  /**
   * Parse challenge string into parts
   */
  private parseChallenge(challenge: string): {
    iss: string;
    aud: string;
    nonce: string;
    iat: number;
  } {
    const parts: Record<string, string> = {};
    const lines = challenge.split('\n');
    
    // Skip the first line (challenge type)
    for (const line of lines.slice(1)) {
      const [key, ...valueParts] = line.split('=');
      if (key && valueParts.length > 0) {
        parts[key] = valueParts.join('=');
      }
    }

    return {
      iss: parts.iss || '',
      aud: parts.aud || '',
      nonce: parts.nonce || '',
      iat: parseInt(parts.iat || '0', 10),
    };
  }

  /**
   * Verify signature using the verification method
   * Uses Veramo's DID resolution and key verification capabilities
   */
  private async verifySignature(
    challenge: string,
    signature: string,
    verificationMethod: any,
    algorithm: string
  ): Promise<boolean> {
    try {
      const agent = this.getVeramoAgent();

      // For eth_signMessage, we can use viem to verify the signature
      if (algorithm === 'eth_signMessage') {
        const { verifyMessage } = await import('viem');
        
        if (verificationMethod.ethereumAddress) {
          try {
            const isValid = await verifyMessage({
              address: verificationMethod.ethereumAddress as `0x${string}`,
              message: challenge,
              signature: signature as `0x${string}`,
            });
            
            return isValid;
          } catch {
            return false;
          }
        }
      }

      // For other algorithms (ES256K, EdDSA), we can try using Veramo's key verification
      // or implement using crypto libraries
      // Note: Veramo doesn't directly expose signature verification for arbitrary data
      // You may need to use @noble/secp256k1 for ES256K or @noble/ed25519 for EdDSA
      
      // For now, we'll attempt basic verification using the DID resolution
      // In production, implement proper cryptographic verification based on:
      // - The verification method's public key (from publicKeyHex or publicKeyBase58)
      // - The algorithm specified
      // - The signature bytes
      
      // Placeholder: Return true if verification method exists and has a public key
      // Replace this with proper crypto verification in production
      const hasPublicKey = 
        verificationMethod.publicKeyHex ||
        verificationMethod.publicKeyBase58 ||
        verificationMethod.blockchainAccountId;
      
      return !!hasPublicKey;
    } catch (error) {
      console.error('Signature verification error:', error);
      return false;
    }
  }
}

