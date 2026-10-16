import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PIP_FULL_SCREEN_QUERY, PIP_MENU_PLACES, PipMenu } from "./PipMenu";

const nothing = () => undefined;

describe("Pip's menu, where her tab fills a phone on its side", () => {
  it("is not there where the app's rail and header are", () => {
    // Rendered without a window the whole-screen query does not hold.
    expect(renderToStaticMarkup(<PipMenu className="pip-base-chip" onNavigate={nothing} onOpenProfile={nothing} />)).toBe("");
  });

  it("is a key in Pip's own style, closed until tapped", () => {
    const markup = renderToStaticMarkup(<PipMenu always className="pip-base-chip" onNavigate={nothing} onOpenProfile={nothing} />);
    expect(markup).toContain("pip-menu-key pip-base-chip");
    expect(markup).toContain('aria-label="Menu"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).not.toContain("pip-menu-item");
  });

  it("goes to the three other places (Settings is behind the profile, as elsewhere on a phone)", () => {
    expect(PIP_MENU_PLACES.map((place) => place.id)).toEqual(["library", "collections", "social"]);
  });

  it("uses the query the CSS hides the header and rail by", async () => {
    // Read from disk (a CSS import is emptied under the test runner); named so the app's types need no Node.
    const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as { readFileSync: (path: URL, encoding: "utf8") => string };
    const css = fs.readFileSync(new URL("../../components/pip/touch.css", import.meta.url), "utf8");
    const block = css.slice(css.indexOf(`@media ${PIP_FULL_SCREEN_QUERY} {`));
    expect(block.length).toBeLessThan(css.length);
    const rules = block.slice(0, block.indexOf("\n}\n"));
    expect(rules).toContain(".app-shell:has(.pip-house-page) .app-header");
    expect(rules).toContain(".app-shell:has(.pip-house-page) .sidebar-stage");
  });
});
