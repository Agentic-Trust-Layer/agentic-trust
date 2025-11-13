import {
  type IIdentifier,
  type IService,
  type IAgentContext,
  type IKeyManager,
  type TKeyType,
  type IKeyManagerCreateArgs,
  type MinimalImportableKey,
  type DIDDocument,
  type IKey,

} from '@veramo/core'

import { AbstractIdentifierProvider } from '@veramo/did-manager'

import { type IAgentKey } from './AgentTypes.js'

export interface AgentDidProviderOptions {
  defaultKms: string
  chainId: number
  agentId: string
}

type IContext = IAgentContext<IKeyManager>

export type ImportOrCreateAgentKeyOptions<TKey extends TKeyType = TKeyType> = Omit<
  Partial<IKeyManagerCreateArgs & MinimalImportableKey>,
  'kms'
> & { type: TKey }

export type CreateAgentIdentifierBaseOptions<T extends TKeyType = TKeyType> = {
  keyRef?: string;
  key?: ImportOrCreateAgentKeyOptions<T>;
}

export class AgentDidProvider extends AbstractIdentifierProvider {
  async addKey(
    args: { identifier: IIdentifier; key: IKey; options?: any },
    context: IAgentContext<IKeyManager>
  ): Promise<any> {
    // In a real implementation, you would add the key to the identifier's key list and persist it.
    // Here, we simulate this by returning a success response.
    return { success: true, key: args.key }
  }

  private defaultKms: string
  private chainId: number
  private agentId: string

  private providerName: string

  constructor(options: AgentDidProviderOptions) {
    super()

    this.defaultKms = options.defaultKms
    this.chainId = options.chainId
    this.agentId = options.agentId

    this.providerName = `agent:${this.agentId}`


  }

  // Returns the DID method name
  getSupportedMethods(): string[] {
    return [`agent:${this.agentId}`]
  }


  getAccount(): string {
    return this.agentId
  }


  async createIdentifier(
    { kms, alias, options }: { kms?: string; alias?: string; options: MinimalImportableKey },
    context: IContext,
  ): Promise<Omit<IIdentifier, 'provider'>> {

    //console.info(`Resolving DID 111: ${did}`)

    // provider and did are a one to one relationship
    const agentId = this.agentId
    const chainId = this.chainId
    const did = `did:8004:eip155:${chainId}:${agentId}`

    const identifier: IIdentifier = {
      did,
      alias,
      provider: this.providerName,
      controllerKeyId: agentId, // assumes no local private key; signing done externally or on-chain
      keys: [],
      services: [] as IService[],
    }

    console.info("&&&&&&&&&&&& Creating identifier:", identifier)
    return identifier
  }


  async resolveDid(did: string): Promise<any> {

    console.info(`Resolving DID 222: ${did}`)

    const parts = did.split(':').slice(1)
    const [method, networkId, agentId] = parts

    if (method !== 'contract') {
      throw new Error(`Unsupported DID method: ${method}`)
    }

    if (!agentId) {
      throw new Error(`Missing agentId in DID: ${did}`)
    }

    const controllerAddress = agentId.toLowerCase()

    return {
      '@context': ['https://www.w3.org/ns/did/v1'],
      id: did,
      verificationMethod: [
        {
          id: `${did}#controller`,
          type: 'EcdsaSecp256k1RecoveryMethod2020',
          controller: did,
          agentId: `${controllerAddress}@eip155:${networkId}`,
        },
      ],
      authentication: [`${did}#controller`],
    }
  }


  async updateIdentifier(args: { did: string; kms?: string | undefined; alias?: string | undefined; options?: any }, context: IAgentContext<IKeyManager>): Promise<IIdentifier> {
    throw new Error('WebDIDProvider updateIdentifier not supported yet.')
  }

  async deleteIdentifier(identifier: IIdentifier, context: IContext): Promise<boolean> {
    for (const { kid } of identifier.keys) {
      await context.agent.keyManagerDelete({ kid })
    }
    return true
  }




  async addService(
    { identifier, service, options }: { identifier: IIdentifier; service: IService; options?: any },
    context: IContext,
  ): Promise<any> {
    return { success: true }
  }

  async removeKey(
    args: { identifier: IIdentifier; kid: string; options?: any },
    context: IContext,
  ): Promise<any> {
    return { success: true }
  }

  async removeService(
    args: { identifier: IIdentifier; id: string; options?: any },
    context: IContext,
  ): Promise<any> {
    return { success: true }
  }
}
