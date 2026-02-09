#!/usr/bin/env node
/**
 * Cross-platform test output filter for AI-optimized test results.
 * Filters test output to show only failures and summary lines.
 *
 * Usage: node --test ... | node scripts/filter-test-output.js
 */

import { createInterface } from 'readline';

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

// Pattern matches: errors, failures (lines to SHOW)
const includePattern = /(✖|Error|FAIL)/;

// Pattern matches: passing tests, test start markers (lines to EXCLUDE)
const excludePattern = /(✔|✅|▶)/;

// Pattern matches: TAP pass lines and subtest headers (never failures)
const tapNonFailurePattern = /^\s*(ok \d|# Subtest:)/;

// Pattern to detect final summary section (lines starting with ℹ)
const summaryPattern = /^ℹ /;

let inSummary = false;
let previousLine = null;
let linesAfterFailure = 0;
let hasFailures = false; // Track if any failures were detected

rl.on('line', (line) => {
  // If we encounter a summary line, enter summary mode
  if (summaryPattern.test(line)) {
    inSummary = true;
  }

  // In summary mode, show all ℹ lines (complete table)
  if (inSummary && summaryPattern.test(line)) {
    console.log(line);
    return;
  }

  // If we're tracking lines after a failure, show them
  if (linesAfterFailure > 0) {
    console.log(line);
    linesAfterFailure--;
    previousLine = line;
    return;
  }

  // Check if current line is a failure
  // Exclude TAP pass lines (ok N) and subtest headers (# Subtest:) that may contain "Error" in test names
  const isFailure = includePattern.test(line) && !excludePattern.test(line) && !tapNonFailurePattern.test(line);

  if (isFailure) {
    hasFailures = true; // Mark that we detected failures
    // Show previous line (context before failure, e.g., "test at ...")
    if (previousLine !== null) {
      console.log(previousLine);
    }
    // Show the failure line itself
    console.log(line);
    // Show next 1 line after failure (error details)
    linesAfterFailure = 1;
  }

  // Remember current line as previous for next iteration
  previousLine = line;
});

rl.on('close', () => {
  // Exit with code 1 if failures detected, 0 otherwise
  // This propagates test failure to shell exit code
  process.exit(hasFailures ? 1 : 0);
});
