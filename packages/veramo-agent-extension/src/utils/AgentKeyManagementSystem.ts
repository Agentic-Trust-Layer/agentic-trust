import { toUtf8String, SigningKey, computeAddress } from 'ethers'
import { hexToBytes, bytesToHex } from "viem";

import { AgentDidProvider } from './AgentDidProvider.js'

import { AbstractKeyManagementSystem, type Eip712Payload } from '@veramo/key-manager'
import { type DIDDocumentSection, 
  type IAgentContext, 
  type IIdentifier, 
  type IResolver, 
  type MinimalImportableKey, 
  type ManagedKeyInfo,
  type TKeyType,
type IKey } from '@veramo/core-types'

import {
  type _ExtendedIKey,
  isDefined,
  //mapAgentIdentifierKeysToDoc,
  type _NormalizedVerificationMethod,
  resolveDidOrThrow,
  dereferenceDidKeys,
  convertEd25519PublicKeyToX25519,
  convertEd25519PrivateKeyToX25519
} from '@veramo/utils'

import { extractPublicKeyBytes } from 'did-jwt'

import { type DIDResolutionOptions, type VerificationMethod } from 'did-resolver'

import { type IAgentKey } from './AgentTypes.js'

export function compressAgentIdentifierSecp256k1Keys(identifier: IIdentifier): IKey[] {
  return identifier.keys
    .map((key: IKey) => {
      if (key.type === 'Secp256k1') {
        if (key.publicKeyHex) {
          const publicBytes = hexToBytes(key.publicKeyHex as `0x${string}`)
          key.publicKeyHex = SigningKey.computePublicKey(publicBytes, true).substring(2)
          key.meta = { ...key.meta }
          key.meta.ethereumAddress = computeAddress('0x' + key.publicKeyHex)
        }
      }
      return key
    })
    .filter(isDefined)
}
export function convertAgentIdentifierEncryptionKeys(identifier: IIdentifier): IKey[] {
  return identifier.keys
    .map((key: IKey) => {
      if (key.type === 'Ed25519') {
        const publicBytes = hexToBytes(key.publicKeyHex as `0x${string}`)
        key.publicKeyHex = bytesToHex(convertEd25519PublicKeyToX25519(publicBytes))
        if (key.privateKeyHex) {
          const privateBytes = hexToBytes(key.privateKeyHex as `0x${string}`)
          key.privateKeyHex = bytesToHex(convertEd25519PrivateKeyToX25519(privateBytes))
        }
        key.type = 'X25519'
      } else if (key.type !== 'X25519') {
        console.info(`key of type ${key.type} is not supported for [de]encryption`)
        return null
      }
      return key
    })
    .filter(isDefined)
}

export function getAgentEthereumAddress(verificationMethod: VerificationMethod): string | undefined {
  let vmEthAddr = verificationMethod.ethereumAddress?.toLowerCase()
  if (!vmEthAddr) {
    const blockchainAccountId = verificationMethod.blockchainAccountId
    if (blockchainAccountId?.includes('@eip155')) {
      vmEthAddr = blockchainAccountId.split('@eip155')[0]?.toLowerCase()
    } else if (verificationMethod.blockchainAccountId?.startsWith('eip155')) {
      vmEthAddr = verificationMethod.blockchainAccountId.split(':')[2]?.toLowerCase()
    } else {
      const { keyBytes, keyType } = extractPublicKeyBytes(verificationMethod)
      if (keyType !== 'Secp256k1') {
        return undefined
      }
      const pbHex = SigningKey.computePublicKey(keyBytes, false)

      vmEthAddr = computeAddress(pbHex).toLowerCase()
    }
  }
  return vmEthAddr
}

export function compareAgentId(localKey: IKey, verificationMethod: VerificationMethod): boolean {
  //if (localKey.type !== 'Secp256k1') {
  //  return false
  //}
  let vmEthAddr = getAgentEthereumAddress(verificationMethod)
  const localAccount = localKey.meta?.account ?? localKey.meta?.ethereumAddress
  if (localKey.meta?.account) {
    console.info("localKey.meta.account: ", localKey.meta.account)
    console.info("vmEthAddr: ", vmEthAddr)
    return vmEthAddr === localAccount.toLowerCase()
  }
  console.info("localKey.publicKeyHex: ", localKey.publicKeyHex)
  const computedAddr = computeAddress('0x' + localKey.publicKeyHex).toLowerCase()

  console.info("computedAddr: ", computedAddr)
  console.info("vmEthAddr: ", vmEthAddr)
  return computedAddr === vmEthAddr
}

export async function mapAgentIdentifierKeysToDoc(
  identifier: IIdentifier,
  section: DIDDocumentSection = 'keyAgreement',
  context: IAgentContext<IResolver>,
  resolutionOptions?: DIDResolutionOptions,
): Promise<_ExtendedIKey[]> {
  const didDocument = await resolveDidOrThrow(identifier.did, context, resolutionOptions)
  console.info(".............. didDocument: ", didDocument)
  // dereference all key agreement keys from DID document and normalize
  const documentKeys: _NormalizedVerificationMethod[] = await dereferenceDidKeys(
    didDocument,
    section,
    context,
  )
  console.info(".............. documentKeys: ", documentKeys)

  let localKeys = identifier.keys.filter(isDefined)
  console.info("--- identifier keys: ", localKeys)

  if (section === 'keyAgreement') {
    localKeys = convertAgentIdentifierEncryptionKeys(identifier)
  } else {
    localKeys = compressAgentIdentifierSecp256k1Keys(identifier)
  }

  console.info("--- identifier keys2: ", localKeys)

  // finally map the didDocument keys to the identifier keys by comparing `publicKeyHex`
  const extendedKeys: _ExtendedIKey[] = documentKeys
    .map((verificationMethod) => {
      console.info("localKey: ", localKeys)
      console.info("verificationMethod: ", verificationMethod)
      const localKey = localKeys.find(
        (localKey: IKey) =>
          localKey.publicKeyHex === verificationMethod.publicKeyHex ||
          compareAgentId(localKey, verificationMethod),
      )

      console.info("localKey: ", localKey)
      if (localKey) {
        const { meta, ...localProps } = localKey
        return { ...localProps, meta: { ...meta, verificationMethod } }
      } else {
        return null
      }
    })
    .filter(isDefined)

  return extendedKeys
}

export class AgentKeyManagementSystem extends AbstractKeyManagementSystem {

  constructor(private providers: Record<string, AgentDidProvider>) {
    super()
  }

  async createKey({ type }: { type: TKeyType }): Promise<ManagedKeyInfo> {
    throw Error('not_supported: AgentKeyManagementSystem cannot create new keys')
  }


  async importKey(args: Omit<MinimalImportableKey, 'kms'>): Promise<ManagedKeyInfo> {
    return args as any as ManagedKeyInfo
  }

  async listKeys(): Promise<ManagedKeyInfo[]> {
    console.info("********************** listKeys **********************")
    const keys: ManagedKeyInfo[] = []
    for (const provider in this.providers) {
      const providerInstance = this.providers[provider]
      if (!providerInstance) {
        continue
      }
      const account = await providerInstance.getAccount()

      const key: ManagedKeyInfo = {
        kid: `${provider}-${account}`,
        type: 'Secp256k1',
        publicKeyHex: '',
        kms: '',
        meta: {
          account,
          provider,
          algorithms: ['eth_signMessage', 'eth_signTypedData'],
        },
      }
      keys.push(key)
   
    }
    return keys
  }

  async sharedSecret(args: {
    
    myKeyRef: Pick<IKey, 'kid'>
    theirKey: Pick<IKey, 'type' | 'publicKeyHex'>
  }): Promise<string> {
    console.info("********************** sharedSecret **********************")
    throw Error('not_implemented: Web3KeyManagementSystem sharedSecret')
  }

  async deleteKey(args: { kid: string }) {
    console.info("********************** deleteKey **********************")
    // this kms doesn't need to delete keys
    return true
  }



  async sign({
    keyRef,
    algorithm,
    data,
  }: {
    keyRef: Pick<IKey, 'kid'>
    algorithm?: string
    data: Uint8Array
  }): Promise<string> {
    console.info("********************** sign **********************")
    if (algorithm) {
      if (algorithm === 'eth_signMessage') {
        return await this.eth_signMessage(keyRef, data)
      } else if (['eth_signTypedData', 'EthereumEip712Signature2021'].includes(algorithm)) {
        return await this.eth_signTypedData(keyRef, data)
      }
    }

    throw Error(`not_supported: Cannot sign ${algorithm} `)
  }

  /**
   * @returns a `0x` prefixed hex string representing the signed EIP712 data
   */
  private async eth_signTypedData(keyRef: Pick<IKey, 'kid'>, data: Uint8Array) {
    console.info("********************** eth_signTypedData **********************")
    let msg, msgDomain, msgTypes, msgPrimaryType
    const serializedData = toUtf8String(data)
    try {
      const jsonData = JSON.parse(serializedData) as Eip712Payload
      if (typeof jsonData.domain === 'object' && typeof jsonData.types === 'object') {
        const { domain, types, message, primaryType } = jsonData
        msg = message
        msgDomain = domain
        msgTypes = types
        msgPrimaryType = primaryType
      } else {
        // next check will throw since the data couldn't be parsed
      }
    } catch (e) {
      // next check will throw since the data couldn't be parsed
    }
    if (typeof msgDomain !== 'object' || typeof msgTypes !== 'object' || typeof msg !== 'object') {
      throw Error(
        `invalid_arguments: Cannot sign typed data. 'domain', 'types', and 'message' must be provided`,
      )
    }
    delete msgTypes.EIP712Domain

    
    //const signature = await signer.signTypedData(msgDomain, msgTypes, msg)
    const signature = "0xabc"

    return signature
  }

  /**
   * @returns a `0x` prefixed hex string representing the signed message
   */
  private async eth_signMessage(keyRef: Pick<IKey, 'kid'>, rawMessageBytes: Uint8Array) {
    console.info("********************** eth_signMessage **********************")
    //const signature = await signer.signMessage(rawMessageBytes)
    const signature = "0xabc"
    // HEX encoded string, 0x prefixed
    return signature
  }
}
