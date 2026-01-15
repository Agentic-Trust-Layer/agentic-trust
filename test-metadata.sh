#!/bin/bash
# Test script to query agent metadata from discovery GraphQL endpoint
# Usage: ./test-metadata.sh [agentId] [chainId]
# Example: ./test-metadata.sh 276 11155111

AGENT_ID=${1:-276}
CHAIN_ID=${2:-11155111}

# Get endpoint from environment or use default
DISCOVERY_URL=${AGENTIC_TRUST_DISCOVERY_URL:-"https://api.agentictrust.io"}
API_KEY=${AGENTIC_TRUST_DISCOVERY_API_KEY:-""}

# Ensure URL ends with /graphql
if [[ ! "$DISCOVERY_URL" =~ /graphql$ ]]; then
  DISCOVERY_URL="${DISCOVERY_URL%/}/graphql"
fi

echo "Testing agent metadata query..."
echo "Endpoint: $DISCOVERY_URL"
echo "Agent ID: $AGENT_ID"
echo "Chain ID: $CHAIN_ID"
echo ""

# Query 1: agentMetadata query (should return all metadata)
QUERY1='{
  "query": "query GetAgentMetadata($where: AgentMetadataWhereInput, $first: Int, $skip: Int) { agentMetadata(where: $where, first: $first, skip: $skip) { entries { key value valueText id indexedKey updatedAtTime } total hasMore } }",
  "variables": {
    "where": {
      "chainId": '$CHAIN_ID',
      "agentId": "'$AGENT_ID'"
    },
    "first": 1000,
    "skip": 0
  }
}'

echo "=== Query 1: agentMetadata (all metadata) ==="
if [ -n "$API_KEY" ]; then
  curl -X POST "$DISCOVERY_URL" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $API_KEY" \
    -d "$QUERY1" | jq '.'
else
  echo "⚠️  Warning: AGENTIC_TRUST_DISCOVERY_API_KEY not set, request may fail"
  curl -X POST "$DISCOVERY_URL" \
    -H "Content-Type: application/json" \
    -d "$QUERY1" | jq '.'
fi

echo ""
echo "=== Query 2: searchAgentsGraph (agent with metadata field) ==="

# Query 2: searchAgentsGraph with metadata field
QUERY2='{
  "query": "query GetAgentWithMetadata($where: AgentWhereInput, $first: Int) { searchAgentsGraph(where: $where, first: $first) { agents { chainId agentId agentName agentAccount metadata { key valueText } } } }",
  "variables": {
    "where": {
      "chainId": '$CHAIN_ID',
      "agentId": "'$AGENT_ID'"
    },
    "first": 1
  }
}'

if [ -n "$API_KEY" ]; then
  curl -X POST "$DISCOVERY_URL" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $API_KEY" \
    -d "$QUERY2" | jq '.'
else
  curl -X POST "$DISCOVERY_URL" \
    -H "Content-Type: application/json" \
    -d "$QUERY2" | jq '.'
fi
