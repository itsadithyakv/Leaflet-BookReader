import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forgetBooksOnThisDevice } from "./deviceData";

const BOOK = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

/** The part of `localStorage` the code uses. */
const fakeStorage = (entries: Record<string, string>) => {
  const data = new Map(Object.entries(entries));
  return {
    get length() {
      return data.size;
    },
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    keys: () => Array.from(data.keys()).sort()
  };
};

describe("what Delete All Data removes from the webview", () => {
  let storage: ReturnType<typeof fakeStorage>;

  beforeEach(() => {
    storage = fakeStorage({
      [`leaflet.reader.${BOOK}`]: '{"cfi":"epubcfi(/6/14!/4/2)","fontSize":18}',
      [`leaflet.bookmarks.${BOOK}`]: "[3,41]",
      [`leaflet.pdfChapters.${BOOK}`]: '{"rules":1,"pages":40,"entries":[]}',
      "leaflet.pip.nodsSeen": `["${BOOK}"]`,
      "leaflet.shelf.lastSeen": "session-7",
      "leaflet.reader.layout": "pages",
      "leaflet.reader.measure": "wide",
      "leaflet.lookup.noteSeen": "1",
      "leaflet.appearance.v1": '{"theme":"dark"}',
      "leaflet.welcomed": "1",
      "someone-elses-key": "x"
    });
    vi.stubGlobal("localStorage", storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * The bug this guards: these stayed after the delete, so the same file
   * imported again opened at the old place, with the old bookmarks.
   */
  it("removes each book's place and bookmarks, and the lists of book ids", () => {
    expect(forgetBooksOnThisDevice()).toBe(8);
    expect(storage.keys()).toEqual(["leaflet.appearance.v1", "leaflet.welcomed", "someone-elses-key"]);
  });

  /**
   * The lookup card says what it sends the first time it is used on a device,
   * and remembers that it has. After a delete this is a new device again.
   */
  it("removes the chapter list made for a book that came without one", () => {
    storage.setItem(`leaflet.contents.${BOOK}`, '{"v":1,"spine":5,"use":"made","toc":[]}');
    forgetBooksOnThisDevice();
    expect(storage.getItem(`leaflet.contents.${BOOK}`)).toBeNull();
  });

  it("removes the note of which Kindle highlights were not found in a book", () => {
    storage.setItem(`leaflet.kindleTried.${BOOK}`, '{"v":1,"ids":["kindle-0a1b2c3d4e5f6071"],"top":640}');
    forgetBooksOnThisDevice();
    expect(storage.getItem(`leaflet.kindleTried.${BOOK}`)).toBeNull();
  });

  it("forgets that the lookup card's note has been shown", () => {
    forgetBooksOnThisDevice();
    expect(storage.getItem("leaflet.lookup.noteSeen")).toBeNull();
  });

  it("can leave the reader's own layout choices", () => {
    expect(forgetBooksOnThisDevice(false)).toBe(5);
    expect(storage.keys()).toEqual([
      "leaflet.appearance.v1",
      "leaflet.lookup.noteSeen",
      "leaflet.reader.layout",
      "leaflet.reader.measure",
      "leaflet.welcomed",
      "someone-elses-key"
    ]);
  });

  /**
   * Character sheets are in the database, which the delete clears; the
   * browser preview keeps its own copy here. The "Characters" switch is one
   * of the reader's settings.
   */
  it("removes the preview's character sheets, and the Characters switch only with the settings", () => {
    storage.setItem("leaflet.people.preview", '[{"id":"p1","kind":"person"}]');
    storage.setItem("leaflet.reader.characters", "1");
    forgetBooksOnThisDevice(false);
    expect(storage.getItem("leaflet.people.preview")).toBeNull();
    expect(storage.getItem("leaflet.reader.characters")).toBe("1");
    storage.setItem("leaflet.people.preview", "[]");
    forgetBooksOnThisDevice();
    expect(storage.getItem("leaflet.people.preview")).toBeNull();
    expect(storage.getItem("leaflet.reader.characters")).toBeNull();
  });

  /**
   * The radio (ambience/prefs.ts): whether it plays while a book is open,
   * the scene and the volume are settings of this device.
   */
  it("forgets the radio's choices with the settings, and keeps them without", () => {
    storage.setItem("leaflet.ambience", '{"on":true,"scene":"cafe","volume":0.4,"thunder":true}');
    forgetBooksOnThisDevice(false);
    expect(storage.getItem("leaflet.ambience")).not.toBeNull();
    forgetBooksOnThisDevice();
    expect(storage.getItem("leaflet.ambience")).toBeNull();
  });

  /**
   * The chapter list shows itself once on a device, and remembers whether it
   * was left open (readers/contentsPanel.ts). After a delete it is a new
   * device: the list shows itself again.
   */
  it("forgets that the chapter list has shown itself, with the settings", () => {
    storage.setItem("leaflet.reader.contentsSeen", "1");
    storage.setItem("leaflet.reader.contentsOpen", "1");
    forgetBooksOnThisDevice(false);
    expect(storage.getItem("leaflet.reader.contentsSeen")).toBe("1");
    expect(storage.getItem("leaflet.reader.contentsOpen")).toBe("1");
    forgetBooksOnThisDevice();
    expect(storage.getItem("leaflet.reader.contentsSeen")).toBeNull();
    expect(storage.getItem("leaflet.reader.contentsOpen")).toBeNull();
  });

  it("does nothing, quietly, when storage cannot be read", () => {
    vi.stubGlobal("localStorage", {
      get length(): number {
        throw new Error("blocked");
      }
    });
    expect(forgetBooksOnThisDevice()).toBe(0);
  });
});
