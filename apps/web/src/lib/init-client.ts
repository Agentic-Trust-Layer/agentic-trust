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
  console.log('📋 initAgenticTrustClient called - NEW CODE');
  
  // If already initialized, return immediately
  try {
    getAgenticTrustClient();
    console.log('✅ Client already initialized, skipping');
    return;
  } catch {
    // Client not initialized, continue
    console.log('⚠️ Client not initialized, proceeding with initialization');
  }

  // If initialization is already in progress, wait for it
  if (initializationPromise) {
    console.log('⏳ Initialization in progress, waiting...');
    return initializationPromise;
  }

  // Start initialization
  initializationPromise = (async () => {
    try {
      console.log('🔄 Starting client initialization...');

      // Get private key from environment variable (if provided)
      const privateKey = process.env.AGENTIC_TRUST_PRIVATE_KEY || 
        process.env.NEXT_PUBLIC_AGENTIC_TRUST_PRIVATE_KEY;
      
      console.log('🔑 Private key:', privateKey ? 'provided' : 'not provided');
      
      // Initialize client - Veramo agent will be created automatically by core package
      await initializeAgenticTrustClient(privateKey ? { privateKey } : undefined);
      console.log('✅ Client initialization complete');
    } catch (error) {
      console.error('❌ Client initialization failed:', error);
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
  console.info('************* Inside Getting client *************');
  await initAgenticTrustClient();
  return getAgenticTrustClient();
}

