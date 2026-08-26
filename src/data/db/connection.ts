/**
 * Database connection port — the narrow surface repositories are written against.
 *
 * Why a port rather than expo-sqlite's `SQLiteDatabase` directly: it keeps the
 * repositories testable off-device (see src/data/db/testDb.ts, which backs the
 * same interface with Node's built-in sqlite), and it documents exactly which
 * four operations the data layer relies on. The shape deliberately mirrors
 * expo-sqlite so its `SQLiteDatabase` satisfies this interface as-is.
 *
 * Only src/data may depend on this. Nothing above the data layer sees SQL.
 */

/**
 * Positional bind parameters. Repositories always bind, never interpolate.
 * Mutable (not `readonly`) so expo-sqlite's `SQLiteDatabase` satisfies this
 * interface without a wrapper.
 */
export type SqlParams = (string | number | null)[];

export interface SqlRunResult {
  lastInsertRowId: number;
  changes: number;
}

export interface DatabaseConnection {
  /** Runs one or more statements with no result rows. */
  execAsync(source: string): Promise<void>;
  /** Runs a write statement and reports affected rows. */
  runAsync(source: string, params: SqlParams): Promise<SqlRunResult>;
  /** Returns the first row, or null when there are none. */
  getFirstAsync<T>(source: string, params: SqlParams): Promise<T | null>;
  /** Returns every matching row. */
  getAllAsync<T>(source: string, params: SqlParams): Promise<T[]>;
  /** Runs `task` inside a transaction, rolling back if it throws. */
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}
