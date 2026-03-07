/**
 * db:import CLI command - JSON data import for multi-project migration
 * Complements db:export (JSON export) and db:dump (SQL export)
 */

import knex from 'knex';
import * as fs from 'fs';
import * as path from 'path';
import knexConfig from '../knexfile.js';
import { importJsonData } from '../utils/importer/import.js';
import { loadConfigFile } from '../config/loader.js';
import { getDefaultDbPath } from '../config/global-config.js';
import type { JsonImportOptions } from '../types.js';

interface DbImportArgs {
  source: string;
  'project-name'?: string;
  'skip-if-exists'?: boolean;
  'dry-run'?: boolean;
  'db-path'?: string;
  config?: string;
  help?: boolean;
}

/**
 * Show help message for db:import command
 */
export function showDbImportHelp(): void {
  console.log(`
sqlew db:import - Import project data from JSON export

USAGE:
  npm run db:import -- <source-file> [key=value ...]

ARGUMENTS:
  <source-file>            JSON export file (required)

OPTIONS (use key=value format):
  project-name=<name>      Target project name (default: from JSON)
  skip-if-exists=true      Skip if project exists (default: true)
  dry-run=true             Validate only, don't import
  db-path=<path>           SQLite database path
  config=<path>            Config file path

EXAMPLES:
  # Import from JSON
  npm run db:import -- data.json

  # Import with custom project name
  npm run db:import -- data.json project-name=newproject

  # Dry run validation
  npm run db:import -- data.json dry-run=true

WORKFLOW:
  1. Export: npm run db:export -- data.json project=myproject
  2. Copy JSON to target
  3. Import: npm run db:import -- data.json
`);
}

/**
 * Parse command-line arguments for db:import
 * Supports key=value format (npm/PowerShell friendly)
 */
export function parseDbImportArgs(args: string[]): DbImportArgs {
  const parsed: Partial<DbImportArgs> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    // Handle key=value format (without -- prefix, npm/PowerShell friendly)
    if (arg.includes('=') && !arg.startsWith('-')) {
      const [key, ...v] = arg.split('=');
      const value = v.join('=');

      if (key === 'project-name' || key === 'projectName') {
        parsed['project-name'] = value;
      } else if (key === 'skip-if-exists' || key === 'skipIfExists') {
        parsed['skip-if-exists'] = value === 'true' || value === '1';
      } else if (key === 'dry-run' || key === 'dryRun') {
        parsed['dry-run'] = value === 'true' || value === '1';
      } else if (key === 'db-path' || key === 'dbPath') {
        parsed['db-path'] = value;
      } else if (key === 'config') {
        parsed.config = value;
      }
    } else if (arg === 'help' || arg === '--help') {
      parsed.help = true;
    } else if (!arg.startsWith('-') && !arg.includes('=') && !parsed.source) {
      // Positional argument for source file
      parsed.source = arg;
    }
  }

  return parsed as DbImportArgs;
}

/**
 * Validate db:import arguments
 */
function validateArgs(args: DbImportArgs): string | null {
  if (!args.source) {
    return 'Error: --source is required (path to JSON export file)';
  }

  if (!fs.existsSync(args.source)) {
    return `Error: Source file not found: ${args.source}`;
  }

  return null;
}

/**
 * Execute db:import command
 */
export async function executeDbImport(args: DbImportArgs): Promise<void> {
  // Show help if requested
  if (args.help) {
    showDbImportHelp();
    return;
  }

  // Validate arguments
  const validationError = validateArgs(args);
  if (validationError) {
    console.error(validationError);
    console.error('Run "sqlew db:import --help" for usage information.');
    process.exit(1);
  }

  // Load config file
  console.error(`Loading config file...`);
  const fileConfig = loadConfigFile(process.cwd(), args.config);
  if (fileConfig.database) {
    console.error(`Config loaded: database.type = ${fileConfig.database.type || 'sqlite'}`);
    if (fileConfig.database.path) {
      console.error(`Config loaded: database.path = ${fileConfig.database.path}`);
    }
  }

  // Determine target database
  const configDbType = fileConfig.database?.type || 'sqlite';
  const targetDb = configDbType === 'postgres' ? 'postgresql' : configDbType;

  try {
    console.error(`Reading from ${targetDb.toUpperCase()} database...`);

    // Create Knex instance
    let db: ReturnType<typeof knex>;

    if (targetDb === 'sqlite') {
      const dbPath = args['db-path'] || fileConfig.database?.path || process.env.SQLEW_DB_PATH || getDefaultDbPath();
      const resolvedDbPath = path.resolve(process.cwd(), dbPath);

      const config = { ...knexConfig.development };
      config.connection = { filename: resolvedDbPath };
      db = knex(config);
      console.error(`Connected to SQLite: ${resolvedDbPath}`);

    } else if (targetDb === 'mysql') {
      const config = { ...knexConfig.mysql };
      if (fileConfig.database?.connection) {
        config.connection = {
          host: fileConfig.database.connection.host || '127.0.0.1',
          port: fileConfig.database.connection.port || 3306,
          user: fileConfig.database.auth?.user || 'root',
          password: fileConfig.database.auth?.password || '',
          database: fileConfig.database.connection.database || 'mcp_context',
          charset: 'utf8mb4',
        };
      }
      db = knex(config);
      console.error(`Connected to MySQL`);

    } else if (targetDb === 'postgresql') {
      const config = { ...knexConfig.postgresql };
      if (fileConfig.database?.connection) {
        config.connection = {
          host: fileConfig.database.connection.host || 'localhost',
          port: fileConfig.database.connection.port || 5432,
          user: fileConfig.database.auth?.user || 'postgres',
          password: fileConfig.database.auth?.password || '',
          database: fileConfig.database.connection.database || 'mcp_context',
        };
      }
      db = knex(config);
      console.error(`Connected to PostgreSQL`);

    } else {
      console.error(`Error: Unsupported target database: ${targetDb}`);
      process.exit(1);
    }

    try {
      // Read JSON file
      console.error(`\nReading JSON export: ${args.source}`);
      const jsonContent = fs.readFileSync(args.source, 'utf-8');
      const jsonData = JSON.parse(jsonContent);

      console.error(`  ✓ JSON parsed (version: ${jsonData.metadata?.sqlew_version || jsonData.version})`);

      // Prepare import options
      const options: JsonImportOptions = {
        targetProjectName: args['project-name'],
        skipIfExists: args['skip-if-exists'] !== false,
        dryRun: args['dry-run'] || false
      };

      // Perform import
      const result = await importJsonData(db, jsonData, options);

      // Report results
      if (result.skipped) {
        console.error(`\n⚠️  Import skipped: ${result.skip_reason}`);
        console.error(`   Project: ${result.project_name}`);
        process.exit(0);
      }

      if (result.success) {
        console.error(`\n✅ Import successful!`);
        console.error(`   Project: ${result.project_name} (ID: ${result.project_id})`);
        if (result.stats) {
          console.error(`   Decisions: ${result.stats.transaction_tables.decisions_created}`);
          console.error(`   Constraints: ${result.stats.transaction_tables.constraints_created}`);
        }
      } else {
        console.error(`\n❌ Import failed: ${result.error}`);
        process.exit(1);
      }

    } finally {
      await db.destroy();
    }
  } catch (error) {
    console.error('Error during import:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Main entry point for db:import command
 */
export async function dbImportCommand(args: string[]): Promise<void> {
  const parsedArgs = parseDbImportArgs(args);
  await executeDbImport(parsedArgs);
}
