import { createPublicClient, http, type Address } from 'viem'
import { sepolia } from 'viem/chains'

export type AgentInfo = {
  agentId: bigint
  agentDomain: string
  agentAddress: Address
}

export const identityRegistryAbi = [
  {
    type: 'function',
    name: 'getAgent',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [
      {
        name: 'agentInfo',
        type: 'tuple',
        components: [
          { name: 'agentId', type: 'uint256' },
          { name: 'agentDomain', type: 'string' },
          { name: 'agentAddress', type: 'address' },
        ],
      },
    ],
  },
] as const

export function getPublicClient() {
  return createPublicClient({
    chain: sepolia,
    transport: http(),
  })
}

export async function getRegistryAgent(
  registryAddress: Address,
  agentId: bigint,
): Promise<AgentInfo> {
  const publicClient = getPublicClient()
  const res: any = await publicClient.readContract({
    address: registryAddress,
    abi: identityRegistryAbi,
    functionName: 'getAgent',
    args: [agentId],
  })
  return {
    agentId: BigInt(res.agentId ?? agentId),
    agentDomain: res.agentDomain,
    agentAddress: res.agentAddress as Address,
  }
}


