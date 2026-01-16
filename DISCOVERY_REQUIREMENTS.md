# Discovery GraphQL Endpoint Requirements for Skill Filtering

## Problem
When users select an intent type (e.g., "Add Member") in the messaging interface, the "to agent" dropdown should only show agents that have the required skills. Currently, this filtering needs to happen at the GraphQL discovery layer.

## Required GraphQL Schema Support

### 1. AgentWhereInput must support `a2aSkills_in` filter

The GraphQL `AgentWhereInput` type must support filtering by skills:

```graphql
input AgentWhereInput {
  # ... existing fields ...
  a2aSkills_in: [String!]  # Array of skill IDs to match (OR logic - agent must have at least one)
}
```

### 2. Skills must be indexed from agent registration JSON

The discovery indexer must extract and index skills from:
- **Agent Registration JSON** (`rawJson`): `endpoints[].a2aSkills` array
- **Agent Card JSON** (from `.well-known/agent-card.json`): `skills[].id` array

Skills should be stored in the indexed format: `governance_and_trust/*` (e.g., `governance_and_trust/membership/add_member`)

### 3. Query Implementation

When `a2aSkills_in` is provided in the `where` clause, the GraphQL resolver should:

1. Extract skills from agent's `rawJson.endpoints[].a2aSkills` OR from agent-card.json `skills[].id`
2. Match if the agent has **at least one** of the skills in the `a2aSkills_in` array
3. Return only matching agents

### Example Query

```graphql
query SearchAgentsBySkill {
  searchAgentsGraph(
    where: {
      a2aSkills_in: ["governance_and_trust/membership/add_member"]
    }
    first: 50
    skip: 0
    orderBy: createdAtTime
    orderDirection: DESC
  ) {
    agents {
      chainId
      agentId
      agentName
      agentAccount
      # ... other fields
    }
    total
    hasMore
  }
}
```

## Current Code Behavior

The codebase already:
- ✅ Passes `a2aSkills` parameter to `/api/agents/search` endpoint
- ✅ Maps `a2aSkills` to `where.a2aSkills_in` in `buildAgentWhereInput()` (see `packages/core/src/server/lib/agents.ts:1445-1447`)
- ✅ Falls back to client-side filtering if GraphQL doesn't support it (see `packages/core/src/server/lib/agents.ts:1677-1686`)

## What Discovery Project Needs to Do

1. **Add `a2aSkills_in` field to `AgentWhereInput` GraphQL schema**
   - Type: `[String!]` (array of strings)
   - Logic: Match agents that have **at least one** skill in the array

2. **Index skills from agent registration**
   - Parse `rawJson.endpoints[]` array
   - Extract `a2aSkills` from each endpoint entry
   - Store skills in a searchable/indexed field

3. **Index skills from agent-card.json** (optional but recommended)
   - Fetch agent-card.json from `a2aEndpoint/.well-known/agent-card.json`
   - Extract `skills[].id` values
   - Merge with registration JSON skills

4. **Implement filtering logic**
   - When `a2aSkills_in` is provided, filter agents that have matching skills
   - Skills should match exactly (case-sensitive) or use case-insensitive matching

## Skill ID Format

All skills now use the format: `governance_and_trust/{category}/{skill_name}`

Examples:
- `governance_and_trust/trust/trust_validate_name`
- `governance_and_trust/trust/trust_validate_account`
- `governance_and_trust/trust/trust_validate_app`
- `governance_and_trust/trust/trust_feedback_authorization`
- `governance_and_trust/membership/add_member`
- `governance_and_trust/membership/remove_member`
- `governance_and_trust/membership/verify_membership`
- `governance_and_trust/alliance/join_alliance`
- `governance_and_trust/alliance/leave_alliance`
- `governance_and_trust/alliance/verify_alliance_membership`
- `governance_and_trust/delegation/add_delegation`
- `governance_and_trust/delegation/revoke_delegation`
- `governance_and_trust/delegation/verify_delegation`

## Testing

Once implemented, test with:
```bash
curl -X POST https://your-discovery-endpoint/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "query": "query { searchAgentsGraph(where: { a2aSkills_in: [\"governance_and_trust/membership/add_member\"] }, first: 10) { agents { agentId agentName } total } }"
  }'
```

This should return only agents that have the `governance_and_trust/membership/add_member` skill in their registration JSON or agent-card.json.
