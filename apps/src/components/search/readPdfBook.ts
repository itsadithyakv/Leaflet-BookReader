import { readPdfText } from "../../readers/pdfTextCache";

/**
 * The text of a PDF in the library, a string a page, read here because the
 * search found none kept for it (readers/pdfTextCache.ts). Null when the
 * reading was called off; throws for a PDF that cannot be opened (locked,
 * damaged, its file gone).
 *
 * pdf.js is brought in only now, the first time there is a PDF to read: the
 * dialog opens without it. The document is let go of when the reading ends,
 * however it ends.
 */
export const readPdfBook = async (
  bookId: string,
  stillWanted: () => boolean,
  onPage?: (done: number, total: number) => void
): Promise<string[] | null> => {
  const { createPdfPageSource } = await import("../../readers/pageSources");
  if (!stillWanted()) {
    return null;
  }
  const source = await createPdfPageSource(bookId);
  try {
    const pdf = source.pdf;
    if (!pdf) {
      throw new Error("That book is not a PDF.");
    }
    return await readPdfText({ pageCount: source.pageCount, textOf: (page) => pdf.plainText(page), stillWanted, onPage });
  } finally {
    source.destroy();
  }
};
