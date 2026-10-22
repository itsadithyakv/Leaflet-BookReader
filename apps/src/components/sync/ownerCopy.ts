/**
 * The words of "one library, one owner" (docs/two-devices.md): short labels
 * on the page, and what they mean behind an (i).
 */
export const OWNER_COPY = {
  otherTitle: "Another account's library",
  otherNote: "This device's library belongs to another Leaflet account. Leaflet never mixes two accounts' reading.",
  startFresh: "Start a fresh library for this account",
  startFreshShort: "Start a fresh library",
  startFreshNote: "A new, empty library for you. The other one stays on this device.",
  openMine: "Open my library",
  openMineNote: "Your own library on this device. This one stays as it is.",
  stayOut: "Stay out of reading sync",
  stayOutNote: "Keep using Social. Reading sync and the board stay off for this library.",

  holdsTitle: (books: number) => `Your account already has a library · ${books} ${books === 1 ? "book" : "books"}`,
  holdsNote: "From before this device had a library of its own.",
  useIt: "Use it",
  useItNote: "Bring it into this library.",
  startEmpty: "Start empty",
  startEmptyNote: "Replaces what your account holds. Can't be undone.",
  startEmptyConfirmTitle: "Start empty?",
  startEmptyConfirmBody: "What your account holds is replaced by this empty library. This can't be undone.",

  storeHoldsTitle: (where: "drive" | "folder", books: number) =>
    `${where === "drive" ? "Your Google Drive" : "Your sync folder"} has a library · ${books} ${books === 1 ? "book" : "books"}`,
  storeHoldsNote: "Saved there by Leaflet before accounts. It may be someone else's, if you share the account.",
  keepApart: "Keep it apart",
  keepApartNote: "Leave its reading as it is. Only your book files go there.",

  roomLine: (bytes: number, limit: number) => `Account sync nearly full · ${(bytes / 1048576).toFixed(1)} of ${(limit / 1048576).toFixed(1)} MB`,
  roomNote:
    "Highlights take the most room. Removing ones you no longer need makes room. Everything stays on this device either way.",

  accountRow: "Leaflet account",
  accountSynced: "Reading synced",
  accountNote:
    "Your places, reading days, highlights, notes, collections and Pip are kept with your account. Book files stay on your devices and in your Drive or sync folder.",
  filesOnly: "Files only",
  driveFilesOnlyNote:
    "This Drive's library isn't this account's. Your book files are kept here; your reading is kept with your account.",
  folderFilesOnlyNote:
    "This sync folder's library isn't this account's. Your book files are kept here; your reading is kept with your account.",
  paused: "Paused",
  pausedNote: "This device's library belongs to another Leaflet account, so its reading isn't synced to yours.",
  driveRefused: "This Drive holds another Leaflet account's library.",
  folderRefused: "This sync folder holds another Leaflet account's library.",
  refusedNote: "Disconnect it, or sign in with the account it belongs to.",
  pausedToast: "Reading sync is paused.",
  driveSignedIn: "Your book files in your own Google Drive, on every device."
} as const;
