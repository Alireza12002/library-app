/**
 * Reading settings repository — all SQL touching `reading_settings` lives here
 * (ARCHITECTURE.md §3).
 *
 * One row (id = 'default'), seeded by migration 001. Reading MODE is part of it:
 * which mode a book reopens in decides which of the two independent reading
 * positions (PDF `last_page` vs Reflow block/page) is restored, so the mode has
 * to survive a restart exactly like the positions do.
 *
 * Values are validated on the way OUT as well as in: a row written by a newer
 * build, or hand-edited, must degrade to defaults rather than crash the reader.
 */
import {
  DEFAULT_READING_SETTINGS,
  FIT_MODES,
  READING_MODES,
  READING_THEMES,
  type ReadingSettings,
} from '@/core/entities/readingSettings';
import type { DatabaseConnection } from '@/data/db/connection';

export interface ReadingSettingsRepository {
  /** The persisted settings, with unknown/invalid values replaced by defaults. */
  get(): Promise<ReadingSettings>;
  /** Persists the whole settings object (single row, replaced atomically). */
  save(settings: ReadingSettings): Promise<ReadingSettings>;
}

interface ReadingSettingsRow {
  mode: string;
  theme: string;
  fit_mode: string;
  font_family: string;
  font_size_pt: number;
  line_height: number;
  content_width_pt: number;
  invert_pages: number;
  page_gap: number;
}

const COLUMNS =
  'mode, theme, fit_mode, font_family, font_size_pt, line_height, content_width_pt, invert_pages, page_gap';

function oneOf<T extends string>(allowed: readonly T[], value: string, fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function positive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonNegative(value: number, fallback: number): number {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** Row → entity, coercing anything out of range back to the default. */
export function toReadingSettings(row: ReadingSettingsRow): ReadingSettings {
  const d = DEFAULT_READING_SETTINGS;
  return {
    mode: oneOf(READING_MODES, row.mode, d.mode),
    theme: oneOf(READING_THEMES, row.theme, d.theme),
    fitMode: oneOf(FIT_MODES, row.fit_mode, d.fitMode),
    fontFamily:
      typeof row.font_family === 'string' && row.font_family ? row.font_family : d.fontFamily,
    fontSizePt: positive(row.font_size_pt, d.fontSizePt),
    lineHeight: positive(row.line_height, d.lineHeight),
    contentWidthPt: positive(row.content_width_pt, d.contentWidthPt),
    invertPages: row.invert_pages === 1,
    pageGap: nonNegative(row.page_gap, d.pageGap),
  };
}

/** Entity → validated entity: what actually gets written. */
export function sanitizeReadingSettings(settings: ReadingSettings): ReadingSettings {
  return toReadingSettings({
    mode: settings.mode,
    theme: settings.theme,
    fit_mode: settings.fitMode,
    font_family: settings.fontFamily,
    font_size_pt: settings.fontSizePt,
    line_height: settings.lineHeight,
    content_width_pt: settings.contentWidthPt,
    invert_pages: settings.invertPages ? 1 : 0,
    page_gap: settings.pageGap,
  });
}

export function createReadingSettingsRepository(db: DatabaseConnection): ReadingSettingsRepository {
  async function get(): Promise<ReadingSettings> {
    const row = await db.getFirstAsync<ReadingSettingsRow>(
      `SELECT ${COLUMNS} FROM reading_settings WHERE id = 'default'`,
      [],
    );
    return row ? toReadingSettings(row) : { ...DEFAULT_READING_SETTINGS };
  }

  return {
    get,

    async save(settings) {
      const s = sanitizeReadingSettings(settings);
      // UPSERT so a missing seed row (should never happen) is repaired rather
      // than making settings silently unpersistable.
      await db.runAsync(
        `INSERT INTO reading_settings (id, ${COLUMNS})
         VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           mode = excluded.mode,
           theme = excluded.theme,
           fit_mode = excluded.fit_mode,
           font_family = excluded.font_family,
           font_size_pt = excluded.font_size_pt,
           line_height = excluded.line_height,
           content_width_pt = excluded.content_width_pt,
           invert_pages = excluded.invert_pages,
           page_gap = excluded.page_gap`,
        [
          s.mode,
          s.theme,
          s.fitMode,
          s.fontFamily,
          s.fontSizePt,
          s.lineHeight,
          s.contentWidthPt,
          s.invertPages ? 1 : 0,
          s.pageGap,
        ],
      );
      return get();
    },
  };
}
