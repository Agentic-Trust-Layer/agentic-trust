/**
 * Agent Registration Models and Constants
 * 
 * Shared constants and types for agent registration forms
 */

/**
 * Agent category options
 */
export type AgentCategoryOption = {
  value: string;
  label: string;
  description?: string;
  /**
   * True if this option is an extension beyond the currently published OASF/OASF standard list.
   * (We still align to OASF naming where possible.)
   */
  oasfExtension: boolean;
};

// NOTE: These labels align with the OASF top-level “Skills” domains taxonomy:
// `https://schema.oasf.outshift.com/`
export const AGENT_CATEGORY_OPTIONS: readonly AgentCategoryOption[] = [
  { value: '', label: 'Select a category (optional)', description: 'No category', oasfExtension: true },
  {
    value: 'Natural Language Processing',
    label: 'Natural Language Processing',
    description: 'Language understanding, generation, retrieval & synthesis, and dialogue.',
    oasfExtension: true,
  },
  {
    value: 'Images / Computer Vision',
    label: 'Images / Computer Vision',
    description: 'Vision perception and generation: classification, detection, segmentation, etc.',
    oasfExtension: true,
  },
  { value: 'Audio', label: 'Audio', description: 'Audio understanding and generation.', oasfExtension: true },
  {
    value: 'Tabular / Text',
    label: 'Tabular / Text',
    description: 'Structured-data and mixed tabular/text workloads (classification, regression, etc.).',
    oasfExtension: true,
  },
  {
    value: 'Analytical skills',
    label: 'Analytical skills',
    description: 'Math, logic, coding, and other analytic capabilities.',
    oasfExtension: true,
  },
  {
    value: 'Retrieval Augmented Generation',
    label: 'Retrieval Augmented Generation',
    description: 'Retrieval + generation pipelines (indexing, search, document QA).',
    oasfExtension: true,
  },
  {
    value: 'Multi-modal',
    label: 'Multi-modal',
    description: 'Cross-modality processing (text↔image, text↔audio, any-to-any).',
    oasfExtension: true,
  },
  {
    value: 'Security & Privacy',
    label: 'Security & Privacy',
    description: 'Threat/vulnerability analysis, secret detection, and privacy risk assessment.',
    oasfExtension: true,
  },
  {
    value: 'Data Engineering',
    label: 'Data Engineering',
    description: 'Data cleaning, schema inference, transformation pipelines, and quality checks.',
    oasfExtension: true,
  },
  {
    value: 'Agent Orchestration',
    label: 'Agent Orchestration',
    description: 'Task decomposition, role assignment, planning, coordination, negotiation.',
    oasfExtension: true,
  },
  {
    value: 'Evaluation & Monitoring',
    label: 'Evaluation & Monitoring',
    description: 'Benchmarks, quality evaluation, anomaly detection, performance monitoring.',
    oasfExtension: true,
  },
  {
    value: 'DevOps / MLOps',
    label: 'DevOps / MLOps',
    description: 'Provisioning, deployments, CI/CD, model versioning, monitoring & alerting.',
    oasfExtension: true,
  },
  {
    value: 'Governance & Compliance',
    label: 'Governance & Compliance',
    description:
      'Scope: “Are we following the rules?” Regulatory compliance (HIPAA, SOC2, GDPR, PCI), policy interpretation/enforcement, auditing evidence, risk/legal workflows, retention/reporting/controls testing. Typical outputs: compliance reports, policy decisions, control checks, audit artifacts.',
    oasfExtension: true,
  },
  {
    value: 'Tool Interaction',
    label: 'Tool Interaction',
    description: 'API/schema understanding, workflow automation, tool-use planning, script integration.',
    oasfExtension: true,
  },
  {
    value: 'Advanced Reasoning & Planning',
    label: 'Advanced Reasoning & Planning',
    description: 'Strategic planning, long-horizon reasoning, hypothesis generation.',
    oasfExtension: true,
  },
] as const;

/**
 * ATP / AgenticTrust “domains” (cross-cutting, not the same as OASF top-level skill domains).
 * These are used to describe what *kind* of trust/collaboration surface the agent participates in.
 */
export type AgentDomainId = 'governance-and-trust' | 'security' | 'collaboration';

export type AgentDomainOption = {
  id: AgentDomainId;
  label: string;
  description: string;
  oasfExtension: boolean;
};

export const AGENT_DOMAIN_OPTIONS: readonly AgentDomainOption[] = [
  {
    id: 'governance-and-trust',
    label: 'Governance-and-Trust',
    description:
      'Scope: “Should I trust / authorize this actor in this context?” Identity verification & key/credential checks; signature validation (e.g., ERC-1271, VC proofs); reputation/trust scoring & validation attestations (ERC-8004); relationship authorization (associations, memberships, delegations — ERC-8092); provenance tracking for trust decisions. Typical outputs: allow/deny decisions, trust attestations, verified relationships, delegation approvals.',
    oasfExtension: true,
  },
  {
    id: 'security',
    label: 'Security',
    description: 'Security operations, threat/vuln analysis, and defensive checks.',
    oasfExtension: true,
  },
  {
    id: 'collaboration',
    label: 'Collaboration',
    description: 'Inbox/task-based coordination between agents and users.',
    oasfExtension: true,
  },
] as const;

/**
 * ATP / AgenticTrust “skills” (A2A-level capabilities) and how they relate to domains.
 * These are extensions over the currently published OASF/OASF skill identifiers.
 */
export type AgentSkillId =
  | 'agent_interaction.request_handling'
  | 'integration.protocol_handling'
  | 'trust.identity.validation'
  | 'trust.feedback.authorization'
  | 'trust.validation.attestation'
  | 'trust.association.attestation'
  | 'trust.membership.attestation'
  | 'trust.delegation.attestation'
  | 'relationship.association.revocation'
  | 'delegation.request.authorization'
  | 'delegation.payload.verification'
  | 'governance.audit.provenance';

export type AgentSkillOption = {
  id: AgentSkillId;
  label: string;
  description: string;
  domains: AgentDomainId[];
  oasfExtension: boolean;
};

export const AGENT_SKILL_OPTIONS: readonly AgentSkillOption[] = [
  {
    id: 'agent_interaction.request_handling',
    label: 'Agent interaction · request handling',
    description: 'Accept, validate, and route inbound A2A requests/messages/tasks.',
    domains: ['collaboration'],
    oasfExtension: true,
  },
  {
    id: 'integration.protocol_handling',
    label: 'Integration · protocol handling',
    description: 'Implement protocol bindings and message envelope handling (e.g., JSON-RPC, HTTP+JSON).',
    domains: ['collaboration'],
    oasfExtension: true,
  },
  {
    id: 'trust.identity.validation',
    label: 'Trust · identity validation',
    description: 'Verify identities, credentials, keys, and signatures (e.g., ERC-1271, VC proofs).',
    domains: ['governance-and-trust', 'security'],
    oasfExtension: true,
  },
  {
    id: 'trust.feedback.authorization',
    label: 'Trust · feedback authorization',
    description: 'Issue/verify authorization to submit feedback (e.g., ERC-8004 feedbackAuth).',
    domains: ['governance-and-trust'],
    oasfExtension: true,
  },
  {
    id: 'trust.validation.attestation',
    label: 'Trust · validation attestation',
    description: 'Create/verify attestations for validations (e.g., validation responses, registry evidence).',
    domains: ['governance-and-trust'],
    oasfExtension: true,
  },
  {
    id: 'trust.association.attestation',
    label: 'Trust · association attestation',
    description: 'Create/verify attestations for associations and relationship trust decisions.',
    domains: ['governance-and-trust'],
    oasfExtension: true,
  },
  {
    id: 'trust.membership.attestation',
    label: 'Trust · membership attestation',
    description: 'Create/verify attestations for memberships (e.g., group/org membership proofs).',
    domains: ['governance-and-trust'],
    oasfExtension: true,
  },
  {
    id: 'trust.delegation.attestation',
    label: 'Trust · delegation attestation',
    description: 'Create/verify attestations for delegations and delegated authority.',
    domains: ['governance-and-trust'],
    oasfExtension: true,
  },
  {
    id: 'relationship.association.revocation',
    label: 'Relationship · association revocation',
    description: 'Revoke/expire associations and publish revocation evidence.',
    domains: ['governance-and-trust'],
    oasfExtension: true,
  },
  {
    id: 'delegation.request.authorization',
    label: 'Delegation · request authorization',
    description: 'Authorize delegated actions and time-bounded permissions.',
    domains: ['governance-and-trust'],
    oasfExtension: true,
  },
  {
    id: 'delegation.payload.verification',
    label: 'Delegation · payload verification',
    description: 'Verify delegated payload integrity/provenance (e.g., signatures, scopes, constraints).',
    domains: ['governance-and-trust', 'security'],
    oasfExtension: true,
  },
  {
    id: 'governance.audit.provenance',
    label: 'Governance · audit provenance',
    description: 'Produce audit/provenance trails for trust and compliance decisions.',
    domains: ['governance-and-trust', 'security'],
    oasfExtension: true,
  },
] as const;

/**
 * Supported trust mechanism options
 */
export interface TrustMechanismOption {
  value: string;
  label: string;
  description: string;
}

export const SUPPORTED_TRUST_MECHANISMS: TrustMechanismOption[] = [
  {
    value: 'reputation',
    label: 'Reputation-based Trust',
    description: 'Participants give subjective feedback on agent performance and behavior (e.g., thumbs up/down, star ratings, text reviews).',
  },
  {
    value: 'crypto-economic',
    label: 'Crypto-economic Trust',
    description: 'Tokens are locked as a guarantee of good agent behavior; they are forfeited if the agent acts maliciously.',
  },
  {
    value: 'tee-attestation',
    label: 'TEE Attestation Trust',
    description: 'A Trusted Execution Environment provides cryptographic proof of the agent\'s code integrity and correct execution.',
  },
] as const;
