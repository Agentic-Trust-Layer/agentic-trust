
import {
  type IIdentifier,
  type IService,
  type IAgentContext,
  type IKeyManager,
  type TKeyType,
  type IKeyManagerCreateArgs,
  type MinimalImportableKey,
  type DIDDocument,
    type KeyMetadata, 
} from '@veramo/core'

export interface IAgentKey {
  kid: string
  kms: string
  type: TKeyType
  publicKeyHex: string
  privateKeyHex?: string
  meta?: KeyMetadata
}
