# ATP-Agent Validation Use Cases: Requirements & Client Guide

## Overview

This document describes **two separate validation use cases** that atp-agent must support and what **clients** must do for A2A interactions. Atp-agent is KB-driven: it reads skills, intent types, task types, and intent→task→skill mappings from **discovery GraphQL** (same knowledge graph as taxonomy). No caching (or very short TTL); skills and taxonomy are treated as KB-backed vocabulary.

## Two Separate Use Cases

**Use-case A (Membership)**: Validator agent applies to join Validation Agents Collection
- **Ontology anchor**: `core:intentType.joinValidationAgentsCollection`
- **ATP-agent role**: Validation collection membership agent
- **Client role**: Validator agent seeking membership

**Use-case B (Service Request)**: Client agent requests a validator agent to validate name / account / app endpoint
- **Ontology anchors**: `core:intentType.requestValidation.name` | `requestValidation.account` | `requestValidation.appEndpoint`
- **ATP-agent role**: Validator service provider (ens-validator, smart-account-validator, smart-app-validator)
- **Client role**: Agent requesting validation service

---

## Use-Case A: Validation Collection Membership

### A.1 ATP-Agent: Validation Collection Membership Agent

#### A.1.1 Skills (OASF)

ATP-agent should advertise these A2A skills (OASF keys from KB):

- `validation_collection/eligibility_evaluate`
- `validation_collection/evidence_bundle_prepare`
- `validation_collection/membership_request_submit`
- `validation_collection/membership_status_monitor`

**Source**: Fetch from discovery GraphQL `oasfSkills` (filter by `validation_collection/` prefix). No caching (or very short TTL).

#### A.1.2 Intent Type + Intent

- **IntentType**: `joinValidationAgentsCollection` (from KB `intentTypes`).
- **Intent** (per-request): `core:Intent` with:
  - `core:hasIntentType` → `joinValidationAgentsCollection`
  - `core:targetOrganization` → `"Validation Agents Collection"`
  - `core:desiredStatus` → `"Member"`

#### A.1.3 Task Types + Tasks

- **TaskTypes** (from KB `taskTypes`):
  - `validationCollection.checkRequirements`
  - `validationCollection.prepareEvidence`
  - `validationCollection.submitRequest`
  - `validationCollection.monitorStatus`
- **Tasks**: Executable instances with `core:hasTaskType`, `prov:used`, `core:usesSkill`.

#### A.1.4 Intent → Task → Skill Mapping

- **Source**: KB `intentTaskMappings(intentKey: "joinValidationAgentsCollection")`.
- **Atp-agent**: Query mappings to resolve task types and required skills for the membership workflow.

#### A.1.5 ATP-Agent Capabilities

1. **Eligibility**: Fetch policy + evaluate applicant agent eligibility
   - Input: Applicant agent identifiers (DID, agentId, chainId)
   - Output: Eligibility status (eligible / not eligible / conditionally eligible) + gap analysis
   - Skill: `validation_collection/eligibility_evaluate`

2. **Evidence**: Build evidence bundle (identity, endpoints, supported validations, attestations)
   - Input: Applicant agent metadata, identity proofs, endpoint declarations
   - Output: Structured evidence bundle (JSON/IPFS)
   - Skill: `validation_collection/evidence_bundle_prepare`

3. **Submit**: Submit request to collection (portal/registry/on-chain) and return receipt/reference
   - Input: Evidence bundle, application forms, fees
   - Output: Submission receipt, application reference ID
   - Skill: `validation_collection/membership_request_submit`

4. **Monitor**: Long-running status monitor (polling + notifications)
   - Input: Application reference ID
   - Output: Status updates (pending / under review / accepted / rejected) + decision notifications
   - Skill: `validation_collection/membership_status_monitor`

#### A.1.6 Plan + Actions

- **Plan**: `core:plan.joinValidationAgentsCollection` with steps:
  1. Assess eligibility → if not eligible, provide advisory; if eligible, continue
  2. Collect & normalize evidence
  3. Validate evidence
  4. Submit application
  5. Monitor status (long-running)
  6. Notify outcome
- **Actions**: HTTP GET (fetch policy), GraphDB query (evidence), submit (registry/portal/tx), poll (status).

---

## Use-Case B: Validation Service Requests

### B.1 ATP-Agent: Validator Service Provider

#### B.1.1 Skills (Executable/Normalized)

ATP-agent should advertise these A2A validation skills (already used in core.ttl):

- `governance_and_trust/trust/trust_validate_name` (ENS validator)
- `governance_and_trust/trust/trust_validate_account` (Smart account validator)
- `governance_and_trust/trust/trust_validate_app` (Smart app validator)

**Source**: Hardcoded in atp-agent (these are executable skills, not OASF taxonomy). Subdomain-based routing:
- `name-validation` subdomain → `trust_validate_name`
- `account-validation` subdomain → `trust_validate_account`
- `app-validation` subdomain → `trust_validate_app`

#### B.1.2 Intent Types + Intents

- **IntentTypes** (from KB `intentTypes`):
  - `requestValidation.name`
  - `requestValidation.account`
  - `requestValidation.appEndpoint`
- **Intent** (per-request): `core:Intent` with:
  - `core:hasIntentType` → one of the three above
  - Subject agent identifiers (agentId, chainId, DID)
  - Specific claim (name/account/url)
  - Optional proofs (signatures, DID docs, etc.)

#### B.1.3 ATP-Agent Capabilities

1. **Request Intake**: Normalize parameters + required evidence
   - Input: Validation request payload (agentId, chainId, requestHash, claim type, proofs)
   - Output: Normalized validation context

2. **Perform Validation**: Execute checks
   - **ENS validator** (`name-validation`): ENS resolution, name binding, ownership proof
   - **Smart account validator** (`account-validation`): Account type detection, signature proofs, delegation validation
   - **Smart app validator** (`app-validation`): Endpoint binding, TLS/reachability, protocol compliance
   - Output: Validation result (pass/fail) + reasons + evidence references

3. **Issue Response**: Return accept/reject + reasons + evidence references
   - Input: Validation result
   - Output: On-chain attestation (via session package), response URI (IPFS), response score

#### B.1.4 Validation.Respond Flow (Existing)

- **Ens-validator** (`name-validation`): skill `governance_and_trust/trust/trust_validate_name`; payload `agentId`, `chainId`, `requestHash`, `response`, `responseUri`.
- **Smart-account-validator** (`account-validation`): skill `governance_and_trust/trust/trust_validate_account`; session package required.
- **Smart-app-validator** (`app-validation`): skill `governance_and_trust/trust/trust_validate_app`; session package required.
- **Behavior**: Accept validation-response A2A, run validator-specific logic, submit attestation via session package to ERC-8004 Validation Registry.

### A.1.7 Discovery Endpoints

ATP-agent uses discovery GraphQL:
- `intentTypes(limit, offset)` → `joinValidationAgentsCollection`
- `taskTypes(limit, offset)` → `validationCollection.*`
- `intentTaskMappings(intentKey: "joinValidationAgentsCollection", ...)`
- `oasfSkills(limit, offset)` → filter by `validation_collection/` prefix

---

## Use-Case B: Validation Service Requests (continued)

### B.1.5 Discovery Endpoints

ATP-agent uses discovery GraphQL:
- `intentTypes(limit, offset)` → `requestValidation.name`, `requestValidation.account`, `requestValidation.appEndpoint`
- Task types and mappings for validation request workflows (if any)

---

## 2. What the Client Must Do (A2A Interactions with ATP-Agent)

### 2.1 Use-Case A: Validation Collection Membership

#### A.2.1 Discover + Choose Validation Collection Membership Agent

- Use discovery endpoints to find agents by **intent** and **skills**:
  - Provide `intentType` = `joinValidationAgentsCollection`.
  - Optionally provide `requiredSkills` derived from KB mappings (e.g. `validation_collection/eligibility_evaluate`, etc.).
- Choose an agent that **advertises** the needed A2A skills (`validation_collection/*`).

#### A.2.2 Admin Messaging UI → A2A Call Shape

**UI sends**:
- `intentType` = `joinValidationAgentsCollection`
- `targetOrganization` = `"Validation Agents Collection"`
- `desiredStatus` = `"Member"`
- Applicant agent identifiers (DID, agentId, chainId)
- Evidence pointers (identity proofs, endpoint declarations, attestations)
- Optional context (chain/registry, deadlines)

**A2A message format**:
```json
{
  "skillId": "joinValidationAgentsCollection",
  "message": "Request to join Validation Agents Collection",
  "payload": {
    "intentType": "joinValidationAgentsCollection",
    "targetOrganization": "Validation Agents Collection",
    "desiredStatus": "Member",
    "applicantAgentId": "...",
    "applicantChainId": 11155111,
    "evidencePointers": [...]
  },
  "metadata": {
    "intentType": "joinValidationAgentsCollection",
    "targetOrganization": "Validation Agents Collection",
    "desiredStatus": "Member"
  }
}
```

#### A.2.3 Handle Asynchronous Workflow

**UI expects async flow**:
1. **Immediate**: `requestAccepted: true` + `trackingId` (e.g. `jvac_1234567890_abc123`)
2. **Periodic**: `statusUpdate` messages (polling or callback):
   - Status: `pending` | `under_review` | `accepted` | `rejected`
   - Progress updates, decision notifications
3. **Terminal**: Final state with reasons:
   - `accepted: true` + membership details
   - `rejected: true` + rejection reasons + gap analysis

**When using `/api/a2a/send-validation`** (admin proxy): send `skillId: "joinValidationAgentsCollection"`, `message`, `payload`, and optional `metadata` with intent fields. Atp-agent reads from both `payload` and `metadata`.

---

### 2.2 Use-Case B: Validation Service Requests

#### B.2.1 Discover + Choose Validator Agent

- Use discovery endpoints to find validator agents by **intent** and **skills**:
  - Provide `intentType` = `requestValidation.name` | `requestValidation.account` | `requestValidation.appEndpoint`.
  - Optionally provide `requiredSkills` (e.g. `governance_and_trust/trust/trust_validate_name` for name validation).
- Choose an agent that **advertises** the needed validation skill:
  - `name-validation` subdomain → `trust_validate_name`
  - `account-validation` subdomain → `trust_validate_account`
  - `app-validation` subdomain → `trust_validate_app`

#### B.2.2 Admin Messaging UI → A2A Call Shape

**UI picks one of three intent types**:
- `requestValidation.name` (for ENS validation)
- `requestValidation.account` (for smart account validation)
- `requestValidation.appEndpoint` (for smart app validation)

**UI sends request payload** containing:
- Subject agent id / chain id (`agentId`, `chainId`)
- The specific claim:
  - Name validation: ENS name (e.g. `agent.8004-agent.eth`)
  - Account validation: Account address + type
  - App validation: Endpoint URL + protocol
- Optional proofs (signatures, DID docs, etc.)
- Validation request hash (if creating on-chain request first)

**A2A message format** (validation.respond):
```json
{
  "skillId": "governance_and_trust/trust/trust_validate_name",
  "message": "Process validation request for agent 123",
  "payload": {
    "agentId": "123",
    "chainId": 11155111,
    "requestHash": "0x...",
    "response": 100,
    "responseUri": "ipfs://...",
    "tag": "agent-validation"
  }
}
```

#### B.2.3 Handle Short-Running Response

**UI expects a short-running response** (synchronous):
- `validated: true | false`
- `reasons: string[]` (validation details, evidence references)
- `responseUri: string` (IPFS URI of validation result)
- `txHash: string` (on-chain attestation transaction hash, if applicable)

**Note**: Validation.respond is **synchronous** (unlike membership workflow). Client sends request → validator processes → returns result immediately.

---

---

## 3. Summary Tables

### Use-Case A: Validation Collection Membership

| Layer        | Example                                              | Description                          |
|-------------|------------------------------------------------------|--------------------------------------|
| IntentType  | `joinValidationAgentsCollection`                     | Reusable taxonomy concept            |
| Intent      | Per-request instance with target org, desired status | Validator agent goal                 |
| TaskType    | `validationCollection.checkRequirements`, etc.       | Reusable unit of work                |
| Task        | Concrete instance with hasTaskType, usesSkill        | Contextual execution                 |
| Plan        | `joinValidationAgentsCollection`                     | Orchestrated workflow                |
| Action      | HTTP GET, GraphDB query, submit, poll                | Atomic execution                     |
| OASF Skill  | `validation_collection/eligibility_evaluate`, etc.   | Discoverable capability              |

### Use-Case B: Validation Service Requests

| Layer        | Example                                              | Description                          |
|-------------|------------------------------------------------------|--------------------------------------|
| IntentType  | `requestValidation.name` | `requestValidation.account` | `requestValidation.appEndpoint` | Reusable taxonomy concept |
| Intent      | Per-request instance with subject agent + claim      | Client agent goal                    |
| TaskType    | (May use existing `validation_request` or new types) | Reusable unit of work               |
| Task        | Concrete validation execution                        | Contextual execution                 |
| Skill       | `governance_and_trust/trust/trust_validate_name`, etc. | Executable capability                |
| Response    | `validated: true/false`, `reasons[]`, `responseUri`  | Validation result                    |

---

## 4. Implementation Guidance

### 4.1 ATP-Agent: Validation Collection Membership Agent

**Subdomain**: Any (or dedicated `validation-collection` subdomain)

**Agent Card Skills**:
- Advertise `joinValidationAgentsCollection` as primary skill
- Advertise `validation_collection/*` OASF skills (from KB) in skillOverlay
- Include OASF extension with `validation_collection/*` skills

**A2A Handler** (`joinValidationAgentsCollection`):
1. Accept intent payload (`intentType`, `targetOrganization`, `desiredStatus`, applicant identifiers, evidence pointers)
2. Fetch KB mappings for `joinValidationAgentsCollection` → resolve task types + required skills
3. Execute plan steps:
   - Eligibility assessment (fetch policy, evaluate)
   - Evidence collection (build bundle)
   - Application submission (submit to registry/portal)
   - Status monitoring (long-running, persist state)
4. Return `accepted: true`, `trackingId`, `planId`, `taskTypes`, `requiredSkills`
5. Support async status updates (polling or callback)

**Database**: Persist membership requests in `tasks` table with:
- `type`: `validation_collection.membership_request`
- `status`: `pending` | `under_review` | `accepted` | `rejected`
- `trackingId`: Unique identifier for async workflow

### 4.2 ATP-Agent: Validator Service Provider

**Subdomains**:
- `name-validation` → ENS validator
- `account-validation` → Smart account validator
- `app-validation` → Smart app validator

**Agent Card Skills**:
- Advertise `governance_and_trust/trust/trust_validate_name` (name-validation)
- Advertise `governance_and_trust/trust/trust_validate_account` (account-validation)
- Advertise `governance_and_trust/trust/trust_validate_app` (app-validation)
- Include OASF overlay: `trust.validate.name`, `trust.validate.account`, `trust.validate.app`

**A2A Handler** (`trust_validate_*`):
1. Accept validation request payload (`agentId`, `chainId`, `requestHash`, `response`, `responseUri`, `tag`)
2. Load session package (from database or env)
3. Run validator-specific logic:
   - **ENS validator**: Resolve ENS name, verify ownership, check binding
   - **Smart account validator**: Detect account type, verify signatures, check delegation
   - **Smart app validator**: Check endpoint binding, TLS, reachability, protocol compliance
4. Submit attestation via `processValidationRequestsWithSessionPackage` (on-chain)
5. Return `validationResult` with `success`, `txHash`, `responseUri`

**Database**: Validation responses are submitted on-chain; no local persistence required (existing flow).

### 4.3 Admin Messaging Interface

#### For Use-Case A (Membership)

**Intent Type Dropdown**:
- Show `joinValidationAgentsCollection` from KB `intentTypes`
- Filter task types by intent (from `intentTaskMappings`)

**Message Composition**:
- **Intent Type**: `joinValidationAgentsCollection` (required)
- **To Agent**: Validation collection membership agent (discovered by intent + skills)
- **Payload Fields**:
  - `targetOrganization`: "Validation Agents Collection"
  - `desiredStatus`: "Member"
  - `applicantAgentId`: Subject agent ID
  - `applicantChainId`: Chain ID
  - `evidencePointers`: Array of evidence references
- **Metadata**: Include `intentType`, `targetOrganization`, `desiredStatus` in `metadata` field

**Response Handling**:
- Display `trackingId` for async workflow
- Poll or receive callbacks for status updates
- Show final outcome (accepted/rejected) with reasons

#### For Use-Case B (Validation Service)

**Intent Type Dropdown**:
- Show `requestValidation.name`, `requestValidation.account`, `requestValidation.appEndpoint` from KB `intentTypes`
- Map to appropriate validator subdomain:
  - `requestValidation.name` → `name-validation` subdomain
  - `requestValidation.account` → `account-validation` subdomain
  - `requestValidation.appEndpoint` → `app-validation` subdomain

**Message Composition**:
- **Intent Type**: One of `requestValidation.*` (required)
- **To Agent**: Validator agent (by subdomain or skill matching)
- **Payload Fields**:
  - `agentId`: Subject agent ID to validate
  - `chainId`: Chain ID
  - `requestHash`: On-chain validation request hash (if created first)
  - `response`: Validation score (0-100)
  - `responseUri`: IPFS URI of validation result (auto-generated)
  - `tag`: "agent-validation"

**Response Handling**:
- Display validation result (`validated`, `reasons`, `responseUri`, `txHash`)
- Show on-chain attestation link
- Handle errors (no matching request, session package missing, etc.)

**Note**: For validation requests, the UI may first create an on-chain validation request (ERC-8004 Validation Registry), then send the A2A message with `requestHash` to the validator.

---

## 5. References

- Discovery taxonomy API: `GET /api/discovery/taxonomy` (intentTypes, taskTypes, intentTaskMappings).
- OASF skills: `GET /api/oasf/skills` or GraphQL `oasfSkills`.
- Atp-agent agent card: `/.well-known/agent-card.json` (skills, OASF overlay).
- Validation.respond: `trust_validate_name` | `trust_validate_account` | `trust_validate_app` via A2A.
- Use-case A intent: `joinValidationAgentsCollection`
- Use-case B intents: `requestValidation.name` | `requestValidation.account` | `requestValidation.appEndpoint`
