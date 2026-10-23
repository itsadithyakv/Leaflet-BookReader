import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { placeKeeper } from "./KeptScroll";
import { keptPageStyle, PageShownContext, usePageShown } from "../hooks/pageShown";
import { restingRowSize } from "./VirtualRows";

describe("a kept page's place", () => {
  it("follows the scrolls while the page is shown", () => {
    const keeper = placeKeeper(0);
    keeper.scrolled(1200);
    keeper.scrolled(3400);
    expect(keeper.place).toBe(3400);
  });

  it("is not moved by the other page's scrolling, nor by the scroll that hiding causes", () => {
    const keeper = placeKeeper(0);
    keeper.scrolled(3400);
    keeper.show(false);
    // The other page is shorter: the scroll area clamps, then the reader scrolls it.
    keeper.scrolled(600);
    keeper.scrolled(0);
    expect(keeper.place).toBe(3400);
    keeper.show(true);
    keeper.scrolled(3500);
    expect(keeper.place).toBe(3500);
  });

  it("is nothing until a place is known", () => {
    expect(placeKeeper().place).toBeNull();
  });
});

describe("a kept page", () => {
  it("is out of the layout while hidden, and as it was while shown", () => {
    expect(keptPageStyle(true)).toBeUndefined();
    expect(keptPageStyle(false)).toEqual({ display: "none" });
  });

  it("is shown unless it is told otherwise", () => {
    const Probe = () => <span>{String(usePageShown())}</span>;
    expect(renderToStaticMarkup(<Probe />)).toBe("<span>true</span>");
    expect(
      renderToStaticMarkup(
        <PageShownContext.Provider value={false}>
          <Probe />
        </PageShownContext.Provider>
      )
    ).toBe("<span>false</span>");
  });

  it("keeps a row's height while hidden (it cannot be measured then), or takes the guess", () => {
    expect(restingRowSize(412, 360, 32)).toBe(412);
    expect(restingRowSize(undefined, 360, 32)).toBe(392);
  });
});
