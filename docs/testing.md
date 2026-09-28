# Testing

## What exists

**254 Rust unit tests**, run with `cargo test` from `apps/src-tauri`. Every test
is colocated in a `#[cfg(test)] mod tests` beside the code it covers. The table
below is the original core; the Pip economy (`pip`, `habit::seeds`), reminders,
the metadata matcher, EPUB package reading (`storage::epub`) and database
upgrades have their own tests beside them too.

| Module | Tests | Covers |
| --- | --- | --- |
| `sync` | 49 | Merge rules, convergence, tombstones, OAuth callback parsing, Drive wire types, credential resolution, two-device folder round trips |
| `convert` | 26 | The built-in TXT / HTML / FB2 → EPUB converters and the EPUB writer |
| `habit` | 15 | The streak walk: grace before freeze, multi-day gaps, the freeze cap, burn counts, day rollover |
| `storage` | 13 | Hashing, path derivation, cover MIME sniffing, EPUB metadata extraction |
| `db` | 12 | Schema migration preserving existing rows, the ledger, the shelf, tombstoning |
| `formats` | 10 | The format table and delivery routing |
| `comic` | 7 | CBZ page listing and natural ordering |

```bash
cd apps && npm run typecheck && npm test && npm run build
cd apps/src-tauri && cargo test
cd server && npm test        # needs MongoDB; TEST_MONGO_URI, default localhost
```

**Vitest** runs the frontend's pure logic (`npm test` in `apps`): reading
progress weighted by section size (`readers/progress.ts`), the shared
"finished" rule, the highlights' Markdown export, and series detection and the
smart shelves (`library/series.test.ts`). Test files sit beside the code as `*.test.ts`.

**CI** (`.github/workflows/ci.yml`) runs all of it on every push and pull
request: the Pip price catalogue check, the type-check, the unit tests, the
production build and `cargo test` on Windows, and the server's API tests
against a MongoDB service. `npm run build` type-checks before building, and the
Tauri build runs it, so a type error cannot reach a release.

## The approach

Logic that can be pure, is pure — and that is where the tests are.

**`habit::evaluate`** takes the ledger and today's date as arguments rather than
reading a clock or a database, so streak rules are tested directly with no
fixtures. **`sync::merge`** is the same: two documents in, one out, no I/O.

The merge is tested for *properties*, not just cases:

- **Commutative** — `merge(a, b) == merge(b, a)`
- **Idempotent** — `merge(a, merge(a, b)) == merge(a, b)`
- **Three-device convergence** — any order of pairwise merges agrees

Alongside those, the specific defects that motivated the rewrite each have a
named regression test: a deletion reaching the other device, opening a book not
rewinding progress, machine-local paths staying out of the document, timestamps
compared as instants rather than strings.

The folder transport is tested **end to end** — two in-memory databases against
one scratch directory, exercising publish, receive, read-on, deletion propagation,
ledger sync, repeat syncs not inflating minutes, a corrupt `state.json` being
survivable, and the lock refusing a second writer.

## What is not tested

**Most of the frontend is untested.** Vitest is in place but covers only the
pure helpers above; no components or stores. The frontend is the larger half of
the app, so this is the biggest remaining gap.

Highest-value things to cover next:

- `sync/merge`'s TypeScript counterparts — the store reducers in `libraryStore`
  and `habitStore`
- `smartReadService`'s pure scoring functions (`estimateWordDifficulty`,
  `estimateRsvpPauseMultiplier`, `getAdaptiveWpm`)
- `constants/bookFormats` staying in step with `formats/mod.rs`

**Drive sync has never run against Google.** Everything beneath the transport is
covered and the folder transport is verified end to end, but no test touches the
real API — that needs an OAuth client tied to a Google account.

## Verifying UI

With no component tests, UI changes are checked in a browser against the dev
server (`npm --prefix ./apps run dev`, port 1421).

The routine that has caught the most:

1. **Four viewports**: 390×844 and 360×640 portrait, 844×390 and 667×375
   landscape, plus 1440×900 as a desktop regression check. The landscape sizes
   matter because they are *wider* than the `md` breakpoint.
2. **Programmatic checks rather than eyeballing.** Walking the DOM for elements
   whose right edge exceeds the viewport catches overflow that a screenshot
   hides; measuring every interactive element's box catches touch targets under
   44 px. Both have found real bugs that looked fine in a screenshot.
3. **Both themes**, since per-theme rules drift apart.

One caveat worth knowing when measuring animation: if the browser pane is
hidden, the document timeline is frozen, so a CSS transition sits pinned at its
start value and a transform will look like it is not applying at all. Bypass the
transition (`el.style.transition = "none"`) before measuring geometry.
