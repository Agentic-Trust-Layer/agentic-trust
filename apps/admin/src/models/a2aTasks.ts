export type InboxTaskType =
  | 'general'
  | 'feedback_request'
  | 'give_feedback'
  | 'validation_request'
  | 'association_request';

export type InboxTaskTypeOption = {
  value: InboxTaskType;
  label: string;
  /**
   * A2A/ATP task types map to OSAF/OSAF-style skill identifiers.
   * If set, the "To Agent" card must advertise at least one of these OSAF skills to enable the task type.
   * This is our primary mapping layer (tasks → OSAF skills → executable A2A skills).
   */
  requiredOsafSkills?: string[];
  /**
   * Back-compat: if the recipient does not publish OSAF overlay tags, fall back to checking raw A2A skill ids.
   */
  requiredToAgentSkills?: string[];
};

export const INBOX_TASK_TYPE_OPTIONS: InboxTaskTypeOption[] = [
  { value: 'general', label: 'General Message' },
  {
    value: 'feedback_request',
    label: 'Request Feedback Permission',
    requiredOsafSkills: ['trust.feedback.authorization'],
    requiredToAgentSkills: ['agent.feedback.requestAuth'],
  },
  {
    value: 'validation_request',
    label: 'Request Validation',
    requiredOsafSkills: ['trust.validation.attestation'],
    requiredToAgentSkills: ['atp.validation.respond'],
  },
  {
    value: 'association_request',
    label: 'Request Association',
    requiredOsafSkills: ['relationship.association.authorization'],
  },
  {
    value: 'give_feedback',
    label: 'Give Feedback',
    requiredOsafSkills: ['trust.feedback.authorization'],
    requiredToAgentSkills: ['agent.feedback.requestAuth'],
  },
];


