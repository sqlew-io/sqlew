/**
 * db:export CLI command - JSON data-only export for append-import
 * Complementary to db:dump (SQL export with schema)
 */

import * as fs from 'fs';
import * as path from 'path';
import { generateJsonExport } from '../utils/exporter/export.js';
import { loadConfigFile } from '../config/loader.js';
import { applyEnvConfigOverrides } from '../config/env-overrides.js';
import {
  createCliKnex,
  describeCliConnection,
  resolveCliDbDialect,
} from './create-cli-knex.js';

interface DbExportArgs {
  project?: string;
  output?: string;
  'db-path'?: string;
  config?: string;
  help?: boolean;
}

/**
 * Show help message for db:export command
 */
export function showDbExportHelp(): void {
  console.log(`
sqlew db:export - Export project data to JSON format

USAGE:
  npm run db:export -- [output-file] [key=value ...]

ARGUMENTS:
  [output-file]            Output file (optional, default: stdout)

OPTIONS (use key=value format):
  project=<name>           Export specific project (default: auto-detect from config.toml)
  project=all              Export all projects (explicit opt-in required)
  db-path=<path>           SQLite database path
  config=<path>            Config file path

ENVIRONMENT:
  SQLEW_DATABASE_URL / DATABASE_URL   Postgres/MySQL URL (overrides config.toml)
  SQLEW_DATABASE_*                    Discrete connection fields + SSL

EXAMPLES:
  # Export current project (auto-detect from .sqlew/config.toml)
  npm run db:export -- data.json

  # Export specific project
  npm run db:export -- data.json project=myproject

  # Export all projects (explicit)
  npm run db:export -- backup.json project=all

  # Export to stdout
  npm run db:export -- project=myproject

WORKFLOW:
  1. Export: npm run db:export -- data.json project=myproject
  2. Copy JSON to target
  3. Import: npm run db:import -- data.json
`);
}

/**
 * Parse command-line arguments for db:export
 * Supports key=value format (npm/PowerShell friendly)
 */
export function parseDbExportArgs(args: string[]): DbExportArgs {
  const parsed: Partial<DbExportArgs> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    // Handle key=value format (without -- prefix, npm/PowerShell friendly)
    if (arg.includes('=') && !arg.startsWith('-')) {
      const [key, ...v] = arg.split('=');
      const value = v.join('=');

      if (key === 'project') {
        parsed.project = value;
      } else if (key === 'db-path' || key === 'dbPath') {
        parsed['db-path'] = value;
      } else if (key === 'config') {
        parsed.config = value;
      }
    } else if (arg === 'help' || arg === '--help') {
      parsed.help = true;
    } else if (!arg.startsWith('-') && !arg.includes('=') && !parsed.output) {
      // Positional argument for output file
      parsed.output = arg;
    }
  }

  return parsed as DbExportArgs;
}

/**
 * Validate db:export arguments
 */
function validateArgs(args: DbExportArgs): string | null {
  // No required arguments - project name is optional
  // If not specified, exports all projects
  return null;
}

/**
 * Resolve CLI config: file load then env overrides (Cursor Secrets / DATABASE_URL).
 * Exported for unit tests — does not connect and does not log secrets.
 */
export function resolveDbExportConfig(configPath?: string, cwd: string = process.cwd()) {
  const loaded = loadConfigFile(cwd, configPath);
  return applyEnvConfigOverrides(loaded);
}

/**
 * Execute db:export command
 */
export async function executeDbExport(args: DbExportArgs): Promise<void> {
  // Show help if requested
  if (args.help) {
    showDbExportHelp();
    return;
  }

  // Validate arguments
  const validationError = validateArgs(args);
  if (validationError) {
    console.error(validationError);
    console.error('Run "sqlew db:export --help" for usage information.');
    process.exit(1);
  }

  const output = args.output;

  // Load config file, then apply env overrides (SQLEW_DATABASE_URL / DATABASE_URL / SSL)
  console.error(`Loading config file...`);
  const fileConfig = resolveDbExportConfig(args.config);
  if (fileConfig.database) {
    console.error(`Config loaded: database.type = ${fileConfig.database.type || 'sqlite'}`);
    if (fileConfig.database.path) {
      console.error(`Config loaded: database.path = ${fileConfig.database.path}`);
    }
    if (fileConfig.database.connection) {
      console.error(`Config loaded: database.connection configured`);
    }
  }

  // Resolve project name: CLI arg > config.toml [project].name > error
  let projectName = args.project;
  let exportAll = false;

  if (projectName === 'all') {
    exportAll = true;
    projectName = undefined;
  } else if (!projectName) {
    projectName = fileConfig.project?.name;
  }

  const dialect = resolveCliDbDialect(fileConfig);
  if (!dialect) {
    console.error(`Error: Unsupported source database: ${fileConfig.database?.type}`);
    process.exit(1);
  }

  try {
    console.error(`Reading from ${dialect.toUpperCase()} database...`);
    if (projectName) {
      console.error(`Exporting project: ${projectName}`);
    } else if (exportAll) {
      console.error(`Exporting all projects (explicit project=all)`);
    } else {
      console.error(`Error: No project name specified.`);
      console.error(`  Specify project name in one of these ways:`);
      console.error(`    1. Set [project].name in .sqlew/config.toml`);
      console.error(`    2. Use CLI option: project=<name>`);
      console.error(`    3. To export ALL projects: project=all`);
      process.exit(1);
    }

    if (dialect === 'sqlite') {
      const dbPath =
        args['db-path'] ||
        fileConfig.database?.path ||
        process.env.SQLEW_DB_PATH;
      if (dbPath) {
        const resolvedDbPath = path.resolve(process.cwd(), dbPath);
        if (!fs.existsSync(resolvedDbPath)) {
          console.error(`Error: SQLite database not found at ${resolvedDbPath}`);
          process.exit(1);
        }
      }
    }

    const db = createCliKnex(fileConfig, { dbPath: args['db-path'] });
    console.error(`Connected to ${describeCliConnection(dialect, fileConfig)}`);

    try {
      // Generate JSON export
      const json = await generateJsonExport(db, {
        projectName,
      });

      // Output to file or stdout
      if (output) {
        fs.writeFileSync(output, json, 'utf-8');
        console.error(`✓ JSON export written to: ${output}`);
        console.error(`\nNext steps:`);
        console.error(`  1. Copy file to target project directory`);
        console.error(`  2. Import data: sqlew db:import --source=${output}`);
      } else {
        // Output to stdout (user can pipe to file)
        console.log(json);
      }
    } finally {
      await db.destroy();
    }
  } catch (error) {
    console.error('Error generating JSON export:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Main entry point for db:export command
 */
export async function dbExportCommand(args: string[]): Promise<void> {
  const parsedArgs = parseDbExportArgs(args);
  await executeDbExport(parsedArgs);
}
