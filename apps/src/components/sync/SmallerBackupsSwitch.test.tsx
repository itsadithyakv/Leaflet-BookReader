import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SmallerBackupsSwitch, smallerBackupsHint } from "./SmallerBackupsSwitch";

const toggle = (on: boolean) => <span data-on={on ? "yes" : "no"} />;

describe("the Smaller backups switch", () => {
  it("is on until this device turns it off, with its words behind the (i)", () => {
    const markup = renderToStaticMarkup(<SmallerBackupsSwitch renderToggle={toggle} />);
    expect(markup).toContain('role="switch"');
    expect(markup).toContain('aria-checked="true"');
    expect(markup).toContain('data-on="yes"');
    expect(markup).toContain(">Smaller backups<");
    // No standing explanation on the card: the hint is the (i)'s alone.
    expect(markup).not.toContain(">Pictures in the copy");
    expect(markup).toContain('aria-label="Pictures in the copy sent to Drive are made smaller. The book on this device is never changed."');
  });

  it("says what it has saved once that is a megabyte or more", () => {
    expect(smallerBackupsHint(0)).toBe("Pictures in the copy sent to Drive are made smaller. The book on this device is never changed.");
    expect(smallerBackupsHint(512 * 1024)).not.toContain("Saved");
    expect(smallerBackupsHint(42 * 1024 * 1024)).toMatch(/Saved so far: 42 MB\.$/);
  });
});
