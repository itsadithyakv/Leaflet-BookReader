import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  knowsBook,
  ownPage,
  ownWords,
  pageFor,
  pageParams,
  pageSummary,
  searchParams,
  searchTitles,
  siteName,
  siteParams,
  titlesFrom,
  titlesParams,
  wikiApi,
  wikiGuesses,
  wikiHost,
  type WikiParams,
  type WikiSite,
  type WikiSummary
} from "../readers/people/wiki";

/**
 * A book's fan wiki, asked what it says of a name (readers/people/wiki.ts
 * has what is asked and what is made of the answers).
 *
 * This is the one part of "Characters" that goes online, and it only does so
 * when the reader asks for a wiki's summary. What is sent: the wiki's name,
 * guessed from the book's series or title, and the name asked about. Not the
 * book, not the page, no account.
 *
 * In the app the question goes through Rust (`wiki_ask`), which lets nothing
 * but the read-only API of a Fandom wiki, or of one it names, through. The browser preview has no
 * backend and asks the wiki itself.
 */

export type WikiFailureKind = "refused" | "offline" | "missing" | "unavailable";

export class WikiFailure extends Error {
  readonly kind: WikiFailureKind;

  constructor(kind: WikiFailureKind, message: string) {
    super(message);
    this.name = "WikiFailure";
    this.kind = kind;
  }
}

const toFailure = (cause: unknown): WikiFailure => {
  if (cause instanceof WikiFailure) {
    return cause;
  }
  const given = cause as { kind?: unknown; message?: unknown } | null;
  const kind = given?.kind;
  if (kind === "refused" || kind === "offline" || kind === "missing" || kind === "unavailable") {
    return new WikiFailure(kind, typeof given?.message === "string" ? given.message : "The wiki could not be asked.");
  }
  return new WikiFailure("offline", "Couldn't reach the wiki. Check your connection and try again.");
};

const ask = async (host: string, params: WikiParams): Promise<string> => {
  if (!wikiHost(host)) {
    throw new WikiFailure("refused", "That is not a wiki's address.");
  }
  try {
    if (isTauri()) {
      return await invoke<string>("wiki_ask", { host, params });
    }
    const query = new URLSearchParams([...params, ["format", "json"], ["origin", "*"]]);
    const response = await fetch(`https://${host}${wikiApi(host)}?${query}`, { credentials: "omit" });
    if (response.status === 404 || response.status === 410) {
      throw new WikiFailure("missing", "There is no wiki at that address.");
    }
    if (!response.ok) {
      throw new WikiFailure("unavailable", "The wiki didn't answer as expected. Try again in a moment.");
    }
    return await response.text();
  } catch (cause) {
    throw toFailure(cause);
  }
};

// ---- Which wiki a book has ---------------------------------------------------

/**
 * A book's wiki as chosen or found; `none` when it has none (looked for at
 * `at`, or said by the reader). `v` is the way of looking that found it.
 */
type Kept = { host: string; name: string; chosen?: boolean; v?: number } | { none: true; at: number; chosen?: boolean; v?: number };

/**
 * Raised when the looking gets better at it: what an older way found (or did
 * not find) is then looked for again, once. What the reader chose is never
 * looked for again. 2: a series' own wiki is asked before one on Fandom.
 */
const LOOKING = 2;

const KEY = (bookId: string) => `leaflet.wiki.${bookId}`;
/** A wiki not found is looked for again after this long: wikis are made, and connections fail. */
const LOOK_AGAIN_MS = 7 * 24 * 60 * 60 * 1000;
const CHANGED = "leaflet:wiki-site";

const kept = (bookId: string): Kept | null => {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY(bookId)) ?? "null") as Kept | null;
    if (parsed && "host" in parsed && typeof parsed.host === "string" && wikiHost(parsed.host) === parsed.host) {
      return parsed;
    }
    return parsed && "none" in parsed ? parsed : null;
  } catch {
    return null;
  }
};

const keep = (bookId: string, value: Kept | null) => {
  try {
    if (value) {
      localStorage.setItem(KEY(bookId), JSON.stringify(value));
    } else {
      localStorage.removeItem(KEY(bookId));
    }
  } catch {
    // Storage that cannot be written: it is found again next time.
  }
  window.dispatchEvent(new Event(CHANGED));
};

type BookLike = { id: string; title: string; author?: string | null; series?: string | null };

/** A wiki's own words (`wikiService.words`), kept by its address. */
const WORDS_KEY = (host: string) => `leaflet.wikiWords.${host}`;
/** Read again after this long: pages are written. */
const WORDS_FOR_MS = 30 * 24 * 60 * 60 * 1000;
/** As many page names as are read of one wiki: forty requests. */
const MOST_TITLES = 20_000;
const ownWordsOf = new Map<string, ReadonlyMap<string, string>>();
const readingWords = new Map<string, Promise<ReadonlyMap<string, string>>>();

const savedWords = (host: string): ReadonlyMap<string, string> | null => {
  try {
    const saved = JSON.parse(localStorage.getItem(WORDS_KEY(host)) ?? "null") as { at?: unknown; words?: unknown } | null;
    if (!saved || typeof saved.at !== "number" || Date.now() - saved.at > WORDS_FOR_MS || !Array.isArray(saved.words)) {
      return null;
    }
    return new Map(saved.words.filter((pair): pair is [string, string] => Array.isArray(pair) && typeof pair[0] === "string" && typeof pair[1] === "string"));
  } catch {
    return null;
  }
};

const finding = new Map<string, Promise<WikiSite | null>>();
const summaries = new Map<string, Promise<WikiSummary | null>>();

/** Whether the wiki at `host` exists, and what it calls itself. */
const siteAt = async (host: string): Promise<WikiSite | null> => {
  try {
    const name = siteName(await ask(host, siteParams()));
    return name ? { host, name } : null;
  } catch (cause) {
    if (toFailure(cause).kind === "missing") {
      return null;
    }
    throw cause;
  }
};

/** Whether the wiki has a page for the book, its series or its author. */
const about = async (host: string, book: BookLike): Promise<boolean> => {
  for (const name of [book.author, book.series, book.title]) {
    if (name && name.trim().length >= 3 && knowsBook(searchTitles(await ask(host, searchParams(name.trim().slice(0, 80)))), book)) {
      return true;
    }
  }
  return false;
};

export const wikiService = {
  /** Fired on `window` when a book's wiki is chosen, found or forgotten. */
  CHANGED,

  /** The book's wiki as last chosen or found, without asking anyone. `undefined`: not looked for yet. */
  known(bookId: string): WikiSite | null | undefined {
    const value = kept(bookId);
    if (!value || (!value.chosen && (value.v ?? 1) < LOOKING)) {
      return undefined;
    }
    if ("host" in value) {
      return { host: value.host, name: value.name };
    }
    return value.chosen || Date.now() - value.at < LOOK_AGAIN_MS ? null : undefined;
  },

  /**
   * The book's wiki: the one the reader chose, else one found by the book's
   * series or title and checked to be about it. Null when it has none.
   * Throws a `WikiFailure` when the wikis could not be asked.
   */
  siteFor(book: BookLike): Promise<WikiSite | null> {
    const known = wikiService.known(book.id);
    if (known !== undefined) {
      return Promise.resolve(known);
    }
    const running = finding.get(book.id);
    if (running) {
      return running;
    }
    const search = (async () => {
      for (const host of wikiGuesses(book)) {
        const site = await siteAt(host);
        if (site && (await about(host, book))) {
          keep(book.id, { ...site, v: LOOKING });
          return site;
        }
      }
      keep(book.id, { none: true, at: Date.now(), v: LOOKING });
      return null;
    })().finally(() => finding.delete(book.id));
    finding.set(book.id, search);
    return search;
  },

  /**
   * The reader names the book's wiki (an address, or just its name). Null
   * when there is no such wiki. Throws a `WikiFailure` when it could not be
   * asked, or the address is not one of Fandom's.
   */
  async choose(bookId: string, typed: string): Promise<WikiSite | null> {
    const host = wikiHost(typed);
    if (!host) {
      throw new WikiFailure("refused", "A wiki on fandom.com (mistborn.fandom.com), or coppermind.net.");
    }
    const site = await siteAt(host);
    if (site) {
      keep(bookId, { ...site, chosen: true });
    }
    return site;
  },

  /** The reader says the book has no wiki (`true`), or that it should be looked for again. */
  forget(bookId: string, none = false) {
    keep(bookId, none ? { none: true, at: Date.now(), chosen: true } : null);
  },

  /**
   * The wiki's own words: the single words it has a page for, small, each
   * with its page (readers/people/wiki.ts: `ownWords`). What lets the reader
   * tell a word the book made up from a word, with nothing asked about any
   * word: the names of the wiki's pages are fetched once, five hundred to a
   * request, and kept on this device for a month. A wiki of more than
   * `MOST_TITLES` pages is read that far and no further.
   */
  words(host: string): Promise<ReadonlyMap<string, string>> {
    const ready = ownWordsOf.get(host);
    if (ready) {
      return Promise.resolve(ready);
    }
    const running = readingWords.get(host);
    if (running) {
      return running;
    }
    const reading = (async () => {
      const saved = savedWords(host);
      if (saved) {
        ownWordsOf.set(host, saved);
        return saved;
      }
      const words = new Map<string, string>();
      let from: string | null = null;
      for (let lot = 0; lot < MOST_TITLES / 500; lot += 1) {
        const { titles, next } = titlesFrom(await ask(host, titlesParams(from)));
        ownWords(titles).forEach(([word, page]) => words.set(word, page));
        if (!next || titles.length === 0) {
          break;
        }
        from = next;
      }
      ownWordsOf.set(host, words);
      try {
        localStorage.setItem(WORDS_KEY(host), JSON.stringify({ at: Date.now(), words: [...words] }));
      } catch {
        // Not kept (storage full, or none): read again the next time the app starts.
      }
      return words;
    })().finally(() => readingWords.delete(host));
    readingWords.set(host, reading);
    return reading;
  },

  /**
   * The wiki's page for a word of the book as the book writes it, small
   * ("shelldry", "obligators"), when the wiki's words have been read
   * (`words`) and it has one. Asks no one.
   */
  ownPage(host: string, key: string): string | null {
    const words = ownWordsOf.get(host);
    return words ? ownPage(words, key) : null;
  },

  /**
   * What the wiki says of a name: the opening of its page. Null when the
   * wiki has no page by that name. Kept for the session.
   */
  summary(host: string, term: string): Promise<WikiSummary | null> {
    const key = `${host}|${term.trim().toLowerCase()}`;
    const known = summaries.get(key);
    if (known) {
      return known;
    }
    const answer = (async () => {
      const name = term.trim().slice(0, 80);
      // The page of that very name first: the wiki follows its own redirects
      // ("Lord Ruler" is kept under another title), which a search of titles does not.
      const direct = pageSummary(await ask(host, pageParams(name)), host);
      if (direct) {
        return direct;
      }
      const title = pageFor(name, searchTitles(await ask(host, searchParams(name))));
      return title && title !== name ? pageSummary(await ask(host, pageParams(title)), host) : null;
    })();
    summaries.set(key, answer);
    // A failure is asked again; an answer (and "no such page") is kept.
    answer.catch(() => {
      if (summaries.get(key) === answer) {
        summaries.delete(key);
      }
    });
    if (summaries.size > 200) {
      summaries.delete(summaries.keys().next().value as string);
    }
    return answer;
  }
};
