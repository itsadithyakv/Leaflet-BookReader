import { describe, expect, it } from "vitest";
import { SHARE_SIZES, renderScene, shareFileName, type ShareSize } from "./render";
import { chooseScenes, type SceneId } from "./scenes";
import { fullYear, lateYear } from "./testing";

/**
 * A canvas that keeps what is written on it: a 2D context that does nothing
 * but note every `fillText`, and measures text by a rule of thumb (half an em
 * a letter) so the layout runs as it does on a screen.
 */
const recordingCanvas = () => {
  const texts: string[] = [];
  let font = "16px sans-serif";
  const gradient = { addColorStop: () => undefined };
  const context = new Proxy(
    {},
    {
      get(_, name) {
        switch (name) {
          case "fillText":
            return (text: string) => texts.push(text);
          case "measureText":
            return (text: string) => ({ width: text.length * 0.5 * Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 16) });
          case "createLinearGradient":
          case "createRadialGradient":
            return () => gradient;
          case "createPattern":
            return () => null;
          case "font":
            return font;
          case "canvas":
            return canvas;
          default:
            return () => undefined;
        }
      },
      set(_, name, value) {
        if (name === "font") font = value;
        return true;
      }
    }
  );
  const canvas = { width: 0, height: 0, getContext: () => context } as unknown as HTMLCanvasElement;
  return { canvas, texts };
};

const draw = (scene: SceneId, size: ShareSize, review = fullYear(), hideTitles = false) => {
  const { canvas, texts } = recordingCanvas();
  renderScene(canvas, scene, review, { size, hideTitles });
  return { canvas, texts: texts.join("\n") };
};

describe("a scene as a picture to share", () => {
  it("comes in three sizes: a Story, a post, a square", () => {
    expect(SHARE_SIZES).toMatchObject({ story: { width: 1080, height: 1920 }, feed: { width: 1080, height: 1350 }, square: { width: 1080, height: 1080 } });
    for (const size of Object.keys(SHARE_SIZES) as ShareSize[]) {
      const { canvas } = draw("summary", size);
      expect([canvas.width, canvas.height]).toEqual([SHARE_SIZES[size].width, SHARE_SIZES[size].height]);
    }
  });

  it("can be drawn for every scene of the year, at every size, with the Leaflet mark", () => {
    const year = fullYear();
    for (const scene of chooseScenes(year)) {
      for (const size of Object.keys(SHARE_SIZES) as ShareSize[]) {
        expect(draw(scene, size, year).texts).toContain("Leaflet");
      }
    }
  });

  it("leaves the book titles out when asked", () => {
    const titles = ["The Hound of the Baskervilles", "A Study in Scarlet", "Moby-Dick"];
    for (const scene of ["books", "faithful", "lines", "summary"] as SceneId[]) {
      const hidden = draw(scene, "story", fullYear(), true).texts;
      for (const title of titles) {
        expect(hidden).not.toContain(title);
      }
    }
    expect(draw("books", "story").texts).toContain("Moby-Dick");
    expect(draw("faithful", "story").texts).toContain("A Study in Scarlet");
  });

  it("carries the span's own words: the year, or a late starter's months", () => {
    expect(draw("time", "story").texts).toContain("2026 IN PAGES");
    const late = draw("time", "feed", lateYear()).texts;
    expect(late).toContain("4 MONTHS IN PAGES · 2026");
    expect(late).toContain("In just 4 months you read for");
    expect(draw("summary", "square", lateYear()).texts).toContain("in pages · 2026");
    expect(draw("opening", "story", fullYear(new Date(2026, 11, 26))).texts).toContain("2026 IN PAGES · SO FAR");
  });

  it("is named for what it is", () => {
    expect(shareFileName(fullYear(), "books", "story")).toBe("2026 in pages - books.png");
    expect(shareFileName(lateYear(), "summary", "square")).toBe("4 months in pages - 2026 - summary square.png");
  });
});
