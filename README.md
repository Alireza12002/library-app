# library-app

Offline-first personal PDF library and reader (Expo + React Native + TypeScript).

- Architecture contract: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — read it before implementing anything.
- Android-first for v1. No backend, no auth, no cloud sync.

## Commands

```bash
npm install          # install dependencies
npm start            # Metro dev server
npm run typecheck    # tsc --noEmit (strict)
npm run lint         # eslint, zero warnings allowed
npm run format       # prettier check
```

A native Android build requires JDK 17 + Android SDK (`npx expo run:android`).
Without them, use EAS development builds or verify UI via `npm run web`.
