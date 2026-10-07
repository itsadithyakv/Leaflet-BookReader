import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { KindleImport } from "./KindleImport";

describe("Import from Kindle, as it first stands", () => {
  const markup = renderToStaticMarkup(<KindleImport />);

  it("is one button and a file input kept out of sight", () => {
    expect(markup.match(/<button/g)).toHaveLength(1);
    expect(markup).toContain("Import from Kindle…");
    expect(markup).toMatch(/<input[^>]*type="file"[^>]*accept="\.txt"[^>]*class="hidden"/);
  });

  it("says what it does when pointed at, not in a sentence left standing", () => {
    expect(markup).toMatch(/<button[^>]*title="[^"]*My Clippings\.txt[^"]*Nothing leaves this device\."/);
    // The line that news is put into is there, and empty.
    expect(markup).toMatch(/<p role="status" aria-live="polite"[^>]*><\/p>/);
  });
});
