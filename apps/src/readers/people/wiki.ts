/**
 * A book's fan wiki: which wiki it is, which page a name has there, and the
 * opening of that page as plain text. The asking is done by
 * `services/wikiService.ts` (through Rust in the app: `src-tauri/src/wiki.rs`);
 * here is only what to ask for and what to make of the answers.
 *
 * Fandom's wikis, and the few others named in `OTHER_WIKIS` (a series' own
 * wiki is sometimes the only one worth asking). They run MediaWiki, whose
 * API has no "summary" to give (Wikipedia's `extracts` is not installed there, and Fandom's own
 * article API sits behind a browser check), so the opening section is asked
 * for as HTML and read down to its first paragraphs here.
 *
 * Unlike everything else in this folder, what comes back was written by
 * people who have finished the book. It is shown only when the reader asks,
 * and says so.
 *
 * Pure: strings in, strings out.
 */

/** Fandom's domain: any wiki there may be asked. */
export const WIKI_SUFFIX = ".fandom.com";

/**
 * Wikis that are not Fandom's, each with where its API is. The Mistborn wiki
 * on Fandom has two hundred pages and nothing on the game the nobles play;
 * the Coppermind, the wiki of everything its writer has written, has five
 * thousand. The same list is in Rust (`src-tauri/src/wiki.rs`), which is what
 * decides: an address not on both is never called.
 */
export const OTHER_WIKIS: ReadonlyArray<{ host: string; api: string; name: string }> = [
  { host: "coppermind.net", api: "/w/api.php", name: "coppermind" },
  // A Wiki of Ice and Fire, and the Discworld's.
  { host: "awoiaf.westeros.org", api: "/api.php", name: "awoiaf" },
  { host: "wiki.lspace.org", api: "/api.php", name: "lspace" }
];

/** Where a wiki's API is. */
export const wikiApi = (host: string) => OTHER_WIKIS.find((wiki) => wiki.host === host)?.api ?? "/api.php";

/** As much of a page's opening as the peek has room for. */
export const MAX_SUMMARY = 520;

export type WikiParams = Array<[string, string]>;

export type WikiSite = {
  /** `mistborn.fandom.com`. */
  host: string;
  /** "Mistborn Wiki". */
  name: string;
};

export type WikiSummary = {
  /** The page's own title, which may not be the name asked about ("Vin" for "Vin Venture"). */
  title: string;
  /** Its opening, as plain text. */
  extract: string;
  url: string;
};

/** A wiki's address as typed or pasted, down to its host; null when it is not one of Fandom's or of `OTHER_WIKIS`. */
export const wikiHost = (typed: string): string | null => {
  const host = typed
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[/?#].*$/, "");
  // Its address, with or without "www."; or just its name ("coppermind").
  const other = OTHER_WIKIS.find((wiki) => wiki.host === host || `www.${wiki.host}` === host || wiki.name === host);
  if (other) {
    return other.host;
  }
  const label = host.endsWith(WIKI_SUFFIX) ? host.slice(0, -WIKI_SUFFIX.length) : /^[a-z0-9-]+$/.test(host) ? host : null;
  if (!label || !/^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/.test(label)) {
    return null;
  }
  return `${label}${WIKI_SUFFIX}`;
};

/** Words that say a name is a series without being part of it. */
const SERIES_WORDS = /\b(?:the|a|an|series|saga|trilogy|duology|quartet|cycle|chronicles?|novels?|books?|collection|boxed set|box set|omnibus|complete)\b/g;

const slugs = (name: string): string[] => {
  const words = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    // A subtitle, and anything in brackets: "Dune (40th Anniversary Edition)".
    .replace(/[([].*$/, "")
    .replace(/\s*[:–—].*$/, "")
    .replace(/[’']/g, "")
    .replace(SERIES_WORDS, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  if (words.length === 0 || words.length > 5) {
    return [];
  }
  const joined = words.join("");
  const hyphened = words.join("-");
  return joined.length >= 3 && joined.length <= 40 ? [...new Set([joined, hyphened])] : [];
};

/**
 * Wikis that are not named as their series is: the series (as `hintKey`
 * makes it) and the wiki's name on Fandom. Hints, not facts: each is asked
 * whether it exists and knows the book before it is used, like any guess,
 * so one that has moved or was never right costs a request and nothing else.
 */
const HINTS: Array<[string, string[]]> = [
  ["song of ice and fire", ["awoiaf.westeros.org", "iceandfire", "gameofthrones"]],
  ["game of thrones", ["awoiaf.westeros.org", "iceandfire", "gameofthrones"]],
  ...["clash of kings", "storm of swords", "feast for crows", "dance with dragons", "fire and blood", "knight of the seven kingdoms"].map(
    (name): [string, string[]] => [name, ["awoiaf.westeros.org", "iceandfire"]]
  ),
  ["discworld", ["wiki.lspace.org"]],
  ["lord of the rings", ["lotr"]],
  ["hobbit", ["lotr"]],
  ["silmarillion", ["lotr"]],
  ["wheel of time", ["wot"]],
  ["stormlight archive", ["stormlightarchive"]],
  ["hunger games", ["thehungergames"]],
  ["witcher", ["witcher"]],
  ["kingkiller chronicle", ["kingkiller"]],
  ["percy jackson", ["riordan"]],
  ["heroes of olympus", ["riordan"]],
  ["chronicles of narnia", ["narnia"]],
  ["malazan book of the fallen", ["malazan"]],
  ["twilight", ["twilightsaga"]],
  ["sherlock holmes", ["bakerstreet"]],
  ["foundation", ["asimov"]],
  ["inheritance cycle", ["inheritance"]],
  ["hitchhikers guide to the galaxy", ["hitchhikers"]],
  ["series of unfortunate events", ["snicket"]],
  ["mortal instruments", ["shadowhunters"]],
  ["infernal devices", ["shadowhunters"]],
  ["harry potter", ["harrypotter"]],
  // One writer's books, which share a wiki of their own (a full address, not a name on Fandom).
  ...[
    "mistborn", "final empire", "well of ascension", "hero of ages", "alloy of law", "shadows of self", "bands of mourning", "lost metal",
    "wax and wayne", "stormlight archive", "way of kings", "words of radiance", "oathbringer", "rhythm of war", "wind and truth",
    "edgedancer", "dawnshard", "elantris", "warbreaker", "emperors soul", "arcanum unbounded", "tress of the emerald sea",
    "yumi and the nightmare painter", "sunlit man", "skyward", "starsight", "cytonic", "defiant", "steelheart", "firefight", "calamity",
    "reckoners", "rithmatist"
  ].map((name): [string, string[]] => [name, ["coppermind.net"]])
];

/** A series or a title as the hints name it: small, without articles, punctuation or what follows a colon. */
const hintKey = (name: string) =>
  name
    .toLowerCase()
    .replace(/\s*[:([–—].*$/, "")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/^(?:the|a|an)\s+/, "")
    .trim();

/**
 * The wikis a book may have, the likeliest first: one known for its series,
 * then one named for the series ("Mistborn"), then for the book itself
 * ("Dune"). Guesses: each is asked whether it exists, and whether it knows
 * the book (`knowsBook`).
 */
export const wikiGuesses = (book: { title: string; series?: string | null }): string[] => {
  const out: string[] = [];
  const add = (slug: string) => {
    // A name on Fandom, or a whole address.
    const host = slug.includes(".") ? slug : `${slug}${WIKI_SUFFIX}`;
    if (!out.includes(host)) {
      out.push(host);
    }
  };
  const names = [book.series ?? "", book.title];
  // A wiki of the books' own before one on Fandom, whichever name says so.
  const hinted: string[] = [];
  for (const name of names) {
    const key = hintKey(name);
    for (const [series, wikis] of HINTS) {
      // The series itself, or a book named for it ("Harry Potter and the...").
      if (key === series || key.startsWith(`${series} `)) {
        hinted.push(...wikis);
      }
    }
  }
  [...hinted.filter((wiki) => wiki.includes(".")), ...hinted.filter((wiki) => !wiki.includes("."))].forEach(add);
  for (const name of names) {
    slugs(name).forEach(add);
  }
  return out.slice(0, 5);
};

// ---- What to ask ------------------------------------------------------------

/** What the wiki calls itself. */
export const siteParams = (): WikiParams => [
  ["action", "query"],
  ["meta", "siteinfo"],
  ["siprop", "general"]
];

/** Pages whose names start like this. */
export const searchParams = (term: string): WikiParams => [
  ["action", "opensearch"],
  ["search", term],
  ["limit", "6"],
  ["namespace", "0"]
];

/** A page's opening section. */
export const pageParams = (title: string): WikiParams => [
  ["action", "parse"],
  ["page", title],
  ["prop", "text"],
  ["section", "0"],
  ["redirects", "1"],
  ["disableeditsection", "1"],
  ["disabletoc", "1"]
];

/**
 * The names of a wiki's pages, five hundred at a time, from `from` on (what
 * the answer before said comes next). Redirects too: a thing the book has a
 * word for is often kept under a longer name ("obligator" under the ministry
 * it serves), and the word is the redirect.
 */
export const titlesParams = (from: string | null = null): WikiParams => [
  ["action", "query"],
  ["list", "allpages"],
  ["aplimit", "500"],
  ["apnamespace", "0"],
  ...(from ? ([["apcontinue", from.slice(0, 200)]] as WikiParams) : [])
];

// ---- What to make of the answers ---------------------------------------------

const parse = (json: string): unknown => {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
};

/** The wiki's name, from its answer to `siteParams`; null when that is not what came back. */
export const siteName = (json: string): string | null => {
  const general = (parse(json) as { query?: { general?: { sitename?: unknown } } } | null)?.query?.general;
  return typeof general?.sitename === "string" && general.sitename.trim() ? general.sitename.trim() : null;
};

const plain = (text: string) =>
  text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, " ")
    .trim();

/** The titles found, from the answer to `searchParams`. */
export const searchTitles = (json: string): string[] => {
  const answer = parse(json);
  const titles = Array.isArray(answer) ? answer[1] : null;
  return Array.isArray(titles) ? titles.filter((title): title is string => typeof title === "string" && title.length > 0) : [];
};

/**
 * The page for a name among the titles found: the one named exactly that,
 * else one that starts with it as whole words ("Vin" finds "Vin Venture",
 * not "Vineyard"). Null when none fits: a wrong page's summary is worse than
 * none.
 */
export const pageFor = (term: string, titles: string[]): string | null => {
  const wanted = plain(term);
  if (!wanted) {
    return null;
  }
  const exact = titles.find((title) => plain(title) === wanted);
  if (exact) {
    return exact;
  }
  // "Kelsier (Mistborn)": the name, told apart from another's.
  return titles.find((title) => plain(title.replace(/\s*\([^)]*\)\s*$/, "")) === wanted) ?? titles.find((title) => plain(title).startsWith(`${wanted} `)) ?? null;
};

/**
 * Whether a wiki is about this book: it has a page named for the book, its
 * series or its author. A wiki that merely shares a word with the title
 * (`alchemist.fandom.com` is a game's) has none of them.
 */
export const knowsBook = (titles: string[], book: { title: string; series?: string | null; author?: string | null }): boolean => {
  const have = titles.map(plain);
  const names = [book.title.replace(/\s*[:([–—].*$/, ""), book.series ?? "", book.author ?? ""].map(plain).filter((name) => name.length >= 3);
  return names.some((name) => have.some((title) => title === name || title.startsWith(`${name} `) || title === `the ${name}`));
};

/** The page names in an answer to `titlesParams`, and where the next lot starts (null at the end). */
export const titlesFrom = (json: string): { titles: string[]; next: string | null } => {
  const answer = parse(json) as { query?: { allpages?: unknown }; continue?: { apcontinue?: unknown } } | null;
  const pages = Array.isArray(answer?.query?.allpages) ? (answer.query.allpages as Array<{ title?: unknown }>) : [];
  const next = answer?.continue?.apcontinue;
  return {
    titles: pages.map((page) => page?.title).filter((title): title is string => typeof title === "string" && title.length > 0),
    next: typeof next === "string" && next ? next : null
  };
};

/** A word of the wiki's own is at least this long: "skaa", "atium". */
const OWN_WORD_LETTERS = 4;

/**
 * The single words among a wiki's page names, small, each with the page it
 * is: what tells "shelldry" (a game the book made up, which it writes small
 * and twice) from a word. A name told apart from another's in brackets
 * ("Iron (metal)") is its word; a name of several words is not one, and is
 * written with capitals in the book anyway.
 */
export const ownWords = (titles: readonly string[]): Array<[string, string]> => {
  const words = new Map<string, string>();
  for (const title of titles) {
    const word = title.replace(/\s*\([^)]*\)\s*$/, "").trim();
    if (/^\p{L}+$/u.test(word) && word.length >= OWN_WORD_LETTERS) {
      const key = word.toLocaleLowerCase();
      // The page named exactly so before one told apart in brackets.
      if (!words.has(key) || title === word) {
        words.set(key, title);
      }
    }
  }
  return [...words];
};

/**
 * The wiki's page for a word of the book, small as the book writes it: the
 * word, or the one it is the plural of ("obligators"). Null for a word the
 * wiki has no page for, which is nearly every word.
 */
export const ownPage = (words: ReadonlyMap<string, string>, key: string): string | null => {
  if (key.length < OWN_WORD_LETTERS) {
    return null;
  }
  const forms = [key];
  if (key.endsWith("ies")) {
    forms.push(`${key.slice(0, -3)}y`);
  }
  if (key.endsWith("es")) {
    forms.push(key.slice(0, -2));
  }
  if (key.endsWith("s")) {
    forms.push(key.slice(0, -1));
  }
  for (const form of forms) {
    const page = form.length >= OWN_WORD_LETTERS ? words.get(form) : undefined;
    if (page) {
      return page;
    }
  }
  return null;
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”" };
const decode = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const point = code[1].toLowerCase() === "x" ? Number.parseInt(code.slice(2), 16) : Number(code.slice(1));
      try {
        return Number.isFinite(point) && point > 31 ? String.fromCodePoint(point) : " ";
      } catch {
        return " ";
      }
    }
    return ENTITIES[code.toLowerCase()] ?? " ";
  });

/** Boxes that are not the article: infoboxes, notices, pictures, quotations set off at the top. */
const BOXES = ["table", "aside", "figure", "script", "style", "noscript", "dl", "blockquote", "ul", "ol"];

const withoutBoxes = (html: string) => {
  let rest = html.replace(/<!--[\s\S]*?-->/g, "");
  for (const tag of BOXES) {
    // Innermost first, until none is left: they nest.
    const inner = new RegExp(`<${tag}\\b[^>]*>(?:(?!<${tag}\\b)[\\s\\S])*?</${tag}\\s*>`, "gi");
    for (let pass = 0; pass < 20; pass += 1) {
      const next = rest.replace(inner, " ");
      if (next === rest) {
        break;
      }
      rest = next;
    }
  }
  return rest.replace(/<sup\b[\s\S]*?<\/sup\s*>/gi, "");
};

/**
 * A page's opening as plain text, from the HTML of its first section: its
 * first paragraphs, up to `MAX_SUMMARY`, ending at a sentence. Empty when
 * the section has no prose (a list page, a redirect's stub).
 *
 * Text only ever leaves here: every tag is dropped, nothing is ever put into
 * the page as HTML.
 */
export const summaryFrom = (html: string, limit = MAX_SUMMARY): string => {
  const paragraphs: string[] = [];
  for (const match of withoutBoxes(html).matchAll(/<p\b[^>]*>([\s\S]*?)<\/p\s*>/gi)) {
    const text = decode(match[1].replace(/<[^>]*>/g, ""))
      .replace(/\s+/g, " ")
      .replace(/\s+([,.;:!?])/g, "$1")
      .trim();
    // A caption, a "main article" pointer, a lone quotation's credit.
    if (text.length >= 40) {
      paragraphs.push(text);
    }
    if (paragraphs.join(" ").length >= limit * 0.6) {
      break;
    }
  }
  const whole = paragraphs.join(" ");
  if (whole.length <= limit) {
    return whole;
  }
  const cut = whole.slice(0, limit);
  const ends = [...cut.matchAll(/[.!?]["”’)]?(?=\s)/g)];
  const last = ends[ends.length - 1];
  if (last && last.index + last[0].length >= limit * 0.5) {
    return cut.slice(0, last.index + last[0].length);
  }
  return `${cut.replace(/\s+\S*$/, "")}…`;
};

/** The summary, from the answer to `pageParams`; null when there is no such page or it says nothing. */
export const pageSummary = (json: string, host: string): WikiSummary | null => {
  const page = (parse(json) as { parse?: { title?: unknown; text?: unknown } } | null)?.parse;
  const title = typeof page?.title === "string" ? page.title : null;
  const text = page?.text as { "*"?: unknown } | string | undefined;
  const html = typeof text === "string" ? text : typeof text?.["*"] === "string" ? (text["*"] as string) : null;
  if (!title || !html) {
    return null;
  }
  const extract = summaryFrom(html);
  if (!extract) {
    return null;
  }
  return { title, extract, url: `https://${host}/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}` };
};
