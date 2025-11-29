# Web3Auth Rules

## Authentication Flow
- Use `useWeb3Auth` hook for Web3Auth operations
- Connect: `await connect()` from Web3Auth provider
- Get user info: `await getUserInfo()` after connection
- Logout: `await logout()` to disconnect

## Provider Access
- Get provider: `(web3auth as any).provider`
- Request accounts: `await provider.request({ method: "eth_accounts" })`
- Handle provider availability checks before use

## User Context
- Use `useConnection` hook for user state
- Store user email and name in connection context
- Persist connection state across page reloads

## Account Abstraction
- Get individual AA: `IndivService.getCounterfactualAccountClientByIndividual`
- Use provider for AA client creation
- Handle AA address resolution properly

## Error Handling
- Check if Web3Auth is initialized before use
- Handle connection failures gracefully
- Provide clear error messages for auth issues

