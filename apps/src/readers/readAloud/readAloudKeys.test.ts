import { describe, expect, it } from "vitest";
import { actionFor, shortcutSections } from "../readerKeys";

describe("read aloud's key", () => {
  it("is R, in both layouts and every mode, and is on the shortcuts sheet", () => {
    for (const layout of ["scroll", "pages"] as const) {
      expect(actionFor({ key: "r" }, { layout, mode: "standard" })).toBe("readAloud");
      expect(actionFor({ key: "R", shiftKey: true }, { layout, mode: "smart" })).toBe("readAloud");
      // Ctrl+R stays the browser's.
      expect(actionFor({ key: "r", ctrlKey: true }, { layout, mode: "standard" })).toBeNull();
      const reading = shortcutSections({ layout, mode: "standard" }).find((section) => section.title === "Reading");
      expect(reading?.rows).toContainEqual({ keys: ["R"], label: "Read aloud from here, or pause it" });
    }
  });
});
