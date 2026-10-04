import { describe, expect, it } from "vitest";
import { converterOffer } from "./converterService";

/**
 * The bug this guards: the "this book needs Calibre" prompt offered "Download
 * & install" on every desktop build, the Microsoft Store one included, where
 * Leaflet may not download and run an installer and the button could only fail.
 */
describe("what a reader without Calibre is offered", () => {
  it("offers the in-app install only where the backend says it may", () => {
    expect(converterOffer(true, { canAutoInstall: true })).toBe("install");
  });

  it("never offers the in-app install in the Store build", () => {
    expect(converterOffer(true, { canAutoInstall: false })).toBe("get");
  });

  it("falls back to the link when the status could not be read", () => {
    expect(converterOffer(true, null)).toBe("get");
  });

  it("offers nothing on a device Calibre has no version for", () => {
    expect(converterOffer(false, { canAutoInstall: true })).toBe("none");
    expect(converterOffer(false, null)).toBe("none");
  });
});
