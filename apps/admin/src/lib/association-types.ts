/**
 * Association types for ERC-8092 associations
 */

export enum AssocType {
  Membership = 0,
  Delegation = 1,
  Affiliation = 2,
  Partnership = 3,
  Other = 255,
}

export const ASSOC_TYPE_OPTIONS = [
  { value: AssocType.Membership, label: 'Membership' },
  { value: AssocType.Delegation, label: 'Delegation' },
  { value: AssocType.Affiliation, label: 'Affiliation' },
  { value: AssocType.Partnership, label: 'Partnership' },
  { value: AssocType.Other, label: 'Other' },
] as const;
