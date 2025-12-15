/**
 * Agent Registration Models and Constants
 * 
 * Shared constants and types for agent registration forms
 */

/**
 * Agent category options
 */
export const AGENT_CATEGORY_OPTIONS = [
  { value: '', label: 'Select a category (optional)' },
  { value: 'Service Agents', label: 'Service Agents (Function/Task Agents)' },
  { value: 'Conversational / Interface Agents', label: 'Conversational / Interface Agents' },
  { value: 'Orchestrator / Coordinator Agents', label: 'Orchestrator / Coordinator Agents' },
  { value: 'Knowledge / Retrieval Agents', label: 'Knowledge / Retrieval Agents' },
  { value: 'Autonomous / Goal-Seeking Agents', label: 'Autonomous / Goal-Seeking Agents' },
  { value: 'Governance / Validation Agents', label: 'Governance / Validation Agents' },
  { value: 'Domain-Specific / Vertical Agents', label: 'Domain-Specific / Vertical Agents' },
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
