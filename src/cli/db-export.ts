/**
 * db:export CLI command - JSON data-only export for append-import
 * Complementary to db:dump (SQL export with schema)
 */

import knex from 'knex';
import * as fs from 'fs';
import * as path from 'path';
import knexConfig from '../knexfile.js';
import { generateJsonExport } from '../utils/exporter/export.js';
import { loadConfigFile } from '../config/loader.js';
import { getDefaultDbPath } from '../config/global-config.js';

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
  project=<name>           Export specific project (default: all projects)
  db-path=<path>           SQLite database path
  config=<path>            Config file path

EXAMPLES:
  # Export specific project
  npm run db:export -- data.json project=myproject

  # Export all projects
  npm run db:export -- backup.json

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

  const projectName = args.project;
  const output = args.output;

  // Load config file - prioritize: explicit --config > default locations
  console.error(`Loading config file...`);
  const fileConfig = loadConfigFile(process.cwd(), args.config);
  if (fileConfig.database) {
    console.error(`Config loaded: database.type = ${fileConfig.database.type || 'sqlite'}`);
    if (fileConfig.database.path) {
      console.error(`Config loaded: database.path = ${fileConfig.database.path}`);
    }
    if (fileConfig.database.connection) {
      console.error(`Config loaded: database.connection configured`);
    }
  }

  // Determine source database - normalize 'postgres' to 'postgresql'
  const configDbType = fileConfig.database?.type || 'sqlite';
  const sourceDb = configDbType === 'postgres' ? 'postgresql' : configDbType;

  try {
    console.error(`Reading from ${sourceDb.toUpperCase()} database...`);
    if (projectName) {
      console.error(`Exporting project: ${projectName}`);
    } else {
      console.error(`Exporting all projects`);
    }

    // Create Knex instance based on source database
    let db: ReturnType<typeof knex>;

    if (sourceDb === 'sqlite') {
      // SQLite source - prioritize: CLI arg > config file (default) > env var > global default
      const dbPath = args['db-path'] || fileConfig.database?.path || process.env.SQLEW_DB_PATH || getDefaultDbPath();
      const resolvedDbPath = path.resolve(process.cwd(), dbPath);

      // Check if database exists
      if (!fs.existsSync(resolvedDbPath)) {
        console.error(`Error: SQLite database not found at ${resolvedDbPath}`);
        process.exit(1);
      }

      const config = { ...knexConfig.development };
      config.connection = { filename: resolvedDbPath };
      db = knex(config);
      console.error(`Connected to SQLite: ${resolvedDbPath}`);

    } else if (sourceDb === 'mysql') {
      // MySQL source - use config file (default) or environment variables
      const config = { ...knexConfig.mysql };
      if (fileConfig.database?.connection) {
        // Override with config file settings
        config.connection = {
          host: fileConfig.database.connection.host || '127.0.0.1',
          port: fileConfig.database.connection.port || 3306,
          user: fileConfig.database.auth?.user || 'root',
          password: fileConfig.database.auth?.password || '',
          database: fileConfig.database.connection.database || 'mcp_context',
          charset: 'utf8mb4',
        };
        console.error(`Using MySQL connection from config file`);
      }
      db = knex(config);
      const conn = config.connection as any;
      console.error(`Connected to MySQL: ${conn.host}:${conn.port}/${conn.database}`);

    } else if (sourceDb === 'postgresql') {
      // PostgreSQL source - use config file (default) or environment variables
      const config = { ...knexConfig.postgresql };
      if (fileConfig.database?.connection) {
        // Override with config file settings
        config.connection = {
          host: fileConfig.database.connection.host || 'localhost',
          port: fileConfig.database.connection.port || 5432,
          user: fileConfig.database.auth?.user || 'postgres',
          password: fileConfig.database.auth?.password || '',
          database: fileConfig.database.connection.database || 'mcp_context',
        };
        console.error(`Using PostgreSQL connection from config file`);
      }
      db = knex(config);
      const conn = config.connection as any;
      console.error(`Connected to PostgreSQL: ${conn.host}:${conn.port}/${conn.database}`);

    } else {
      console.error(`Error: Unsupported source database: ${sourceDb}`);
      process.exit(1);
    }

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
