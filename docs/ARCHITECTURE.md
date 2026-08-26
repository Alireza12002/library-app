# PDF Library App — Architecture Document (v1 Contract)

> **Status:** Active contract for all future implementation tasks. Any deviation requires updating this document first.
> **Scope:** Offline-first personal PDF library and reader. Android-first. No backend, no auth, no cloud sync — ever, for v1.

---

## 0. Verified Platform Baseline (researched 2026-08-25)

| Component | Version | Notes |
|---|---|---|
| Expo SDK | **57** (latest stable) | RN 0.87, React 19.x |
| `expo-sqlite` | 57.0.x | New type-safe API |
| `expo-file-system` | 57.0.x | New `File`/`Directory` API only — legacy API is forbidden |
| `expo-document-picker` | 57.0.x | Returns Android SAF `content://` URIs |
| `@kishannareshpal/expo-pdf` | **0.3.2** (2026-03-24) | Chosen PDF engine, behind `PdfEngine` port |

### PDF library verification results (from npm package + Kotlin source inspection)

**Compatible:** zero runtime JS dependencies; peers `expo`/`react`/`react-native`; ships an Expo Module (works with EAS dev builds, not Expo Go); Android implementation wraps the author's maintained `AndroidPdfViewer` fork over `io.legere:pdfiumandroid:1.0.32`.

**Confirmed capability set:** local + remote URIs, `pagingEnabled`, `horizontal`, `doubleTapToZoom`, `fitMode ('width'|'height'|'both')`, `pageGap`, `contentPadding`, `pageColorInverted` (dark pages), `autoScale`, events `onLoadComplete(pageCount)`, `onPageChanged(pageIndex, pageCount)`, `onError(invalid_uri | invalid_document | password_required | password_incorrect)`.

**⚠ Confirmed gaps (must be designed around, not discovered later):**
1. **No imperative jump-to-page.** There is no `initialPage` prop, no ref/controller, no programmatic page navigation — only the `onPageChanged` callback. "Continue reading" therefore cannot be a simple prop today. Strategy: see §8 (Risks R1) and Phase 4 spike.
2. **No text extraction.** Goal #9 needs a separate mechanism (Phase 7): a thin in-repo Expo module over `io.legere:pdfiumandroid` (the same pdfium engine the viewer already bundles — no second native renderer).
3. **Pre-1.0, effectively single-maintainer.** Mitigated by the `PdfEngine` port making replacement a one-adapter change.

---

## 1. Architectural Layers

Dependency direction is **inward only**. An outer layer may import an inner one; never the reverse.

```
┌─────────────────────────────────────────────────────────┐
│ L5 PRESENTATION                                         │
│ app/ routes, feature components/hooks                   │
│ React Native + Expo Router only                         │
├─────────────────────────────────────────────────────────┤
│ L4 APPLICATION SERVICES                                 │
│ business logic: import, reading progress, bookmarks,    │
│ extraction orchestration, settings                      │
├───────────────────────────────┬─────────────────────────┤
│ L3 INFRASTRUCTURE ADAPTERS    │ L2 PLATFORM ADAPTERS    │
│ repositories (SQLite),        │ PdfEngine adapter       │
│ file storage                  │ (expo-pdf), doc-picker  │
├───────────────────────────────┴─────────────────────────┤
│ L1 CORE (DOMAIN)                                        │
│ entities, value objects, ports, errors                  │
│ Pure TypeScript. Zero RN/Expo imports. Unit-testable.   │
└─────────────────────────────────────────────────────────┘
```

Hard rules:
- **Screens never** import from `data/`, `services/` internals beyond their public functions, `files/`, `pdf/adapters/`, or call `expo-sqlite`/`expo-file-system`/PDF libs directly.
- **Services** own transactions/business rules; they compose repositories + adapters.
- **Core** contains no framework code; it compiles with plain `tsc`.

---

## 2. Folder Structure

```
library-app/
├── app/                              # Expo Router — routes ONLY, presentation/orchestration
│   ├── _layout.tsx                   # root stack (SafeAreaProvider) — (tabs) + pushed routes
│   ├── (tabs)/
│   │   ├── _layout.tsx               # bottom tab bar: Library, Settings
│   │   ├── index.tsx                 # Library: book grid/list, import button
│   │   └── settings.tsx              # reading/appearance/typography preferences
│   ├── book/
│   │   └── [id].tsx                  # book details, actions, bookmark list entry point
│   └── reader/
│       └── [bookId].tsx              # PDF mode + reflow mode host (pushed above the tabs)
├── src/
│   ├── core/                         # L1 — pure TS
│   │   ├── entities/                 # Book, Bookmark, ReadingProgress, ReadingSettings
│   │   ├── ports/                    # PdfEngine, PdfEngineViewProps, StoragePort,
│   │   │                             # DocumentPickerPort, Clock (test seam)
│   │   ├── errors.ts                 # DomainError taxonomy (ImportValidationError, …)
│   │   └── ids.ts                    # uuid helper
│   ├── data/                         # L3 — persistence
│   │   ├── db/
│   │   │   ├── client.ts             # single sqlite connection, WAL
│   │   │   └── migrations/           # numbered, forward-only SQL migrations
│   │   └── repositories/
│   │       ├── bookRepository.ts
│   │       ├── bookmarkRepository.ts
│   │       └── readingProgressRepository.ts
│   ├── files/                        # L3 — filesystem
│   │   ├── storage.ts                # library dir layout, copy-in/delete, path resolver
│   │   └── documentPicker.ts         # wraps expo-document-picker → DocumentPickerPort
│   ├── services/                     # L4
│   │   ├── importService.ts          # pick → validate → copy → insert row (transactional)
│   │   ├── bookService.ts            # delete book (row + file), rename, list ordering
│   │   ├── readingProgressService.ts # load/save last page (debounced writes)
│   │   ├── bookmarkService.ts
│   │   └── settingsService.ts        # typography/theme prefs
│   ├── pdf/                          # L2 — PDF behind the port
│   │   ├── engine.ts                 # resolves PdfEngine singleton (DI point)
│   │   └── adapters/
│   │       └── expoPdfAdapter.ts     # maps PdfEngine* ↔ @kishannareshpal/expo-pdf
│   ├── features/                     # L5 presentation, feature-scoped
│   │   ├── library/                  # components/, hooks/
│   │   ├── book-detail/
│   │   ├── reader/                   # components/ (PdfScreen, ReflowScreen), hooks/
│   │   └── settings/                 # typography & theme controls (later phase)
│   ├── components/layout/            # shared primitives (Screen, EmptyState, Section, Row)
│   ├── theme/                        # tokens, dark/light, typography scale
│   └── config/                       # constants: limits, debounce ms, storage dirs
├── assets/
├── docs/                             # this file
├── .github/workflows/ci.yml
├── app.json · eas.json · babel.config.js · metro.config.js
├── tsconfig.json                     # strict: true, exactOptionalPropertyTypes
├── eslint.config.js · .prettierrc
└── package.json
```

Import-alias: `@/*` → `src/*` (and routes use relative or `@/`).

---

## 3. Major Modules & Boundaries

| Module | Owns | May import | Must NOT import |
|---|---|---|---|
| `core/` | entities, ports, errors | nothing app-specific | RN, Expo, any L≥2 module |
| `data/db` | connection, migrations | core (nothing else needed) | services, features, pdf |
| `data/repositories` | SQL queries, row↔entity mapping | `data/db`, `core/entities` | services, features, RN components |
| `files/` | storage layout, copy/delete, picker | core/ports, expo-file-system, expo-document-picker | repositories, services internals |
| `pdf/` | PdfEngine port impl, engine selection | core/ports, `@kishannareshpal/expo-pdf` | data, services, features |
| `services/` | business rules, orchestration | core, repositories, files, pdf/engine | RN components, `app/` routes |
| `features/*` | UI components + hooks | services (public fns), core/entities, theme | direct sqlite/fs/pdf-lib usage |
| `components/layout` | shared presentation primitives | `theme`, react-native | services, core entities, data, files, pdf |
| `app/` | routing, screen composition | features, `components/layout`, services (via hooks) | repositories, db, fs, pdf adapter |

Cross-module communication happens **through `core/ports` interfaces**, so any adapter (PDF lib, storage, picker) can be swapped without touching services or UI.

---

## 4. Data Entities & Schema (migration 001)

```ts
// core/entities
Book              { id: string(uuid); title: string; fileName: string;
                    storedPath: string;      // absolute file:// URI of the private copy
                    fileSizeBytes: number;
                    addedAt: Date; updatedAt: Date }
ReadingProgress   { bookId: string;         // FK, UNIQUE — 1:1 with Book
                    lastPageIndex: number;   // 0-based
                    lastReadAt: Date }
Bookmark          { id: string(uuid); bookId: string; pageIndex: number;
                    label?: string; createdAt: Date }   // UNIQUE(bookId, pageIndex)
ReadingSettings   { id: 'default';          // single-row table
                    mode: 'pdf' | 'reflow';
                    theme: 'light' | 'sepia' | 'dark';
                    fontFamily: string; fontSizePt: number;
                    lineHeight: number; invertPages: boolean }
ExtractedPage?    { id; bookId; pageIndex; text; extractedAt }  // cache table, Phase 7
```

```sql
CREATE TABLE books (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  file_name TEXT NOT NULL,
  stored_path TEXT NOT NULL UNIQUE,
  file_size_bytes INTEGER NOT NULL,
  added_at INTEGER NOT NULL,          -- unix ms
  updated_at INTEGER NOT NULL
);
CREATE TABLE reading_progress (
  book_id TEXT PRIMARY KEY NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  last_page_index INTEGER NOT NULL DEFAULT 0,
  last_read_at INTEGER NOT NULL
);
CREATE TABLE bookmarks (
  id TEXT PRIMARY KEY NOT NULL,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  page_index INTEGER NOT NULL,
  label TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(book_id, page_index)
);
CREATE TABLE reading_settings (
  id TEXT PRIMARY KEY CHECK (id = 'default'),
  mode TEXT NOT NULL DEFAULT 'pdf',
  theme TEXT NOT NULL DEFAULT 'light',
  font_family TEXT NOT NULL DEFAULT 'system',
  font_size_pt REAL NOT NULL DEFAULT 16,
  line_height REAL NOT NULL DEFAULT 1.5,
  invert_pages INTEGER NOT NULL DEFAULT 0
);
-- Phase 7 adds: extracted_pages(book_id, page_index, text, extracted_at)
```

Rules: timestamps as unix-ms integers; all writes through repositories; migrations forward-only, never edited once shipped.

---

## 5. Dependencies (smallest viable set)

### Runtime
| Package | Purpose | Justification |
|---|---|---|
| `expo` (SDK 57) + `react`, `react-native` | framework | given |
| `expo-router` | file-based navigation | given |
| `expo-sqlite` | structured local data | given |
| `expo-file-system` | persistent PDF storage | given |
| `expo-document-picker` | import flow | given |
| `@kishannareshpal/expo-pdf@0.3.2` | PDF rendering (verified above) | only native PDF option that is Expo-Module based, actively published, zero JS deps |
| `react-native-safe-area-context` | safe-area insets | **required peer of `expo-router`** — `expo-router` imports `SafeAreaProvider` at module load and the vendored bottom-tabs/native-stack views require it; the app cannot boot without it. Installed via `npx expo install` (SDK-pinned) |
| `expo-linking` | deep-link URL handling | **required peer of `expo-router`**; backs the `library://` scheme declared in `app.json`. Installed via `npx expo install` (SDK-pinned) |
| `zustand` | **deferred until a real need appears** | expected candidate: reader UI state shared across PdfScreen/ReflowScreen chrome. Do not add until a hook-local state demonstrably fails |

### Dev
`typescript@~5.9` (strict), `eslint` + `eslint-config-expo`, `prettier`, `jest` + `jest-expo` + `@testing-library/react-native`, `eas-cli` (CI only).

### Explicitly excluded
Backend/HTTP clients, auth, cloud sync, state-management beyond the conditional zustand, ORM layers (raw typed SQL via `expo-sqlite` is enough), moment/date libs (use `Intl`/plain `Date`).

Any new dependency requires a written purpose statement in this section before installation.

---

## 6. Key Ports (contracts, not implementations)

```ts
// core/ports/pdfEngine.ts — the ONLY way the app talks to PDF technology
export interface PdfSource { kind: 'file'; uri: string }

export interface PdfEngine {
  /** Native view props adapter — rendered by <PdfEngineView {...props}/> */
  ViewComponent: React.ComponentType<PdfEngineViewProps>;
}

export interface PdfEngineViewProps {
  source: PdfSource;
  initialPosition?: { pageIndex: number };
  horizontal?: boolean;
  pagingEnabled?: boolean;
  fitMode?: 'width' | 'height' | 'both';
  inverted?: boolean;
  doubleTapZoom?: boolean;
  onLoad?: (info: { pageCount: number }) => void;
  onPageChange?: (position: { pageIndex: number; pageCount: number }) => void;
  onError?: (error: PdfEngineError) => void;   // normalized core/errors codes
}

/** Optional capability — engines MAY throw UnsupportedCapabilityError */
export interface PdfTextExtractor {
  extractPageText(uri: string, pageIndex: number): Promise<string>;
}

export interface PdfEngineCapabilities {
  jumpToInitialPage: boolean;   // false for expo-pdf 0.3.2 until Phase 4 spike resolves it
  textExtraction: boolean;      // false until Phase 7 pdf-text module lands
}
```

Swapping libraries later = writing one new adapter in `src/pdf/adapters/` + flipping `engine.ts`. Nothing else changes. **If a chosen library fails SDK/EAS compatibility checks, stop and report — do not silently swap.**

---

## 7. Core Flows (orchestration contracts)

**Import:** route calls `useImportBooks()` → `importService.importFromPicker()`: `documentPicker.pick({ pdf })` → validate (extension/mime, size ≤ `config.maxImportBytes`) → `files.storage.copyIntoLibrary(contentUri, uuid)` (new FS API reads SAF `content://` directly; permission is session-scoped, hence copy immediately) → `bookRepository.insert(...)` in one logical step; failure at any stage cleans up partial artifacts.

**Continue reading:** reader route loads book + progress → passes `{ source, initialPosition }` to `PdfEngine.ViewComponent`; every `onPageChange` is debounced (`config.progressDebounceMs`) into `readingProgressService.save()`; leaving the screen flushes pending write.

**Bookmark:** `onPageChange` keeps current page in hook state; add → `bookmarkService.add(bookId, pageIndex)`; tap bookmark → navigate/scroll (subject to R1 capability).

**Delete book:** transactional semantics — DB row delete, then file delete; orphaned file cleanup is acceptable, orphaned rows are not (file existence checked on open).

---

## 8. Risks & Technical Constraints

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| R1 | expo-pdf 0.3.2 has **no jump-to-page API** (verified in source) | "continue reading" UX | Phase 4 spike: (a) remount-with-key at target page via internal scroll assumptions, (b) upstream contribution/patch-package adding `initialPage` (trivial in `reloadPdf()`), or (c) fork. Abstraction already models it as a capability flag |
| R2 | No text extraction in viewer lib | Goal #9 | Phase 7 thin Expo module `pdf-text` over `io.legere:pdfiumandroid` (already in the dependency graph via expo-pdf — no second pdfium) |
| R3 | Single-maintainer pre-1.0 PDF lib | maintenance | Port isolation (§6); adapter swap is contained |
| R4 | Pdfium bitmap memory on large PDFs / low-end Android | OOM crashes | paging enabled, fitMode width, import size warning, test on 2 GB-RAM device profile, avoid keeping two readers mounted |
| R5 | SAF `content://` grants are transient | broken imports | copy into app storage during picker session (never persist the content URI) |
| R6 | New expo-file-system API is young (SDK 54+) | API drift | use only new `File`/`Directory` API, pin SDK 57, upgrade deliberately |
| R7 | Scanned/image PDFs yield no text | reflow mode useless for them | detect empty extraction, show "no extractable text", stay in PDF mode; OCR explicitly out of scope v1 |
| R8 | Reflow pagination fidelity | confusing bookmarks | reflow = continuous scroll view; bookmarks anchor to nearest source page, labeled as such |
| R9 | EAS builds required (native modules ⇒ no Expo Go) | slower loop | EAS development profiles + local `npx expo run:android` when possible; CI caches Gradle |
| R10 | SQLite corruption / interrupted writes | data loss | WAL mode; file ops before DB commits where order matters |

---

## 9. Testing Strategy (every feature independently testable)

- **L1 core:** pure unit tests (no mocks needed).
- **Services:** unit tests with in-memory repository/port fakes (interfaces make this trivial); fake clock/debounce.
- **Repositories:** tests against real `expo-sqlite` in-memory DB (`SQLiteProvider`/`:memory:`) under jest-expo.
- **Adapters (pdf/storage/picker):** thin; covered by contract tests asserting mapping to/from port types; device-level behavior validated manually via dev build checklist per phase.
- **Presentation:** `@testing-library/react-native` render tests with mocked service hooks.
- CI gate on every PR: `tsc --noEmit` && `eslint .` && `jest`. Failures are fixed, never suppressed (`@ts-ignore`/eslint-disable require justification in review).

---

## 10. Implementation Order

Each phase ends with green typecheck + lint + tests and a short manual device checklist. Phases ship PR-by-PR; unrelated files untouched.

| Phase | Deliverable | Done when |
|---|---|---|
| **0. Scaffold** | create-expo-app (SDK 57), TS strict, ESLint/Prettier, folder skeleton, aliases, jest-expo wired, GitHub Actions CI, `eas.json` (development/profile/production, Android) | CI green on hello-world; dev build installs |
| **1. Persistence core** | db client + migration 001 + three repositories + settings row | repo unit tests pass against in-memory sqlite |
| **2. Import + Library** | picker port, storage, `importService`, library list screen | pick PDF → appears in list; app restart keeps it; duplicate/corrupt handled |
| **3. Reader MVP** | PdfEngine port + expo-pdf adapter, reader screen, progress saving (debounced) | open book → renders; page turns persist across reopen |
| **4. Jump-to-page (R1 spike)** | resolve continue-reading mechanism; update capability flag | opening a mid-book item lands on saved page |
| **5. Bookmarks** | service, UI, jump-from-bookmark | add/list/remove/tap-through works |
| **6. Reader ergonomics** | h/v mode toggle, fit modes, page inversion, zoom defaults, error states (password/corrupt) | manual checklist passes on large test PDF |
| **7. Extraction + reflow** | `pdf-text` native module (or upstream capability), `extractionService` + cache table, ReflowScreen with typography/theme controls | digital PDF extracts; scanned PDF shows graceful fallback (R7/R8) |
| **8. Settings polish** | typography/theme persistence via settingsService | prefs survive restart, apply to both modes |
| **9. Hardening & release** | edge cases (R4–R7), empty/error states, prod EAS profile, changelog | production build runs clean |

---

*This document is the contract. Implementation tasks reference phases by number; architectural changes amend this file in the same PR.*
