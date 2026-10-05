import { describe, expect, it } from "vitest";
import { genreMood } from "./genre";

describe("what a book's genres put Pip in the mood for", () => {
  it("knows horror however it is filed, a thriller included", () => {
    for (const genre of ["Horror", "horror fiction", "Gothic", "Thriller", "Gothic fiction", "Ghost stories", "Psychological thrillers", "HORROR TALES", "Suspense"]) {
      expect(genreMood([genre])).toBe("horror");
    }
  });

  it("knows a mystery", () => {
    for (const genre of ["Mystery", "Detective", "Crime", "Detective and mystery stories", "Mystery & Detective", "Whodunit", "Noir", "Historical mystery"]) {
      expect(genreMood([genre])).toBe("mystery");
    }
  });

  it("knows fantasy", () => {
    for (const genre of ["Fantasy", "Epic fantasy", "Fantasy fiction", "Urban Fantasy", "Sword and sorcery", "Fairy tales", "Dragons", "High-fantasy"]) {
      expect(genreMood([genre])).toBe("fantasy");
    }
  });

  it("knows the two that came cheap", () => {
    for (const genre of ["Science fiction", "Sci-Fi", "scifi", "Space opera", "Cyberpunk", "Dystopian"]) expect(genreMood([genre])).toBe("scifi");
    for (const genre of ["Romance", "Love stories", "Romantic comedy", "Regency romance"]) expect(genreMood([genre])).toBe("romance");
  });

  it("is nothing for a book that is none of them, or has no genres", () => {
    for (const genres of [[], ["Fiction"], ["History"], ["Biography & Autobiography"], ["Cooking"], ["Magical realism"], ["Crimea"], ["Literary"], [""], ["  "]]) {
      expect(genreMood(genres)).toBeNull();
    }
    expect(genreMood(null)).toBeNull();
    expect(genreMood(undefined)).toBeNull();
    // Whatever a hand-edited library holds.
    expect(genreMood([4, null, { name: "Horror" }] as unknown[])).toBeNull();
  });

  it("takes the genre listed first, and a plain one over a thriller's hint", () => {
    expect(genreMood(["Fiction", "Fantasy", "Romance"])).toBe("fantasy");
    expect(genreMood(["Romance", "Fantasy"])).toBe("romance");
    // "Thriller" only hints at horror: a mystery listed after it still claims the book.
    expect(genreMood(["Thriller", "Mystery"])).toBe("mystery");
    expect(genreMood(["Crime thriller"])).toBe("mystery");
    expect(genreMood(["Thrillers", "Fiction"])).toBe("horror");
    // One string that says two things: the darker reading wins.
    expect(genreMood(["Gothic mystery"])).toBe("horror");
    expect(genreMood(["Dark fantasy"])).toBe("fantasy");
    expect(genreMood(["Science fantasy"])).toBe("fantasy");
    expect(genreMood(["Paranormal romance"])).toBe("romance");
  });
});
