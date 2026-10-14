import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ReaderSearch } from "./ReaderSearch";

// (Drawn on the server, a store is read as it started: no profile, so no handle to copy. What a shared profile
// adds, the handle and its Copy button, is seen in the app.)
describe("adding friends", () => {
  it("is called that, with a field to find a reader by their handle", () => {
    const markup = renderToStaticMarkup(<ReaderSearch showToast={() => undefined} />);
    expect(markup).toContain("Add friends");
    expect(markup).toContain("Follow readers");
    expect(markup).toContain('aria-label="Find a reader by their handle"');
    // No handle of one's own to send before there is a shared profile.
    expect(markup).not.toContain("Copy");
  });
});
