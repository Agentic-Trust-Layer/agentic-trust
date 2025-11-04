import { getRegistryAgent } from './IdentityRegistry.js'
import { AccountId, type ChainIdParams } from 'caip';
import type {
  DIDResolutionOptions,
  DIDResolutionResult,
  ParsedDID,
  Resolvable,
  ResolverRegistry,
} from 'did-resolver';



const DID_LD_JSON = 'application/did+ld+json';
const DID_JSON = 'application/did+json';

function buildAgentDidDoc(
  did: string,
  agentId: string,
  agentDomain: string,
  agentAddress: string,
  chainId: number,
  registry: `0x${string}`
) {
  const controller = did;
  const vmId = `${did}#aa-eth`;
  const httpsOrigin = `https://${agentDomain}`;
  const wssOrigin = `wss://${agentDomain}`;

  return {
    '@context': [
      'https://www.w3.org/ns/did/v1',
      'https://w3id.org/security/multikey/v1',
    ],
    id: did,
    alsoKnownAs: [httpsOrigin],
    verificationMethod: [
      {
        id: vmId,
        type: 'EcdsaSecp256k1RecoveryMethod2020',
        controller: did,
        blockchainAccountId: `eip155:${chainId}:${agentAddress}`,
        ethereumAddress: agentAddress,
        accept: ['EIP-1271', 'EIP-712'],
        erc8004: {
          agentId,
          registry,
          chainId,
        },
      },
    ],
    authentication: [vmId],
    assertionMethod: [vmId],
    capabilityInvocation: [vmId],
    capabilityDelegation: [vmId],
    service: [
      {
        id: '#mcp-ws',
        type: 'MCP',
        serviceEndpoint: {
          uri: `${wssOrigin}/.well-known/mcp`,
          protocol: 'model-context-protocol',
          version: '0.1',
          transport: 'websocket',
          accept: ['application/json'],
          auth: ['did-jws', 'eip-1271'],
        },
      },
      {
        id: '#ens',
        type: 'ENSService',
        serviceEndpoint: {
          // name can be set via reverse ENS lookup of agentAddress if available
          records: {
            addr: agentAddress,
            url: httpsOrigin,
            'org.did': did,
          },
          auth: ['eip-1271', 'eip-712'],
        },
      },
      {
        id: '#linked-domains',
        type: 'LinkedDomains',
        serviceEndpoint: {
          origins: [httpsOrigin],
        },
      },
      {
        id: '#agent-card',
        type: 'AgentCard',
        serviceEndpoint: `${httpsOrigin}/.well-known/agent-card.json`,
      },
      {
        id: '#agent-interface',
        type: 'AgentInterface',
        serviceEndpoint: `${httpsOrigin}/.well-known/a2a`,
      },
      {
        id: '#reputation',
        type: 'ReputationRegistry',
        serviceEndpoint: {
          chainId,
          contract: '0xREPUT4TI0NADDRE55',
          methods: ['acceptFeedback'],
        },
      },
    ],
    agent: {
      standard: 'ERC-8004',
      domain: agentDomain,
      address: agentAddress,
    },
  };
}

function toDidDoc(did: string, agentId: string): any {
  return buildAgentDidDoc(
    did,
    agentId,
    'unknown-domain',
    '0x0000000000000000000000000000000000000000',
    0,
    '0x0000000000000000000000000000000000000000'
  );
}


export function getAgentResolver(): ResolverRegistry {
  return {
    agent: async (
      did: string,
      parsed: ParsedDID,
      r: Resolvable,
      options: DIDResolutionOptions
    ): Promise<DIDResolutionResult> => {

      console.info(">>>>>>>> inside agent resolver: did: ", did)

      const contentType = options.accept || DID_JSON;
      const response: DIDResolutionResult = {
        didResolutionMetadata: { contentType },
        didDocument: null,
        didDocumentMetadata: {},
      };
      try {
        // Lookup agent info from ERC-8004 Identity Registry
        const REGISTRY_ADDRESS = '0xD3Ef59f3Bbc1d766E3Ba463Be134B5eB29e907A0' as `0x${string}`;
        const agentId = parsed.id;
        const info = await getRegistryAgent(REGISTRY_ADDRESS, BigInt(agentId));
        const agentDomain = info.agentDomain as string;
        const agentAddress = info.agentAddress as string;
        // Default to Sepolia if your registry is on Sepolia; adapt as needed
        const chainId = 11155111;

        const doc = buildAgentDidDoc(
          did,
          agentId,
          agentDomain,
          agentAddress,
          chainId,
          REGISTRY_ADDRESS
        );
        if (contentType === DID_LD_JSON) {
          response.didDocument = doc;
        } else if (contentType === DID_JSON) {
          const { ['@context']: _ctx, ...jsonDoc } = doc as any;
          response.didDocument = jsonDoc as any;
        } else {
          delete response.didResolutionMetadata.contentType;
          response.didResolutionMetadata.error = 'representationNotSupported';
        }
      } catch (e) {
        response.didResolutionMetadata.error = 'invalidDid';
        response.didResolutionMetadata.message = (e as Error).message;
      }

      console.info(">>>>>>>> inside agent resolver: response: ", JSON.stringify(response))
      return response;
    },
  };
}
