/**
 * Base abstractions for chain-aware domain clients
 * (discovery, identity, ENS, reputation).
 *
 * Each concrete singleton wraps an instance of this base class.
 */

export type DomainClientType = 'discovery' | 'identity' | 'ens' | 'reputation';

/**
 * Generic base class for domain-specific clients.
 *
 * - TClient: the underlying client type (e.g. AIAgentDiscoveryClient)
 * - TKey:    key type used to distinguish instances (e.g. chainId or 'global')
 */
export abstract class DomainClient<TClient, TKey = number> {
  protected instances: Map<TKey, TClient> = new Map();
  protected initPromises: Map<TKey, Promise<TClient>> = new Map();

  constructor(public readonly type: DomainClientType) {}

  /**
   * Concrete subclasses must implement client construction for a given key.
   * The optional initArg can be used to pass through configuration overrides.
   */
  protected abstract buildClient(key: TKey, initArg?: unknown): Promise<TClient>;

  /**
   * Get or create a client for a given key.
   * Handles memoization and in‑flight initialization tracking.
   */
  async get(key: TKey, initArg?: unknown): Promise<TClient> {
    if (this.instances.has(key)) {
      return this.instances.get(key)!;
    }

    if (this.initPromises.has(key)) {
      return this.initPromises.get(key)!;
    }

    const promise = this.buildClient(key, initArg)
      .then((client) => {
        this.instances.set(key, client);
        this.initPromises.delete(key);
        return client;
      })
      .catch((error) => {
        this.initPromises.delete(key);
        throw error;
      });

    this.initPromises.set(key, promise);
    return promise;
  }

  isInitialized(key: TKey): boolean {
    return this.instances.has(key);
  }

  /**
   * Reset one or all instances (useful for testing).
   */
  reset(key?: TKey): void {
    if (typeof key === 'undefined') {
      this.instances.clear();
      this.initPromises.clear();
    } else {
      this.instances.delete(key);
      this.initPromises.delete(key);
    }
  }
}


