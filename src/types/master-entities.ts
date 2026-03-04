/**
 * Master table entity interfaces (m_ prefix tables)
 */

export interface ContextKey {
  readonly id: number;
  readonly key: string;
}

export interface ConstraintCategory {
  readonly id: number;
  readonly name: string;
}

export interface Layer {
  readonly id: number;
  readonly name: string;
}

export interface Tag {
  readonly id: number;
  readonly name: string;
}

export interface Scope {
  readonly id: number;
  readonly name: string;
}
