import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MOBILE_NAV_ITEMS, MobileNav } from "./MobileNav";

const nothing = () => undefined;

describe("the tab bar on an upright phone", () => {
  it("has the four places, and neither Settings (behind the profile button) nor a Read key", () => {
    expect(MOBILE_NAV_ITEMS.map((item) => item.label)).toEqual(["Library", "Collections", "Social", "Pip"]);
    const markup = renderToStaticMarkup(<MobileNav activeItem="Library" onNavigate={nothing} />);
    expect(markup).not.toContain("Settings");
    expect(markup).not.toContain("Resume reading");
    expect(markup).not.toContain(">Read<");
    expect(markup.match(/class="mobile-nav-item"/g)).toHaveLength(4);
  });

  it("marks the page on screen, and none when it is Settings", () => {
    const social = renderToStaticMarkup(<MobileNav activeItem="Social" onNavigate={nothing} />);
    expect(social.match(/aria-current="page"/g)).toHaveLength(1);
    expect(social).toMatch(/aria-current="page"[^>]*>.*?Social/);
    const settings = renderToStaticMarkup(<MobileNav activeItem="Settings" onNavigate={nothing} />);
    expect(settings).not.toContain('aria-current="page"');
  });

  it("is the tour's nav where the rail is not shown", () => {
    // Rendered without a window, the rail's query does not hold.
    const markup = renderToStaticMarkup(<MobileNav activeItem="Library" onNavigate={nothing} />);
    expect(markup).toContain('data-tour="nav"');
  });

  it("dots a place with something new", () => {
    const markup = renderToStaticMarkup(<MobileNav activeItem="Library" onNavigate={nothing} badge={{ Social: 3 }} />);
    expect(markup).toContain('aria-label="3 new"');
  });
});
