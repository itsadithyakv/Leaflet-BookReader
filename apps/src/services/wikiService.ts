import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  knowsBook,
  pageFor,
  pageParams,
  pageSummary,
  searchParams,
  searchTitles,
  siteName,
  siteParams,
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
 * but a Fandom wiki's read-only API through. The browser preview has no
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
    const response = await fetch(`https://${host}/api.php?${query}`, { credentials: "omit" });
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

/** A book's wiki as chosen or found; `none` when it has none (looked for at `at`, or said by the reader). */
type Kept = { host: string; name: string; chosen?: boolean } | { none: true; at: number; chosen?: boolean };

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
    if (!value) {
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
          keep(book.id, site);
          return site;
        }
      }
      keep(book.id, { none: true, at: Date.now() });
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
      throw new WikiFailure("refused", "Wikis on fandom.com only, for now: mistborn.fandom.com");
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
