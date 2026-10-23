// Injected into the page before the app (Page.addScriptToEvaluateOnNewDocument), after
// `window.__PERF = {...}`: a stand-in for Tauri's IPC, so the production build runs its app paths
// against a made-up library of `books` books. No real library, account or file is touched.
(() => {
  const P = window.__PERF || {};
  const N = P.books ?? 300;
  const origin = location.origin;
  // The windowed desktop look is decided by the material; "none" is a plain opaque window.
  window.__LEAFLET_WINDOW_MATERIAL__ = P.material || "none";
  // First-run screens and tours, seen: the check measures the app in use, not its welcome.
  const seen = {
    "leaflet.welcomed": "1",
    "leaflet.reader.tourSeen": "1",
    "leaflet.reader.contentsSeen": "1",
    "leaflet.lookup.noteSeen": "1",
    "leaflet.pip.tourSeen": "1"
  };
  try {
    if (!sessionStorage.getItem("perf.init")) {
      sessionStorage.setItem("perf.init", "1");
      for (const [k, v] of Object.entries(seen)) localStorage.setItem(k, v);
    }
  } catch {}
  const now = Date.now();
  const day = 86400000;
  const iso = (t) => new Date(t).toISOString();
  const words = ["Long", "Road", "Quiet", "Garden", "Harbour", "Lights", "Ember", "Stone", "River", "North", "Glass", "Winter", "Crown", "Ash"];
  const books = Array.from({ length: N }, (_, i) => ({
    id: "b" + i,
    title: `${words[i % 14]} ${words[(i * 5 + 3) % 14]}${i % 3 ? " of the " + words[(i * 7) % 14] : ""} ${i}`,
    author: "Author " + (i % 23),
    genres: [["Fantasy"], ["Science Fiction"], ["History"], ["Mystery"]][i % 4],
    coverUrl: `C:/perf/covers/b${i}.png`,
    localPath: `C:/perf/books/b${i}.epub`,
    fileHash: "h" + i,
    progress: i === 0 ? 0.02 : (i % 7) / 7,
    position: null,
    lastOpened: i % 4 ? iso(now - i * day) : null,
    progressUpdatedAt: i % 4 ? iso(now - i * day) : null,
    finishedAt: null,
    createdAt: iso(now - (400 - i) * day),
    metadataCheckedAt: iso(now),
    available: true
  }));
  const callbacks = new Map();
  let next = 1;
  const calls = (window.__perfCalls = {});
  const answer = async (cmd) => {
    calls[cmd] = (calls[cmd] || 0) + 1;
    switch (cmd) {
      case "list_books":
        return books;
      case "finished_removed":
      case "take_pending_open_paths":
        return [];
      case "supported_formats":
        return ["epub", "pdf", "mobi", "azw3", "cbz", "txt"];
      case "read_book_bytes":
        return (await fetch(origin + "/perf-book.epub")).arrayBuffer();
      case "book_file_size":
        return 400000;
      case "needs_converter":
        return false;
      case "cover_data":
        return null;
      case "sync_status":
        return {
          driveConnected: false, driveAvailable: false, driveCredentialSource: "none", expiresAt: null, accountEmail: null,
          folderPath: null, apiBase: null, apiBaseCustom: false, lastSyncedAt: null, booksPending: 0, accountBackup: false,
          library: { standing: "unowned", stayOut: false, elsewhere: false, refused: null }, driveFilesOnly: false, folderFilesOnly: false
        };
      case "account_status":
        return { available: false, apiBase: null, signedIn: false, account: null, offline: false };
      case "habit_snapshot":
        return {
          streak: 6, longestStreak: 12, freezes: 1, graceAvailable: true, goalMinutes: 20, todayMinutes: 7, todayMet: false,
          days: [], sessions: [], freeReads: [], shelfCount: 3, peakShelf: 3, brokeFrom: null, cold: null,
          seedsEarned: 0, gardenWater: 0, gardenRipe: 0
        };
      case "reminders_get":
        return { settings: { daily: false, dailyAt: 1140, streakRisk: false, closeNudge: false, asked: true }, supported: true, whileClosed: true, blocked: false };
      case "annotations_highlight_counts":
        return [];
      case "scan_series":
        return 0;
      case "plugin:event|listen":
        return next++;
      case "plugin:event|unlisten":
      case "plugin:event|emit":
        return null;
      case "plugin:window|theme":
        return "light";
      case "plugin:window|is_maximized":
        return true;
      case "plugin:window|scale_factor":
        return 1;
      case "plugin:app|version":
        return "0.0.0-perf";
      case "reminders_context":
      case "window_material_theme":
      case "window_material_effects":
      case "log_client_error":
      case "update_progress":
        return null;
      default:
        if (/_list$/.test(cmd) || ["annotations_removed", "large_books", "people_save"].includes(cmd)) return [];
        // Anything else is refused, as an app without that service would be.
        throw "perf: no " + cmd;
    }
  };
  window.isTauri = true;
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
    plugins: {},
    transformCallback(fn) {
      const id = next++;
      callbacks.set(id, fn);
      window["_" + id] = fn;
      return id;
    },
    unregisterCallback(id) {
      callbacks.delete(id);
      delete window["_" + id];
    },
    convertFileSrc(path, protocol = "asset") {
      return protocol === "cover" ? `${origin}/perf-cover/${encodeURIComponent(path)}` : `${origin}/perf-asset/${encodeURIComponent(path)}`;
    },
    invoke(cmd, args) {
      return answer(cmd, args);
    }
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
})();
