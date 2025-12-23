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
   * True if this option is an extension beyond the currently published OASF/OSAF standard list.
   * (We still align to OASF naming where possible.)
   */
  osafExtension: boolean;
};

// NOTE: These labels align with the OASF top-level “Skills” domains taxonomy:
// `https://schema.oasf.outshift.com/`
export const AGENT_CATEGORY_OPTIONS: readonly AgentCategoryOption[] = [
  { value: '', label: 'Select a category (optional)', description: 'No category', osafExtension: true },
  {
    value: 'Natural Language Processing',
    label: 'Natural Language Processing',
    description: 'Language understanding, generation, retrieval & synthesis, and dialogue.',
    osafExtension: true,
  },
  {
    value: 'Images / Computer Vision',
    label: 'Images / Computer Vision',
    description: 'Vision perception and generation: classification, detection, segmentation, etc.',
    osafExtension: true,
  },
  { value: 'Audio', label: 'Audio', description: 'Audio understanding and generation.', osafExtension: true },
  {
    value: 'Tabular / Text',
    label: 'Tabular / Text',
    description: 'Structured-data and mixed tabular/text workloads (classification, regression, etc.).',
    osafExtension: true,
  },
  {
    value: 'Analytical skills',
    label: 'Analytical skills',
    description: 'Math, logic, coding, and other analytic capabilities.',
    osafExtension: true,
  },
  {
    value: 'Retrieval Augmented Generation',
    label: 'Retrieval Augmented Generation',
    description: 'Retrieval + generation pipelines (indexing, search, document QA).',
    osafExtension: true,
  },
  {
    value: 'Multi-modal',
    label: 'Multi-modal',
    description: 'Cross-modality processing (text↔image, text↔audio, any-to-any).',
    osafExtension: true,
  },
  {
    value: 'Security & Privacy',
    label: 'Security & Privacy',
    description: 'Threat/vulnerability analysis, secret detection, and privacy risk assessment.',
    osafExtension: true,
  },
  {
    value: 'Data Engineering',
    label: 'Data Engineering',
    description: 'Data cleaning, schema inference, transformation pipelines, and quality checks.',
    osafExtension: true,
  },
  {
    value: 'Agent Orchestration',
    label: 'Agent Orchestration',
    description: 'Task decomposition, role assignment, planning, coordination, negotiation.',
    osafExtension: true,
  },
  {
    value: 'Evaluation & Monitoring',
    label: 'Evaluation & Monitoring',
    description: 'Benchmarks, quality evaluation, anomaly detection, performance monitoring.',
    osafExtension: true,
  },
  {
    value: 'DevOps / MLOps',
    label: 'DevOps / MLOps',
    description: 'Provisioning, deployments, CI/CD, model versioning, monitoring & alerting.',
    osafExtension: true,
  },
  {
    value: 'Governance & Compliance',
    label: 'Governance & Compliance',
    description:
      'Scope: “Are we following the rules?” Regulatory compliance (HIPAA, SOC2, GDPR, PCI), policy interpretation/enforcement, auditing evidence, risk/legal workflows, retention/reporting/controls testing. Typical outputs: compliance reports, policy decisions, control checks, audit artifacts.',
    osafExtension: true,
  },
  {
    value: 'Tool Interaction',
    label: 'Tool Interaction',
    description: 'API/schema understanding, workflow automation, tool-use planning, script integration.',
    osafExtension: true,
  },
  {
    value: 'Advanced Reasoning & Planning',
    label: 'Advanced Reasoning & Planning',
    description: 'Strategic planning, long-horizon reasoning, hypothesis generation.',
    osafExtension: true,
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
  osafExtension: boolean;
};

export const AGENT_DOMAIN_OPTIONS: readonly AgentDomainOption[] = [
  {
    id: 'governance-and-trust',
    label: 'Governance-and-Trust',
    description:
      'Scope: “Should I trust / authorize this actor in this context?” Identity verification & key/credential checks; signature validation (e.g., ERC-1271, VC proofs); reputation/trust scoring & validation attestations (ERC-8004); relationship authorization (associations, memberships, delegations — ERC-8092); provenance tracking for trust decisions. Typical outputs: allow/deny decisions, trust attestations, verified relationships, delegation approvals.',
    osafExtension: true,
  },
  {
    id: 'security',
    label: 'Security',
    description: 'Security operations, threat/vuln analysis, and defensive checks.',
    osafExtension: true,
  },
  {
    id: 'collaboration',
    label: 'Collaboration',
    description: 'Inbox/task-based coordination between agents and users.',
    osafExtension: true,
  },
] as const;

/**
 * ATP / AgenticTrust “skills” (A2A-level capabilities) and how they relate to domains.
 * These are extensions over the currently published OASF/OSAF skill identifiers.
 */
export type AgentSkillId =
  | 'agent_interaction.request_handling'
  | 'integration.protocol_handling'
  | 'trust.identity.validation'
  | 'trust.feedback.authorization'
  | 'trust.validation.attestation'
  | 'relationship.association.authorization'
  | 'relationship.association.revocation'
  | 'delegation.request.authorization'
  | 'delegation.payload.verification'
  | 'governance.audit.provenance';

export type AgentSkillOption = {
  id: AgentSkillId;
  label: string;
  description: string;
  domains: AgentDomainId[];
  osafExtension: boolean;
};

export const AGENT_SKILL_OPTIONS: readonly AgentSkillOption[] = [
  {
    id: 'agent_interaction.request_handling',
    label: 'Agent interaction · request handling',
    description: 'Accept, validate, and route inbound A2A requests/messages/tasks.',
    domains: ['collaboration'],
    osafExtension: true,
  },
  {
    id: 'integration.protocol_handling',
    label: 'Integration · protocol handling',
    description: 'Implement protocol bindings and message envelope handling (e.g., JSON-RPC, HTTP+JSON).',
    domains: ['collaboration'],
    osafExtension: true,
  },
  {
    id: 'trust.identity.validation',
    label: 'Trust · identity validation',
    description: 'Verify identities, credentials, keys, and signatures (e.g., ERC-1271, VC proofs).',
    domains: ['governance-and-trust', 'security'],
    osafExtension: true,
  },
  {
    id: 'trust.feedback.authorization',
    label: 'Trust · feedback authorization',
    description: 'Issue/verify authorization to submit feedback (e.g., ERC-8004 feedbackAuth).',
    domains: ['governance-and-trust'],
    osafExtension: true,
  },
  {
    id: 'trust.validation.attestation',
    label: 'Trust · validation attestation',
    description: 'Create/verify attestations for validations (e.g., validation responses, registry evidence).',
    domains: ['governance-and-trust'],
    osafExtension: true,
  },
  {
    id: 'relationship.association.authorization',
    label: 'Relationship · association authorization',
    description: 'Authorize creation of associations/memberships/delegations (e.g., ERC-8092).',
    domains: ['governance-and-trust'],
    osafExtension: true,
  },
  {
    id: 'relationship.association.revocation',
    label: 'Relationship · association revocation',
    description: 'Revoke/expire associations and publish revocation evidence.',
    domains: ['governance-and-trust'],
    osafExtension: true,
  },
  {
    id: 'delegation.request.authorization',
    label: 'Delegation · request authorization',
    description: 'Authorize delegated actions and time-bounded permissions.',
    domains: ['governance-and-trust'],
    osafExtension: true,
  },
  {
    id: 'delegation.payload.verification',
    label: 'Delegation · payload verification',
    description: 'Verify delegated payload integrity/provenance (e.g., signatures, scopes, constraints).',
    domains: ['governance-and-trust', 'security'],
    osafExtension: true,
  },
  {
    id: 'governance.audit.provenance',
    label: 'Governance · audit provenance',
    description: 'Produce audit/provenance trails for trust and compliance decisions.',
    domains: ['governance-and-trust', 'security'],
    osafExtension: true,
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
