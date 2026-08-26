/**
 * Migration mechanism behaviour (ARCHITECTURE.md §9).
 * Runs against real SQLite via node:sqlite — same engine as expo-sqlite.
 */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { getSchemaVersion, runMigrations } from '@/data/db/migrate';
import { LATEST_VERSION } from '@/data/db/migrations';

import { createTestDatabase, wrapConnection } from './helpers/testDb';

test('migrations bring a fresh database to the latest version', async () => {
  const db = await createTestDatabase();
  try {
    assert.equal(await getSchemaVersion(db.connection), LATEST_VERSION);
  } finally {
    db.close();
  }
});

test('running migrations twice is a no-op', async () => {
  const db = await createTestDatabase();
  try {
    // createTestDatabase already migrated; a second run must not throw
    // (it would if CREATE TABLE ran again).
    const version = await runMigrations(db.connection);
    assert.equal(version, LATEST_VERSION);
  } finally {
    db.close();
  }
});

test('migration 001 creates every expected table and index', async () => {
  const db = await createTestDatabase();
  try {
    const tables = await db.connection.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      [],
    );
    const names = tables.map((t) => t.name);
    for (const expected of ['books', 'bookmarks', 'reading_settings']) {
      assert.ok(names.includes(expected), `missing table ${expected}`);
    }

    const indexes = await db.connection.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%' ORDER BY name",
      [],
    );
    const indexNames = indexes.map((i) => i.name);
    for (const expected of [
      'idx_books_created_at',
      'idx_books_last_opened_at',
      'idx_books_title',
      'idx_bookmarks_book_id_page',
    ]) {
      assert.ok(indexNames.includes(expected), `missing index ${expected}`);
    }
  } finally {
    db.close();
  }
});

test('migration 001 seeds exactly one reading_settings row', async () => {
  const db = await createTestDatabase();
  try {
    const rows = await db.connection.getAllAsync<{ id: string }>(
      'SELECT id FROM reading_settings',
      [],
    );
    assert.deepEqual(
      rows.map((r) => r.id),
      ['default'],
    );
  } finally {
    db.close();
  }
});

test('a failing migration rolls back and leaves the version untouched', async () => {
  const raw = new DatabaseSync(':memory:');
  const connection = wrapConnection(raw);
  try {
    await assert.rejects(() =>
      // Second statement is invalid, so the whole migration must roll back.
      connection.withTransactionAsync(async () => {
        await connection.execAsync('CREATE TABLE probe (id TEXT)');
        await connection.execAsync('THIS IS NOT SQL');
      }),
    );

    const tables = await connection.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'probe'",
      [],
    );
    assert.equal(tables.length, 0, 'probe table should have been rolled back');
    assert.equal(await getSchemaVersion(connection), 0);
  } finally {
    raw.close();
  }
});

test('a database newer than the build refuses to migrate', async () => {
  const raw = new DatabaseSync(':memory:');
  const connection = wrapConnection(raw);
  try {
    await connection.execAsync(`PRAGMA user_version = ${LATEST_VERSION + 5}`);
    await assert.rejects(() => runMigrations(connection), /newer than this build supports/);
  } finally {
    raw.close();
  }
});
