/**
 * "Tidy a folder": where each book file in the folder should go.
 *
 * `Author/Series/NN - Title.ext` for a book in a series, `Author/Title.ext`
 * for one that is not, `Unknown author/Title.ext` when nobody is named.
 *
 * Plain data in, plain data out: what each file is called is settled before
 * this (the library's word for a book it has, the file's own for the rest),
 * and nothing here touches the disk. The plan is only what the reader is
 * shown; Rust checks every move again before it makes one
 * (`storage/tidy.rs`), and never puts a file over another.
 *
 * The naming keeps to the rules "Book copies" uses (`storage/library_copy.rs`:
 * `clean`, `is_reserved_name`, `truncate`), so a name made here is one Windows
 * keeps as written.
 */

export type TidySeries = { name: string; index: number | null };

export type TidyFile = {
  /** From the folder, with `/` between the parts. */
  path: string;
  /** The file's SHA-256: two files with the same one are the same book. */
  hash: string;
  /** Lower case, without the dot. */
  extension: string;
  title: string;
  author: string | null;
  series: TidySeries | null;
};

export type TidyMove = { from: string; to: string };

/** A second file of a book already in the folder. It stays where it is. */
export type TidyDuplicate = { path: string; sameAs: string };

export type TidyPlan = {
  moves: TidyMove[];
  /** Files already where they belong. */
  inPlace: number;
  duplicates: TidyDuplicate[];
};

/** The longest whole path Explorer and most Windows apps will open. */
const MAX_PATH_CHARS = 259;
/** Longest file name, without the extension. */
const MAX_STEM_CHARS = 120;
/** However deep the folder is, the name keeps this much of the title. */
const MIN_STEM_CHARS = 24;
/** Longest name of an author's or a series' folder, and the least a deep folder leaves of it. */
const MAX_DIR_CHARS = 60;
const MIN_DIR_CHARS = 16;
/** Other systems count bytes (255), and a title in Chinese is three a character. */
const MAX_NAME_BYTES = 200;
/** `Title (2).epub`, `Title (3).epub`... for different books that want one name. */
const MAX_NAME_ATTEMPTS = 200;
/** Room kept for " (200)". */
const CLASH_CHARS = 6;

export const UNKNOWN_AUTHOR = "Unknown author";

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/** One part of a name with everything a filesystem would refuse taken out. */
export const cleanName = (part: string): string => {
  let out = "";
  for (const character of part) {
    if (character === ":") {
      // "Dune: Messiah" reads best as "Dune - Messiah".
      out += " - ";
    } else if (character === "/" || character === "\\" || character === "|") {
      out += "-";
    } else if (character === '"') {
      out += "'";
    } else if (CONTROL.test(character)) {
      out += " ";
    } else if (!"<>?*".includes(character)) {
      out += character;
    }
  }
  // Windows drops trailing dots and spaces without saying so, and a leading
  // dot hides the file on other systems.
  return out.split(/\s+/).filter(Boolean).join(" ").replace(/^[. ]+|[. ]+$/g, "");
};

const utf8Bytes = (character: string) => {
  const code = character.codePointAt(0) ?? 0;
  return code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
};

/**
 * Counted the way Windows counts a name (an emoji is two, which is also what
 * `length` says), and always cut between characters, never inside one.
 */
const truncate = (value: string, maxChars: number, maxBytes: number): string => {
  let out = "";
  let bytes = 0;
  for (const character of value) {
    if (out.length + character.length > maxChars || bytes + utf8Bytes(character) > maxBytes) {
      break;
    }
    out += character;
    bytes += utf8Bytes(character);
  }
  return out.replace(/[. -]+$/, "");
};

/** Names Windows keeps for devices. Only the part before the first dot counts. */
const isReserved = (name: string) => /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(name.split(".")[0].trim().toUpperCase());

/** `CON_`, `Aux_. Notes`: the part Windows reads as the device is the part changed. */
const unreserve = (name: string) => {
  if (!isReserved(name)) {
    return name;
  }
  const dot = name.indexOf(".");
  return dot < 0 ? `${name}_` : `${name.slice(0, dot).trimEnd()}_.${name.slice(dot + 1)}`;
};

const nameOf = (raw: string, fallback: string, maxChars: number) =>
  unreserve(truncate(cleanName(raw), maxChars, MAX_NAME_BYTES) || fallback);

/** "01", "12", "03.5": two digits, so a folder sorts in reading order. */
export const seriesNumber = (index: number | null): string | null => {
  if (index === null || !Number.isFinite(index) || index < 0 || index >= 1000) {
    return null;
  }
  const [whole, part] = String(Number(index.toFixed(2))).split(".");
  return `${whole.padStart(2, "0")}${part ? `.${part}` : ""}`;
};

/** How Windows compares names: `Dune.epub` and `dune.EPUB` are one file. */
const key = (path: string) => path.toLowerCase();

const slashed = (path: string) => path.replace(/\\/g, "/");

/**
 * A folder's name as it is already spelt, here or on the disk. Two spellings
 * of one folder ("The Expanse", "the expanse") are one folder to Windows; the
 * first one met is the one used, so a file is not "moved" to where it is.
 */
const spelled = (known: Map<string, string>, folder: string) => {
  const seen = known.get(key(folder));
  if (seen !== undefined) {
    return seen;
  }
  known.set(key(folder), folder);
  return folder;
};

/** The folder and the name (without number or extension) a file should have. */
const placeOf = (file: TidyFile, folderLength: number, known: Map<string, string>) => {
  let author = nameOf(file.author ?? "", UNKNOWN_AUTHOR, MAX_DIR_CHARS);
  let series = file.series ? nameOf(file.series.name, "", MAX_DIR_CHARS) : "";

  // The chosen folder, a separator, the author's folder, the series', the
  // name, " (200)" for a clash, a dot, the extension.
  const taken = (folders: number) => folderLength + 1 + folders + 1 + CLASH_CHARS + 1 + file.extension.length;
  const folders = () => author.length + (series ? series.length + 1 : 0);
  const short = () => MIN_STEM_CHARS - (MAX_PATH_CHARS - taken(folders()));
  // In a deep folder the folders' names give way before the title does.
  if (file.series && series && short() > 0) {
    series = nameOf(file.series.name, "", Math.max(MIN_DIR_CHARS, series.length - short()));
  }
  if (short() > 0) {
    author = nameOf(file.author ?? "", UNKNOWN_AUTHOR, Math.max(MIN_DIR_CHARS, author.length - short()));
  }

  let folder = spelled(known, author);
  if (series) {
    folder = spelled(known, `${folder}/${series}`);
  }

  const number = series && file.series ? seriesNumber(file.series.index) : null;
  const prefix = number ? `${number} - ` : "";
  const room = Math.min(MAX_STEM_CHARS, Math.max(MIN_STEM_CHARS, MAX_PATH_CHARS - taken(folder.length)));
  const title = truncate(cleanName(file.title), room - prefix.length, MAX_NAME_BYTES - prefix.length) || "Untitled";
  return { folder, stem: unreserve(`${prefix}${title}`) };
};

/**
 * Where every file should go.
 *
 * `folderLength` is how long the chosen folder's own path is, so a whole path
 * stays one Windows apps can open. `occupied` is anything else known to be in
 * the folder (a book file the scan could not read): its name is not free.
 *
 * A file already where it belongs is not in `moves`. A second file with the
 * same contents stays where it is and is listed in `duplicates`. Two
 * different books that want one name get ` (2)`, ` (3)`.
 */
export const planTidy = (files: TidyFile[], folderLength: number, occupied: string[] = []): TidyPlan => {
  const order = files
    .map((file) => ({ ...file, path: slashed(file.path) }))
    .sort((a, b) => (key(a.path) < key(b.path) ? -1 : key(a.path) > key(b.path) ? 1 : a.path < b.path ? -1 : 1));

  // Every name in use now stays in use: a file is never planned into the
  // place of another, even one that is itself about to move.
  const taken = new Set<string>();
  const known = new Map<string, string>();
  for (const path of [...order.map((file) => file.path), ...occupied.map(slashed)]) {
    taken.add(key(path));
    const parts = path.split("/");
    for (let depth = 1; depth < parts.length; depth += 1) {
      spelled(known, parts.slice(0, depth).join("/"));
    }
  }

  const wanted = order.map((file) => {
    const place = placeOf(file, folderLength, known);
    const there = key(file.path) === key(`${place.folder}/${place.stem}.${file.extension}`);
    return { file, ...place, there };
  });

  // Of several files with the same contents, the one tidied is the one
  // already in place, or else the first.
  const chosen = new Map<string, (typeof wanted)[number]>();
  for (const item of wanted) {
    const same = item.file.hash || item.file.path;
    const current = chosen.get(same);
    if (!current || (!current.there && item.there)) {
      chosen.set(same, item);
    }
  }

  const plan: TidyPlan = { moves: [], inPlace: 0, duplicates: [] };
  for (const item of wanted) {
    const { file } = item;
    const one = chosen.get(file.hash || file.path);
    if (one && one !== item) {
      plan.duplicates.push({ path: file.path, sameAs: one.file.path });
      continue;
    }
    let to: string | null = null;
    for (let attempt = 1; attempt <= MAX_NAME_ATTEMPTS && to === null; attempt += 1) {
      const name = attempt === 1 ? item.stem : `${item.stem} (${attempt})`;
      const candidate = `${item.folder}/${name}.${file.extension}`;
      // Its own name is its to keep: "Dune (2).epub" stays while "Dune.epub" is another book.
      if (key(candidate) === key(file.path) || !taken.has(key(candidate))) {
        to = candidate;
        taken.add(key(candidate));
      }
    }
    // No free name in two hundred: left where it is.
    if (to === null || to === file.path) {
      plan.inPlace += 1;
    } else {
      plan.moves.push({ from: file.path, to });
    }
  }
  return plan;
};
