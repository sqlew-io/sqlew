/**
 * Plan Pattern Extractor Unit Tests
 *
 * Tests for extracting 📌 Decision and 🚫 Constraint blocks
 * from plan markdown using regex patterns.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  extractPatternsFromPlan,
  hasFilledPatterns,
  hasPatterns,
} from '../../../cli/hooks/plan-pattern-extractor.js';

describe('plan-pattern-extractor', () => {
  describe('extractPatternsFromPlan - constraint reason', () => {
    it('should extract reason from constraint block with Reason field', () => {
      const content = `
### 🚫 Constraint: security
- **Rule**: No hardcoded API keys
- **Priority**: critical
- **Reason**: Keys committed to git cannot be rotated
- **Tags**: security, env
`;
      const result = extractPatternsFromPlan(content);

      assert.strictEqual(result.constraints.length, 1);
      assert.strictEqual(result.constraints[0].category, 'security');
      assert.strictEqual(result.constraints[0].rule, 'No hardcoded API keys');
      assert.strictEqual(result.constraints[0].priority, 'critical');
      assert.strictEqual(
        result.constraints[0].reason,
        'Keys committed to git cannot be rotated'
      );
      assert.strictEqual(result.constraints[0].tags, 'security, env');
    });

    it('should leave reason undefined when Reason field is absent', () => {
      const content = `
### 🚫 Constraint: architecture
- **Rule**: Use dependency injection for services
- **Priority**: high
- **Tags**: architecture, design
`;
      const result = extractPatternsFromPlan(content);

      assert.strictEqual(result.constraints.length, 1);
      assert.strictEqual(result.constraints[0].rule, 'Use dependency injection for services');
      assert.strictEqual(result.constraints[0].priority, 'high');
      assert.strictEqual(result.constraints[0].tags, 'architecture, design');
      assert.strictEqual(result.constraints[0].reason, undefined);
    });

    it('should extract all fields correctly when Reason is mixed with other fields', () => {
      const content = `
### 🚫 Constraint: code-style
- **Rule**: No console.log in production code
- **Reason**: Logs leak sensitive data to browser consoles
- **Priority**: medium
- **Tags**: logging, quality
`;
      const result = extractPatternsFromPlan(content);

      assert.strictEqual(result.constraints.length, 1);
      const c = result.constraints[0];
      assert.strictEqual(c.category, 'code-style');
      assert.strictEqual(c.rule, 'No console.log in production code');
      assert.strictEqual(c.reason, 'Logs leak sensitive data to browser consoles');
      assert.strictEqual(c.priority, 'medium');
      assert.strictEqual(c.tags, 'logging, quality');
    });

    it('should process multiple constraint blocks with and without reason individually', () => {
      const content = `
### 🚫 Constraint: security
- **Rule**: No hardcoded API keys
- **Priority**: critical
- **Reason**: Keys committed to git cannot be rotated

### 🚫 Constraint: performance
- **Rule**: Cache API responses for 5 minutes
- **Priority**: low
- **Tags**: caching
`;
      const result = extractPatternsFromPlan(content);

      assert.strictEqual(result.constraints.length, 2);

      assert.strictEqual(result.constraints[0].category, 'security');
      assert.strictEqual(result.constraints[0].rule, 'No hardcoded API keys');
      assert.strictEqual(result.constraints[0].reason, 'Keys committed to git cannot be rotated');

      assert.strictEqual(result.constraints[1].category, 'performance');
      assert.strictEqual(result.constraints[1].rule, 'Cache API responses for 5 minutes');
      assert.strictEqual(result.constraints[1].priority, 'low');
      assert.strictEqual(result.constraints[1].tags, 'caching');
      assert.strictEqual(result.constraints[1].reason, undefined);
    });

    it('should not affect decision extraction when constraints include Reason field', () => {
      const content = `
### 📌 Decision: auth/jwt-strategy
- **Value**: Use JWT with refresh tokens
- **Layer**: business
- **Tags**: auth, security
- **Rationale**: Stateless sessions scale better

### 🚫 Constraint: security
- **Rule**: No hardcoded API keys
- **Priority**: critical
- **Reason**: Keys committed to git cannot be rotated
`;
      const result = extractPatternsFromPlan(content);

      assert.strictEqual(result.decisions.length, 1);
      const d = result.decisions[0];
      assert.strictEqual(d.key, 'auth/jwt-strategy');
      assert.strictEqual(d.value, 'Use JWT with refresh tokens');
      assert.strictEqual(d.layer, 'business');
      assert.strictEqual(d.tags, 'auth, security');
      assert.strictEqual(d.rationale, 'Stateless sessions scale better');
      assert.strictEqual(d.alternatives, undefined);
      assert.strictEqual(d.tradeoffs, undefined);

      assert.strictEqual(result.constraints.length, 1);
      assert.strictEqual(result.constraints[0].reason, 'Keys committed to git cannot be rotated');
    });
  });

  describe('hasFilledPatterns', () => {
    const templateOnly = `
---
## 📝 Decision/Constraint Recording (auto-detected on ExitPlanMode)

### 📌 Decision: [key/path]
- **Value**: Description
- **Layer**: presentation | business | data | infrastructure | cross-cutting
- **Rationale**: Why this decision was made

### 🚫 Constraint: [category]
- **Rule**: Description (category: architecture | security | code-style | performance)
- **Priority**: critical | high | medium | low
- **Tags**: comma-separated tags

---
`;

    it('should return false for empty plan', () => {
      assert.strictEqual(hasFilledPatterns('# Plan\n\nNo ADR.\n'), false);
    });

    it('should return false for template placeholders only', () => {
      assert.strictEqual(hasPatterns(templateOnly), true);
      assert.strictEqual(hasFilledPatterns(templateOnly), false);
    });

    it('should return true for a real decision', () => {
      const content = `
### 📌 Decision: auth/session
- **Value**: Redis server-side sessions
- **Layer**: infrastructure
`;
      assert.strictEqual(hasFilledPatterns(content), true);
    });

    it('should return true for intentional N/A', () => {
      const content = `
### 📌 Decision: n/a
- **Value**: N/A
- **Layer**: cross-cutting
`;
      assert.strictEqual(hasFilledPatterns(content), true);
    });

    it('should return true when plan body has template plus a real block', () => {
      const content =
        templateOnly +
        `
### 📌 Decision: data/orm
- **Value**: Keep Knex
- **Layer**: data
`;
      assert.strictEqual(hasFilledPatterns(content), true);
    });
  });
});