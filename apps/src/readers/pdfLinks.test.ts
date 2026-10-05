import { describe, expect, it } from "vitest";
import {
  destFraction,
  destPoint,
  linkAction,
  linkAt,
  linkRect,
  pageLinks,
  resolveDest,
  mailAddress,
  webAddress,
  type DestLookups,
  type PageLink
} from "./pdfLinks";

/** An upright A4 page, 595 by 842: page space has its origin bottom left, the page as shown top left. */
const UPRIGHT = [1, 0, 0, -1, 0, 842];
/** The same sheet shown turned a quarter clockwise (/Rotate 90): 842 wide, 595 tall. */
const TURNED = [0, 1, 1, 0, 0, 0];

const ref = (num: number) => ({ num, gen: 0 });

/** A document whose page objects are numbered 10, 20, 30... and which knows two names. */
const lookups = (calls: number[] = []): DestLookups => ({
  getDestination: async (name) =>
    name === "figures" ? [ref(40), { name: "FitH" }, 500] : name === "nowhere" ? [ref(999), { name: "Fit" }] : null,
  getPageIndex: async (page) => {
    calls.push(page.num);
    if (page.num % 10 !== 0 || page.num > 80) {
      throw new Error("not a page");
    }
    return page.num / 10 - 1;
  }
});

describe("what a link does", () => {
  it("goes to a destination in the document, named or spelled out", () => {
    expect(linkAction({ subtype: "Link", dest: "figures" })).toEqual({ kind: "dest", dest: "figures" });
    const explicit = [ref(30), { name: "XYZ" }, 0, 400, 0];
    expect(linkAction({ subtype: "Link", dest: explicit })).toEqual({ kind: "dest", dest: explicit });
  });

  it("opens an http or https address, as https", () => {
    expect(linkAction({ subtype: "Link", url: "https://example.com/a?b=1#c" })).toEqual({
      kind: "web",
      url: "https://example.com/a?b=1#c"
    });
    expect(linkAction({ subtype: "Link", url: "http://example.com/" })).toEqual({ kind: "web", url: "https://example.com/" });
  });

  it("gives no area to any other scheme, or to an address pdf.js would not vouch for", () => {
    for (const url of ["mailto:", "mailto:?to=someone@example.com", "mailto:a@example.com,b@example.com", "javascript:alert(1)", "file:///C:/Windows/system32/calc.exe", "ftp://example.com/x", "tel:+15550100", "https://", "not a url"]) {
      expect([url, linkAction({ subtype: "Link", url })]).toEqual([url, null]);
    }
    // A launch action or a link to another file arrives with no `url` pdf.js checked.
    expect(linkAction({ subtype: "Link", unsafeUrl: "calc.exe" } as never)).toBeNull();
    expect(linkAction({ subtype: "Link" })).toBeNull();
    expect(webAddress(undefined)).toBeNull();
  });

  it("opens the reader's mail program for a mail address, and passes on nothing but the address", () => {
    expect(linkAction({ subtype: "Link", url: "mailto:business@example.com" })).toEqual({ kind: "web", url: "mailto:business@example.com" });
    expect(mailAddress(" MAILTO:First.Last+books@mail.example.co.uk ")).toBe("mailto:First.Last+books@mail.example.co.uk");
    expect(mailAddress("mailto:a@example.com?subject=Hi&body=x&attach=C:/secret.txt")).toBe("mailto:a@example.com");
    for (const url of ["mailto:nobody", "mailto:a@b", "mailto:a b@example.com", "mailto:a@-example.com", "mailto:a@example.com%0Abcc:x@example.com", "mailto://example.com/a@b.c", "https://example.com/", undefined, 7]) {
      expect([url, mailAddress(url)]).toEqual([url, null]);
    }
  });

  it("steps a page for the named actions a presentation uses, and knows no others", () => {
    expect(linkAction({ subtype: "Link", action: "NextPage" })).toEqual({ kind: "step", to: "next" });
    expect(linkAction({ subtype: "Link", action: "LastPage" })).toEqual({ kind: "step", to: "last" });
    expect(linkAction({ subtype: "Link", action: "Print" })).toBeNull();
    expect(linkAction({ subtype: "Link", action: "SaveAs" })).toBeNull();
  });

  it("is only for links: a note, a form field or a highlight is not one", () => {
    expect(linkAction({ subtype: "Widget", url: "https://example.com/" })).toBeNull();
    expect(linkAction({ subtype: "Text", dest: "figures" })).toBeNull();
    expect(linkAction(null)).toBeNull();
  });

  it("stays in the document when a link has both a destination and an address", () => {
    expect(linkAction({ subtype: "Link", dest: "figures", url: "https://example.com/" })?.kind).toBe("dest");
  });
});

describe("where a link is on the page", () => {
  it("is a share of the page as shown, measured from its top left", () => {
    const rect = linkRect([50, 60, 250, 76], UPRIGHT, 595, 842)!;
    expect(rect.left).toBeCloseTo(50 / 595, 10);
    expect(rect.top).toBeCloseTo((842 - 76) / 842, 10);
    expect(rect.width).toBeCloseTo(200 / 595, 10);
    expect(rect.height).toBeCloseTo(16 / 842, 10);
  });

  it("turns with a page the file shows turned", () => {
    // 200 along the sheet and 16 up it: on the turned page, 16 across and 200 down.
    const rect = linkRect([50, 60, 250, 76], TURNED, 842, 595)!;
    expect(rect.left).toBeCloseTo(60 / 842, 10);
    expect(rect.top).toBeCloseTo(50 / 595, 10);
    expect(rect.width).toBeCloseTo(16 / 842, 10);
    expect(rect.height).toBeCloseTo(200 / 595, 10);
  });

  it("follows a page whose own space does not begin at nought", () => {
    // MediaBox [20 30 615 872]: the same sheet, its corner at (20, 30).
    const rect = linkRect([70, 90, 270, 106], [1, 0, 0, -1, -20, 872], 595, 842)!;
    expect(rect.left).toBeCloseTo(50 / 595, 10);
    expect(rect.top).toBeCloseTo((842 - 76) / 842, 10);
  });

  it("takes its corners in either order, and keeps to the page", () => {
    expect(linkRect([250, 76, 50, 60], UPRIGHT, 595, 842)).toEqual(linkRect([50, 60, 250, 76], UPRIGHT, 595, 842));
    const over = linkRect([500, 800, 700, 900], UPRIGHT, 595, 842)!;
    expect(over.left + over.width).toBeCloseTo(1, 10);
    expect(over.top).toBe(0);
  });

  it("is nothing for a rectangle with no size, off the page, or not a rectangle", () => {
    expect(linkRect([50, 60, 50, 76], UPRIGHT, 595, 842)).toBeNull();
    expect(linkRect([700, 60, 900, 76], UPRIGHT, 595, 842)).toBeNull();
    expect(linkRect([50, 60], UPRIGHT, 595, 842)).toBeNull();
    expect(linkRect([50, Number.NaN, 250, 76], UPRIGHT, 595, 842)).toBeNull();
    expect(linkRect(undefined, UPRIGHT, 595, 842)).toBeNull();
  });
});

describe("where a destination goes", () => {
  it("reads the point each kind of destination shows", () => {
    expect(destPoint([ref(30), { name: "XYZ" }, 72, 400, 0])).toEqual({ left: 72, top: 400 });
    expect(destPoint([ref(30), { name: "XYZ" }, null, null, null])).toEqual({ left: null, top: null });
    expect(destPoint([ref(30), { name: "FitH" }, 500])).toEqual({ left: null, top: 500 });
    expect(destPoint([ref(30), { name: "FitBV" }, 40])).toEqual({ left: 40, top: null });
    expect(destPoint([ref(30), { name: "FitR" }, 10, 20, 300, 420])).toEqual({ left: 10, top: 420 });
    expect(destPoint([ref(30), { name: "Fit" }])).toEqual({ left: null, top: null });
    expect(destPoint([ref(30)])).toEqual({ left: null, top: null });
  });

  it("finds the page of a spelled-out destination, a named one, and a bare page number", async () => {
    expect(await resolveDest([ref(30), { name: "XYZ" }, 0, 400, 0], lookups(), 8)).toEqual({ page: 3, left: 0, top: 400 });
    expect(await resolveDest("figures", lookups(), 8)).toEqual({ page: 4, left: null, top: 500 });
    expect(await resolveDest([5, { name: "Fit" }], lookups(), 8)).toEqual({ page: 6, left: null, top: null });
  });

  it("goes nowhere for a name that is not known or a page that is not in the document", async () => {
    expect(await resolveDest("missing", lookups(), 8)).toBeNull();
    expect(await resolveDest("nowhere", lookups(), 8)).toBeNull();
    expect(await resolveDest([ref(80), { name: "Fit" }], lookups(), 6)).toBeNull();
    expect(await resolveDest([], lookups(), 8)).toBeNull();
  });

  it("says how far down the page as shown the point is", () => {
    expect(destFraction({ left: 0, top: 400 }, [1, 0, 0, -1, 0, 595], 842, 595)).toBeCloseTo(195 / 595, 10);
    expect(destFraction({ left: null, top: 842 }, UPRIGHT, 595, 842)).toBe(0);
    // No height given: the page, not a place on it.
    expect(destFraction({ left: 72, top: null }, UPRIGHT, 595, 842)).toBeNull();
    // On a turned page, down the page as shown is along the sheet.
    expect(destFraction({ left: 119, top: 700 }, TURNED, 842, 595)).toBeCloseTo(119 / 595, 10);
    expect(destFraction({ left: null, top: 700 }, TURNED, 842, 595)).toBeNull();
  });
});

describe("a page's links, ready to lay over it", () => {
  it("keeps what can be followed, labelled, and leaves the rest out", async () => {
    const calls: number[] = [];
    const links = await pageLinks(
      [
        { subtype: "Link", rect: [50, 60, 250, 76], dest: [ref(30), { name: "XYZ" }, 0, 400, 0] },
        { subtype: "Link", rect: [50, 100, 250, 116], dest: [ref(30), { name: "Fit" }] },
        { subtype: "Link", rect: [50, 140, 250, 156], dest: "figures" },
        { subtype: "Link", rect: [310, 60, 540, 76], url: "http://example.com/paper" },
        { subtype: "Link", rect: [310, 100, 540, 116], url: "mailto:someone@example.com" },
        { subtype: "Link", rect: [310, 140, 540, 156], url: "javascript:alert(1)" },
        { subtype: "Link", rect: [310, 180, 540, 196], dest: "missing" },
        { subtype: "Link", rect: [0, 0, 0, 0], url: "https://example.com/" },
        { subtype: "Highlight", rect: [50, 300, 250, 316] },
        null
      ],
      UPRIGHT,
      595,
      842,
      lookups(calls),
      8
    );
    expect(links.map((link) => link.label)).toEqual(["Go to page 3", "Go to page 3", "Go to page 4", "https://example.com/paper", "Write to someone@example.com"]);
    expect(links[4].target).toEqual({ kind: "web", url: "mailto:someone@example.com" });
    expect(links[0].target).toEqual({ kind: "page", page: 3, left: 0, top: 400 });
    expect(links[3].target).toEqual({ kind: "web", url: "https://example.com/paper" });
    // Two links to the same page look its number up once.
    expect(calls.filter((num) => num === 30)).toHaveLength(1);
  });

  it("finds the link under a point, the later of two that overlap", () => {
    const link = (left: number, top: number, label: string): PageLink => ({
      rect: { left, top, width: 0.2, height: 0.02 },
      label,
      target: { kind: "web", url: "https://example.com/" }
    });
    const links = [link(0.1, 0.5, "first"), link(0.2, 0.51, "second")];
    expect(linkAt(links, 0.15, 0.505)?.label).toBe("first");
    expect(linkAt(links, 0.25, 0.515)?.label).toBe("second");
    expect(linkAt(links, 0.5, 0.5)).toBeNull();
    expect(linkAt([], 0.1, 0.1)).toBeNull();
  });
});
