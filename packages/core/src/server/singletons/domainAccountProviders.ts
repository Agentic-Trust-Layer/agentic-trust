/**
 * Shared helpers to resolve AccountProviders for domain clients
 * (reputation, ENS, etc.) from user apps and environment.
 */

import { ViemAccountProvider, type AccountProvider } from '@agentic-trust/8004-sdk';
import { getAdminApp } from '../userApps/adminApp';
import { getClientApp } from '../userApps/clientApp';
import { getProviderApp } from '../userApps/providerApp';
import { isUserAppEnabled } from '../userApps/userApp';
import { getChainEnvVar, requireChainEnvVar } from '../lib/chainConfig';

export interface DomainUserApps {
  adminApp?: Awaited<ReturnType<typeof getAdminApp>>;
  clientApp?: Awaited<ReturnType<typeof getClientApp>>;
  providerApp?: Awaited<ReturnType<typeof getProviderApp>>;
}

/**
 * Resolve which user apps are active in this process based on roles.
 * This can be called once and passed into domain client initializers.
 */
export async function resolveDomainUserApps(): Promise<DomainUserApps> {
  const ctx: DomainUserApps = {};

  if (isUserAppEnabled('admin')) {
    try {
      ctx.adminApp = await getAdminApp();
    } catch (error) {
      console.warn('AdminApp not available while resolving domain user apps:', error);
    }
  }

  if (isUserAppEnabled('provider')) {
    try {
      ctx.providerApp = await getProviderApp();
    } catch (error) {
      console.warn('ProviderApp not available while resolving domain user apps:', error);
    }
  }

  if (isUserAppEnabled('client')) {
    try {
      ctx.clientApp = await getClientApp();
    } catch (error) {
      console.warn('ClientApp not available while resolving domain user apps:', error);
    }
  }

  return ctx;
}

/**
 * Resolve an AccountProvider suitable for reputation operations
 * for the given chain. Prefers:
 *   1. AdminApp
 *   2. ProviderApp (optionally upgraded by ClientApp)
 *   3. ClientApp
 *
 * Falls back to a read-only provider derived from the provider's
 * session key (if available).
 */
export async function resolveReputationAccountProvider(
  chainId: number,
  rpcUrl: string,
  userApps?: DomainUserApps
): Promise<AccountProvider> {
  const ctx = userApps ?? (await resolveDomainUserApps());

  if (ctx.adminApp?.accountProvider) {
    return ctx.adminApp.accountProvider;
  }

  if (ctx.providerApp?.accountProvider) {
    let provider: AccountProvider = ctx.providerApp.accountProvider;

    // If a ClientApp is also available, prefer its AccountProvider
    if (ctx.clientApp?.accountProvider) {
      provider = ctx.clientApp.accountProvider;
    } else {
      // Fallback: derive a read-only client provider from the session key
      const sessionKeyAddress = ctx.providerApp.sessionPackage.sessionKey.address as `0x${string}`;
      const { createPublicClient, http } = await import('viem');
      const { sepolia } = await import('viem/chains');

      const clientPublicClient = createPublicClient({
        chain: sepolia,
        transport: http(rpcUrl),
      });

      provider = new ViemAccountProvider({
        publicClient: clientPublicClient as any,
        walletClient: null,
        account: sessionKeyAddress,
        chainConfig: {
          id: sepolia.id,
          rpcUrl,
          name: sepolia.name,
          chain: sepolia,
        },
      });
    }

    return provider;
  }

  if (ctx.clientApp?.accountProvider) {
    return ctx.clientApp.accountProvider;
  }

  throw new Error(
    'Cannot resolve AccountProvider for reputation client: configure AGENTIC_TRUST_APP_ROLES to include "client", "provider", or "admin".'
  );
}

/**
 * Resolve an AccountProvider suitable for ENS operations for the given chain.
 * Prefers:
 *   1. AdminApp
 *   2. ClientApp
 *   3. ProviderApp
 *
 * Falls back to a read-only provider if none are available.
 */
export async function resolveENSAccountProvider(
  chainId: number,
  rpcUrl: string,
  userApps?: DomainUserApps
): Promise<AccountProvider> {
  const ctx = userApps ?? (await resolveDomainUserApps());

  if (ctx.adminApp?.accountProvider) {
    return ctx.adminApp.accountProvider;
  }

  if (ctx.clientApp?.accountProvider) {
    return ctx.clientApp.accountProvider;
  }

  if (ctx.providerApp?.accountProvider) {
    return ctx.providerApp.accountProvider;
  }

  // Fallback: read-only public client
  const { createPublicClient, http } = await import('viem');
  const { sepolia } = await import('viem/chains');

  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(rpcUrl),
  });

  return new ViemAccountProvider({
    publicClient,
    walletClient: null,
    account: undefined,
    chainConfig: {
      id: sepolia.id,
      rpcUrl,
      name: sepolia.name,
      chain: sepolia,
    },
  });
}


