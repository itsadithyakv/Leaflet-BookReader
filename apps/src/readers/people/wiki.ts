/**
 * A book's fan wiki: which wiki it is, which page a name has there, and the
 * opening of that page as plain text. The asking is done by
 * `services/wikiService.ts` (through Rust in the app: `src-tauri/src/wiki.rs`);
 * here is only what to ask for and what to make of the answers.
 *
 * Fandom's wikis only. They run MediaWiki, whose API has no "summary" to
 * give (Wikipedia's `extracts` is not installed there, and Fandom's own
 * article API sits behind a browser check), so the opening section is asked
 * for as HTML and read down to its first paragraphs here.
 *
 * Unlike everything else in this folder, what comes back was written by
 * people who have finished the book. It is shown only when the reader asks,
 * and says so.
 *
 * Pure: strings in, strings out.
 */

/** Fandom's domain: the only place asked. */
export const WIKI_SUFFIX = ".fandom.com";

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

/** A wiki's address as typed or pasted, down to its host; null when it is not one of Fandom's. */
export const wikiHost = (typed: string): string | null => {
  const host = typed
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[/?#].*$/, "");
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
  ["song of ice and fire", ["iceandfire", "gameofthrones"]],
  ["game of thrones", ["iceandfire", "gameofthrones"]],
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
  ["harry potter", ["harrypotter"]]
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
    const host = `${slug}${WIKI_SUFFIX}`;
    if (!out.includes(host)) {
      out.push(host);
    }
  };
  const names = [book.series ?? "", book.title];
  for (const name of names) {
    const key = hintKey(name);
    for (const [series, wikis] of HINTS) {
      // The series itself, or a book named for it ("Harry Potter and the...").
      if (key === series || key.startsWith(`${series} `)) {
        wikis.forEach(add);
      }
    }
  }
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
