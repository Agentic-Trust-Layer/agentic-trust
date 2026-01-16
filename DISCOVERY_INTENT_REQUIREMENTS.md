# Discovery Backend Requirements: Intent-Based Agent Search

## Overview
The admin messaging interface sends **intent-based requests** to the discovery backend. The backend should interpret these intents using:
1. **Intent type → skills mapping** (from `a2aTasks.ts`)
2. **Semantic vector search** (using existing embedding capabilities)
3. **Skill filtering** (using indexed skills from agent-card.json and registration JSON)

## Current Implementation

The frontend already:
- ✅ Sends intent-based requests to `/api/agents/semantic-search`
- ✅ Provides `intentJson` with intent type and optional query text
- ✅ Provides `requiredSkills` array for backend filtering (skill IDs in `governance_and_trust/*` format)

## What Discovery Backend Needs to Add/Change

### 1. Intent Type → Skills Mapping

The backend needs to map intent types to required skills. Use this mapping (only new skill ID format):

```typescript
const INTENT_TO_SKILLS_MAP: Record<string, string[]> = {
  'governance.membership.add': ['governance_and_trust/membership/add_member'],
  'governance.membership.remove': ['governance_and_trust/membership/remove_member'],
  'governance.membership.verify': ['governance_and_trust/membership/verify_membership'],
  'governance.alliance.join': ['governance_and_trust/alliance/join_alliance'],
  'governance.alliance.leave': ['governance_and_trust/alliance/leave_alliance'],
  'governance.alliance.verify': ['governance_and_trust/alliance/verify_alliance_membership'],
  'governance.delegation.add': ['governance_and_trust/delegation/add_delegation'],
  'governance.delegation.revoke': ['governance_and_trust/delegation/revoke_delegation'],
  'governance.delegation.verify': ['governance_and_trust/delegation/verify_delegation'],
  'trust.name_validation': ['governance_and_trust/trust/trust_validate_name'],
  'trust.account_validation': ['governance_and_trust/trust/trust_validate_account'],
  'trust.app_validation': ['governance_and_trust/trust/trust_validate_app'],
  'trust.feedback': ['governance_and_trust/trust/trust_feedback_authorization'],
  // Note: trust.association, trust.membership, trust.delegation intents don't have executable skills
  // and should not be used for skill-based filtering
};
```

### 2. Enhanced GraphQL Schema

Update the `semanticAgentSearch` GraphQL query to accept additional parameters:

```graphql
input SemanticAgentSearchInput {
  text: String                    # Free-form text query (existing)
  intentJson: String              # JSON string with intentType, action, query (existing)
  topK: Int                       # Number of results (existing)
  requiredSkills: [String!]       # NEW: Skill IDs in governance_and_trust/* format
  minScore: Float                 # NEW: Minimum similarity score threshold
}
```

The frontend currently sends `intentJson` and `topK`. Add support for `requiredSkills` in the input.

### 3. Intent Interpretation Logic in GraphQL Resolver

When the `semanticAgentSearch` resolver receives a request:

1. **Parse `intentJson`** (if provided):
   ```json
   {
     "intentType": "governance.membership.add",
     "action": "...",
     "query": "optional user query text"
   }
   ```

2. **Extract intent type** from `intentJson.intentType` (e.g., `"governance.membership.add"`)

3. **Map to required skills** using `INTENT_TO_SKILLS_MAP`:
   - If `requiredSkills` are provided in the input, use those
   - Otherwise, look up skills from the intent type mapping
   - Example: `"governance.membership.add"` → `["governance_and_trust/membership/add_member"]`

4. **Build semantic query text** for embedding:
   - Intent type label (e.g., "Add Member" for `governance.membership.add`)
   - Intent description/context
   - Optional user query text from `intentJson.query`
   - Example: `"Add Member. Add a member to a membership group. {user query}"`

5. **Generate query embedding** using your existing `SemanticSearchService.generateEmbeddingResilient()`

6. **Query vector store** with:
   - Query vector (from step 5)
   - `topK` parameter (default: 50)
   - Optional `minScore` threshold
   - **Filter by skills** (if vector store supports metadata filtering):
     - Filter vectors where `metadata.a2aSkills` contains any of `requiredSkills`

7. **Post-filter results** (if vector store doesn't support skill filtering):
   - For each match, check the agent's indexed skills
   - Keep only agents that have at least one of the `requiredSkills`
   - Skills are indexed in agent vectors' metadata (see section 5)

8. **Return matching agents** sorted by relevance score (descending)

### 4. Skill Indexing Requirements

The backend must index skills from:

**A. Agent Registration JSON** (`rawJson`):
```json
{
  "endpoints": [
    {
      "name": "A2A",
      "a2aSkills": [
        "governance_and_trust/membership/add_member",
        "governance_and_trust/trust/trust_validate_name"
      ]
    }
  ]
}
```

**B. Agent Card JSON** (from `.well-known/agent-card.json`):
```json
{
  "skills": [
    { "id": "governance_and_trust/membership/add_member", "name": "...", ... },
    { "id": "governance_and_trust/trust/trust_validate_name", ... }
  ]
}
```

**Index both sources** and merge them. Skills should be stored in the indexed format: `governance_and_trust/*`

### 5. Vector Embedding for Intent Search

When building agent vectors using your existing `SemanticSearchService.upsertAgent()`:

1. **Include skills in embedding text** (in `buildAgentText()` or `prepareAgentText()`):
   - Add `Skills: {skill1}, {skill2}, ...` to the agent text
   - Use skill IDs in `governance_and_trust/*` format
   - Example: `"Skills: governance_and_trust/membership/add_member, governance_and_trust/trust/trust_validate_name"`
   
2. **Include skills in vector metadata** (in `buildVectorMetadata()`):
   ```typescript
   metadata: {
     chainId: record.chainId,
     agentId: record.agentId,
     name: record.name,
     // NEW: Add indexed skills for filtering
     a2aSkills: [...skillIds],  // e.g., ["governance_and_trust/membership/add_member", "governance_and_trust/trust/trust_validate_name"]
     // ... other metadata
   }
   ```

3. **Extract skills from agent sources**:
   - From registration JSON: `rawJson.endpoints[].a2aSkills` → `metadata.a2aSkills`
   - From agent-card.json: `skills[].id` → `metadata.a2aSkills`
   - Only index skills in `governance_and_trust/*` format (ignore any OASF format skills)

4. **Intent query embedding**:
   - Embed the intent type label + description + optional user query
   - Example: `"Add Member. Add a member to a membership group. {user query}"`
   - Use `SemanticSearchService.generateEmbeddingResilient()` for the query text

### 6. Response Format

Return agents with metadata indicating skill matches:

```typescript
interface SemanticSearchResponse {
  matches: Array<{
    agent: AgentData;
    score: number;
    matchedSkills?: string[];      // Which required skills the agent has (governance_and_trust/* format)
  }>;
  intentType?: string;            // Echo back the intent type
  total?: number;                 // Total matching agents
}
```

### 7. Implementation Flow in GraphQL Resolver

```
1. Receive GraphQL query: semanticAgentSearch(input: { intentJson, topK, requiredSkills? })
2. Parse intentJson JSON to extract intentType (e.g., "governance.membership.add")
3. Determine required skills:
   - If requiredSkills provided → use those
   - Otherwise → look up from INTENT_TO_SKILLS_MAP using intentType
4. Build semantic query text:
   - Map intentType to label: "governance.membership.add" → "Add Member"
   - Append description: "Add a member to a membership group"
   - Append user query from intentJson.query (if provided)
   - Result: "Add Member. Add a member to a membership group. {user query}"
5. Generate query embedding using SemanticSearchService.generateEmbeddingResilient(queryText)
6. Query vector store (SemanticSearchService.search()):
   - vector: query embedding from step 5
   - topK: input.topK or 50
   - filter: { 
       a2aSkills: { $in: requiredSkills }  // If vector store supports metadata filtering
     }
   - minScore: input.minScore or default
7. Post-filter results (if vector store doesn't support skill filtering):
   - For each match, check match.metadata.a2aSkills
   - Keep only agents where match.metadata.a2aSkills includes any of requiredSkills
8. Sort by match.score (descending)
9. Return { total: filtered.length, matches: sortedMatches }
```

### 8. GraphQL Schema Support (Optional but Recommended)

If using GraphQL for skill filtering, add to `AgentWhereInput`:

```graphql
input AgentWhereInput {
  # ... existing fields ...
  a2aSkills_in: [String!]  # Filter by skill IDs (governance_and_trust/* format)
}
```

This allows pre-filtering before vector search, improving performance.

### 9. Skill Format Normalization

When indexing skills, use only the new format:
- Registration JSON: Use `endpoints[].a2aSkills` as-is (should be in `governance_and_trust/*` format)
- Agent Card: Use `skills[].id` as-is (should be in `governance_and_trust/*` format)
- Ignore any OASF format skills (e.g., `trust.validate.name`) - only index `governance_and_trust/*` format

### 10. Testing

Test with intent-based requests:

```bash
curl -X POST https://your-discovery-endpoint/api/agents/semantic-search \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "intentType": "governance.membership.add",
    "requiredSkills": ["governance_and_trust/membership/add_member"],
    "topK": 50
  }'
```

Or with intentJson:

```bash
curl -X POST https://your-discovery-endpoint/api/agents/semantic-search \
  -H "Content-Type: application/json" \
  -d '{
    "intentJson": "{\"intentType\":\"governance.membership.add\",\"query\":\"\"}",
    "requiredSkills": ["governance_and_trust/membership/add_member"],
    "topK": 50
  }'
```

Expected: Returns agents that have the `governance_and_trust/membership/add_member` skill, ranked by semantic similarity to "Add Member" intent.

## Summary

**Key Changes Needed in Discovery Backend:**

1. ✅ **Add intent type → skills mapping** (use the mapping in section 1, only `governance_and_trust/*` format)
2. ✅ **Update GraphQL `SemanticAgentSearchInput`** to accept `requiredSkills` (only new format)
3. ✅ **Update `semanticAgentSearch` resolver** to:
   - Parse `intentJson` and extract `intentType`
   - Map intent type to required skills (if not provided in input)
   - Build semantic query text from intent type label + description + user query
   - Use `SemanticSearchService` to generate query embedding and search
   - Filter results by skills (either via vector store metadata filter or post-filter)
4. ✅ **Index skills in vector metadata** when upserting agents:
   - Extract `a2aSkills` from registration JSON and agent-card.json
   - Only index skills in `governance_and_trust/*` format (ignore OASF format)
   - Store in `metadata.a2aSkills` array
5. ✅ **Include skills in embedding text** (already done if skills are in `record.capabilities` or `record.metadata`)
6. ✅ **Return skill match metadata** in response (optional, for debugging)

**Leverage Existing:**
- ✅ `SemanticSearchService` class (already have)
- ✅ `generateEmbeddingResilient()` method (already have)
- ✅ `search()` method with vector queries (already have)
- ✅ `upsertAgent()` / `upsertAgents()` for indexing (already have)
- ✅ Agent-card.json and registration JSON parsing (already have)

**New Requirements:**
- Intent type → skills mapping logic
- Skills extraction and indexing in vector metadata
- Skill-based filtering in vector queries or post-filtering
- Intent query text generation from intent type labels
