/**
 * Mirror of the canonical format table in `apps/src-tauri/src/formats/mod.rs`.
 *
 * The backend is the authority: it rejects anything absent from its own table at
 * import and at open. This copy exists so the UI can render labels and filters
 * without an await. The desktop file picker refreshes it from the backend (see
 * `loadSupportedFormats`) so the dialog cannot offer files import would drop.
 */

export type BookDelivery = "epub" | "pdf" | "comic" | "builtin" | "convert";

export type BookFormat = {
  extension: string;
  label: string;
  /** How the file reaches a reader: rendered directly, or converted to EPUB first. */
  delivery: BookDelivery;
  /** One representative per family, so copy says "HTML" not "HTML, HTM, HTMLZ". */
  headline: boolean;
};

const asFormat = (
  extension: string,
  label: string,
  delivery: BookDelivery = "convert",
  headline = false
): BookFormat => ({
  extension,
  label,
  delivery,
  headline
});

export const DEFAULT_BOOK_FORMATS: BookFormat[] = [
  asFormat("epub", "EPUB", "epub", true),
  asFormat("pdf", "PDF", "pdf", true),
  asFormat("cbz", "CBZ", "comic", true),
  asFormat("txt", "TXT", "builtin", true),
  asFormat("txtz", "TXTZ", "builtin"),
  asFormat("html", "HTML", "builtin", true),
  asFormat("htm", "HTM", "builtin"),
  asFormat("htmlz", "HTMLZ", "builtin"),
  asFormat("xhtml", "XHTML", "builtin"),
  asFormat("fb2", "FB2", "builtin", true),
  asFormat("fbz", "FBZ", "builtin"),
  asFormat("mobi", "MOBI"),
  asFormat("azw3", "AZW3"),
  asFormat("azw", "AZW"),
  asFormat("azw4", "AZW4"),
  asFormat("prc", "PRC"),
  asFormat("pdb", "PDB"),
  asFormat("lit", "LIT"),
  asFormat("lrf", "LRF"),
  asFormat("rb", "RB"),
  asFormat("snb", "SNB"),
  asFormat("tcr", "TCR"),
  asFormat("pml", "PML"),
  asFormat("pmlz", "PMLZ"),
  asFormat("rtf", "RTF"),
  asFormat("docx", "DOCX"),
  asFormat("odt", "ODT"),
  asFormat("chm", "CHM"),
  asFormat("cbr", "CBR"),
  asFormat("cbc", "CBC")
];

let activeFormats: BookFormat[] = DEFAULT_BOOK_FORMATS;

/** Replaces the mirror with the backend's table. Ignores an empty response. */
export const setSupportedFormats = (formats: BookFormat[]) => {
  if (formats.length > 0) {
    activeFormats = formats;
  }
};

export const getBookFormats = () => activeFormats;

export const IMPORTABLE_EXTENSIONS = DEFAULT_BOOK_FORMATS.map((format) => format.extension);

/** Formats rendered as a sequence of page images rather than reflowable text. */
export const isPageImageFormat = (extension: string) => {
  const delivery = findBookFormat(extension)?.delivery;
  return delivery === "pdf" || delivery === "comic";
};

export const getBookExtension = (path: string) => path.split(".").pop()?.toLowerCase() ?? "";

export const findBookFormat = (extension: string) =>
  activeFormats.find((format) => format.extension === extension.toLowerCase());

export const isImportableExtension = (extension: string) => Boolean(findBookFormat(extension));

export const isReadableExtension = (extension: string) =>
  isImportableExtension(extension) && !isPageImageFormat(extension);

/** True when the file needs Calibre. Builtin conversions do not count. */
export const needsConversion = (extension: string) =>
  findBookFormat(extension)?.delivery === "convert";

/** Formats that open with no external dependency, for honest UI copy. */
export const dependencyFreeFormats = () =>
  getBookFormats().filter((format) => format.delivery !== "convert");

/** One label per family, so the copy stays readable. */
export const dependencyFreeSummary = () =>
  dependencyFreeFormats()
    .filter((format) => format.headline)
    .map((format) => format.label)
    .join(", ");

export const externalConverterCount = () =>
  getBookFormats().filter((format) => format.delivery === "convert").length;

/**
 * Short phrase for UI copy. Spelling out all ~29 formats would swamp the
 * import card and the empty-library message.
 */
export const formatSummary = (limit = 4) => {
  const formats = activeFormats;
  const primary = formats.slice(0, limit).map((format) => format.label);
  const rest = formats.length - primary.length;
  return rest > 0 ? `${primary.join(", ")} and ${rest} more` : primary.join(", ");
};
