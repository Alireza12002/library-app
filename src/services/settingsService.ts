/**
 * Settings service — persisted reader settings (ARCHITECTURE.md §3, L4).
 *
 * Owns the one settings row. The reading MODE lives here, and it matters more
 * than a cosmetic preference: on reopen it selects which independent reading
 * position is restored — the PDF page or the Reflow block. It therefore goes
 * through the same SQLite persistence as those positions, not a best-effort
 * side channel.
 */
import type { ReadingSettings } from '@/core/entities/readingSettings';

export interface SettingsServiceDeps {
  load(): Promise<ReadingSettings>;
  save(settings: ReadingSettings): Promise<ReadingSettings>;
}

export interface SettingsService {
  /** Persisted settings (defaults when nothing was ever saved). */
  getSettings(): Promise<ReadingSettings>;
  /** Replaces the persisted settings; resolves to what was actually stored. */
  saveSettings(settings: ReadingSettings): Promise<ReadingSettings>;
}

export function createSettingsService(deps: SettingsServiceDeps): SettingsService {
  return {
    getSettings: () => deps.load(),
    saveSettings: (settings) => deps.save(settings),
  };
}
