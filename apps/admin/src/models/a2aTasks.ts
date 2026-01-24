/**
 * Intent/task taxonomy types.
 * Intent types, task types, and intent–task mappings are read from discovery GraphQL
 * via /api/discovery/taxonomy. No hardcoded options.
 */

export const GENERAL_INTENT_KEY = 'general';
export const GENERAL_TASK_KEY = 'general';

export type IntentTypeOption = {
  key: string;
  label?: string | null;
  description?: string | null;
};

export type TaskTypeOption = {
  key: string;
  label?: string | null;
  description?: string | null;
};

export type IntentTaskMappingOption = {
  intent: IntentTypeOption;
  task: TaskTypeOption;
  requiredSkills: string[];
  optionalSkills: string[];
};

/** Legacy type aliases for backward compatibility; use string keys from discovery. */
export type InboxIntentType = string;
export type InboxTaskType = string;

export type InboxIntentTypeOption = {
  value: string;
  label: string;
  defaultTaskKey: string;
};

export type InboxTaskTypeOption = {
  value: string;
  label: string;
  /** From intentTaskMappings.requiredSkills; used for mapping only. */
  requiredSkills?: string[];
};
