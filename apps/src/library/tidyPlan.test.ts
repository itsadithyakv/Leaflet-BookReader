import { describe, expect, it } from "vitest";
import { cleanName, planTidy, seriesNumber, type TidyFile, type TidyPlan } from "./tidyPlan";

/** `D:\Books`. */
const FOLDER = 8;

let made = 0;
const file = (path: string, title: string, author: string | null = null, more: Partial<TidyFile> = {}): TidyFile => {
  made += 1;
  return { path, hash: `hash-${made}`, extension: path.split(".").pop()!.toLowerCase(), title, author, series: null, ...more };
};
const inSeries = (name: string, index: number | null) => ({ series: { name, index } });

const plan = (files: TidyFile[], occupied: string[] = []) => planTidy(files, FOLDER, occupied);
const targets = (files: TidyFile[]) => plan(files).moves.map((move) => move.to);
const target = (one: TidyFile) => targets([one])[0];

/** What `storage/tidy.rs` accepts as a name: the planner must make nothing else. */
const legal = (name: string) =>
  name.length > 0 &&
  name.length <= 255 &&
  !/[<>:"/\\|?*\u0000-\u001f\u007f-\u009f]/.test(name) &&
  !/^[ .]|[ .]$/.test(name) &&
  !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(name.split(".")[0].trim());

/** The folder after a plan is carried out, as the next scan would see it. */
const carriedOut = (files: TidyFile[], done: TidyPlan) =>
  files.map((entry) => ({ ...entry, path: done.moves.find((move) => move.from === entry.path)?.to ?? entry.path }));

describe("what a book file is called", () => {
  it("goes in its author's folder under its title", () => {
    expect(target(file("Dune (Frank Herbert) (z-library.sk, 1lib.sk).epub", "Dune", "Frank Herbert"))).toBe(
      "Frank Herbert/Dune.epub"
    );
    expect(target(file("downloads/old/emma.PDF", "Emma", "Jane Austen"))).toBe("Jane Austen/Emma.pdf");
    // The author as the library shows it: one folder, however many wrote it.
    expect(target(file("go.epub", "Good Omens", "Terry Pratchett and Neil Gaiman"))).toBe(
      "Terry Pratchett and Neil Gaiman/Good Omens.epub"
    );
  });

  it("goes in its series' folder, numbered, when it is in one", () => {
    expect(target(file("lw.epub", "Leviathan Wakes", "James S. A. Corey", inSeries("The Expanse", 1)))).toBe(
      "James S. A. Corey/The Expanse/01 - Leviathan Wakes.epub"
    );
    // No number, no prefix.
    expect(target(file("x.epub", "The Churn", "James S. A. Corey", inSeries("The Expanse", null)))).toBe(
      "James S. A. Corey/The Expanse/The Churn.epub"
    );
    // A series with no name left is no series.
    expect(target(file("y.epub", "Dune", "Frank Herbert", inSeries(" ?? ", 1)))).toBe("Frank Herbert/Dune.epub");
  });

  it("pads the number to two digits and keeps a half", () => {
    expect(seriesNumber(1)).toBe("01");
    expect(seriesNumber(12)).toBe("12");
    expect(seriesNumber(3.5)).toBe("03.5");
    expect(seriesNumber(2.5)).toBe("02.5");
    expect(seriesNumber(100)).toBe("100");
    expect(seriesNumber(0)).toBe("00");
    // A number that came through a 32-bit float.
    expect(seriesNumber(Math.fround(1.1))).toBe("01.1");
    expect(seriesNumber(null)).toBeNull();
    expect(seriesNumber(Number.NaN)).toBeNull();
    expect(seriesNumber(-1)).toBeNull();
    expect(target(file("n.epub", "The Vital Abyss", "James S. A. Corey", inSeries("The Expanse", 5.5)))).toBe(
      "James S. A. Corey/The Expanse/05.5 - The Vital Abyss.epub"
    );
  });

  it("uses a folder of its own when nobody is named", () => {
    expect(target(file("scan0042.pdf", "Meeting Notes"))).toBe("Unknown author/Meeting Notes.pdf");
    expect(target(file("a.epub", "Beowulf", "   "))).toBe("Unknown author/Beowulf.epub");
    expect(target(file("b.epub", "", ""))).toBe("Unknown author/Untitled.epub");
    expect(target(file("c.epub", "Lost", null, inSeries("Found", 2)))).toBe("Unknown author/Found/02 - Lost.epub");
  });
});

describe("names Windows will keep", () => {
  it("takes out what a filesystem refuses, as book copies do", () => {
    expect(cleanName("Dune: Messiah")).toBe("Dune - Messiah");
    expect(cleanName("Either/Or")).toBe("Either-Or");
    expect(cleanName("What If?")).toBe("What If");
    expect(cleanName('The "Good" Book <draft> *')).toBe("The 'Good' Book draft");
    expect(cleanName("Tab\there\nand\u0000there")).toBe("Tab here and there");
    expect(cleanName("C:\\Users\\me|you")).toBe("C - -Users-me-you");
    expect(cleanName("Wait...")).toBe("Wait");
    expect(cleanName(".hidden")).toBe("hidden");
    expect(cleanName("  ...  ")).toBe("");
  });

  it("never ends a name with a dot or a space", () => {
    expect(target(file("a.epub", "Wait...", "Martin Luther King Jr."))).toBe("Martin Luther King Jr/Wait.epub");
    expect(target(file("b.epub", "Title", "Someone", inSeries("To be continued... ", 1)))).toBe(
      "Someone/To be continued/01 - Title.epub"
    );
  });

  it("does not use a device's name as it is", () => {
    expect(target(file("a.epub", "CON", "Someone"))).toBe("Someone/CON_.epub");
    expect(target(file("b.epub", "nul", "AUX"))).toBe("AUX_/nul_.epub");
    expect(target(file("c.epub", "Aux. Notes", "Someone", inSeries("COM1", null)))).toBe("Someone/COM1_/Aux_. Notes.epub");
    // Only the device names: a title that starts like one, or has a number before it, is left alone.
    expect(target(file("d.epub", "Console Wars", "COM10"))).toBe("COM10/Console Wars.epub");
    expect(target(file("e.epub", "Con", "Someone", inSeries("Air", 1)))).toBe("Someone/Air/01 - Con.epub");
  });

  it("makes only names the renaming accepts, whatever a file claims to be", () => {
    const nasty = [
      "a<b>c:d\"e/f\\g|h?i*j",
      "..\\..\\escape",
      "../../escape",
      "..",
      ".",
      "C:\\Windows\\System32",
      "/etc/passwd",
      "\\\\server\\share",
      "   ",
      "...",
      "-",
      ":",
      "LPT1.txt",
      "prn",
      "name\u0007with\u009fcontrol",
      "trailing space ",
      "trailing dot.",
      " leading space",
      "📚".repeat(300),
      "書".repeat(300),
      "x".repeat(600)
    ];
    for (const title of nasty) {
      for (const author of [null, ...nasty]) {
        const to = target(file("in.epub", title, author, inSeries(author ?? title, 3)));
        const parts = to.split("/");
        expect(parts.length, to).toBeGreaterThanOrEqual(2);
        expect(parts.length, to).toBeLessThanOrEqual(3);
        for (const part of parts) {
          expect(legal(part), `${JSON.stringify(title)} by ${JSON.stringify(author)} gave ${JSON.stringify(to)}`).toBe(true);
        }
        expect(to.endsWith(".epub")).toBe(true);
      }
    }
  });
});

describe("long names", () => {
  const longTitle = "A Very Long Title That Goes On ".repeat(12).trim();
  const longAuthor = "Someone With A Great Many Names ".repeat(6).trim();
  const longSeries = "The Chronicles Of A Series With A Long Name ".repeat(4).trim();

  it("cuts a long name and keeps the number and the extension", () => {
    const to = target(file("a.epub", longTitle, longAuthor, inSeries(longSeries, 7)));
    const [author, series, name] = to.split("/");
    expect(author.length).toBeLessThanOrEqual(60);
    expect(series.length).toBeLessThanOrEqual(60);
    expect(name.length).toBeLessThanOrEqual(120 + ".epub".length);
    expect(name.startsWith("07 - A Very Long Title")).toBe(true);
    expect(name.endsWith(".epub")).toBe(true);
    expect(author.startsWith("Someone With A Great Many Names")).toBe(true);
  });

  it("keeps the whole path within what Windows apps open", () => {
    for (const folderLength of [8, 60, 120, 160, 180, 189]) {
      const done = planTidy([file("a.epub", longTitle, longAuthor, inSeries(longSeries, 7))], folderLength);
      const to = done.moves[0].to;
      // The folder, a separator, the path, and room for " (200)".
      expect(folderLength + 1 + to.length + 6, `${folderLength}: ${to}`).toBeLessThanOrEqual(259);
      expect(to.split("/").every(legal), to).toBe(true);
      // The title is what survives: the folders give way first.
      expect(to.split("/")[2].startsWith("07 - A Very Long Title")).toBe(true);
    }
  });

  it("gives the folders' names up before the title in a deep folder", () => {
    const roomy = planTidy([file("a.epub", longTitle, longAuthor, inSeries(longSeries, 7))], 60).moves[0].to.split("/");
    const deep = planTidy([file("b.epub", longTitle, longAuthor, inSeries(longSeries, 7))], 185).moves[0].to.split("/");
    expect(deep[0].length).toBeLessThan(roomy[0].length);
    expect(deep[0].length).toBeGreaterThanOrEqual(16 - 1);
    expect(deep[1].length).toBeGreaterThanOrEqual(16 - 1);
    expect(deep[2].length).toBeGreaterThanOrEqual(24 - 1);
  });

  it("still names a file in a folder too deep for any name to fit", () => {
    // Nothing fits; the least is asked for, and the renaming refuses a path too long.
    const to = planTidy([file("a.epub", longTitle, longAuthor, inSeries(longSeries, 7))], 400).moves[0].to;
    expect(to.split("/").every(legal)).toBe(true);
    expect(to.length).toBeLessThan(80);
  });

  it("never cuts inside a character", () => {
    const to = target(file("a.epub", "📚".repeat(300), "e\u0301".repeat(100), inSeries("書".repeat(300), 1)));
    const [author, series, name] = to.split("/");
    expect(author.length).toBeLessThanOrEqual(60);
    // Three bytes a character: the byte limit is the one reached.
    expect(new TextEncoder().encode(series).length).toBeLessThanOrEqual(200);
    expect(new TextEncoder().encode(name.replace(/\.epub$/, "")).length).toBeLessThanOrEqual(200);
    // A cut inside an emoji leaves half of one, which is not text.
    expect(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(to)).toBe(false);
    expect(/^01 - (📚)+\.epub$/u.test(name)).toBe(true);
  });
});

describe("files already in the folder", () => {
  it("leaves a file that is where it belongs out of the moves", () => {
    const files = [
      file("Frank Herbert/Dune.epub", "Dune", "Frank Herbert"),
      file("James S. A. Corey/The Expanse/01 - Leviathan Wakes.epub", "Leviathan Wakes", "James S. A. Corey", inSeries("The Expanse", 1)),
      file("emma.epub", "Emma", "Jane Austen")
    ];
    const done = plan(files);
    expect(done.moves).toEqual([{ from: "emma.epub", to: "Jane Austen/Emma.epub" }]);
    expect(done.inPlace).toBe(2);
    expect(done.duplicates).toEqual([]);
  });

  it("has nothing left to do once it has been carried out", () => {
    const files = [
      file("a.epub", "Dune", "Frank Herbert"),
      file("b.epub", "Dune", "Frank Herbert"),
      file("c.epub", "Dune", "frank herbert"),
      file("d.epub", "Leviathan Wakes", "James S. A. Corey", inSeries("The Expanse", 1)),
      file("e.epub", "Caliban's War", "James S. A. Corey", inSeries("the expanse", 2)),
      file("f.pdf", "Dune", "Frank Herbert"),
      { ...file("g.epub", "Dune", "Frank Herbert"), hash: "same" },
      { ...file("h.epub", "Dune", "Frank Herbert"), hash: "same" }
    ];
    const first = plan(files);
    expect(first.moves.length + first.inPlace + first.duplicates.length).toBe(files.length);

    const second = plan(carriedOut(files, first));
    expect(second.moves).toEqual([]);
    expect(second.inPlace).toBe(files.length - 1);
    expect(second.duplicates.length).toBe(1);
  });

  it("reads a path with either slash", () => {
    const done = plan([file("Frank Herbert\\Dune.epub", "Dune", "Frank Herbert"), file("sub\\emma.epub", "Emma", "Jane Austen")]);
    expect(done.inPlace).toBe(1);
    expect(done.moves).toEqual([{ from: "sub/emma.epub", to: "Jane Austen/Emma.epub" }]);
  });

  it("renames a file whose name is right but for its capitals", () => {
    const done = plan([file("Frank Herbert/dune.EPUB", "Dune", "Frank Herbert")]);
    expect(done.moves).toEqual([{ from: "Frank Herbert/dune.EPUB", to: "Frank Herbert/Dune.epub" }]);
  });

  it("uses a folder as it is already spelt", () => {
    // Windows takes "frank herbert" and "Frank Herbert" for one folder.
    const done = plan([
      file("frank herbert/Dune.epub", "Dune", "Frank Herbert"),
      file("messiah.epub", "Dune Messiah", "Frank Herbert"),
      file("lw.epub", "Leviathan Wakes", "James S. A. Corey", inSeries("The Expanse", 1)),
      file("cw.epub", "Caliban's War", "James S. A. Corey", inSeries("the expanse", 2))
    ]);
    expect(done.inPlace).toBe(1);
    expect(done.moves.map((move) => move.to)).toEqual([
      "James S. A. Corey/the expanse/02 - Caliban's War.epub",
      "James S. A. Corey/the expanse/01 - Leviathan Wakes.epub",
      "frank herbert/Dune Messiah.epub"
    ]);
  });
});

describe("the same book twice", () => {
  it("leaves a second file with the same contents where it is", () => {
    const first = file("Dune (z-library).epub", "Dune", "Frank Herbert");
    const second = { ...file("old/dune copy.epub", "Dune", "Frank Herbert"), hash: first.hash };
    const third = { ...file("zzz/again.epub", "Dune", "Frank Herbert"), hash: first.hash };
    const done = plan([third, second, first]);
    expect(done.moves).toEqual([{ from: "Dune (z-library).epub", to: "Frank Herbert/Dune.epub" }]);
    expect(done.duplicates).toEqual([
      { path: "old/dune copy.epub", sameAs: "Dune (z-library).epub" },
      { path: "zzz/again.epub", sameAs: "Dune (z-library).epub" }
    ]);
    expect(done.inPlace).toBe(0);
  });

  it("takes the one already in place for the book, not for the copy", () => {
    const messy = file("Dune (z-library).epub", "Dune", "Frank Herbert");
    const tidy = { ...file("Frank Herbert/Dune.epub", "Dune", "Frank Herbert"), hash: messy.hash };
    const done = plan([messy, tidy]);
    expect(done.moves).toEqual([]);
    expect(done.inPlace).toBe(1);
    expect(done.duplicates).toEqual([{ path: "Dune (z-library).epub", sameAs: "Frank Herbert/Dune.epub" }]);
  });

  it("does not take two files with no hash for one book", () => {
    const done = plan([{ ...file("a.epub", "Dune", "Frank Herbert"), hash: "" }, { ...file("b.epub", "Emma", "Jane Austen"), hash: "" }]);
    expect(done.moves.length).toBe(2);
    expect(done.duplicates).toEqual([]);
  });
});

describe("two books that want one name", () => {
  it("numbers the later ones", () => {
    expect(
      targets([
        file("a.epub", "Dune", "Frank Herbert"),
        file("b.epub", "Dune", "Frank Herbert"),
        file("c.epub", "DUNE", "frank herbert"),
        // Another kind of file is another name.
        file("d.pdf", "Dune", "Frank Herbert")
      ])
    ).toEqual(["Frank Herbert/Dune.epub", "Frank Herbert/Dune (2).epub", "Frank Herbert/DUNE (3).epub", "Frank Herbert/Dune.pdf"]);
  });

  it("does not plan a file into a name that is in use", () => {
    const done = plan([file("Frank Herbert/Dune.epub", "Dune (first edition)", "Frank Herbert"), file("new.epub", "Dune", "Frank Herbert")]);
    // The file there now is itself moving, but its name is not given away in the same run.
    expect(done.moves).toEqual([
      { from: "Frank Herbert/Dune.epub", to: "Frank Herbert/Dune (first edition).epub" },
      { from: "new.epub", to: "Frank Herbert/Dune (2).epub" }
    ]);
  });

  it("keeps clear of a file the scan could not read", () => {
    const done = plan([file("new.epub", "Dune", "Frank Herbert")], ["frank herbert\\DUNE.epub"]);
    expect(done.moves).toEqual([{ from: "new.epub", to: "frank herbert/Dune (2).epub" }]);
  });

  it("lets a numbered file keep its number while the plain name is another book's", () => {
    const done = plan([file("Frank Herbert/Dune.epub", "Dune", "Frank Herbert"), file("Frank Herbert/Dune (2).epub", "Dune", "Frank Herbert")]);
    expect(done.moves).toEqual([]);
    expect(done.inPlace).toBe(2);
    // And gives it the plain name once that is free.
    expect(targets([file("Frank Herbert/Dune (2).epub", "Dune", "Frank Herbert")])).toEqual(["Frank Herbert/Dune.epub"]);
  });
});
