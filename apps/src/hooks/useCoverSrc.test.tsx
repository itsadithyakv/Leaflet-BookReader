import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installMiniDom, type MiniElement } from "../testing/miniDom";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({
  invoke,
  isTauri: () => true,
  // As Tauri writes it on Windows and Android.
  convertFileSrc: (path: string, protocol: string) => `http://${protocol}.localhost/${encodeURIComponent(path)}`,
  Channel: class {}
}));

const document = installMiniDom();

const book = { id: "b 1", coverUrl: "C:\\Users\\me\\AppData\\Roaming\\com.leaflet.app\\covers\\abc-chosen-7.jpg" };

describe("a library cover's URL", () => {
  let bookService: typeof import("../services/bookService").bookService;
  let thumbSources: typeof import("./useCoverSrc").thumbSources;
  let coverImgProps: typeof import("./useCoverSrc").coverImgProps;
  beforeAll(async () => {
    ({ bookService } = await import("../services/bookService"));
    ({ thumbSources, coverImgProps } = await import("./useCoverSrc"));
  }, 30_000);

  it("names the book and the width, and changes with the cover's file", () => {
    expect(bookService.coverThumbUrl(book, 240)).toBe("http://cover.localhost/b%201?w=240&v=abc-chosen-7.jpg");
    expect(bookService.coverThumbUrl({ ...book, coverUrl: "/data/covers/abc-cover.jpg" }, 480)).toBe(
      "http://cover.localhost/b%201?w=480&v=abc-cover.jpg"
    );
  });

  it("is not made for a book without a cover file here", () => {
    expect(bookService.coverThumbUrl({ id: "x", coverUrl: null }, 240)).toBeNull();
    expect(bookService.coverThumbUrl({ id: "x", coverUrl: "https://covers.example/x.jpg" }, 240)).toBeNull();
    expect(thumbSources({ id: "x", coverUrl: null })).toBeNull();
  });

  it("offers both widths to the web view, the small one as the plain src", () => {
    const sources = thumbSources(book);
    expect(sources?.src).toBe("http://cover.localhost/b%201?w=240&v=abc-chosen-7.jpg");
    expect(sources?.srcSet).toBe(
      "http://cover.localhost/b%201?w=240&v=abc-chosen-7.jpg 240w, http://cover.localhost/b%201?w=480&v=abc-chosen-7.jpg 480w"
    );
  });

  it("goes in the img with its drawn width, loaded lazily and decoded off the main thread, in a 2:3 box", () => {
    const onError = () => undefined;
    const props = coverImgProps({ src: "s", srcSet: "s 240w, l 480w", onError }, "180px");
    expect(props).toMatchObject({ src: "s", srcSet: "s 240w, l 480w", sizes: "180px", loading: "lazy", decoding: "async", width: 240, height: 360 });
    // A data URL has one size: no srcset, so no sizes either.
    expect(coverImgProps({ src: "data:image/jpeg;base64,xx", onError }, "180px")).not.toHaveProperty("srcSet");
    expect(coverImgProps({ src: "data:image/jpeg;base64,xx", onError }, "180px")).not.toHaveProperty("sizes");
  });
});

describe("a cover whose URL fails", () => {
  let React: typeof import("react");
  let root: import("react-dom/client").Root;
  let seen: import("./useCoverSrc").CoverSrc | null = null;
  let Probe: () => null;

  beforeAll(async () => {
    React = await import("react");
    const { useCoverSrc } = await import("./useCoverSrc");
    Probe = () => {
      seen = useCoverSrc(book, { thumb: true });
      return null;
    };
  }, 30_000);

  const settle = async () => {
    for (let round = 0; round < 4; round += 1) {
      await React.act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  };

  beforeEach(async () => {
    invoke.mockReset();
    seen = null;
    const { createRoot } = await import("react-dom/client");
    const container = document.createElement("div") as MiniElement;
    document.body.appendChild(container);
    root = createRoot(container as unknown as Element);
    await React.act(async () => root.render(<Probe />));
  });

  afterEach(async () => {
    await React.act(async () => root.unmount());
  });

  it("asks for it over IPC instead, then for the full cover, then gives up for the placeholder", async () => {
    invoke.mockImplementation(async (command: string, args: { thumb?: boolean }) =>
      command === "cover_data" && args.thumb ? "data:image/jpeg;base64,SMALL" : null
    );
    expect(seen?.srcSet).toContain("480w");
    expect(invoke).not.toHaveBeenCalled();

    await React.act(async () => seen?.onError());
    await settle();
    expect(invoke).toHaveBeenCalledWith("cover_data", { bookId: "b 1", thumb: true });
    expect(seen?.src).toBe("data:image/jpeg;base64,SMALL");
    expect(seen?.srcSet).toBeUndefined();

    // That fails to draw too: one try with the full cover, which is not there.
    await React.act(async () => seen?.onError());
    await settle();
    expect(invoke).toHaveBeenLastCalledWith("cover_data", { bookId: "b 1", thumb: false });
    expect(seen?.src).toBeNull();
  });
});
