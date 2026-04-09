# Leaflet v0.1.2

Leaflet is a desktop-first reading app built with Tauri + React for managing and reading a personal ebook library. It emphasizes fast imports, offline reading, calm UI, and habit-friendly focus sessions.

## What It Does Today

- **Library management**
  - Import EPUB, PDF, AZW3, and MOBI files (AZW3/MOBI are converted to EPUB when possible).
  - Automatic metadata refresh for missing/low-quality title/author/cover.
  - Cover caching for offline use.
  - Grid/list views with search, filters, and sorting.
  - Reading progress stored per book and surfaced in library cards.

- **Reading experience**
  - Scroll reader with chapter sidebar and bookmarks.
  - Progress persistence (last location per chapter).
  - Reader dot indicator (optional) marks last read line after a short delay.
  - Auto-scroll with adjustable speed.
  - Adjustable font size.
  - Light/dark reader themes.

- **Focus sessions + analytics**
  - Timed sessions with checkpoints and optional session notes.
  - “Clean session” rewards for uninterrupted focus.
  - Analytics bookshelf that visualizes completed focus sessions.
  - Shelf tier progression (wood ? stone ? copper ? iron ? gold ? diamond ? netherite).

- **Sync hooks**
  - Google Drive connect and manual sync entry points.

## Key Pipelines

### Import + Convert + Metadata
1. User imports books (EPUB/PDF/AZW3/MOBI).
2. Non-EPUB formats are converted when possible via the bundled converter.
3. Books are stored locally in the library.
4. Metadata refresh attempts fill missing title/author/cover info.
5. Cover artwork is cached locally for offline use.

### Reading Progress
1. Reader updates progress as the user reads.
2. Progress is stored in the library store and persisted locally.
3. Library cards show completion percentage and “Finished” when complete.

### Reader Experience
1. EPUB content is rendered in the reader view.
2. Theme, typography, and layout are applied consistently.
3. Optional reader dot marks the last read line after a short idle delay.
4. Auto-scroll and font sizing are controlled from reader settings.
5. Sidebar open/close uses eased transitions with a masked layout freeze to avoid text reflow flashes.

### Focus Sessions + Bookshelf
1. User starts a timed focus session.
2. Checkpoints (50/90/100%) prompt gentle toasts.
3. On completion, a bookshelf item is created with session metadata.
4. Clean sessions receive a visual bonus.

## Tech Stack

- **Tauri** (desktop shell)
- **React + TypeScript** (UI)
- **Zustand** (state management)
- **epub.js** (EPUB rendering)

## Local Storage + Data

- Library, reader preferences, and bookmarks are stored locally.
- Covers are cached in the app data directory for offline use.

## Notes

- EPUB reading is supported in the reader.
- PDF files are stored in the library and can be imported; reader support is focused on EPUB.
- Converter download is optional in dev; enable with `DUDEREADER_AUTO_DOWNLOAD_CONVERTER=1`.
