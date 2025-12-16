/**
 * Validation Types and Models
 */

/**
 * Validation claim types as defined in the ERC-8004 validation specification
 */
export type ValidationClaimType =
  | 'functionality'
  | 'affiliation'
  | 'availability'
  | 'security'
  | 'identity'
  | 'compliance'
  | 'safety'
  | 'performance'
  | 'interoperability'
  | 'operator'
  | `domain:${string}`;

/**
 * Standard validation claim type options for dropdowns
 */
export const VALIDATION_CLAIM_TYPE_OPTIONS: Array<{
  value: ValidationClaimType;
  label: string;
}> = [
  { value: 'functionality', label: 'Functionality' },
  { value: 'affiliation', label: 'Affiliation' },
  { value: 'availability', label: 'Availability' },
  { value: 'security', label: 'Security' },
  { value: 'identity', label: 'Identity' },
  { value: 'compliance', label: 'Compliance' },
  { value: 'safety', label: 'Safety' },
  { value: 'performance', label: 'Performance' },
  { value: 'interoperability', label: 'Interoperability' },
  { value: 'operator', label: 'Operator' },
];
