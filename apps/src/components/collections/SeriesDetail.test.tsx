import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { SeriesGroup } from "../../library/series";
import { SeriesDetail } from "./SeriesDetail";

const group: SeriesGroup = {
  key: "discworld|pratchett",
  name: "Discworld",
  author: "Terry Pratchett",
  members: [],
  total: 2,
  missing: [
    { index: 1, title: "The Colour of Magic" },
    { index: 2, title: "The Light Fantastic" }
  ],
  parts: [],
  missingExtras: [],
  finishedCount: 0,
  ownedCount: 0,
  next: null,
  upNext: false,
  missingNext: null
};

describe("a series, opened", () => {
  it("keeps how to set a book right behind an (i)", () => {
    const nothing = () => undefined;
    const markup = renderToStaticMarkup(
      <SeriesDetail group={group} onOpen={nothing} showToast={nothing} />
    );
    const hint = "Its ⋯ menu → Series sets it right.";
    expect(markup).toContain(hint);
    expect(markup.replace(/<[^>]*>/g, " ")).not.toContain(hint);
    expect(markup).toContain("The Light Fantastic");
  });
});
