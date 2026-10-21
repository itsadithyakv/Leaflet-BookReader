import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ReaderPhoneBack } from "./ReaderToolbar";
import type { ReaderScope } from "./scope";

const reader = (shape: string, chromeVisible = true) =>
  ({ shape, chromeVisible, exitGuard: { back: () => undefined } }) as unknown as ReaderScope;

describe("a phone's way back to the library", () => {
  it("is a button called Back to library, with the arrow", () => {
    const markup = renderToStaticMarkup(<ReaderPhoneBack reader={reader("upright")} />);
    expect(markup).toContain('aria-label="Back to library"');
    expect(markup).toContain("arrow_back");
    expect(markup).not.toContain("where you were");
  });

  it("is a phone's only, either way up: a tablet and the desktop have the bar's", () => {
    expect(renderToStaticMarkup(<ReaderPhoneBack reader={reader("sideways")} />)).toContain("Back to library");
    expect(renderToStaticMarkup(<ReaderPhoneBack reader={reader("tablet")} />)).toBe("");
    expect(renderToStaticMarkup(<ReaderPhoneBack reader={reader("desktop")} />)).toBe("");
  });

  it("is out of the way of a screen reader and the tab key while the chrome is away", () => {
    const markup = renderToStaticMarkup(<ReaderPhoneBack reader={reader("upright", false)} />);
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('tabindex="-1"');
  });
});
