import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ContentsList } from "./ContentsList";

/** A stylesheet read from disk (a CSS import is emptied under the test runner); named so the app's types need no Node. */
const readCss = async (path: string) => {
  const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as { readFileSync: (path: URL, encoding: "utf8") => string };
  return fs.readFileSync(new URL(path, import.meta.url), "utf8");
};

const nothing = () => undefined;

describe("the chapter list of a single work", () => {
  const toc = [
    { label: "MAPS", href: "text/chapter12.xhtml" },
    { label: "PART ONE", href: "text/chapter13.xhtml" },
    { label: "Chapter 1", href: "text/chapter16.xhtml" },
    { label: "Chapter 2", href: "text/chapter18.xhtml" },
    { label: "PART TWO", href: "text/chapter37.xhtml" },
    { label: "Chapter 12", href: "text/chapter40.xhtml" }
  ];
  const depths = [0, 0, 1, 1, 0, 1];
  const rows = toc.map((item, at) => ({ label: item.label, spine: at, depth: depths[at] }));
  const markup = renderToStaticMarkup(
    <ContentsList toc={toc} rows={rows} books={[]} bytes={[]} active={2} place={null} finished={false} open={false} loading={false} onGo={nothing} />
  );
  const buttons = [...markup.matchAll(/<button([^>]*)>(.*?)<\/button>/g)].map(([, attrs, inside]) => ({
    label: inside.replace(/<[^>]+>/g, ""),
    depth: /data-depth="(\d+)"/.exec(attrs)?.[1],
    part: /reader-toc-part/.test(attrs),
    indent: /padding-left:(\d+)px/.exec(attrs)?.[1] ?? null
  }));

  it("sets the chapters in under their parts", () => {
    expect(buttons.map((button) => [button.label, button.depth, button.indent])).toEqual([
      ["MAPS", "0", null],
      ["PART ONE", "0", null],
      ["Chapter 1", "1", "26"],
      ["Chapter 2", "1", "26"],
      ["PART TWO", "0", null],
      ["Chapter 12", "1", "26"]
    ]);
  });

  it("marks a part over its chapters, and nothing else", () => {
    expect(buttons.filter((button) => button.part).map((button) => button.label)).toEqual(["PART ONE", "PART TWO"]);
  });

  it("reads down its left edge by finger too (the touch rule centres a button's insides)", async () => {
    const css = await readCss("./contentsList.css");
    expect(css).toMatch(/\.reader-chapter-link\.reader-icon\s*\{[^}]*justify-content:\s*flex-start;[^}]*text-align:\s*left;/);
  });
});
