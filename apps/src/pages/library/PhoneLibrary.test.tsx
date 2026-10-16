import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ActiveSession } from "../../store/habitStore";
import { PhoneFocusStrip, PhoneShelfTools, SESSION_LENGTHS } from "./PhoneLibrary";

const nothing = () => undefined;

const strip = (session: ActiveSession | null) =>
  renderToStaticMarkup(
    <PhoneFocusStrip
      streakTitle="3 Day Streak!"
      session={session}
      reading={false}
      duration={20}
      setDuration={nothing}
      fullScreen={false}
      toggleFullScreen={nothing}
      onStart={nothing}
      onEnd={nothing}
    />
  );

const tools = (patch: Partial<{ author: string; genre: string; highlights: number }> = {}) =>
  renderToStaticMarkup(
    <PhoneShelfTools
      filters={{ author: patch.author ?? "all", genre: patch.genre ?? "all", sort: "recent", view: "grid" }}
      setFilter={nothing}
      authors={["Jane Austen"]}
      genres={[{ key: "classics", name: "Classics" }]}
      genreValue="all"
      sortOptions={[{ value: "recent", label: "Recently Added" }]}
      highlightTotal={patch.highlights ?? 0}
      openHighlights={nothing}
    />
  );

describe("the Library's top on a phone", () => {
  it("is one slim card at rest: the streak and a Focus key, the session's choices kept for its sheet", () => {
    const markup = strip(null);
    expect(markup).toContain("3 Day Streak!");
    expect(markup).toContain('data-tour="session"');
    expect(markup).toContain("Focus");
    // The length, full screen and Start are in the sheet, not on the page.
    expect(markup).not.toContain("<select");
    expect(markup).not.toContain("Full screen");
    expect(markup).not.toContain("Start");
    expect(SESSION_LENGTHS).toEqual([10, 20, 30, 45]);
  });

  it("says a running session and how long is left, with End", () => {
    const markup = strip({ startedAt: new Date().toISOString(), durationMinutes: 30 } as ActiveSession);
    expect(markup).toContain("Session running");
    expect(markup).toMatch(/30 min left/);
    expect(markup).toContain(">End<");
    expect(markup).not.toContain('data-tour="session"');
  });

  it("puts sort, filters and covers-or-list behind one key, not a row of selects", () => {
    const markup = tools();
    expect(markup).toContain("Sort &amp; filter");
    expect(markup).not.toContain("<select");
    expect(markup).not.toContain("Grid view");
    // No highlights, no key for them.
    expect(markup).not.toContain("Highlights");
  });

  it("marks the key when the shelf is filtered, and shows highlights as an icon when there are some", () => {
    expect(tools({ genre: "classics" })).toContain('aria-label="Sort and filter (filtered)"');
    expect(tools({ highlights: 4 })).toContain('aria-label="Highlights: 4"');
  });
});
