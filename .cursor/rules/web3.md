# Web3 & Blockchain Rules

## Libraries
- Use `viem` for Ethereum interactions (not ethers.js)
- Use `@agentic-trust/core` for agent operations
- Use `@metamask/delegation-toolkit` for account abstraction

## Account Abstraction
- Use `MetaMaskSmartAccount` for AA clients
- Counterfactual addresses: Use `getCounterfactualAAAddressByAgentName`
- Deployed accounts: Use `getDeployedAccountClientByAgentName`

## DID Handling
- DID formats: `did:8004:...`, `did:ethr:...`, `did:ens:...`
- Always decode URL-encoded DIDs: `decodeURIComponent(did)`
- Parse DIDs properly before use

## Transaction Handling
- Use `sendUserOperation`, `sendTransaction`, or `sendBatch` based on client type
- Handle transaction errors gracefully (user rejection, insufficient funds, RPC errors)
- Provide clear error messages to users

## Chain Support
- Supported chains: Sepolia (11155111), Base Sepolia (84532), Optimism Sepolia (11155420)
- Use `sepolia` from `viem/chains` for chain config
- Always specify chainId when making blockchain calls

