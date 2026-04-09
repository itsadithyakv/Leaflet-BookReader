# DudeRead

DudeRead is a desktop-first reading app built with Tauri + React for managing and reading a personal ebook library. It focuses on fast imports, offline reading, and a calm reading UI.

## What It Does Today

- **Library management**
  - Import EPUB (and PDF files for library storage).
  - Automatic metadata refresh for missing/low-quality titles, authors, and covers.
  - Cover caching for offline use.
  - Grid and list views with search, filters, and sorting.
  - Reading progress tracked per book and surfaced in library cards.

- **Reading experience**
  - Scroll and flip reading modes.
  - Progress persistence per book (last position saved).
  - Reader dot indicator (optional) marks the last read line after a short delay.
  - Auto-scroll with adjustable speed.
  - Adjustable font size.
  - Light and dark reader themes.
  - Chapter navigation sidebar with open/close support.

- **Sync hooks**
  - Google Drive connect and manual sync entry points.

## Key Pipelines

### Import + Metadata
1. User imports books (EPUB/PDF).
2. Books are added to the local library.
3. Metadata refresh attempts run for missing author/title/cover/genres.
4. Cover artwork is cached locally for offline use.

### Reading Progress
1. Reader updates progress as the user reads.
2. Progress is stored in the library store and persisted via the backend.
3. Library cards show completion percentage and “Finished” when complete.

### Reader Experience
1. Reader loads EPUB content into the reader view.
2. Theme, typography, and layout are applied consistently.
3. Optional reader dot marks the last read line after a short idle delay.
4. Auto-scroll can be toggled on/off and tuned via settings.

## Tech Stack

- Tauri (desktop shell)
- React + TypeScript
- Zustand (state management)

## Notes

- EPUB reading is supported in the reader.
- PDF files are stored in the library and can be imported; reader support is focused on EPUB.
