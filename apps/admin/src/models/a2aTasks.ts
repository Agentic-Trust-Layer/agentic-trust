export type InboxTaskType =
  | 'general'
  | 'feedback_auth_request'
  | 'name_validation_request'
  | 'account_validation_request'
  | 'app_validation_request'
  | 'association_request'
  | 'join_alliance_request'
  | 'leave_alliance_request'
  | 'verify_alliance_membership_request'
  | 'add_delegation_request'
  | 'revoke_delegation_request'
  | 'verify_delegation_request'
  | 'add_member_request'
  | 'remove_member_request'
  | 'verify_membership_request';

export type InboxIntentType =
  | 'general'
  | 'trust.name_validation'
  | 'trust.account_validation'
  | 'trust.app_validation'
  | 'trust.feedback'
  | 'trust.association'
  | 'trust.membership'
  | 'trust.delegation'
  | 'governance.alliance.join'
  | 'governance.alliance.leave'
  | 'governance.alliance.verify'
  | 'governance.delegation.add'
  | 'governance.delegation.revoke'
  | 'governance.delegation.verify'
  | 'governance.membership.add'
  | 'governance.membership.remove'
  | 'governance.membership.verify';

export type InboxIntentTypeOption = {
  value: InboxIntentType;
  label: string;
  defaultTaskType: InboxTaskType;
};

export type InboxTaskTypeOption = {
  value: InboxTaskType;
  label: string;
  /**
   * A2A/ATP task types map to OASF/OASF-style skill identifiers.
   * If set, the "To Agent" card must advertise at least one of these OASF skills to enable the task type.
   * This is our primary mapping layer (tasks → OASF skills → executable A2A skills).
   */
  requiredOsafSkills?: string[];
  /**
   * Back-compat: if the recipient does not publish OASF overlay tags, fall back to checking raw A2A skill ids.
   */
  requiredToAgentSkills?: string[];
};

export const INBOX_TASK_TYPE_OPTIONS: InboxTaskTypeOption[] = [
  { value: 'general', label: 'General Message' },
  {
    value: 'feedback_auth_request',
    label: 'Request Feedback Permission',
    requiredOsafSkills: ['trust.feedback.authorization'],
    requiredToAgentSkills: ['governance_and_trust/trust/trust_feedback_authorization'],
  },
  {
    value: 'name_validation_request',
    label: 'Request Name Validation',
    requiredOsafSkills: ['trust.validate.name'],
    requiredToAgentSkills: ['governance_and_trust/trust/trust_validate_name'],
  },
  {
    value: 'account_validation_request',
    label: 'Request Account Validation',
    requiredOsafSkills: ['trust.validate.account'],
    requiredToAgentSkills: ['governance_and_trust/trust/trust_validate_account'],
  },
  {
    value: 'app_validation_request',
    label: 'Request App Validation',
    requiredOsafSkills: ['trust.validate.app'],
    requiredToAgentSkills: ['governance_and_trust/trust/trust_validate_app'],
  },
  {
    value: 'association_request',
    label: 'Request Association',
    requiredOsafSkills: ['trust.association.attestation'],
  },
  {
    value: 'join_alliance_request',
    label: 'Join Alliance',
    requiredToAgentSkills: ['governance_and_trust/alliance/join_alliance'],
  },
  {
    value: 'leave_alliance_request',
    label: 'Leave Alliance',
    requiredToAgentSkills: ['governance_and_trust/alliance/leave_alliance'],
  },
  {
    value: 'verify_alliance_membership_request',
    label: 'Verify Alliance Membership',
    requiredToAgentSkills: ['governance_and_trust/alliance/verify_alliance_membership'],
  },
  {
    value: 'add_delegation_request',
    label: 'Add Delegation',
    requiredToAgentSkills: ['governance_and_trust/delegation/add_delegation'],
  },
  {
    value: 'revoke_delegation_request',
    label: 'Revoke Delegation',
    requiredToAgentSkills: ['governance_and_trust/delegation/revoke_delegation'],
  },
  {
    value: 'verify_delegation_request',
    label: 'Verify Delegation',
    requiredToAgentSkills: ['governance_and_trust/delegation/verify_delegation'],
  },
  {
    value: 'add_member_request',
    label: 'Add Member',
    requiredToAgentSkills: ['governance_and_trust/membership/add_member'],
  },
  {
    value: 'remove_member_request',
    label: 'Remove Member',
    requiredToAgentSkills: ['governance_and_trust/membership/remove_member'],
  },
  {
    value: 'verify_membership_request',
    label: 'Verify Membership',
    requiredToAgentSkills: ['governance_and_trust/membership/verify_membership'],
  },
];

export const INBOX_INTENT_TYPE_OPTIONS: InboxIntentTypeOption[] = [
  { value: 'general', label: 'General', defaultTaskType: 'general' },
  { value: 'trust.name_validation', label: 'Trust Name Validation', defaultTaskType: 'name_validation_request' },
  { value: 'trust.account_validation', label: 'Trust Account Validation', defaultTaskType: 'account_validation_request' },
  { value: 'trust.app_validation', label: 'Trust App Validation', defaultTaskType: 'app_validation_request' },
  { value: 'trust.feedback', label: 'Trust Feedback', defaultTaskType: 'feedback_auth_request' },
  { value: 'trust.association', label: 'Trust Association', defaultTaskType: 'association_request' },
  { value: 'trust.membership', label: 'Trust Membership', defaultTaskType: 'association_request' },
  { value: 'trust.delegation', label: 'Trust Delegation', defaultTaskType: 'association_request' },
  { value: 'governance.alliance.join', label: 'Join Alliance', defaultTaskType: 'join_alliance_request' },
  { value: 'governance.alliance.leave', label: 'Leave Alliance', defaultTaskType: 'leave_alliance_request' },
  { value: 'governance.alliance.verify', label: 'Verify Alliance Membership', defaultTaskType: 'verify_alliance_membership_request' },
  { value: 'governance.delegation.add', label: 'Add Delegation', defaultTaskType: 'add_delegation_request' },
  { value: 'governance.delegation.revoke', label: 'Revoke Delegation', defaultTaskType: 'revoke_delegation_request' },
  { value: 'governance.delegation.verify', label: 'Verify Delegation', defaultTaskType: 'verify_delegation_request' },
  { value: 'governance.membership.add', label: 'Add Member', defaultTaskType: 'add_member_request' },
  { value: 'governance.membership.remove', label: 'Remove Member', defaultTaskType: 'remove_member_request' },
  { value: 'governance.membership.verify', label: 'Verify Membership', defaultTaskType: 'verify_membership_request' },
];


