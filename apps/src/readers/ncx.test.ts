import { describe, expect, it } from "vitest";
import { countToc, fullerToc, tocFromNcx, type NcxElement } from "./ncx";
import type { TocItem } from "./readerTypes";

/** A made-up element: a name, attributes, and children or text. */
const el = (nodeName: string, attrs: Record<string, string> = {}, inside: NcxElement[] | string = []): NcxElement => ({
  nodeName,
  children: typeof inside === "string" ? [] : inside,
  textContent: typeof inside === "string" ? inside : inside.map((child) => child.textContent ?? "").join(""),
  getAttribute: (name) => attrs[name] ?? null
});

const point = (id: string, label: string, src: string, kids: NcxElement[] = [], prefix = "") =>
  el(`${prefix}navPoint`, { id }, [el(`${prefix}navLabel`, {}, [el(`${prefix}text`, {}, label)]), el(`${prefix}content`, { src }), ...kids]);

const ncx = (points: NcxElement[], prefix = "") => el(`${prefix}ncx`, {}, [el(`${prefix}head`), el(`${prefix}docTitle`, {}, [el(`${prefix}text`, {}, "A Set")]), el(`${prefix}navMap`, {}, points)]);

/** epub.js's way, for comparison: entries filed by id, parents found by id. */
const byId = (root: NcxElement): TocItem[] => {
  const filed: Record<string, TocItem> = {};
  const list: TocItem[] = [];
  const walk = (parent: NcxElement, parentId: string | null) => {
    for (const child of Array.from(parent.children).filter((node) => node.nodeName === "navPoint")) {
      const id = child.getAttribute("id") ?? "";
      const item: TocItem = { id, label: "", href: "x", subitems: [] };
      filed[id] = item;
      if (parentId === null) {
        list.push(item);
      } else {
        filed[parentId].subitems!.push(item);
      }
      walk(child, id);
    }
  };
  walk(Array.from(root.children).find((node) => node.nodeName === "navMap")!, null);
  return list;
};

describe("the contents of an NCX file", () => {
  // Two novels in one file. The first novel's entry has the id of its own cover, as the publisher wrote it.
  const set = ncx([
    point("cover", "Cover", "cover.htm"),
    point("one-cover", "The First Novel", "one-cover.htm", [
      point("one-cover", "Cover", "one-cover.htm#img"),
      point("one-c1", "Anna", "one-c1.htm"),
      point("one-c2", "Boris", "one-c2.htm"),
      point("one-app", "Appendix", "one-app.htm", [point("one-app-a", "The Houses", "one-app.htm#a")])
    ]),
    point("two", "The Second Novel", "two-cover.htm", [point("two-cover", "Cover", "two-cover.htm#img"), point("two-c1", "Anna", "two-c1.htm")])
  ]);

  it("nests entries as the file nests them, whatever their ids", () => {
    const toc = tocFromNcx(set);
    expect(toc.map((item) => item.label)).toEqual(["Cover", "The First Novel", "The Second Novel"]);
    expect(toc[1].subitems?.map((item) => item.label)).toEqual(["Cover", "Anna", "Boris", "Appendix"]);
    expect(toc[1].subitems?.[3].subitems?.map((item) => item.href)).toEqual(["one-app.htm#a"]);
    expect(toc[2].subitems?.map((item) => item.href)).toEqual(["two-cover.htm#img", "two-c1.htm"]);
    expect(countToc(toc)).toBe(10);
  });

  it("keeps what filing by id loses", () => {
    const lossy = byId(set);
    // The first novel is left with no chapters: they hang on its cover, which nothing points to.
    expect(lossy[1].subitems).toEqual([]);
    expect(countToc(lossy)).toBe(5);
    expect(fullerToc(lossy, tocFromNcx(set))).toHaveLength(3);
    expect(countToc(fullerToc(lossy, tocFromNcx(set)))).toBe(10);
  });

  it("leaves a book epub.js reads correctly exactly as epub.js read it", () => {
    const plain = ncx([point("a", "One", "a.htm"), point("b", "Two", "b.htm", [point("b1", "Two, first", "b.htm#1")])]);
    const fromEpubjs = byId(plain);
    expect(fullerToc(fromEpubjs, tocFromNcx(plain))).toBe(fromEpubjs);
  });

  it("reads prefixed element names, and from a document as well as its root", () => {
    const prefixed = ncx([point("a", "One", "a.htm", [point("a1", "One, first", "a.htm#1", [], "ncx:")], "ncx:")], "ncx:");
    const asDocument = el("#document", {}, [prefixed]);
    expect(tocFromNcx(asDocument)[0].subitems?.[0].label).toBe("One, first");
  });

  it("passes over an entry with nowhere to go, and a file with no navMap", () => {
    const holed = ncx([el("navPoint", { id: "x" }, [el("navLabel", {}, [el("text", {}, "Nowhere")])]), point("a", "One", "a.htm")]);
    expect(tocFromNcx(holed).map((item) => item.label)).toEqual(["One"]);
    expect(tocFromNcx(el("ncx", {}, [el("head")]))).toEqual([]);
    expect(tocFromNcx(null)).toEqual([]);
  });

  it("counts a tree with a loop in it once round", () => {
    const loop: TocItem = { label: "Cover", href: "c.htm", subitems: [] };
    loop.subitems!.push(loop);
    expect(countToc([loop])).toBe(1);
  });
});
