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

import { type IAAKey } from './AATypes.js'

export interface AADidProviderOptions {
  defaultKms: string
  chainId: number
  address: string
}

type IContext = IAgentContext<IKeyManager>

export type ImportOrCreateAAKeyOptions<TKey extends TKeyType = TKeyType> = Omit<
  Partial<IKeyManagerCreateArgs & MinimalImportableKey>,
  'kms'
> & { type: TKey }

export type CreateAAIdentifierBaseOptions<T extends TKeyType = TKeyType> = {
  keyRef?: string;
  key?: ImportOrCreateAAKeyOptions<T>;
}

export class AADidProvider extends AbstractIdentifierProvider {
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
  private address: string

  private providerName: string

  constructor(options: AADidProviderOptions) {
    super()

    this.defaultKms = options.defaultKms
    this.chainId = options.chainId
    this.address = options.address

    this.providerName = `aa:${this.address}`


  }

  // Returns the DID method name
  getSupportedMethods(): string[] {
    return [`aa:${this.address}`]
  }


  getAccount(): string {
    return this.address
  }


  async createIdentifier(
    { kms, alias, options }: { kms?: string; alias?: string; options: MinimalImportableKey },
    context: IContext,
  ): Promise<Omit<IIdentifier, 'provider'>> {

    //console.info(`Resolving DID 111: ${did}`)

    // provider and did are a one to one relationship
    const address = this.address
    const chainId = this.chainId
    const did = `did:aa:eip155:${chainId}:${address}`

    const identifier: IIdentifier = {
      did,
      alias,
      provider: this.providerName,
      controllerKeyId: address, // assumes no local private key; signing done externally or on-chain
      keys: [],
      services: [] as IService[],
    }

    console.info("&&&&&&&&&&&& Creating identifier:", identifier)
    return identifier
  }


  async resolveDid(did: string): Promise<any> {

    console.info(`Resolving DID 222: ${did}`)

    const parts = did.split(':').slice(1)
    const [method, networkId, address] = parts

    if (method !== 'contract') {
      throw new Error(`Unsupported DID method: ${method}`)
    }

    if (!address) {
      throw new Error(`Missing address in DID: ${did}`)
    }

    const controllerAddress = address.toLowerCase()

    return {
      '@context': ['https://www.w3.org/ns/did/v1'],
      id: did,
      verificationMethod: [
        {
          id: `${did}#controller`,
          type: 'EcdsaSecp256k1RecoveryMethod2020',
          controller: did,
          blockchainAccountId: `${controllerAddress}@eip155:${networkId}`,
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
