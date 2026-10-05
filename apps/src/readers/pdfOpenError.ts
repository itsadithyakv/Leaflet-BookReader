/**
 * What to tell the reader when a PDF will not open.
 *
 * pdf.js says why in its own words ("No password given", "Invalid PDF
 * structure."), which are a programmer's. The reason is told by the name of
 * the error it rejects with; anything not known keeps its own message, which
 * is better than none. Pure, so it can be tested without a PDF.
 */

export const PDF_LOCKED = "This PDF is protected by a password, and Leaflet cannot open those yet.";
export const PDF_DAMAGED = "This PDF is damaged or incomplete, and could not be opened.";
export const PDF_EMPTY = "This PDF has no pages.";

/** The message for a PDF that failed to open, or null when the error says nothing this knows. */
export const pdfOpenMessage = (error: unknown): string | null => {
  const name = typeof error === "object" && error !== null ? (error as { name?: unknown }).name : null;
  if (name === "PasswordException") {
    return PDF_LOCKED;
  }
  if (name === "InvalidPDFException" || name === "MissingPDFException" || name === "UnexpectedResponseException") {
    return PDF_DAMAGED;
  }
  return null;
};
