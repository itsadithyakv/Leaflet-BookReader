import { describe, expect, it } from "vitest";
import { knowsBook, ownPage, ownWords, pageFor, pageParams, pageSummary, searchTitles, siteName, summaryFrom, titlesFrom, titlesParams, wikiApi, wikiGuesses, wikiHost } from "./wiki";

describe("a wiki's address", () => {
  it("is taken as typed, pasted or just named", () => {
    expect(wikiHost("mistborn.fandom.com")).toBe("mistborn.fandom.com");
    expect(wikiHost("  https://Mistborn.fandom.com/wiki/Vin?so=search ")).toBe("mistborn.fandom.com");
    expect(wikiHost("red-rising")).toBe("red-rising.fandom.com");
  });

  it("is only ever one of Fandom's, or a wiki named here", () => {
    for (const typed of ["", "example.com", "mistborn.fandom.com.evil.example", "evil.example/mistborn.fandom.com", "a.b.fandom.com", "-x.fandom.com", "x-.fandom.com", "coppermind.org", "evil.coppermind.net", "coppermind.net.evil.example", "fandom.com"]) {
      expect(wikiHost(typed), typed).toBeNull();
    }
    for (const typed of ["coppermind.net", "https://coppermind.net/wiki/Shelldry", "www.coppermind.net", "Coppermind"]) {
      expect(wikiHost(typed), typed).toBe("coppermind.net");
    }
    expect([wikiHost("awoiaf"), wikiHost("https://awoiaf.westeros.org/index.php/Jon_Snow"), wikiHost("lspace")]).toEqual([
      "awoiaf.westeros.org",
      "awoiaf.westeros.org",
      "wiki.lspace.org"
    ]);
    // A wiki's first label is not its name: "wiki" is a wiki on Fandom, if anything.
    expect(wikiHost("wiki")).toBe("wiki.fandom.com");
    expect([wikiApi("coppermind.net"), wikiApi("mistborn.fandom.com")]).toEqual(["/w/api.php", "/api.php"]);
  });
});

describe("the wikis a book may have", () => {
  it("are named for its series first, then for the book", () => {
    expect(wikiGuesses({ title: "The Night Ferry", series: "Saltmarsh" })).toEqual([
      "saltmarsh.fandom.com",
      "nightferry.fandom.com",
      "night-ferry.fandom.com"
    ]);
    expect(wikiGuesses({ title: "Dune" })).toEqual(["dune.fandom.com"]);
  });

  it("start with a wiki of the books' own, by the series or by the book alone", () => {
    expect(wikiGuesses({ title: "The Final Empire", series: "Mistborn" })).toEqual([
      "coppermind.net",
      "mistborn.fandom.com",
      "finalempire.fandom.com",
      "final-empire.fandom.com"
    ]);
    // No series stored: the title says whose it is.
    expect(wikiGuesses({ title: "The Final Empire" })[0]).toBe("coppermind.net");
    // Before the series' wiki on Fandom, which is the smaller.
    expect(wikiGuesses({ title: "Oathbringer", series: "The Stormlight Archive" }).slice(0, 2)).toEqual(["coppermind.net", "stormlightarchive.fandom.com"]);
  });

  it("are tried joined and hyphenated", () => {
    expect(wikiGuesses({ title: "Golden Son", series: "Red Rising Saga" })).toEqual([
      "redrising.fandom.com",
      "red-rising.fandom.com",
      "goldenson.fandom.com",
      "golden-son.fandom.com"
    ]);
  });

  it("leave out a subtitle, an edition and what only says it is a series", () => {
    expect(wikiGuesses({ title: "Dune (40th Anniversary Edition)" })).toEqual(["dune.fandom.com"]);
    expect(wikiGuesses({ title: "Project Hail Mary: A Novel" })).toEqual(["projecthailmary.fandom.com", "project-hail-mary.fandom.com"]);
    expect(wikiGuesses({ title: "Harry Potter and the Order of the Phoenix", series: "Harry Potter" })[0]).toBe("harrypotter.fandom.com");
  });

  it("start with the wiki a series is known to have, where that is not named as the series is", () => {
    expect(wikiGuesses({ title: "A Game of Thrones", series: "A Song of Ice and Fire" }).slice(0, 3)).toEqual([
      "awoiaf.westeros.org",
      "iceandfire.fandom.com",
      "gameofthrones.fandom.com"
    ]);
    expect(wikiGuesses({ title: "Game of Thrones Boxed Set: A Game of Thrones, a Clash of Kings, a Storm of Swords, and a Feast for Crows" })).toEqual([
      "awoiaf.westeros.org",
      "iceandfire.fandom.com",
      "gameofthrones.fandom.com",
      "game-of-thrones.fandom.com"
    ]);
    expect(wikiGuesses({ title: "A Storm of Swords" })[0]).toBe("awoiaf.westeros.org");
    expect(wikiGuesses({ title: "Mort", series: "Discworld" })[0]).toBe("wiki.lspace.org");
    expect(wikiGuesses({ title: "The Eye of the World", series: "The Wheel of Time" })[0]).toBe("wot.fandom.com");
    // A book named for its series, with none stated.
    expect(wikiGuesses({ title: "Harry Potter and the Half-Blood Prince" })[0]).toBe("harrypotter.fandom.com");
    expect(wikiGuesses({ title: "The Hobbit" })).toEqual(["lotr.fandom.com", "hobbit.fandom.com"]);
  });

  it("are none for a title that is no name for a wiki", () => {
    expect(wikiGuesses({ title: "It" })).toEqual([]);
    expect(wikiGuesses({ title: "The Curious Incident of the Dog in the Night-Time and Other Stories" })).toEqual([]);
  });
});

describe("what a wiki answers", () => {
  it("says what it is called", () => {
    expect(siteName('{"query":{"general":{"sitename":"Mistborn Wiki","lang":"en"}}}')).toBe("Mistborn Wiki");
    expect(siteName("<!DOCTYPE html><title>Just a moment...</title>")).toBeNull();
    expect(siteName('{"error":{"code":"readapidenied"}}')).toBeNull();
  });

  it("lists the pages a search found", () => {
    expect(searchTitles('["Vin",["Vin","Characters","Reen"],["","",""],["u1","u2","u3"]]')).toEqual(["Vin", "Characters", "Reen"]);
    expect(searchTitles('["Nobody",[],[],[]]')).toEqual([]);
    expect(searchTitles("not json")).toEqual([]);
  });
});

describe("a wiki's own words", () => {
  const answer = JSON.stringify({
    continue: { apcontinue: "Bob_(Skyward)" },
    query: { allpages: [{ title: "Shelldry" }, { title: "Skaa" }, { title: "Iron (metal)" }, { title: "Iron" }, { title: "Lord Ruler" }, { title: "Obligator" }, { title: "Tin" }, { title: "17th Shard" }, {}] }
  });

  it("are asked for five hundred page names at a time", () => {
    expect(Object.fromEntries(titlesParams())).toEqual({ action: "query", list: "allpages", aplimit: "500", apnamespace: "0" });
    expect(Object.fromEntries(titlesParams("Bob_(Skyward)")).apcontinue).toBe("Bob_(Skyward)");
    const { titles, next } = titlesFrom(answer);
    expect([titles.length, next]).toEqual([8, "Bob_(Skyward)"]);
    expect(titlesFrom(JSON.stringify({ query: { allpages: [{ title: "Zane" }] } }))).toEqual({ titles: ["Zane"], next: null });
    expect(titlesFrom("<html>not an answer</html>")).toEqual({ titles: [], next: null });
  });

  it("are its single-word pages, small, each with its page", () => {
    const words = new Map(ownWords(titlesFrom(answer).titles));
    // A name of several words, a short one and one with a figure in it are not words of its own.
    expect([...words.keys()].sort()).toEqual(["iron", "obligator", "shelldry", "skaa"]);
    // The page named exactly so, not the one told apart in brackets.
    expect(words.get("iron")).toBe("Iron");
  });

  it("give the page for a word as the book writes it, or its plural", () => {
    const words = new Map(ownWords(["Shelldry", "Obligator", "Skaa", "Canton", "Ministry"]));
    expect(ownPage(words, "shelldry")).toBe("Shelldry");
    expect(ownPage(words, "obligators")).toBe("Obligator");
    expect(ownPage(words, "ministries")).toBe("Ministry");
    expect(ownPage(words, "tomorrow")).toBeNull();
    // Too short to be told from a word by its ending.
    expect(ownPage(new Map([["ska", "Ska"]]), "skas")).toBeNull();
  });
});

describe("the page for a name", () => {
  it("is the one named exactly that, however it is cased or quoted", () => {
    expect(pageFor("Order of the Phoenix", ["Order of the Phoenix (film)", "Order of the Phoenix"])).toBe("Order of the Phoenix");
    expect(pageFor("lord ruler", ["Lord Ruler"])).toBe("Lord Ruler");
    expect(pageFor("Muad’Dib", ["Muad'Dib"])).toBe("Muad'Dib");
  });

  it("is one told apart in brackets, or a fuller name", () => {
    expect(pageFor("Kelsier", ["Kelsier (Mistborn)", "Kelsier's crew"])).toBe("Kelsier (Mistborn)");
    expect(pageFor("Vin", ["Vineyard", "Vin Venture"])).toBe("Vin Venture");
  });

  it("is none when nothing found is that name", () => {
    expect(pageFor("Vin", ["Vineyard", "Characters"])).toBeNull();
    expect(pageFor("Vin", [])).toBeNull();
  });
});

describe("a wiki that is about the book", () => {
  const book = { title: "The Final Empire", series: "Mistborn", author: "Brandon Sanderson" };

  it("has a page for the book, its series or its author", () => {
    expect(knowsBook(["Brandon Sanderson"], book)).toBe(true);
    expect(knowsBook(["Mistborn (series)", "Mistborn: The Final Empire"], book)).toBe(true);
    expect(knowsBook(["The Final Empire"], book)).toBe(true);
  });

  it("is not one that only shares a word with it", () => {
    expect(knowsBook(["Alchemist (class)", "Alchemy"], { title: "The Alchemist", author: "Paulo Coelho" })).toBe(false);
    expect(knowsBook([], book)).toBe(false);
  });
});

describe("a page's opening", () => {
  const HTML = `<div class="mw-parser-output">
    <table class="notice" id="spoiler"><tbody><tr><td><p>Warning! This article contains spoilers for the whole of the series, read on at your own risk.</p></td></tr></tbody></table>
    <aside class="portable-infobox"><h2>Order of the Phoenix</h2><div><p>Founded by Albus Dumbledore in the nineteen seventies, in secret.</p></div></aside>
    <figure><img src="x.png" onerror="alert(1)"><figcaption><p>The Order, photographed together in the first war against them.</p></figcaption></figure>
    <dl><dd><i>"We're the Order." — Someone, saying a long quotation that is not the article at all</i></dd></dl>
    <p><br /></p>
    <p>The <b>Order of the Phoenix</b> was a secret society founded by <a href="/wiki/Albus_Dumbledore" title="Albus Dumbledore">Albus Dumbledore</a> to oppose Lord Voldemort and his Death&nbsp;Eaters.<sup id="cite_ref-1" class="reference"><a href="#cite_note-1">[1]</a></sup> The original Order was created in the 1970s.</p>
    <p>The Order worked with the Ministry &amp; others to oppose him , and played a part in the first war.</p>
    <script>alert("x")</script>
  </div>`;

  it("is its first paragraphs as plain text, without boxes, pictures, notes or scripts", () => {
    const text = summaryFrom(HTML);
    expect(text).toBe(
      "The Order of the Phoenix was a secret society founded by Albus Dumbledore to oppose Lord Voldemort and his Death Eaters. The original Order was created in the 1970s. The Order worked with the Ministry & others to oppose him, and played a part in the first war."
    );
    expect(text).not.toMatch(/[<>]|spoilers|photographed|alert|\[1\]/);
  });

  it("stops at the end of a sentence when it is long", () => {
    const long = `<p>${"This is one sentence of the opening of the page. ".repeat(30)}</p>`;
    const text = summaryFrom(long, 200);
    expect(text.length).toBeLessThanOrEqual(200);
    expect(text.endsWith("page.")).toBe(true);
  });

  it("is cut at a whole word when no sentence ends in time", () => {
    const text = summaryFrom(`<p>${"word ".repeat(200)}</p>`, 100);
    expect(text.endsWith("word…")).toBe(true);
    expect(text.length).toBeLessThanOrEqual(101);
  });

  it("is empty for a page with no prose", () => {
    expect(summaryFrom("<ul><li>Vin</li><li>Kelsier</li></ul><p>See also.</p>")).toBe("");
    expect(summaryFrom("")).toBe("");
  });

  it("comes with the page's own title and its address", () => {
    const answer = JSON.stringify({ parse: { title: "Vin Venture", text: { "*": "<p>Vin is the main protagonist of the Mistborn trilogy, a thief from the streets.</p>" } } });
    expect(pageSummary(answer, "mistborn.fandom.com")).toEqual({
      title: "Vin Venture",
      extract: "Vin is the main protagonist of the Mistborn trilogy, a thief from the streets.",
      url: "https://mistborn.fandom.com/wiki/Vin_Venture"
    });
  });

  it("is nothing for a page that is not there", () => {
    expect(pageSummary('{"error":{"code":"missingtitle","info":"The page you specified doesn\'t exist."}}', "mistborn.fandom.com")).toBeNull();
    expect(pageSummary("<!DOCTYPE html>", "mistborn.fandom.com")).toBeNull();
  });

  it("asks for the opening section only", () => {
    expect(pageParams("Vin")).toContainEqual(["section", "0"]);
  });
});
