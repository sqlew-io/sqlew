#!/usr/bin/env node
/**
 * Thin bin alias: run the same entry as the `sqlew` package.
 */
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const entry = require.resolve('sqlew');
await import(pathToFileURL(entry).href);
