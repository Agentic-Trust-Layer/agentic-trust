# Error Handling Rules

## Error Types
- Network errors: RPC errors, connection failures
- User errors: Transaction rejection, insufficient funds
- Validation errors: Missing fields, invalid format
- Server errors: Database failures, unexpected exceptions

## Error Messages
- Be specific: "Failed to create agent: transaction rejected" not just "Error"
- User-friendly: Explain what went wrong and how to fix it
- Technical details: Log full error for debugging, but show simplified message to user

## Transaction Errors
- Check for user rejection: `errorMessage.includes('user rejected')`
- Check for insufficient funds: `errorMessage.includes('insufficient funds')`
- Check for RPC errors: `errorMessage.includes('Internal JSON-RPC error')`
- Check for existing resources: `errorMessage.includes('already exists')`

## API Error Responses
- Format: `{ error: 'Error type', message: 'Detailed message' }`
- Include status codes: 400 (bad request), 404 (not found), 500 (server error)
- Always log errors server-side for debugging

## Async Error Handling
- Use try-catch for async operations
- Re-throw errors when needed to propagate to outer catch
- Set error state in UI components for user feedback

