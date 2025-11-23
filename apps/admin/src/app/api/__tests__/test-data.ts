/**
 * Test data constants
 * 
 * These values represent real agent data that can be used for testing.
 * Using real data ensures tests validate against actual API response formats.
 */

export const TEST_AGENT_ID = '724';
export const TEST_CHAIN_ID = 11155111;
export const TEST_AGENT_NAME = 'movieagent.8004-agent.eth';
export const TEST_AGENT_ACCOUNT = '0xDc7f44AfA28A8cC4e4fAAb24810C660ac97A9939';
export const TEST_TOKEN_URI = 'https://bafkreib3wycpaaazqxoiarvqcuvua5mkimg7yraozckf4ni6c64hahahjm.ipfs.w3s.link';
export const TEST_A2A_ENDPOINT = 'https://b3b17ea0.movie-agent.pages.dev/.well-known/agent-card.json';

/**
 * Test metadata as returned from contract
 */
export const TEST_METADATA = {
  agentName: TEST_AGENT_NAME,
  agentAccount: `eip155:${TEST_CHAIN_ID}:${TEST_AGENT_ACCOUNT}`,
};

/**
 * Test IPFS registration JSON
 */
export const TEST_IPFS_REGISTRATION = {
  type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
  name: TEST_AGENT_NAME,
  description: 'movie review agent',
  image: null,
  endpoints: [
    {
      name: 'A2A',
      endpoint: TEST_A2A_ENDPOINT,
      version: '0.3.0',
    },
    {
      name: 'ENS',
      endpoint: TEST_AGENT_NAME,
      version: 'v1',
    },
    {
      name: 'agentAccount',
      endpoint: `eip155:${TEST_CHAIN_ID}:${TEST_AGENT_ACCOUNT}`,
      version: 'v1',
    },
  ],
  registrations: [
    {
      agentRegistry: 'eip155:11155111:0x8004a6090Cd10A7288092483047B097295Fb8847',
    },
  ],
  supportedTrust: ['reputation', 'crypto-economic', 'tee-attestation'],
};

/**
 * Test GraphQL discovery data
 */
export const TEST_DISCOVERY_DATA = {
  agentId: TEST_AGENT_ID,
  agentName: TEST_AGENT_NAME,
  a2aEndpoint: TEST_A2A_ENDPOINT,
  createdAtTime: '2025-10-31T08:23:59.000Z',
  updatedAtTime: '2025-11-03T11:43:56.000Z',
};

/**
 * Expected agent record payload structure
 */
export const TEST_AGENT_RECORD = {
  success: true,
  agentId: TEST_AGENT_ID,
  chainId: TEST_CHAIN_ID,
  agentAccount: TEST_AGENT_ACCOUNT,
  identityMetadata: {
    tokenUri: TEST_TOKEN_URI,
    metadata: {
      agentName: TEST_AGENT_NAME,
      agentAccount: TEST_AGENT_ACCOUNT,
    },
  },
  identityRegistration: {
    tokenUri: TEST_TOKEN_URI,
    registration: TEST_IPFS_REGISTRATION,
  },
  discovery: TEST_DISCOVERY_DATA,
  // Flattened fields from registration
  name: TEST_AGENT_NAME,
  description: 'movie review agent',
  image: null,
  endpoints: TEST_IPFS_REGISTRATION.endpoints,
  supportedTrust: TEST_IPFS_REGISTRATION.supportedTrust,
  // Flattened fields from discovery
  a2aEndpoint: TEST_A2A_ENDPOINT,
  createdAtTime: TEST_DISCOVERY_DATA.createdAtTime,
  updatedAtTime: TEST_DISCOVERY_DATA.updatedAtTime,
};

