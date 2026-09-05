/**
 * react-native stand-in for hook tests (test-only, ARCHITECTURE.md §9).
 *
 * useReadingProgress subscribes to AppState to flush progress when the app
 * backgrounds. That is the only react-native surface the reader hooks touch at
 * runtime, so this provides just it.
 */

export const AppState = {
  addEventListener(): { remove: () => void } {
    return {
      remove(): void {
        /* no listeners to detach in tests */
      },
    };
  },
};

export const Platform = {
  OS: 'android' as const,
};
