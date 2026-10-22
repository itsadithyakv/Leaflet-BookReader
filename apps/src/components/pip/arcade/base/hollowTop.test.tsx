import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { cellsFull, fillOf, hoursSaid, hoursText, partOf, percentOf } from "./chapterWords";
import { HollowTop } from "./HollowTop";
import { HollowDock } from "./HollowDock";
import { pagesOf } from "./HollowGuide";
import { newBase } from "../../../../pip/base/rules";

const nothing = () => undefined;
const top = (parcels: number) =>
  renderToStaticMarkup(
    <HollowTop
      chapter={{ n: 4, read: 380, to: 600, part: 0.4, next: "Fence", goal: true }}
      onChapter={nothing}
      chapterOpen={false}
      acorns={312}
      acornCue={{ current: null }}
      acornChipRef={nothing}
      trailsRef={nothing}
      gained={null}
      onAcorns={nothing}
      parcels={parcels}
      onParcels={nothing}
      guideOpen={false}
      onGuide={nothing}
      sound
      onSound={nothing}
      onPostcard={null}
      onArcade={nothing}
      onHouse={nothing}
    />
  );

describe("hours read, said the Hollow's way", () => {
  it("is hours and minutes, never a decimal", () => {
    expect(hoursText(380)).toBe("6 h 20 m");
    expect(hoursText(45)).toBe("45 m");
    expect(hoursText(600)).toBe("10 h");
    expect(hoursText(-5)).toBe("0 m");
    expect(hoursSaid(61)).toBe("1 hour 1 minute");
  });

  it("fills a cell of the bar only once it is whole, and all five only at the end", () => {
    expect(cellsFull(0)).toBe(0);
    expect(cellsFull(0.39)).toBe(1);
    expect(cellsFull(0.99)).toBe(4);
    expect(cellsFull(1)).toBe(5);
    expect(partOf(30, 60)).toBe(0.5);
  });
});

describe("the top bar (1.5.10)", () => {
  it("is the menu, the chapter bar, the acorns and the (i): nothing else", () => {
    const markup = top(0);
    expect(markup).toContain('aria-label="Menu"');
    expect(markup).toContain("Ch 4");
    expect(markup).toContain("6 h 20 m");
    expect(markup).toContain("Fence");
    expect(markup).toContain('data-hud="acorns"');
    expect(markup).not.toContain('data-hud="parcels"');
    // No sound, camera, arcade or house keys on the bar: they are in the menu.
    expect(markup).not.toMatch(/lucide-camera|lucide-gamepad|lucide-door-open|lucide-volume/);
  });

  it("shows the acorn count plain, never in the berry pill that means something waits", () => {
    expect(top(0)).not.toContain("pip-base-count");
    expect(top(0)).toContain("pip-acorn-count");
  });

  it("has a parcels badge when there are parcels, that opens them all", () => {
    expect(top(3)).toContain("Open all");
  });
});

describe("the dock", () => {
  it("is three keys: Build, Raid and Edit", () => {
    const markup = renderToStaticMarkup(
      <HollowDock dock={{ where: "camp", buildOpen: false, onBuild: nothing, buildMark: null, raid: { open: false, rested: 2, nudge: false, onRaid: nothing }, onEdit: nothing }} />
    );
    expect(markup.match(/is-key/g)?.length).toBe(3);
    expect(markup).toMatch(/Build[\s\S]*Raid[\s\S]*Edit/);
  });
});

describe("the guide behind the (i)", () => {
  it("is eight pages of three lines at most, and does not speak of prowlers (or the meadow) before their chapter as if they were here", () => {
    const pages = pagesOf(newBase(0, "2026-10-21"), 0);
    expect(pages.map((page) => page.id)).toEqual(["acorns", "chapters", "buildings", "prowlers", "raids", "heroes", "meadow", "friends"]);
    expect(pages.find((page) => page.id === "meadow")?.locked).toBe("Chapter 7");
    expect(pages.every((page) => page.lines.length <= 3)).toBe(true);
    expect(pages.find((page) => page.id === "prowlers")?.locked).toBe("Chapter 3");
    expect(pagesOf(newBase(4 * 60, "2026-10-21"), 4 * 60).find((page) => page.id === "prowlers")?.locked).toBeUndefined();
  });

  it("says, on the prowlers' page (1.5.11), that they come down a trail, and what keeps them out", () => {
    const page = pagesOf(newBase(4 * 60, "2026-10-21"), 4 * 60).find((entry) => entry.id === "prowlers")!;
    expect(page.lines.length).toBeLessThanOrEqual(3);
    expect(page.lines[0]).toMatch(/down the trail from the Dark Wood/);
    expect(page.lines.join(" ")).toMatch(/wall across it and towers behind it keep them out/);
  });
});

describe("the chapter bar's words (1.5.10)", () => {
  it("says Vol past the tenth chapter, as the chapter card does", async () => {
    const { chapterChipOf } = await import("./hollowRules");
    const base = newBase(90 * 60, "2026-10-21");
    const chip = chapterChipOf(base, 90 * 60);
    expect(chip.volume).toBe(3);
    const markup = renderToStaticMarkup(
      <HollowTop
        chapter={chip}
        onChapter={nothing}
        chapterOpen={false}
        acorns={0}
        acornCue={{ current: null }}
        acornChipRef={nothing}
        trailsRef={nothing}
        gained={null}
        onAcorns={nothing}
        parcels={0}
        onParcels={nothing}
        guideOpen={false}
        onGuide={nothing}
        sound
        onSound={nothing}
        onPostcard={null}
        onArcade={null}
        onHouse={null}
      />
    );
    expect(markup).toContain("Vol 3");
    expect(markup).not.toContain("Ch 13");
    expect(markup).toMatch(/Volume 3: .*% of the way to volume 4/);
  });

  it("names the next goal in its own words, as the card does", async () => {
    const { chapterChipOf } = await import("./hollowRules");
    const base = { ...newBase(70, "2026-10-21"), levels: { ...newBase(70, "2026-10-21").levels, store: 1 } };
    const chip = chapterChipOf(base, 70);
    expect(chip.goal).toBe(true);
    expect(chip.next).toBe("Tap the oak to take in its acorns");
  });

  it("fills a sliver as soon as any of the chapter is read, and all of it only at the end", () => {
    expect(fillOf(0)).toBe(0);
    expect(fillOf(0.001)).toBe(3);
    expect(fillOf(0.5)).toBe(22);
    expect(fillOf(0.999)).toBe(42);
    expect(fillOf(1)).toBe(44);
    expect(percentOf(0.4)).toBe(40);
  });
});
