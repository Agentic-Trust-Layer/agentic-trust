# Name Validation Service

A simple Express service that processes name validation requests for agents. The validator reads validation requests from the validation registry contract, validates that agent names exist and are owned by the correct agent accounts, and submits validation responses with a score of 100 for valid agents.

## Features

- Reads validation requests from the validation registry contract
- Filters for unprocessed requests matching the validator address
- Validates agent names exist and are owned by agent accounts
- Submits validation responses with score 100 for valid agents
- Processes all pending validation requests in a single run

## Setup

1. Install dependencies:
```bash
npm install
```

2. Configure environment variables in `.env`:
```env
# Required: Validator private key (EOA private key for validator app - used for signing)
AGENTIC_TRUST_VALIDATOR_PRIVATE_KEY=your_private_key_here

# Required: Validator ENS private key (EOA private key for validator account abstraction - used to calculate validator AA address)
AGENTIC_TRUST_VALIDATOR_PRIVATE_KEY=your_ens_private_key_here

# Required: Enable validator app role
AGENTIC_TRUST_APP_ROLES=validator

# Required: RPC URL for the chain
AGENTIC_TRUST_RPC_URL_SEPOLIA=https://sepolia.infura.io/v3/your_key

# Required: Validation registry contract address
AGENTIC_TRUST_VALIDATION_REGISTRY_SEPOLIA=0x...

# Optional: Server port (default: 3003)
PORT=3003
```

## Usage

### Development

Run the server in development mode with hot reload:
```bash
npm run dev
```

### Production

Build and run:
```bash
npm run build
npm start
```

## API Endpoints

### `GET /health`
Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### `POST /api/validate`
Process all pending validation requests for the validator.

**Request Body (optional):**
```json
{
  "chainId": 11155111
}
```

**Response:**
```json
{
  "success": true,
  "chainId": 11155111,
  "processed": 5,
  "successful": 4,
  "failed": 1,
  "results": [
    {
      "requestHash": "0x...",
      "agentId": "123",
      "chainId": 11155111,
      "success": true,
      "txHash": "0x..."
    },
    {
      "requestHash": "0x...",
      "agentId": "124",
      "chainId": 11155111,
      "success": false,
      "error": "ENS name does not exist"
    }
  ]
}
```

### `GET /api/status`
Get the current status of validation requests for the validator.

**Query Parameters (optional):**
- `chainId`: Chain ID (default: 11155111)

**Response:**
```json
{
  "validatorAddress": "0x...",
  "chainId": 11155111,
  "totalRequests": 10,
  "pending": 3,
  "completed": 7,
  "pendingRequests": [...],
  "completedRequests": [...]
}
```

## How It Works

1. **Validator App**: The validator app uses `AGENTIC_TRUST_VALIDATOR_PRIVATE_KEY` for signing transactions via the `validatorApp` userApp.

2. **Validator Address**: The validator address (AA address) is derived from `AGENTIC_TRUST_VALIDATOR_PRIVATE_KEY` using the same method as in the admin app (seed: 'name-validator'). This is the address that validation requests are sent to.

2. **Reading Requests**: The service calls `getValidatorRequests(validatorAddress)` to get all validation requests for the validator.

3. **Filtering**: Only requests with `response === 0` (unprocessed) are processed.

4. **Validation**: For each request:
   - Gets agent information using the core library
   - Validates the agent's name exists using `getAgentIdentityByName`
   - Verifies the name resolves to the agent's account address using `getAgentAccountByName`
   - Checks that the resolved address matches the agent's account address

5. **Response**: If validation passes, submits a validation response with score 100 using `validationResponse`.

## Notes

- The validator only processes requests where `response === 0` (pending/unprocessed)
- Validation responses are submitted with a score of 100 for valid agents
- The validator uses `validatorApp` (via `AGENTIC_TRUST_VALIDATOR_PRIVATE_KEY`) for signing transactions
- The validator address (AA address) uses the same account abstraction address calculation as the admin app (seed: 'name-validator')
- All validation logic uses the `@agentic-trust/core` library and `AgenticTrustClient` for consistency

