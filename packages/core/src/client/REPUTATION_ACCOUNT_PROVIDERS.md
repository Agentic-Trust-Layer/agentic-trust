# Agent vs Client Account Providers

## Overview

In the reputation system, there are two distinct parties involved in feedback operations:

1. **Agent** - The service provider (AI agent that provides services)
2. **Client** - The user/client who interacts with the agent and gives feedback

The `AIAgentReputationClient` requires both `agentAccountProvider` and `clientAccountProvider` to handle operations from both perspectives.

## `agentAccountProvider`

**Purpose**: Represents the **agent's** blockchain account (the service provider)

**Used for**:
- **Signing feedback auth tokens** - The agent signs authorization tokens that allow clients to submit feedback
- **Agent-side read operations** - Reading reputation data, getting last index, etc.
- **Base adapter operations** - Used by the BaseReputationClient for general contract calls

**Examples**:
- In a **provider app**: Uses `ProviderApp.accountProvider` (the agent's smart account)
- In an **admin app**: Uses `AdminApp.accountProvider` (admin's account, acting as agent)
- In a **client app**: Uses the same account as client (when agent and client are the same)

## `clientAccountProvider`

**Purpose**: Represents the **client's** blockchain account (the user giving feedback)

**Used for**:
- **Submitting feedback transactions** - When `giveClientFeedback()` is called, it uses `clientAccountProvider.send()` to submit the transaction
- **Client-side read operations** - Reading client-specific reputation data

**Examples**:
- In a **provider app**: Uses `ClientApp.accountProvider` or session key address (the client who owns the session)
- In an **admin app**: Uses `AdminApp.accountProvider` (same as agent, since admin acts as both)
- In a **client app**: Uses `ClientApp.accountProvider` (the client's account)

## Key Distinction

The separation allows for:
- **Agent authorization**: Agent signs feedback auth tokens to authorize clients
- **Client submission**: Client submits feedback transactions using their own account
- **Different custody models**: Agent and client can have different account types (EOA, smart account, etc.)

## Usage in Different App Types

### Admin App
- `agentAccountProvider` = AdminApp.accountProvider
- `clientAccountProvider` = AdminApp.accountProvider (same account, admin acts as both)

### Provider App
- `agentAccountProvider` = ProviderApp.accountProvider (agent's smart account)
- `clientAccountProvider` = ClientApp.accountProvider OR session key address (the client)

### Client App
- `agentAccountProvider` = ClientApp.accountProvider (same account as client)
- `clientAccountProvider` = ClientApp.accountProvider (client's account)

## Example Flow

1. **Client requests feedback auth**:
   - Agent uses `agentAccountProvider` to sign a feedback auth token
   - This authorizes the client to submit feedback

2. **Client submits feedback**:
   - Client uses `clientAccountProvider.send()` to submit the feedback transaction
   - The transaction includes the feedback auth token signed by the agent

This two-account model ensures proper authorization and attribution in the reputation system.

