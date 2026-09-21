/**
 * Reading settings persistence (ARCHITECTURE.md §9).
 *
 * The reading MODE is the missing half of the "Reflow forgets its position"
 * bug: the Reflow position row was persisted, but the mode was written to a
 * storage module that does not exist in this app, so every restart reopened in
 * PDF mode and the saved Reflow position was never consulted. These tests pin
 * the settings row — including `mode` — to real SQLite.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { DEFAULT_READING_SETTINGS } from '@/core/entities/readingSettings';
import {
  createReadingSettingsRepository,
  sanitizeReadingSettings,
} from '@/data/repositories/readingSettingsRepository';

import { createTestDatabase } from './helpers/testDb';

describe('reading settings persistence', () => {
  test('defaults come back when nothing was ever saved', async () => {
    const db = await createTestDatabase();
    try {
      const repo = createReadingSettingsRepository(db.connection);
      const settings = await repo.get();
      assert.deepEqual(settings, DEFAULT_READING_SETTINGS);
    } finally {
      db.close();
    }
  });

  test('the reading mode survives a save/load round-trip', async () => {
    const db = await createTestDatabase();
    try {
      const repo = createReadingSettingsRepository(db.connection);
      await repo.save({ ...DEFAULT_READING_SETTINGS, mode: 'reflow', theme: 'sepia' });

      // A NEW repository over the same connection — models a fresh app start.
      const reloaded = await createReadingSettingsRepository(db.connection).get();
      assert.equal(reloaded.mode, 'reflow', 'mode must survive a restart');
      assert.equal(reloaded.theme, 'sepia');
    } finally {
      db.close();
    }
  });

  test('every field round-trips', async () => {
    const db = await createTestDatabase();
    try {
      const repo = createReadingSettingsRepository(db.connection);
      const saved = await repo.save({
        mode: 'reflow',
        theme: 'dark',
        fitMode: 'height',
        fontFamily: 'serif',
        fontSizePt: 19,
        lineHeight: 1.7,
        contentWidthPt: 560,
        invertPages: true,
        pageGap: 12,
      });
      const loaded = await repo.get();
      assert.deepEqual(loaded, saved);
      assert.equal(loaded.fontSizePt, 19);
      assert.equal(loaded.invertPages, true);
    } finally {
      db.close();
    }
  });

  test('a hand-corrupted row degrades to defaults instead of crashing', async () => {
    const db = await createTestDatabase();
    try {
      // Bypass the CHECK constraints via PRAGMA (models a row written by a
      // different build). ignore_check_constraints exists exactly for this.
      await db.connection.execAsync('PRAGMA ignore_check_constraints = ON');
      await db.connection.execAsync(
        "UPDATE reading_settings SET mode = 'martian', font_size_pt = -3 WHERE id = 'default'",
      );
      await db.connection.execAsync('PRAGMA ignore_check_constraints = OFF');

      const settings = await createReadingSettingsRepository(db.connection).get();
      assert.equal(settings.mode, DEFAULT_READING_SETTINGS.mode);
      assert.equal(settings.fontSizePt, DEFAULT_READING_SETTINGS.fontSizePt);
    } finally {
      db.close();
    }
  });

  test('sanitize clamps out-of-range values before they reach SQL', () => {
    const sanitized = sanitizeReadingSettings({
      ...DEFAULT_READING_SETTINGS,
      fontSizePt: Number.NaN,
      lineHeight: -1,
      pageGap: Number.NEGATIVE_INFINITY,
    });
    assert.equal(sanitized.fontSizePt, DEFAULT_READING_SETTINGS.fontSizePt);
    assert.equal(sanitized.lineHeight, DEFAULT_READING_SETTINGS.lineHeight);
    assert.equal(sanitized.pageGap, DEFAULT_READING_SETTINGS.pageGap);
  });
});

describe('migration 006 — settings columns', () => {
  test('adds fit_mode, content_width_pt and page_gap with defaults', async () => {
    const db = await createTestDatabase();
    try {
      const columns = await db.connection.getAllAsync<{ name: string }>(
        'PRAGMA table_info(reading_settings)',
        [],
      );
      const names = columns.map((c) => c.name);
      for (const expected of ['fit_mode', 'content_width_pt', 'page_gap']) {
        assert.ok(names.includes(expected), `missing column ${expected}`);
      }

      // The seeded row picked up the defaults without a rewrite.
      const row = await db.connection.getFirstAsync<{
        fit_mode: string;
        content_width_pt: number;
        page_gap: number;
      }>(
        "SELECT fit_mode, content_width_pt, page_gap FROM reading_settings WHERE id = 'default'",
        [],
      );
      assert.ok(row);
      assert.equal(row.fit_mode, 'width');
      assert.equal(row.content_width_pt, 640);
      assert.equal(row.page_gap, 0);
    } finally {
      db.close();
    }
  });
});
