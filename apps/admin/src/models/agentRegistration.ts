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
export type AgentSkillId = string;

export type AgentSkillOption = {
  id: string;
  label: string;
  description?: string | null;
  domains?: string[];
  oasfExtension?: boolean;
};

/**
 * Fetch OASF skills from discovery GraphQL.
 * Returns empty array if discovery is unavailable.
 */
export async function fetchAgentSkillOptions(): Promise<AgentSkillOption[]> {
  try {
    const res = await fetch('/api/oasf/skills', { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    const skills = Array.isArray(data?.skills) ? data.skills : [];
    return skills.map((s: any) => ({
      id: String(s.key || s.id || ''),
      label: String(s.caption || s.label || s.key || ''),
      description: s.description || null,
      domains: s.category ? [s.category] : [],
      oasfExtension: true,
    })).filter((s: AgentSkillOption) => s.id);
  } catch (e) {
    console.warn('[agentRegistration] Failed to fetch skills from discovery:', e);
    return [];
  }
}

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
