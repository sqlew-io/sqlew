/**
 * SQL Import Module for Docker Containers
 *
 * Provides utilities for importing SQL dumps into MySQL/MariaDB/PostgreSQL
 * running in Docker containers.
 */

import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
/**
 * Import SQL dump to database via Docker container
 */
export async function importSqlToDocker(
  sql: string,
  containerName: string,
  type: 'mysql' | 'mariadb' | 'postgresql'
): Promise<void> {
  const tempFile = `/tmp/sqlew-test-${Date.now()}.sql`;
  writeFileSync(tempFile, sql);

  try {
    // Copy file to container
    await execAsync(`docker cp ${tempFile} ${containerName}:/tmp/import.sql`);

    // Import based on database type
    if (type === 'mysql' || type === 'mariadb') {
      await execAsync(
        `docker exec ${containerName} mysql -u mcp_user -pmcp_pass mcp_test -e "SOURCE /tmp/import.sql"`
      );
    } else if (type === 'postgresql') {
      await execAsync(
        `docker exec ${containerName} psql -U mcp_user -d mcp_test -f /tmp/import.sql -v ON_ERROR_STOP=1 -q`
      );
    }
  } finally {
    // Clean up temp file
    if (existsSync(tempFile)) {
      unlinkSync(tempFile);
    }
  }
}
