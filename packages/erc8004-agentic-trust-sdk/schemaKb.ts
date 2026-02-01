/**
 * GraphDB-backed (knowledge base) GraphQL schema (v2).
 *
 * This schema is aligned to the KB model:
 * Agent → Identity → Descriptor → (assembled) ProtocolDescriptor.
 *
 * Used as reference for the discovery client; the live backend is introspected at runtime.
 */

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
  }

  input KbAgentWhereInput {
    chainId: Int
    agentId8004: Int
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

  type KbProtocolDescriptor {
    iri: ID!
    protocol: String!
    serviceUrl: String!
    protocolVersion: String
    json: String
    skills: [String!]!
    domains: [String!]!
  }

  type KbIdentityDescriptor {
    iri: ID!
    kind: String!
    json: String
    onchainMetadataJson: String
    registeredBy: String
    registryNamespace: String
    skills: [String!]!
    domains: [String!]!
    protocolDescriptors: [KbProtocolDescriptor!]!
  }

  type KbIdentity {
    iri: ID!
    kind: String!
    did: String!
    descriptor: KbIdentityDescriptor
  }

  type KbAgent {
    iri: ID!
    uaid: String
    agentName: String
    agentTypes: [String!]!
    createdAtBlock: Int
    createdAtTime: Int
    updatedAtTime: Int
    did8004: String
    agentId8004: Int
    isSmartAgent: Boolean!
    identity: KbIdentity
    identity8004: KbIdentity
    identityEns: KbIdentity
    assertions: KbAgentAssertions
    reviewAssertions(first: Int, skip: Int): KbReviewResponseConnection
    validationAssertions(first: Int, skip: Int): KbValidationResponseConnection
    identityOwnerAccount: KbAccount
    identityOperatorAccount: KbAccount
    identityWalletAccount: KbAccount
    agentOwnerAccount: KbAccount
    agentOperatorAccount: KbAccount
    agentWalletAccount: KbAccount
    agentOwnerEOAAccount: KbAccount
    agentAccount: KbAccount
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

  type Query {
    kbAgents(
      where: KbAgentWhereInput
      first: Int
      skip: Int
      orderBy: KbAgentOrderBy
      orderDirection: OrderDirection
    ): KbAgentSearchResult!
    kbOwnedAgents(
      chainId: Int!
      ownerAddress: String!
      first: Int
      skip: Int
      orderBy: KbAgentOrderBy
      orderDirection: OrderDirection
    ): KbAgentSearchResult!
    kbOwnedAgentsAllChains(
      ownerAddress: String!
      first: Int
      skip: Int
      orderBy: KbAgentOrderBy
      orderDirection: OrderDirection
    ): KbAgentSearchResult!
    kbAgentByUaid(uaid: String!): KbAgent
  }
`;
