import { describe, expect, it } from "vitest";
import { framesOf, kindKey, kindOf, panicKind, scrubFrame, scrubText } from "./errorScrub";

/**
 * What an error report may say. The same expectations as the server's own
 * scrubbing (server/test/admin.test.js), which runs again on whatever it is
 * sent: nothing of the reader's, only which error and where in the code.
 */

describe("scrubbing an error's words", () => {
  it("takes out titles, paths, files, addresses, emails, ids and numbers", () => {
    expect(
      scrubText(`Failed to open "The Hobbit" from C:\\Users\\Ada\\Books\\hobbit.epub for ada@example.com at https://example.com/x?y=1 (page 214, id 9f8e7d6c5b4a39281706)`)
    ).toBe("Failed to open <q> from <path> for <email> at <url> (page #, id <id>)");
    expect(scrubText("ENOENT: no such file /home/ada/Leaflet/Dune.epub")).toBe("ENOENT: no such file <path>");
    expect(scrubText("couldn't read Dune.pdf, ‘Arrakis’ and 'x'")).toBe("couldn't read <file>, <q> and <q>");
    expect(scrubText("It's 'It's here' and the reader's")).toBe("It's <q> and the reader's");
    expect(scrubText("a\nb\tc\u202Ed")).toBe("a b c d");
    expect(scrubText("x".repeat(500))).toHaveLength(200);
  });

  it("keeps a place in the code as a function and a file, without the build's hash, line or column", () => {
    expect(scrubFrame("openBook@assets/LibraryPage-Dx81aQzz.js:1:2345")).toBe("openBook@assets/LibraryPage.js");
    expect(scrubFrame("load@src/readers/text/useBookOpening.ts?t=1729")).toBe("load@readers/text/useBookOpening.ts");
    expect(scrubFrame("panic@sync/cloud.rs:812")).toBe("panic@sync/cloud.rs");
    // A name the build shortened says nothing, and a path that is not the app's says only that.
    expect(scrubFrame("a@assets/index-AbC123xy.js:1:9")).toBe("?@assets/index.js");
    expect(scrubFrame("x@C:\\Users\\Ada\\Leaflet\\a.js")).toBe("?@<path>");
  });

  it("reads the top few places from a Chromium stack, and only the app's own pages by name", () => {
    const stack = [
      "TypeError: Cannot read properties of undefined (reading 'title')",
      "    at openBook (http://tauri.localhost/assets/LibraryPage-Dx81aQzz.js:1:2345)",
      "    at async Object.loadShelf (https://tauri.localhost/assets/index-AbC123xy.js:2:99)",
      "    at http://tauri.localhost/assets/index-AbC123xy.js:3:1",
      "    at evil (https://example.com/inject.js:1:1)",
      "    at new Reader (http://localhost:1420/src/readers/Reader.tsx?t=17:4:2)",
      "    at sixth (http://tauri.localhost/assets/x.js:1:1)"
    ].join("\n");
    expect(framesOf(stack)).toEqual([
      "openBook@assets/LibraryPage.js",
      "loadShelf@assets/index.js",
      "?@assets/index.js",
      "evil@elsewhere",
      "Reader@src/readers/Reader.tsx"
    ]);
    expect(framesOf(undefined)).toEqual([]);
  });

  it("makes a kind of an error, a rejection's reason, and a panic", () => {
    const error = new TypeError(`Cannot open "Emma" at /home/bob/Emma.epub`);
    error.stack = "TypeError: x\n    at openBook (http://tauri.localhost/assets/LibraryPage-Dx81aQzz.js:1:2)";
    const kind = kindOf("unhandled rejection", error);
    expect(kind).toEqual({ name: "TypeError", message: "unhandled rejection: Cannot open <q> at <path>", frames: ["openBook@assets/LibraryPage.js"] });
    // Two titles, one kind.
    const other = new TypeError(`Cannot open "Dune" at /home/ada/Dune.epub`);
    other.stack = error.stack;
    expect(kindKey(kindOf("unhandled rejection", other))).toBe(kindKey(kind));

    expect(kindOf("unhandled rejection", { book: "Persuasion", page: 12 })).toEqual({ name: "Error", message: "unhandled rejection: {<q>:<q>,<q>:#}", frames: [] });
    expect(panicKind("index out of bounds: the len is 3 but the index is 7", "sync/cloud.rs:812")).toEqual({
      name: "Panic",
      message: "index out of bounds: the len is # but the index is #",
      frames: ["panic@sync/cloud.rs"]
    });
  });
});
