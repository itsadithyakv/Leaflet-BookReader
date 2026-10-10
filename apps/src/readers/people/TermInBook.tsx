import { useCallback, useEffect, useState } from "react";
import { UiIcon } from "../../components/UiIcon";
import { accountService } from "../../services/accountService";
import { WikiFailure, wikiService } from "../../services/wikiService";
import "../lookupCard.css";
import type { MentionSearch } from "./bookText";
import type { Place } from "./model";
import type { WikiMode } from "./peoplePrefs";
import type { TermSummary } from "./terms";
import type { WikiSite, WikiSummary } from "./wiki";

type TermInBookProps = {
  /** The word or name looked up, as selected. */
  term: string;
  /** The place being read: nothing after it is read. */
  here: Place;
  book: { id: string; title: string; author?: string | null; series?: string | null };
  search: MentionSearch;
  chapterOf: (section: number) => string | null;
  wiki: WikiMode;
  onJump: (cfi: string) => void;
};

type WikiState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; site: WikiSite | null; summary: WikiSummary | null }
  | { status: "failed"; message: string };

/**
 * What a word means in this book, for the look-up card when no dictionary
 * knows it: "shelldry" is a game one novel made up, and Wiktionary has
 * nothing to say of it. The book has: the line it came into the book on (or
 * the one that says what it is), and how often it has been used so far.
 * Under that, the book's fan wiki on it, which was written by people who
 * finished the book and says so; asked for at once where the reader has
 * chosen that (Settings), on a press otherwise.
 *
 * Every use of the word so far is read, however it is written: a word looked
 * up was asked about, and is not held to the rules that tell a name from a
 * word under a resting pointer (`terms.ts`). Nothing after the place being
 * read is ever read.
 *
 * Draws nothing when the book has not used the word and no wiki is asked:
 * the card then says that nothing was found, as it did.
 */
export const TermInBook = ({ term, here, book, search, chapterOf, wiki, onJump }: TermInBookProps) => {
  // The place as it was when the word was looked up: the card is about that.
  const [at] = useState(here);
  const [summary, setSummary] = useState<TermSummary | null | undefined>(undefined);
  const [fromWiki, setFromWiki] = useState<WikiState>({ status: "idle" });

  useEffect(() => {
    const stop = new AbortController();
    setSummary(undefined);
    setFromWiki({ status: "idle" });
    search.about([{ text: term, person: "?", exact: false }], "?", at, { signal: stop.signal }).then(
      (found) => !stop.signal.aborted && setSummary(found && found.count > 0 ? found : null),
      () => !stop.signal.aborted && setSummary(null)
    );
    return () => stop.abort();
  }, [term, search, at]);

  const askWiki = useCallback(() => {
    setFromWiki({ status: "loading" });
    wikiService
      .siteFor(book)
      .then(async (site) => ({ site, summary: site ? await wikiService.summary(site.host, term) : null }))
      .then(
        (done) => setFromWiki({ status: "done", ...done }),
        (cause) => setFromWiki({ status: "failed", message: cause instanceof WikiFailure ? cause.message : "The wiki could not be asked." })
      );
    // The book is the reader's for as long as the card shows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term, book.id]);

  // "Show the wiki's summary straight away" (Settings): asked for with the look-up.
  useEffect(() => {
    if (wiki === "auto") {
      askWiki();
    }
  }, [wiki, askWiki]);

  const about = summary?.about ?? null;
  const said = fromWiki.status === "done" ? fromWiki.summary : null;
  // Nothing in the book, and the wiki has nothing or was not asked: the card says nothing was found.
  const nothing = summary === null && (wiki === "off" || (fromWiki.status === "done" && !said));
  if (summary === undefined || nothing) {
    return null;
  }

  const jump = () => {
    if (about) {
      void search.cfiOf(about).then((cfi) => cfi && onJump(cfi));
    }
  };

  return (
    <section className="reader-lookup-section" aria-label="In this book">
      <div className="reader-lookup-section-head">
        <h3 className="reader-lookup-label">In this book</h3>
        {summary && (
          <span className="reader-lookup-source reader-muted">
            {summary.count.toLocaleString()} {summary.count === 1 ? "mention" : "mentions"} so far
          </span>
        )}
      </div>
      {summary && about ? (
        <>
          <div className="reader-lookup-description reader-muted">
            {summary.described ? "The book says" : "First appears"} · {chapterOf(about.section) ?? "earlier"}
          </div>
          <p className="reader-lookup-text">
            {about.before}
            <mark>{about.match}</mark>
            {about.after}
          </p>
          <button type="button" className="reader-lookup-more" onClick={jump} title="Go to this place in the book">
            Go to it
          </button>
        </>
      ) : (
        <p className="reader-lookup-text reader-muted">Not used before this page.</p>
      )}

      {wiki === "ask" && fromWiki.status === "idle" && (
        <div className="mt-3">
          <button
            type="button"
            className="reader-notes-action"
            onClick={askWiki}
            title="Fetches this word's page from the book's fan wiki. It may give away what happens later."
          >
            Ask the book's wiki
          </button>
        </div>
      )}
      {fromWiki.status !== "idle" && (
        <div className="mt-3" aria-live="polite">
          <div className="reader-lookup-description reader-muted">
            From the wiki · may spoil
            {fromWiki.status === "done" && fromWiki.site ? ` · ${fromWiki.site.name}` : ""}
          </div>
          {fromWiki.status === "loading" && <p className="reader-lookup-text reader-muted">Asking the wiki…</p>}
          {fromWiki.status === "failed" && <p className="reader-lookup-text reader-muted">{fromWiki.message}</p>}
          {fromWiki.status === "done" && !fromWiki.site && <p className="reader-lookup-text reader-muted">No wiki found for this book.</p>}
          {fromWiki.status === "done" && fromWiki.site && !said && (
            <p className="reader-lookup-text reader-muted">
              {fromWiki.site.name} has no page called “{term}”.
            </p>
          )}
          {said && (
            <>
              <p className="reader-lookup-text">{said.extract}</p>
              <button type="button" className="reader-lookup-more" onClick={() => void accountService.openLink(said.url).catch(() => undefined)}>
                Read on {fromWiki.status === "done" ? (fromWiki.site?.name ?? "the wiki") : "the wiki"}
                <UiIcon name="external" size={12} />
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
};
