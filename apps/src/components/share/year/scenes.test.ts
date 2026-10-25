import { describe, expect, it } from "vitest";
import { SCENE_ORDER, chooseScenes, isSmallYear, sceneCopy, sceneHasTitles, sceneWords, shownMonths, summaryFigures } from "./scenes";
import { emptyYear, fullYear, lateYear, smallYear } from "./testing";

describe("which scenes a year has", () => {
  it("is every scene, in order, for a year with something for each", () => {
    expect(chooseScenes(fullYear())).toEqual(SCENE_ORDER);
  });

  it("skips a scene with nothing to say", () => {
    const year = fullYear();
    expect(chooseScenes({ ...year, highlight: null, highlightChoices: [], hardestWord: null })).not.toContain("lines");
    expect(chooseScenes({ ...year, hollow: null })).not.toContain("hollow");
    expect(chooseScenes({ ...year, cardsMade: 0, cardsLearnt: 0 })).not.toContain("study");
    expect(chooseScenes({ ...year, finished: [] })).not.toContain("books");
    expect(chooseScenes({ ...year, dayShare: null })).not.toContain("when");
    expect(chooseScenes({ ...year, readerType: null })).not.toContain("kind");
    expect(chooseScenes({ ...year, topAuthor: null, topAuthorBooks: [], mostReturned: null })).not.toContain("faithful");
  });

  it("tells a small year in a few warm scenes, never a thin long story", () => {
    const year = smallYear();
    expect(isSmallYear(year)).toBe(true);
    expect(chooseScenes(year)).toEqual(["opening", "time", "summary"]);
    expect(sceneCopy("time", year).lines[0]).toBe("That's about as long as 3 pots of tea, brewed and poured.");
    expect(sceneCopy("time", { ...year, comparison: null }).lines[0]).toBe("Every page counts. These did.");
    expect(sceneCopy("time", year)).toMatchObject({ big: "15", unit: "minutes" });
  });

  it("gives an empty year one kind card", () => {
    expect(chooseScenes(emptyYear())).toEqual(["empty"]);
    expect(sceneCopy("empty", emptyYear()).lines[0]).toMatch(/first one/);
  });

  it("shows the calendar's months from a late starter's first", () => {
    expect(shownMonths(lateYear())).toEqual([8, 9, 10, 11]);
    expect(shownMonths(fullYear())).toHaveLength(12);
  });
});

describe("what the scenes say", () => {
  it("frames a late starter's story by the months they had", () => {
    const year = lateYear();
    expect(sceneCopy("opening", year)).toMatchObject({ eyebrow: "Your first", big: "4 months", unit: "in pages" });
    expect(sceneCopy("time", year).eyebrow).toBe("In just 4 months you read for");
    expect(sceneCopy("summary", year).unit).toBe("in pages · 2026");
  });

  it("says the year, and so far before it is over", () => {
    expect(sceneCopy("opening", fullYear())).toMatchObject({ eyebrow: "Your year", big: "2026" });
    const soFar = fullYear(new Date(2026, 11, 26));
    expect(sceneCopy("opening", soFar).eyebrow).toBe("Your year so far");
    expect(sceneCopy("opening", soFar).lines[0]).toBe("Up to 26 December. The rest still counts.");
    expect(sceneCopy("summary", soFar).unit).toBe("in pages, so far");
  });

  it("leaves book titles out when asked, everywhere they would be", () => {
    const year = fullYear();
    const titles = ["The Hound of the Baskervilles", "A Study in Scarlet", "Moby-Dick"];
    for (const id of chooseScenes(year)) {
      const words = sceneWords(id, year, { hideTitles: true });
      for (const title of titles) {
        expect(words).not.toContain(title);
      }
    }
    expect(sceneCopy("books", year, { hideTitles: true }).shelf?.every((book) => book.title === "" && book.author === "")).toBe(true);
    expect(sceneCopy("faithful", year, { hideTitles: true }).stack?.every((title) => title === "")).toBe(true);
    // The author stays: it is not a title.
    expect(sceneCopy("lines", year, { hideTitles: true }).quote?.by).toBe("Herman Melville");
    expect(sceneWords("books", year)).toContain("Moby-Dick");
  });

  it("offers the switch only for scenes with titles in them", () => {
    const year = fullYear();
    expect(chooseScenes(year).filter((id) => sceneHasTitles(id, year))).toEqual(["books", "faithful", "lines"]);
  });

  it("swaps the highlight among the year's, round and round", () => {
    const year = { ...fullYear() };
    year.highlightChoices = [...year.highlightChoices, { text: "Call me Ishmael.", note: null, title: "Moby-Dick", author: "Herman Melville" }];
    expect(sceneCopy("lines", year, { highlightAt: 1 }).quote?.text).toBe("Call me Ishmael.");
    expect(sceneCopy("lines", year, { highlightAt: 2 }).quote?.text).toBe(year.highlightChoices[0].text);
  });

  it("sums up in six figures at most, each one there is something to say for", () => {
    const figures = summaryFigures(fullYear());
    expect(figures.length).toBeLessThanOrEqual(6);
    expect(figures[0].label).toBe("hours");
    expect(summaryFigures(smallYear()).map((figure) => figure.label)).toEqual(["minutes", "days read", "days in a row"]);
  });
});
