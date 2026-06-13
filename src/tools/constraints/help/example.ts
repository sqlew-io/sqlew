/**
 * Comprehensive examples for constraint tool
 */

/**
 * Get comprehensive examples for constraint tool
 * @returns Examples documentation object
 */
export function constraintExample(): any {
  return {
    tool: 'constraint',
    description: 'Comprehensive constraint examples for various use cases',
    categories: {
      performance: {
        description: 'Performance-related constraints for response times, throughput, resource usage',
        examples: [
          {
            scenario: 'API Response Time',
            example: '{ action: "add", category: "performance", constraint_text: "All API endpoints must respond within 100ms for 95th percentile", priority: "high", layer: "business", tags: ["api", "latency"] }',
            rationale: 'Ensures fast user experience and prevents timeout issues'
          },
          {
            scenario: 'Database Query Performance',
            example: '{ action: "add", category: "performance", constraint_text: "Database queries must complete within 50ms", priority: "high", layer: "data", tags: ["database", "query"] }',
            rationale: 'Prevents database bottlenecks and ensures scalability'
          },
          {
            scenario: 'Memory Usage',
            example: '{ action: "add", category: "performance", constraint_text: "Peak memory usage must not exceed 512MB per instance", priority: "critical", layer: "infrastructure", tags: ["memory", "resource"] }',
            rationale: 'Prevents out-of-memory errors in containerized environments'
          }
        ]
      },
      architecture: {
        description: 'Architectural constraints for code structure, dependencies, patterns',
        examples: [
          {
            scenario: 'Layer Dependency Rules',
            example: '{ action: "add", category: "architecture", constraint_text: "Presentation layer must not directly access data layer - use business layer only", priority: "critical", layer: "cross-cutting", tags: ["layering", "separation"] }',
            rationale: 'Enforces clean architecture and separation of concerns'
          },
          {
            scenario: 'Dependency Injection',
            example: '{ action: "add", category: "architecture", constraint_text: "All service classes must use constructor-based dependency injection", priority: "medium", layer: "business", tags: ["di", "testability"] }',
            rationale: 'Improves testability and reduces coupling'
          },
          {
            scenario: 'API Versioning',
            example: '{ action: "add", category: "architecture", constraint_text: "All public APIs must include version prefix (e.g., /v1/, /v2/)", priority: "high", layer: "presentation", tags: ["api", "versioning"] }',
            rationale: 'Enables backward compatibility and smooth API evolution'
          }
        ]
      },
      security: {
        description: 'Security constraints for authentication, authorization, data protection',
        examples: [
          {
            scenario: 'Authentication Required',
            example: '{ action: "add", category: "security", constraint_text: "All non-public endpoints must require JWT authentication", priority: "critical", layer: "presentation", tags: ["auth", "jwt"] }',
            rationale: 'Prevents unauthorized access to protected resources'
          },
          {
            scenario: 'Data Encryption',
            example: '{ action: "add", category: "security", constraint_text: "All PII (Personally Identifiable Information) must be encrypted at rest using AES-256", priority: "critical", layer: "data", tags: ["encryption", "pii"] }',
            rationale: 'Protects sensitive data and ensures compliance'
          },
          {
            scenario: 'Input Validation',
            example: '{ action: "add", category: "security", constraint_text: "All user inputs must be validated and sanitized before processing", priority: "critical", layer: "presentation", tags: ["validation", "injection-prevention"] }',
            rationale: 'Prevents injection attacks (SQL, XSS, etc.)'
          }
        ]
      },
      'code-style': {
        description: 'Code style constraints for naming conventions, formatting, documentation',
        examples: [
          {
            scenario: 'Naming Convention',
            example: '{ action: "add", category: "code-style", constraint_text: "All public functions must use camelCase naming", priority: "medium", layer: "cross-cutting", tags: ["naming", "convention"] }',
            rationale: 'Ensures consistent code readability across the codebase'
          },
          {
            scenario: 'Documentation Required',
            example: '{ action: "add", category: "code-style", constraint_text: "All public APIs must have JSDoc comments", priority: "medium", layer: "documentation", tags: ["jsdoc", "api"] }',
            rationale: 'Improves maintainability and developer experience'
          }
        ]
      }
    },
    management: {
      activate: {
        description: 'Reactivate a previously deactivated constraint',
        examples: [
          {
            scenario: 'Reactivate Constraint',
            example: '{ action: "activate", constraint_id: 5 }',
            rationale: 'Use when a temporarily deactivated constraint should be enforced again'
          }
        ]
      },
      deactivate: {
        description: 'Deactivate a constraint without deleting it',
        examples: [
          {
            scenario: 'Temporarily Disable Constraint',
            example: '{ action: "deactivate", constraint_id: 5 }',
            rationale: 'Useful for temporary exceptions or during refactoring'
          }
        ]
      },
      get_with_inactive: {
        description: 'Retrieve all constraints including inactive ones',
        examples: [
          {
            scenario: 'List All Constraints',
            example: '{ action: "get", include_inactive: true }',
            rationale: 'Review all constraints including deactivated ones for audit or reactivation'
          },
          {
            scenario: 'Filter by Category with Inactive',
            example: '{ action: "get", category: "security", include_inactive: true }',
            rationale: 'See all security constraints to identify ones that might need reactivation'
          }
        ]
      }
    },
    workflows: {
      constraint_lifecycle: {
        description: 'Full lifecycle of a constraint from creation to deactivation/reactivation',
        steps: [
          { step: 1, action: 'Add new constraint', example: '{ action: "add", category: "security", constraint_text: "All passwords must be hashed with bcrypt", priority: "critical" }' },
          { step: 2, action: 'Retrieve active constraints', example: '{ action: "get", category: "security" }' },
          { step: 3, action: 'Temporarily deactivate during migration', example: '{ action: "deactivate", constraint_id: 5 }' },
          { step: 4, action: 'List all including inactive for review', example: '{ action: "get", include_inactive: true }' },
          { step: 5, action: 'Reactivate after migration complete', example: '{ action: "activate", constraint_id: 5 }' }
        ]
      },
      constraint_validation: {
        description: 'Workflow for validating code against constraints',
        steps: [
          {
            step: 1,
            action: 'Retrieve active constraints for layer',
            example: '{ action: "get", layer: "business" }'
          },
          {
            step: 2,
            action: 'Check code changes against constraints',
            example: 'Review file changes and verify compliance with each constraint'
          },
          {
            step: 3,
            action: 'Report violations',
            example: 'Use message tool to send warnings for constraint violations'
          },
          {
            step: 4,
            action: 'Link violations to tasks',
            example: 'Create tasks to fix violations and link to relevant constraints'
          }
        ]
      },
      requirement_tracking: {
        description: 'Workflow for tracking requirements as constraints',
        steps: [
          {
            step: 1,
            action: 'Add requirement as constraint',
            example: '{ action: "add", category: "performance", constraint_text: "System must handle 1000 concurrent users", priority: "high", tags: ["requirement", "load"] }'
          },
          {
            step: 2,
            action: 'Link related decisions',
            example: 'Use decision tool to record architectural decisions that address the constraint'
          },
          {
            step: 3,
            action: 'Create implementation tasks',
            example: 'Use task tool to break down implementation and link to constraint'
          },
          {
            step: 4,
            action: 'Validate compliance',
            example: 'Test implementation against constraint criteria'
          }
        ]
      }
    },
    best_practices: {
      writing_constraints: [
        'Be specific and measurable (use numbers, percentages, time limits)',
        'Use the reason field to record why the constraint exists',
        'Use appropriate priority (critical for must-have, high for important, medium/low for nice-to-have)',
        'Assign to correct layer (where constraint is enforced)',
        'Tag comprehensively for easy retrieval'
      ],
      managing_constraints: [
        'Review constraints regularly and deactivate outdated ones',
        'Use activate/deactivate for temporary exceptions instead of deleting',
        'Periodically review inactive constraints with include_inactive: true',
        'Link constraints to related decisions and tasks',
        'Use constraints for both technical and business requirements',
        'Validate code changes against active constraints',
        'Document constraint violations and remediation plans'
      ]
    }
  };
}
