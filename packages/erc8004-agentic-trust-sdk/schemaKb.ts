/**
 * GraphDB-backed (knowledge base) GraphQL schema (v2).
 *
 * This schema is intentionally aligned to the KB model:
 * Agent → Identity → Descriptor → (assembled) ProtocolDescriptor.
 *
 * Used as reference for the discovery client; the live backend is introspected at runtime.
 */

import { buildSchema, type GraphQLSchema } from 'graphql';

export const graphQLSchemaStringKb = `
  type OasfSkill {
    key: String!
    nameKey: String
    uid: Int
    caption: String
    extendsKey: String
    category: String
  }

  type OasfDomain {
    key: String!
    nameKey: String
    uid: Int
    caption: String
    extendsKey: String
    category: String
  }

  type IntentType {
    key: String!
    label: String
    description: String
  }

  type TaskType {
    key: String!
    label: String
    description: String
  }

  type IntentTaskMapping {
    intent: IntentType!
    task: TaskType!
    requiredSkills: [String!]!
    optionalSkills: [String!]!
  }

  enum OrderDirection {
    ASC
    DESC
  }

  enum KbAgentOrderBy {
    agentId8004
    agentName
    uaid
    createdAtTime
    updatedAtTime
    trustLedgerTotalPoints
    atiOverallScore
    bestRank
  }

  input KbAgentWhereInput {
    chainId: Int
    agentIdentifierMatch: String
    did8004: String
    uaid: String
    uaid_in: [String!]
    agentName_contains: String
    isSmartAgent: Boolean
    hasA2a: Boolean
    hasAssertions: Boolean
    hasReviews: Boolean
    hasValidations: Boolean
    minReviewAssertionCount: Int
    minValidationAssertionCount: Int
  }

  type KbAccount {
    iri: ID!
    chainId: Int
    address: String
    accountType: String
    didEthr: String
  }

  type KbDescriptor {
    iri: ID!
    name: String
    description: String
    image: String
  }

  type KbProtocolDescriptor {
    iri: ID!
    name: String
    description: String
    image: String
    agentCardJson: String
  }

  type KbProtocol {
    iri: ID!
    protocol: String!
    protocolVersion: String
    serviceUrl: String
    descriptor: KbProtocolDescriptor
    skills: [String!]!
    domains: [String!]!
  }

  type KbServiceEndpoint {
    iri: ID!
    name: String!
    descriptor: KbDescriptor
    protocol: KbProtocol!
  }

  type KbIdentityDescriptor {
    iri: ID!
    kind: String!
    name: String
    description: String
    image: String
    registrationJson: String
    nftMetadataJson: String
    registeredBy: String
    registryNamespace: String
    skills: [String!]!
    domains: [String!]!
  }

  type KbIdentity {
    iri: ID!
    kind: String!
    did: String!
    uaidHOL: String
    descriptor: KbIdentityDescriptor
    serviceEndpoints: [KbServiceEndpoint!]!
  }

  type KbIdentity8004 {
    iri: ID!
    kind: String!
    did: String!
    did8004: String!
    agentId8004: Int
    isSmartAgent: Boolean!
    descriptor: KbIdentityDescriptor
    serviceEndpoints: [KbServiceEndpoint!]!
    ownerAccount: KbAccount
    operatorAccount: KbAccount
    walletAccount: KbAccount
    ownerEOAAccount: KbAccount
    agentAccount: KbAccount
  }

  type KbIdentity8122 {
    iri: ID!
    kind: String!
    did: String!
    did8122: String!
    agentId8122: String!
    registryAddress: String
    endpointType: String
    endpoint: String
    descriptor: KbIdentityDescriptor
    serviceEndpoints: [KbServiceEndpoint!]!
    ownerAccount: KbAccount
    agentAccount: KbAccount
  }

  type KbAgentDescriptor {
    iri: ID!
    name: String
    description: String
    image: String
  }

  type KbAgent {
    iri: ID!
    uaid: String
    agentName: String
    agentDescription: String
    agentImage: String
    agentDescriptor: KbAgentDescriptor
    agentTypes: [String!]!
    createdAtBlock: Int
    createdAtTime: Int
    updatedAtTime: Int
    trustLedgerTotalPoints: Int
    trustLedgerBadgeCount: Int
    trustLedgerComputedAt: Int
    atiOverallScore: Int
    atiOverallConfidence: Float
    atiVersion: String
    atiComputedAt: Int
    identity: KbIdentity
    identity8004: KbIdentity8004
    identity8122: KbIdentity8122
    identityHol: KbIdentity
    identityEns: KbIdentity
    serviceEndpoints: [KbServiceEndpoint!]!
    assertions: KbAgentAssertions
    reviewAssertions(first: Int, skip: Int): KbReviewResponseConnection
    validationAssertions(first: Int, skip: Int): KbValidationResponseConnection
  }

  type KbAgentSearchResult {
    agents: [KbAgent!]!
    total: Int!
    hasMore: Boolean!
  }

  type KbSubgraphRecord {
    rawJson: String
    txHash: String
    blockNumber: Int
    timestamp: Int
  }

  type KbReviewResponse {
    iri: ID!
    agentDid8004: String
    json: String
    record: KbSubgraphRecord
  }

  type KbReviewResponseConnection {
    total: Int!
    items: [KbReviewResponse!]!
  }

  type KbValidationResponse {
    iri: ID!
    agentDid8004: String
    json: String
    record: KbSubgraphRecord
  }

  type KbValidationResponseConnection {
    total: Int!
    items: [KbValidationResponse!]!
  }

  type KbAgentAssertions {
    total: Int!
    reviewResponses: KbReviewResponseConnection!
    validationResponses: KbValidationResponseConnection!
  }

  type KbAssociation {
    iri: ID!
    record: KbSubgraphRecord
  }

  type KbSemanticAgentMatch {
    agent: KbAgent
    score: Float!
    matchReasons: [String!]
  }

  type KbSemanticAgentSearchResult {
    matches: [KbSemanticAgentMatch!]!
    total: Int!
    intentType: String
  }

  input SemanticAgentSearchInput {
    text: String
    intentJson: String
    topK: Int
    minScore: Float
    requiredSkills: [String!]
    filters: SemanticSearchFilterInput
  }

  input SemanticSearchFilterInput {
    capabilities: [String!]
    inputMode: String
    outputMode: String
    tags: [String!]
  }

  type Query {
    oasfSkills(key: String, nameKey: String, category: String, extendsKey: String, limit: Int, offset: Int, orderBy: String, orderDirection: String): [OasfSkill!]!
    oasfDomains(key: String, nameKey: String, category: String, extendsKey: String, limit: Int, offset: Int, orderBy: String, orderDirection: String): [OasfDomain!]!
    intentTypes(key: String, label: String, limit: Int, offset: Int): [IntentType!]!
    taskTypes(key: String, label: String, limit: Int, offset: Int): [TaskType!]!
    intentTaskMappings(intentKey: String, taskKey: String, limit: Int, offset: Int): [IntentTaskMapping!]!
    kbAgents(where: KbAgentWhereInput, first: Int, skip: Int, orderBy: KbAgentOrderBy, orderDirection: OrderDirection): KbAgentSearchResult!
    kbOwnedAgents(chainId: Int!, ownerAddress: String!, first: Int, skip: Int, orderBy: KbAgentOrderBy, orderDirection: OrderDirection): KbAgentSearchResult!
    kbOwnedAgentsAllChains(ownerAddress: String!, first: Int, skip: Int, orderBy: KbAgentOrderBy, orderDirection: OrderDirection): KbAgentSearchResult!
    kbIsOwner(uaid: String!, walletAddress: String!): Boolean!
    kbAgentByUaid(uaid: String!): KbAgent
    kbSemanticAgentSearch(input: SemanticAgentSearchInput!): KbSemanticAgentSearchResult!
    kbReviews(chainId: Int!, first: Int, skip: Int): [KbReviewResponse!]!
    kbValidations(chainId: Int!, first: Int, skip: Int): [KbValidationResponse!]!
    kbAssociations(chainId: Int!, first: Int, skip: Int): [KbAssociation!]!
  }
`;

export function buildGraphQLSchemaKb(): GraphQLSchema {
  return buildSchema(graphQLSchemaStringKb);
}
