/**
 * Enum types matching database integer values
 */

/**
 * Decision status enumeration
 * 1 = active, 2 = deprecated, 3 = draft, 4 = in_progress, 5 = in_review, 6 = implemented
 */
export enum Status {
  ACTIVE = 1,
  DEPRECATED = 2,
  DRAFT = 3,
  IN_PROGRESS = 4,
  IN_REVIEW = 5,
  IMPLEMENTED = 6,
}

/**
 * Valid status string values for API parameters
 * Matches STRING_TO_STATUS keys in constants.ts
 */
export type StatusString = 'active' | 'deprecated' | 'draft' | 'in_progress' | 'in_review' | 'implemented';

/**
 * Message type enumeration
 * 1 = decision, 2 = warning, 3 = request, 4 = info
 */
export enum MessageType {
  DECISION = 1,
  WARNING = 2,
  REQUEST = 3,
  INFO = 4,
}

/**
 * Priority level enumeration
 * 1 = low, 2 = medium, 3 = high, 4 = critical
 */
export enum Priority {
  LOW = 1,
  MEDIUM = 2,
  HIGH = 3,
  CRITICAL = 4,
}
