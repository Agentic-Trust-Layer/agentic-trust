/**
 * Initialize AgenticTrust Client
 * 
 * This module handles initialization of the AgenticTrustClient
 * with a Veramo agent instance.
 */

import { initializeAgenticTrustClient, getAgenticTrustClient } from './client';

let initializationPromise: Promise<void> | null = null;

/**
 * Initialize the AgenticTrust client
 * Veramo agent will be created automatically by the core package
 * This is called once and the client is cached for subsequent use
 */
export async function initAgenticTrustClient(): Promise<void> {
  // If already initialized, return immediately
  try {
    getAgenticTrustClient();
    return;
  } catch {
    // Client not initialized, continue
  }

  // If initialization is already in progress, wait for it
  if (initializationPromise) {
    return initializationPromise;
  }

  // Start initialization
  initializationPromise = (async () => {
    try {
      // Get private key from environment variable (if provided)
      const privateKey = process.env.AGENTIC_TRUST_PRIVATE_KEY || 
        process.env.NEXT_PUBLIC_AGENTIC_TRUST_PRIVATE_KEY;
      
      // Initialize client - Veramo agent will be created automatically by core package
      await initializeAgenticTrustClient(privateKey ? { privateKey } : undefined);
    } catch (error) {
      initializationPromise = null; // Reset on error so it can be retried
      throw error;
    }
  })();

  return initializationPromise;
}

/**
 * Get the initialized client (will initialize if needed)
 */
export async function getClient(): Promise<ReturnType<typeof getAgenticTrustClient>> {
  await initAgenticTrustClient();
  return getAgenticTrustClient();
}

