/**
 * Minimal ABIs for the idchain-world ERC-8122 Agent Registry system.
 *
 * Source contracts:
 * - AgentRegistry.sol
 * - AgentRegistrar.sol
 * - AgentRegistryFactory.sol
 *
 * Repo: https://github.com/idchain-world/agent-registry
 */

export const agentRegistryAbi = [
  {
    type: 'function',
    name: 'agentIndex',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'ownerOf',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'register',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'endpointType', type: 'string' },
      { name: 'endpoint', type: 'string' },
      { name: 'agentAccount', type: 'address' },
    ],
    outputs: [{ name: 'agentId', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'setMetadata',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'key', type: 'string' },
      { name: 'value', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'setContractMetadata',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'key', type: 'string' },
      { name: 'value', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'event',
    name: 'Registered',
    inputs: [
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'owner', type: 'address', indexed: true },
      { name: 'endpointType', type: 'string', indexed: false },
      { name: 'endpoint', type: 'string', indexed: false },
      { name: 'agentAccount', type: 'address', indexed: false },
    ],
    anonymous: false,
  },
] as const;

export const agentRegistrarAbi = [
  {
    type: 'function',
    name: 'registry',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'mintPrice',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'maxSupply',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'open',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'publicMinting',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'openMinting',
    stateMutability: 'nonpayable',
    inputs: [{ name: '_publicMinting', type: 'bool' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'mint',
    stateMutability: 'payable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'endpointType', type: 'string' },
      { name: 'endpoint', type: 'string' },
      { name: 'agentAccount', type: 'address' },
    ],
    outputs: [{ name: 'agentId', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'mint',
    stateMutability: 'payable',
    inputs: [
      { name: 'to', type: 'address' },
      {
        name: 'metadata',
        type: 'tuple[]',
        components: [
          { name: 'key', type: 'string' },
          { name: 'value', type: 'bytes' },
        ],
      },
    ],
    outputs: [{ name: 'agentId', type: 'uint256' }],
  },
  {
    type: 'event',
    name: 'AgentMinted',
    inputs: [
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'owner', type: 'address', indexed: true },
      { name: 'mintNumber', type: 'uint256', indexed: false },
    ],
    anonymous: false,
  },
] as const;

export const agentRegistryFactoryAbi = [
  {
    type: 'function',
    name: 'registryImplementation',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'registrarImplementation',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'deploy',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'admin', type: 'address' },
      { name: 'mintPrice', type: 'uint256' },
      { name: 'maxSupply', type: 'uint256' },
    ],
    outputs: [
      { name: 'registry', type: 'address' },
      { name: 'registrar', type: 'address' },
    ],
  },
  {
    type: 'function',
    name: 'deployRegistry',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'admin', type: 'address' }],
    outputs: [{ name: 'registry', type: 'address' }],
  },
  {
    type: 'function',
    name: 'deployRegistrar',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'registry', type: 'address' },
      { name: 'mintPrice', type: 'uint256' },
      { name: 'maxSupply', type: 'uint256' },
      { name: 'admin', type: 'address' },
    ],
    outputs: [{ name: 'registrar', type: 'address' }],
  },
  {
    type: 'event',
    name: 'RegistryAndRegistrarDeployed',
    inputs: [
      { name: 'registry', type: 'address', indexed: true },
      { name: 'registrar', type: 'address', indexed: true },
      { name: 'admin', type: 'address', indexed: true },
    ],
    anonymous: false,
  },
] as const;

