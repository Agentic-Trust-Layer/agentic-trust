import { RegistryBrokerClient, ProfileType, AIAgentType, AIAgentCapability } from '@hashgraphonline/standards-sdk';
import { Buffer } from 'buffer';
import {
  AccountId,
  LedgerId,
  PrivateKey,
  SignerSignature,
  type Signer,
} from '@hashgraph/sdk';

function createPrivateKeySignerLocal(options: {
  accountId: string;
  privateKey: PrivateKey;
  network: 'mainnet' | 'testnet';
}): Signer {
  const accountId = AccountId.fromString(options.accountId);
  const privateKey = options.privateKey;
  const ledgerId = LedgerId.fromString(options.network);

  const unsupported = (method: string) => new Error(`${method} is not supported by the in-memory signer`);

  // Mirror the signer shape that standards-sdk builds internally, but avoid its optionalImport loader
  // (Next.js server bundles often do not expose a global require()).
  return {
    getLedgerId: () => ledgerId,
    getAccountId: () => accountId,
    getAccountKey: () => privateKey.publicKey,
    getNetwork: () => ({}),
    getMirrorNetwork: () => [],
    sign: async (messages: Uint8Array[]) =>
      Promise.all(
        messages.map(async (message: Uint8Array) => {
          const signature = await privateKey.sign(message);
          return new SignerSignature({
            publicKey: privateKey.publicKey,
            signature,
            accountId,
          });
        }),
      ),
    getAccountBalance: async () => {
      throw unsupported('getAccountBalance');
    },
    getAccountInfo: async () => {
      throw unsupported('getAccountInfo');
    },
    getAccountRecords: async () => {
      throw unsupported('getAccountRecords');
    },
    signTransaction: async (_tx: unknown) => {
      throw unsupported('signTransaction');
    },
    checkTransaction: async (_tx: unknown) => {
      throw unsupported('checkTransaction');
    },
    populateTransaction: async (_tx: unknown) => {
      throw unsupported('populateTransaction');
    },
    call: async (_request: unknown) => {
      throw unsupported('call');
    },
  } as unknown as Signer;
}

async function loadHederaPrivateKeyFromEnv(): Promise<{ privateKey: PrivateKey; derPublicKeyHex: string }> {
  const privateKeyRaw = String(process.env.HEDERA_PRIVATE_KEY ?? '').trim();

  const privateKey = PrivateKey.fromString(privateKeyRaw);

  const derPublicKeyHex = Buffer.from(privateKey.publicKey.toBytesDer()).toString('hex');
  return { privateKey, derPublicKeyHex };
}

let cachedGeneratedKey: { privateKeyString: string; publicKeyString: string } | null = null;

function generateAndLogKeyForHashpackOnce() {
  if (cachedGeneratedKey) return;
  const priv = PrivateKey.generateECDSA();
  cachedGeneratedKey = {
    privateKeyString: priv.toString(),
    publicKeyString: priv.publicKey.toString(),
  };
  console.log('HOL generated Hedera private key (ECDSA):', cachedGeneratedKey.privateKeyString);
  console.log('HOL generated Hedera public key:', cachedGeneratedKey.publicKeyString);
}

type AgentRegistrationRequest = {
  profile: Record<string, unknown>;
  registry: string;
  communicationProtocol?: string;
  endpoint?: string;
  protocol?: string;
  additionalRegistries?: string[];
  metadata?: Record<string, unknown>;
};

type HolRegistrationInput = {
  /**
   * The HOL UAID is the agent UAID (uaid:*).
   * This is the primary identifier we want HOL to store.
   */
  uaidHOL: string;
  /**
   * Communication protocol endpoint used by HOL registry broker (e.g. A2A endpoint URL).
   */
  endpoint: string;
  /**
   * Defaults to "a2a".
   */
  communicationProtocol?: string | null;
  /**
   * Optional: fan-out to additional registries (e.g. ["erc-8004:ethereum-sepolia"])
   */
  additionalRegistries?: string[] | null;
  /**
   * Optional: metadata merged into registry broker metadata.
   */
  metadata?: Record<string, string> | null;
  name?: string | null;
  description?: string | null;
  image?: string | null;
  descriptor?: unknown;
  /**
   * Registry Broker "ledger key" issued by verifyLedgerChallenge().
   * When provided, server does not need any Hedera private key.
   */
  ledgerKey?: string | null;
  /**
   * Ledger account used for broker auth; used for x-account-id header.
   */
  ledgerAccountId?: string | null;
};

export async function registerHolAgent(input: HolRegistrationInput): Promise<unknown> {
  const uaidHOL = String(input?.uaidHOL ?? '').trim();
  const endpoint = String(input?.endpoint ?? '').trim();
  const communicationProtocol = String(input?.communicationProtocol ?? 'a2a').trim() || 'a2a';
  const additionalRegistries = Array.isArray(input?.additionalRegistries) ? input.additionalRegistries : null;
  const metadata = input?.metadata && typeof input.metadata === 'object' ? input.metadata : null;
  if (!uaidHOL.startsWith('uaid:')) {
    throw new Error('registerHolAgent: uaidHOL must start with "uaid:"');
  }
  if (!endpoint) {
    throw new Error('registerHolAgent: endpoint is required');
  }

  const baseUrl = String(process.env.REGISTRY_BROKER_API_URL ?? '').trim() || undefined;
  const apiKey = String(process.env.REGISTRY_BROKER_API_KEY ?? '').trim() || undefined;

  const ledgerKey = String(input?.ledgerKey ?? '').trim() || null;
  const ledgerAccountId = String(input?.ledgerAccountId ?? '').trim() || null;

  const accountId = String(process.env.HEDERA_ACCOUNT_ID ?? '').trim();
  const privateKeyRaw = String(process.env.HEDERA_PRIVATE_KEY ?? '').trim();
  const networkRaw = String(process.env.HOL_HEDERA_NETWORK ?? '').trim().toLowerCase();
  const network = networkRaw === 'mainnet' || networkRaw === 'testnet' ? (networkRaw as 'mainnet' | 'testnet') : null;

  if (!network) {
    throw new Error(
      'registerHolAgent: missing/invalid env vars. Set HOL_HEDERA_NETWORK=(mainnet|testnet).',
    );
  }

  const client = new RegistryBrokerClient({
    ...(baseUrl ? { baseUrl } : {}),
    ...(apiKey ? { apiKey } : {}),
  });
  
  try { 

  if (ledgerKey) {
    // Ledger key was issued by broker verifyLedgerChallenge() (e.g. via Hashpack in-browser signing).
    (client as any).setLedgerApiKey(ledgerKey);
    if (ledgerAccountId) {
      (client as any).setDefaultHeader?.('x-account-id', ledgerAccountId);
    }
  } else {
    // Fallback: server-side signer using env vars
    if (!accountId || !privateKeyRaw) {
      generateAndLogKeyForHashpackOnce();
      throw new Error(
        'registerHolAgent: missing HEDERA_ACCOUNT_ID/HEDERA_PRIVATE_KEY (and no ledgerKey provided). Connect Hashpack to authenticate or set env vars and retry.',
      );
    }

    const { privateKey, derPublicKeyHex } = await loadHederaPrivateKeyFromEnv();
    if (process.env.HOL_LOG_SIGNER_PUBKEY === '1') {
      console.log('HOL signer DER public key (hex):', derPublicKeyHex);
    }

    // Note: standards-sdk types lag the runtime surface; call via any.
    console.log('********* authenticateWithLedger');

    await (client as any).authenticateWithLedger({
      accountId,
      network,
      expiresInMinutes: 10,
      signer: createPrivateKeySignerLocal({
        accountId,
        privateKey,
        network,
      }),
    });
  }

  const did = `did:hol:${uaidHOL}`;

  console.log("********* profile")
  const profile = {
    version: '1.0.0',
    type: ProfileType.AI_AGENT,
    display_name: input?.name ?? uaidHOL,
    bio: input?.description ?? '',
    profileImage: input?.image ?? undefined,
    uaid: uaidHOL,
    properties: {
      source: 'agentic-trust-admin',
      did,
      descriptor: input?.descriptor ?? undefined,
    },
    aiAgent: {
      type: AIAgentType.MANUAL,
      model: 'unknown',
      capabilities: [AIAgentCapability.TEXT_GENERATION],
    },
  };
  console.log("********* profile", profile)

  const payload: AgentRegistrationRequest = {
    profile,
    registry: 'hashgraph-online',
    communicationProtocol,
    endpoint,
    ...(additionalRegistries && additionalRegistries.length > 0 ? { additionalRegistries } : {}),
    metadata: {
      provider: 'agentic-trust-admin',
      uaidHOL,
      did,
      ...(metadata ?? {}),
    },
  };

  


    console.log("********* getRegistrationQuote")
    const quote = await (client as any).getRegistrationQuote(payload);
    console.log("********* quote", quote)
    const registration = await (client as any).registerAgent(payload);
    console.log("********* registration", registration)

    if (registration?.attemptId) {
      console.log("********* waitForRegistrationCompletion")
      try {
        const final = await (client as any).waitForRegistrationCompletion(registration.attemptId, {
          intervalMs: 2000,
          timeoutMs: 5 * 60 * 1000,
        });
        console.log("********* final", final)
        return { quote, registration, final };
      } catch (progressError: any) {
        // Registration has already been submitted; don't fail the whole request if progress polling fails
        // (e.g., broker key expired mid-poll).
        const status = typeof progressError?.status === 'number' ? progressError.status : undefined;
        const statusText = typeof progressError?.statusText === 'string' ? progressError.statusText : undefined;
        const body = progressError?.body;
        if (body) {
          try {
            console.log('********* registration completion polling error body (full)', JSON.stringify(body, null, 2));
          } catch {
            // ignore
          }
        }
        return {
          quote,
          registration,
          finalError: {
            status,
            statusText,
            message: progressError instanceof Error ? progressError.message : String(progressError),
            body,
          },
        };
      }
    }

    return { quote, registration };
  } catch (error: any) {
    console.log("********* error", error)
    const status = typeof error?.status === 'number' ? error.status : undefined;
    const statusText = typeof error?.statusText === 'string' ? error.statusText : undefined;
    const body = error?.body;
    if (body) {
      try {
        console.log('********* registry broker error body (full)', JSON.stringify(body, null, 2));
      } catch {
        // ignore stringify failures
      }
    }
    const extractedMessage =
      typeof (client as any)?.extractErrorMessage === 'function'
        ? (client as any).extractErrorMessage(error)
        : null;
    const shortfall =
      typeof (client as any)?.extractInsufficientCreditsDetails === 'function'
        ? (client as any).extractInsufficientCreditsDetails(error)
        : null;

    const details = {
      status,
      statusText,
      message: extractedMessage || (error instanceof Error ? error.message : String(error)),
      shortfall,
      body,
    };

    throw new Error(`[HOL RegistryBroker] ${JSON.stringify(details)}`);
  }
}

