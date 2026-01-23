export type DelegationMessage = {
  delegate: `0x${string}`;
  delegator: `0x${string}`;
  authority: `0x${string}`;
  caveats: any[];
  salt: `0x${string}`;
  signature: `0x${string}`;
};

export type SignedDelegation = 
  | {
      // New flattened structure: delegation properties at top level
      delegate: `0x${string}`;
      delegator: `0x${string}`;
      authority: `0x${string}`;
      caveats: any[];
      salt: `0x${string}`;
      signature: `0x${string}`;
    }
  | {
      // Legacy structure: delegation properties nested under message
      message: DelegationMessage;
      signature: `0x${string}`;
    };

export type SessionPackage = {
  agentId: number;
  chainId: number;
  aa: `0x${string}`;
  sessionAA?: `0x${string}`;
  selector: `0x${string}`;
  // SC-DELEGATION config used for ERC-8092 keyType 0x8004 proof validation.
  // Required when the agent intends to produce SC-DELEGATION proofs off-chain.
  scDelegation?: {
    associationsStoreProxy: `0x${string}`;
    delegationManager: `0x${string}`;
    scDelegationEnforcer: `0x${string}`;
    scDelegationVerifier: `0x${string}`;
  };
  sessionKey: {
    privateKey: `0x${string}`;
    address: `0x${string}`;
    validAfter: number;
    validUntil: number;
  };
  entryPoint: `0x${string}`;
  bundlerUrl: string;
  delegationRedeemData?: `0x${string}`;
  signedDelegation: SignedDelegation;
};


