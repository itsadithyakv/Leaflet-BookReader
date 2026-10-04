/**
 * Section sizes read from the book epub.js already has open, for when the
 * backend's own (a quick read of the archive's directory) are not to be had:
 * in the browser preview, or when that call fails. The sizes come from the
 * archive's directory as epub.js's unzipper holds it; nothing is read again
 * or decompressed.
 */

export type ArchiveSection = { href: string; bytes: number; linear: boolean };

// epub.js and its unzipper have no types for these internals.
/* eslint-disable @typescript-eslint/no-explicit-any */
export const sectionsFromArchive = (book: any): ArchiveSection[] => {
  const zip = book?.archive?.zip;
  const sections: any[] = book?.spine?.spineItems ?? [];
  if (!zip || typeof zip.file !== "function") {
    return [];
  }
  const sizeOf = (path: string) => {
    const entry = zip.file(path);
    const size = Number(entry?._data?.uncompressedSize);
    return Number.isFinite(size) && size > 0 ? size : 0;
  };
  const found: ArchiveSection[] = [];
  for (const section of sections) {
    const href = String(section?.href ?? "");
    const path = String(section?.url ?? "").replace(/^\//, "");
    if (!href || !path) {
      continue;
    }
    let bytes = sizeOf(path);
    if (bytes === 0) {
      try {
        bytes = sizeOf(decodeURIComponent(path));
      } catch {
        // A stray "%" in a file name: there is only the raw form.
      }
    }
    if (bytes > 0) {
      found.push({ href, bytes, linear: section?.linear !== false });
    }
  }
  return found;
};
