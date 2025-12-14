type StoredCliAuth = {
  state: string;
  codeChallenge: string;
  redirectUri: string;
  createdAtMs: number;
  result: Record<string, unknown>;
};

const KEY = '__agentic_trust_cli_auth_store__';

function getStore(): Map<string, StoredCliAuth> {
  const g = globalThis as any;
  if (!g[KEY]) {
    g[KEY] = new Map<string, StoredCliAuth>();
  }
  return g[KEY] as Map<string, StoredCliAuth>;
}

export function putCliAuth(code: string, value: StoredCliAuth) {
  getStore().set(code, value);
}

export function takeCliAuth(code: string): StoredCliAuth | undefined {
  const store = getStore();
  const value = store.get(code);
  if (value) {
    store.delete(code);
  }
  return value;
}

export function getCliAuth(code: string): StoredCliAuth | undefined {
  return getStore().get(code);
}

export function pruneCliAuth(maxAgeMs: number) {
  const now = Date.now();
  const store = getStore();
  for (const [code, value] of store.entries()) {
    if (now - value.createdAtMs > maxAgeMs) {
      store.delete(code);
    }
  }
}

