# Leaflet — reference

Working documentation for the app: what each part does, how it is built, and
why it is built that way. Written for someone picking the codebase up cold.

| Document | Covers |
| --- | --- |
| [product.md](product.md) | What ships, on what terms: free desktop, paid mobile later, what is switched off |
| [architecture.md](architecture.md) | The two halves, how they talk, where state lives |
| [tech-stack.md](tech-stack.md) | Every dependency and what it is there for |
| [features.md](features.md) | Each feature, end to end |
| [pip.md](pip.md) | Pip, the reading companion: engine, world, moments, tour |
| [data-model.md](data-model.md) | SQLite schema, migrations, the sync document |
| [building.md](building.md) | Desktop and Android builds, the traps |
| [mobile.md](mobile.md) | The plan for the phone app: two devices as one, reading upright and sideways, Dotty by touch, signing in |
| [release-msix.md](release-msix.md) | Packaging for the Microsoft Store and submitting |
| [deploy.md](deploy.md) | The 1.0 run sheet: GitHub Pages, Atlas, the VM, the API, the Store build |
| [release-notes-1.0.md](release-notes-1.0.md) | What 1.0 does, and its known issues |
| [store-listing.md](store-listing.md) | Paste-ready Store description, features and search terms |
| [testing.md](testing.md) | What is tested, what is not, and how to verify UI |
| [legal/](legal/) | Privacy policy and terms of use (drafts to review) |

## What Leaflet is

An ebook reader that keeps a local library, reads a wide range of formats, and
turns reading into a daily habit, with Pip, a pixel-art companion who lives in
the app and celebrates it with you. The Windows app is free on the Microsoft
Store with nothing locked; a paid mobile app comes later (see
[product.md](product.md)).

Three commitments shape most of the design decisions in here:

1. **Offline first.** Everything works with no network. Fonts and assets are
   self-hosted; nothing is fetched from a CDN at runtime.
2. **Your books stay yours.** Book files and reading history live on the
   reader's device, and the backup goes to their own Google Drive. Leaflet's
   server exists only for the optional account and leaderboards, and it never
   receives book files or Google credentials.
3. **One codebase, two platforms.** Desktop and mobile run identical Rust and
   identical React; the differences are a handful of `#[cfg(desktop)]` blocks and
   responsive CSS, not a fork.
