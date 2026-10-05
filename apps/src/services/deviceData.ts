/**
 * What the webview keeps about the reader's books outside the database: for
 * each book, the place reached, the reader's settings for it and the page
 * reader's bookmarks (`leaflet.reader.<book id>`, `leaflet.bookmarks.<book
 * id>`), and two lists of book and session ids.
 *
 * "Delete All Data" cleared the database and left these, so importing the same
 * file again opened it at the old place with the old bookmarks.
 */
const PER_BOOK_PREFIXES = ["leaflet.reader.", "leaflet.bookmarks."];
/**
 * `leaflet.people.preview` is the browser preview's character sheets (the app
 * keeps them in the database, which the delete clears).
 */
const LISTS = ["leaflet.pip.nodsSeen", "leaflet.shelf.lastSeen", "leaflet.people.preview", "leaflet.words.preview", "leaflet.pip.lastStop", "leaflet.pip.spines", "leaflet.pip.visits", "leaflet.pip.findSeen"];
/**
 * How the reader likes every book laid out, and what the reader has already
 * been shown once: settings. Most are kept under the per-book prefix; the
 * lookup card's "what is sent" note (readers/LookupCard.tsx) is not.
 */
const READER_SETTINGS = [
  "leaflet.reader.layout",
  "leaflet.reader.measure",
  "leaflet.reader.autoScrollSpeed",
  "leaflet.reader.startMode",
  "leaflet.reader.tourSeen",
  "leaflet.reader.characters",
  // Whether words looked up are kept (readers/words/wordPrefs.ts).
  "leaflet.reader.keepWords",
  "leaflet.lookup.noteSeen",
  // The radio: on or off, the scene, the volume (ambience/prefs.ts).
  "leaflet.ambience",
  // Pip on the desktop: the switch, and the day she was hidden for (desktop-pip/setting.ts).
  "leaflet.desktopPip.enabled",
  "leaflet.desktopPip.hiddenOn"
];

/**
 * Removes them. With `settingsToo`, the reader's own layout choices as well,
 * for a delete that promises to remove settings. Returns how many keys went.
 */
export const forgetBooksOnThisDevice = (settingsToo = true): number => {
  try {
    const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).filter(
      (key): key is string =>
        typeof key === "string" &&
        (LISTS.includes(key) ||
          READER_SETTINGS.includes(key) ||
          PER_BOOK_PREFIXES.some((prefix) => key.startsWith(prefix))) &&
        (settingsToo || !READER_SETTINGS.includes(key))
    );
    keys.forEach((key) => localStorage.removeItem(key));
    return keys.length;
  } catch {
    // Storage that cannot be read holds nothing to remove.
    return 0;
  }
};
