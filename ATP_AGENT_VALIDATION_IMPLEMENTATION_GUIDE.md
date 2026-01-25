# ATP-Agent Validation Implementation Guide

## Overview

This guide provides **implementation advice** for building ATP-agent validation capabilities and the admin messaging interface to support **two separate use cases**:

- **Use-case A**: Validation collection membership (validator agent applies to join)
- **Use-case B**: Validation service requests (client requests validator to validate name/account/app)

---

## Use-Case A: Validation Collection Membership

### ATP-Agent: Validation Collection Membership Agent

#### Skills to Advertise (OASF from KB)

Fetch from discovery GraphQL `oasfSkills` (filter by `validation_collection/` prefix):

- `validation_collection/eligibility_evaluate`
- `validation_collection/evidence_bundle_prepare`
- `validation_collection/membership_request_submit`
- `validation_collection/membership_status_monitor`

**Implementation**:
```typescript
// In agent card builder (worker.ts / server.ts)
const { validationCollectionSkills } = await fetchOasfTaxonomy(env);
// Filter: validationCollectionSkills.filter(k => k.startsWith('validation_collection/'))

// For validator subdomains, append to skills array:
if (isValidator && validationCollectionSkills.length > 0) {
  skillsFinal = [
    ...skillsFinal,
    {
      id: 'joinValidationAgentsCollection',
      name: 'joinValidationAgentsCollection',
      // ... skill metadata
    },
    ...validationCollectionSkills.map(key => ({
      id: key,
      name: key,
      // ... skill metadata
    }))
  ];
}
```

#### Capabilities to Implement

1. **Eligibility Assessment** (`validation_collection/eligibility_evaluate`)
   - **Input**: Applicant agent identifiers (DID, agentId, chainId)
   - **Action**: Fetch policy from KB/registry, evaluate eligibility criteria
   - **Output**: `{ eligible: true/false, status: 'eligible'|'not_eligible'|'conditionally_eligible', gapAnalysis: {...}, nextStepRecommendations: '...' }`

2. **Evidence Bundle Preparation** (`validation_collection/evidence_bundle_prepare`)
   - **Input**: Applicant agent metadata, identity proofs, endpoint declarations, attestations
   - **Action**: Collect from multiple sources (GraphDB, agent card, on-chain), normalize, validate
   - **Output**: Structured evidence bundle (JSON/IPFS URI)

3. **Membership Request Submission** (`validation_collection/membership_request_submit`)
   - **Input**: Evidence bundle, application forms, fees
   - **Action**: Submit to collection registry/portal (on-chain or off-chain)
   - **Output**: `{ receipt: {...}, applicationReferenceId: '...', submissionReceipt: ipfs://... }`

4. **Status Monitoring** (`validation_collection/membership_status_monitor`)
   - **Input**: Application reference ID
   - **Action**: Poll collection registry/portal for status updates
   - **Output**: `{ status: 'pending'|'under_review'|'accepted'|'rejected', lastUpdate: timestamp, decision: {...} }`
   - **Note**: Long-running; persist state in `tasks` table

#### A2A Handler: `joinValidationAgentsCollection`

**Handler Location**: `apps/atp-agent/src/worker.ts` and `apps/atp-agent/src/server.ts`

**Implementation**:
```typescript
else if (skillId === INTENT_JOIN_VALIDATION_AGENTS_COLLECTION) {
  // Use-case A: Validation Collection Membership
  // Only available on validator subdomains (name-validation, account-validation, app-validation)
  
  const meta = (typeof metadata === 'object' && metadata !== null ? metadata : {}) as Record<string, unknown>;
  const p = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>;
  
  // Normalize intent payload
  const intentType = String(p.intentType ?? meta.intentType ?? INTENT_JOIN_VALIDATION_AGENTS_COLLECTION).trim();
  const targetOrganization = String(p.targetOrganization ?? meta.targetOrganization ?? 'Validation Agents Collection').trim();
  const desiredStatus = String(p.desiredStatus ?? meta.desiredStatus ?? 'Member').trim();
  const applicantAgentId = p.applicantAgentId ?? meta.applicantAgentId;
  const applicantChainId = p.applicantChainId ?? meta.applicantChainId;
  const applicantDid = p.applicantDid ?? meta.applicantDid;
  const context = p.context ?? meta.context ?? message ?? '';

  // Fetch KB mappings to resolve task types + required skills
  const mappings = await fetchIntentTaskMappings(env, intentType);
  const taskTypes = [...new Set(mappings.map(m => m.task?.key).filter(Boolean))];
  const requiredSkills = [...new Set(mappings.flatMap(m => m.requiredSkills || []).filter(Boolean))];

  // Generate tracking ID for async workflow
  const trackingId = `jvac_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  // TODO: Execute plan steps (eligibility → evidence → submit → monitor)
  // For now, return accepted + trackingId

  return {
    accepted: true,
    trackingId,
    planId: 'plan.joinValidationAgentsCollection',
    intentType,
    targetOrganization,
    desiredStatus,
    taskTypes,
    requiredSkills,
    success: true
  };
}
```

**Plan Execution** (Future):
1. Assess eligibility → if not eligible, return advisory; if eligible, continue
2. Collect & normalize evidence → build evidence bundle
3. Validate evidence → ensure meets requirements
4. Submit application → call registry/portal API or on-chain transaction
5. Monitor status → persist in `tasks` table, poll periodically
6. Notify outcome → send status updates to client

#### Agent Card Configuration

**For validator subdomains** (`name-validation`, `account-validation`, `app-validation`):
- Include `joinValidationAgentsCollection` skill in `skills` array
- Include `validation_collection/*` OASF skills in `skillOverlay`:
  ```typescript
  skillOverlay: {
    'joinValidationAgentsCollection': validationCollectionSkills,
    ...Object.fromEntries(validationCollectionSkills.map(k => [k, [k]]))
  }
  ```

---

### Admin Messaging Interface: Use-Case A

#### Intent Type Selection

**UI**: Intent Type dropdown should show `joinValidationAgentsCollection` from KB `intentTypes`.

**Implementation**:
```typescript
// Intent options are fetched from /api/discovery/taxonomy
// Filter to show joinValidationAgentsCollection when available
const intentOptions = useMemo(() => {
  const fromKB = taxonomyIntentTypes.map(it => ({
    value: it.key,
    label: it.label || it.key,
  }));
  return [
    { value: GENERAL_INTENT_KEY, label: 'General' },
    ...fromKB.filter(it => it.value === 'joinValidationAgentsCollection' || /* other intents */)
  ];
}, [taxonomyIntentTypes]);
```

#### Message Composition

**UI Fields**:
- **Intent Type**: `joinValidationAgentsCollection` (required, from dropdown)
- **To Agent**: Validation collection membership agent (discovered by intent + skills)
- **From Agent**: Validator agent applying (selected from owned agents)
- **Content**: Optional context/notes

**Payload Construction**:
```typescript
// When sending joinValidationAgentsCollection
const intentPayload = {
  intentType: 'joinValidationAgentsCollection',
  targetOrganization: 'Validation Agents Collection',
  desiredStatus: 'Member',
  applicantAgentId: selectedFolderAgent.agentId,  // From Agent (applicant)
  applicantChainId: selectedFolderAgent.chainId,
  applicantDid: selectedFromAgentDid,
  context: contentToSend || '',
};

// Send directly to validation collection membership agent's A2A endpoint
const a2aResponse = await fetch(messageEndpoint, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    skillId: 'joinValidationAgentsCollection',
    message: contentToSend || 'Request to join Validation Agents Collection',
    payload: intentPayload,
    metadata: {
      intentType: 'joinValidationAgentsCollection',
      targetOrganization: 'Validation Agents Collection',
      desiredStatus: 'Member',
      source: 'admin-app',
      timestamp: new Date().toISOString(),
    },
  }),
});
```

#### Response Handling

**UI expects**:
1. **Immediate**: `{ accepted: true, trackingId: 'jvac_...', planId: '...', taskTypes: [...], requiredSkills: [...] }`
2. **Periodic**: Status updates (polling or callback) with `status: 'pending'|'under_review'|'accepted'|'rejected'`
3. **Terminal**: Final outcome with reasons

**UI Implementation**:
```typescript
// Display tracking ID
if (a2aData?.response?.trackingId) {
  console.log('Tracking ID:', a2aData.response.trackingId);
  // Store in state, show in UI, enable polling
}

// Poll for status updates (or receive callbacks)
// TODO: Implement status polling endpoint or callback mechanism
```

---

## Use-Case B: Validation Service Requests

### ATP-Agent: Validator Service Provider

#### Skills to Advertise (Executable)

**Hardcoded** (not from KB; these are executable skills):

- `governance_and_trust/trust/trust_validate_name` (ENS validator, `name-validation` subdomain)
- `governance_and_trust/trust/trust_validate_account` (Smart account validator, `account-validation` subdomain)
- `governance_and_trust/trust/trust_validate_app` (Smart app validator, `app-validation` subdomain)

**Implementation**:
```typescript
// In buildSkills() function (worker.ts / server.ts)
const baseSkills = [
  {
    id: 'governance_and_trust/trust/trust_validate_name',
    name: 'governance_and_trust/trust/trust_validate_name',
    // ... skill metadata
  },
  {
    id: 'governance_and_trust/trust/trust_validate_account',
    name: 'governance_and_trust/trust/trust_validate_account',
    // ... skill metadata
  },
  {
    id: 'governance_and_trust/trust/trust_validate_app',
    name: 'governance_and_trust/trust/trust_validate_app',
    // ... skill metadata
  },
  // ... other skills
];
```

#### Capabilities to Implement

1. **Request Intake** (normalize parameters + required evidence)
   - **Input**: `{ agentId, chainId, requestHash, response, responseUri, tag }`
   - **Action**: Validate payload, load session package, check for matching on-chain validation request
   - **Output**: Normalized validation context

2. **Perform Validation** (execute checks)
   - **ENS validator** (`name-validation`):
     - Resolve ENS name → check binding → verify ownership
   - **Smart account validator** (`account-validation`):
     - Detect account type → verify signatures → check delegation
   - **Smart app validator** (`app-validation`):
     - Check endpoint binding → TLS/reachability → protocol compliance
   - **Output**: Validation result (pass/fail) + reasons + evidence references

3. **Issue Response** (return accept/reject + reasons + evidence references)
   - **Input**: Validation result
   - **Action**: Submit attestation via `processValidationRequestsWithSessionPackage` (on-chain to ERC-8004 Validation Registry)
   - **Output**: `{ validationResult: { success, txHash, responseUri, ... } }`

#### A2A Handler: `trust_validate_*`

**Handler Location**: `apps/atp-agent/src/worker.ts` and `apps/atp-agent/src/server.ts`

**Implementation** (existing, unchanged):
```typescript
else if (
  skillId === 'governance_and_trust/trust/trust_validate_name' ||
  skillId === 'governance_and_trust/trust/trust_validate_account' ||
  skillId === 'governance_and_trust/trust/trust_validate_app'
) {
  // Use-case B: Validation Service Request
  // Synchronous validation response
  
  const agentIdParam = payload?.agentId ?? metadata?.agentId;
  const chainIdParam = payload?.chainId ?? metadata?.chainId ?? DEFAULT_CHAIN_ID;
  const requestHashParam = payload?.requestHash;
  const responseScore = payload?.response ?? 100;
  const responseUriParam = payload?.responseUri;
  const responseTag = payload?.tag ?? 'agent-validation';

  // Load session package (from database or env)
  // Run validator-specific logic (ENS / account / app)
  // Submit attestation via processValidationRequestsWithSessionPackage
  
  return {
    validationResult: {
      success: true,
      txHash: '...',
      responseUri: 'ipfs://...',
      // ...
    }
  };
}
```

**Subdomain Routing**:
- `name-validation` subdomain → `trust_validate_name` skill
- `account-validation` subdomain → `trust_validate_account` skill
- `app-validation` subdomain → `trust_validate_app` skill

---

### Admin Messaging Interface: Use-Case B

#### Intent Type Selection

**UI**: Intent Type dropdown should show `requestValidation.name`, `requestValidation.account`, `requestValidation.appEndpoint` from KB `intentTypes`.

**Implementation**:
```typescript
// Intent options from KB
const intentOptions = useMemo(() => {
  const fromKB = taxonomyIntentTypes.map(it => ({
    value: it.key,
    label: it.label || it.key,
  }));
  return [
    { value: GENERAL_INTENT_KEY, label: 'General' },
    ...fromKB.filter(it => 
      it.value === 'requestValidation.name' ||
      it.value === 'requestValidation.account' ||
      it.value === 'requestValidation.appEndpoint'
    )
  ];
}, [taxonomyIntentTypes]);
```

#### Message Composition

**UI Fields**:
- **Intent Type**: One of `requestValidation.name` | `requestValidation.account` | `requestValidation.appEndpoint` (required, from dropdown)
- **To Agent**: Validator agent (auto-selected by subdomain or skill matching):
  - `requestValidation.name` → `name-validation` subdomain
  - `requestValidation.account` → `account-validation` subdomain
  - `requestValidation.appEndpoint` → `app-validation` subdomain
- **From Agent**: Agent to be validated (selected from owned agents)
- **Validation Type**: Claim type (compliance, security, etc.)
- **Validation Details**: Optional description

**Payload Construction** (for validation.respond):
```typescript
// First, create on-chain validation request (ERC-8004 Validation Registry)
const validationResult = await requestValidationFn({
  requesterDid,
  requestUri: 'ipfs://...',
  requestHash: '0x...',
  validatorAddress: toAgent.agentAccount,
  // ...
});

// Then, send A2A message with validation.respond skill
// (This is handled via /api/a2a/send-validation or direct A2A call)
const response = await fetch('/api/a2a/send-validation', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    a2aEndpoint: toAgentCardUrl,
    skillId: 'governance_and_trust/trust/trust_validate_name', // or trust_validate_account, trust_validate_app
    message: `Process validation request for agent ${agentId}`,
    payload: {
      agentId,
      chainId,
      requestHash: validationResult.requestHash,
      response: 100,
      responseUri: 'ipfs://...', // Auto-generated
      tag: 'agent-validation',
    },
  }),
});
```

#### Response Handling

**UI expects** (synchronous):
- `{ validated: true/false, reasons: string[], responseUri: string, txHash: string }`

**UI Implementation**:
```typescript
// Display validation result
if (a2aData?.response?.validationResult) {
  const result = a2aData.response.validationResult;
  console.log('Validation result:', {
    validated: result.success,
    reasons: result.reasons || [],
    responseUri: result.responseUri,
    txHash: result.txHash,
  });
  // Show in UI, link to on-chain attestation
}
```

---

## Key Differences Between Use Cases

| Aspect | Use-Case A (Membership) | Use-Case B (Service Request) |
|--------|------------------------|------------------------------|
| **Intent Type** | `joinValidationAgentsCollection` | `requestValidation.name` \| `requestValidation.account` \| `requestValidation.appEndpoint` |
| **Skills** | `validation_collection/*` (OASF from KB) | `governance_and_trust/trust/trust_validate_*` (executable) |
| **Flow** | Async (eligibility → evidence → submit → monitor) | Synchronous (request → validate → attestation) |
| **Response** | `accepted: true, trackingId, planId` | `validationResult: { success, txHash, responseUri }` |
| **State** | Persisted in `tasks` table (long-running) | On-chain only (ERC-8004 Validation Registry) |
| **ATP-Agent Role** | Validation collection membership agent | Validator service provider |
| **Client Role** | Validator agent applying | Agent requesting validation |

---

## Discovery GraphQL Queries

Both use cases rely on discovery GraphQL:

**Use-Case A**:
```graphql
query {
  intentTypes(key: "joinValidationAgentsCollection") { key label description }
  taskTypes(key: "validationCollection.*") { key label description }
  intentTaskMappings(intentKey: "joinValidationAgentsCollection") {
    intent { key }
    task { key }
    requiredSkills
    optionalSkills
  }
  oasfSkills(key: "validation_collection/*") { key caption category }
}
```

**Use-Case B**:
```graphql
query {
  intentTypes(key: "requestValidation.*") { key label description }
  # Task types and mappings for validation request workflows (if any)
}
```

---

## Testing

### Use-Case A Testing

1. **Discover validation collection membership agent**:
   ```bash
   curl -X POST https://discovery-endpoint/graphql \
     -H "Content-Type: application/json" \
     -d '{
       "query": "query { searchAgentsGraph(where: { a2aSkills_in: [\"joinValidationAgentsCollection\"] }) { agents { agentId agentName } } }"
     }'
   ```

2. **Send joinValidationAgentsCollection request**:
   ```bash
   curl -X POST https://validation-collection-agent.8004-agent.io/api/a2a \
     -H "Content-Type: application/json" \
     -d '{
       "skillId": "joinValidationAgentsCollection",
       "payload": {
         "intentType": "joinValidationAgentsCollection",
         "targetOrganization": "Validation Agents Collection",
         "desiredStatus": "Member",
         "applicantAgentId": "123",
         "applicantChainId": 11155111
       }
     }'
   ```

3. **Expected response**:
   ```json
   {
     "accepted": true,
     "trackingId": "jvac_1234567890_abc123",
     "planId": "plan.joinValidationAgentsCollection",
     "taskTypes": ["validationCollection.checkRequirements", ...],
     "requiredSkills": ["validation_collection/eligibility_evaluate", ...]
   }
   ```

### Use-Case B Testing

1. **Discover validator agent**:
   ```bash
   curl -X POST https://discovery-endpoint/graphql \
     -H "Content-Type: application/json" \
     -d '{
       "query": "query { searchAgentsGraph(where: { a2aSkills_in: [\"governance_and_trust/trust/trust_validate_name\"] }) { agents { agentId agentName } } }"
     }'
   ```

2. **Send validation.respond request**:
   ```bash
   curl -X POST https://name-validation.8004-agent.io/api/a2a \
     -H "Content-Type: application/json" \
     -d '{
       "skillId": "governance_and_trust/trust/trust_validate_name",
       "payload": {
         "agentId": "123",
         "chainId": 11155111,
         "requestHash": "0x...",
         "response": 100,
         "responseUri": "ipfs://...",
         "tag": "agent-validation"
       }
     }'
   ```

3. **Expected response**:
   ```json
   {
     "validationResult": {
       "success": true,
       "txHash": "0x...",
       "responseUri": "ipfs://...",
       "response": 100
     }
   }
   ```

---

## References

- Requirements: `ATP_AGENT_VALIDATION_USE_CASE.md`
- Discovery taxonomy: `GET /api/discovery/taxonomy`
- OASF skills: `GET /api/oasf/skills` or GraphQL `oasfSkills`
- Atp-agent agent card: `/.well-known/agent-card.json`
