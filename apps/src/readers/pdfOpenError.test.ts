import { describe, expect, it } from "vitest";
import { PDF_DAMAGED, PDF_LOCKED, pdfOpenMessage } from "./pdfOpenError";

/** An error as pdf.js rejects with: told apart by its name. */
const named = (name: string, message: string) => Object.assign(new Error(message), { name });

describe("why a PDF would not open", () => {
  it("says a password is needed, not pdf.js's 'No password given'", () => {
    expect(pdfOpenMessage(named("PasswordException", "No password given"))).toBe(PDF_LOCKED);
    expect(pdfOpenMessage(named("PasswordException", "Incorrect Password"))).toBe(PDF_LOCKED);
  });

  it("says a truncated or broken file is damaged, not 'Invalid PDF structure.'", () => {
    expect(pdfOpenMessage(named("InvalidPDFException", "Invalid PDF structure."))).toBe(PDF_DAMAGED);
    expect(pdfOpenMessage(named("MissingPDFException", "Missing PDF"))).toBe(PDF_DAMAGED);
  });

  it("leaves anything else to say what it says", () => {
    expect(pdfOpenMessage(new Error("The PDF file is empty or unavailable."))).toBeNull();
    expect(pdfOpenMessage("a string")).toBeNull();
    expect(pdfOpenMessage(null)).toBeNull();
  });
});
