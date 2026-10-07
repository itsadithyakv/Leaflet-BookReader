import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { UiIcon } from "../../components/UiIcon";
import { accountService } from "../../services/accountService";
import { WikiFailure, wikiService } from "../../services/wikiService";
import "../lookupCard.css";
import "./people.css";
import type { MentionSearch } from "./bookText";
import type { Mention } from "./mentions";
import { castAt, type Entry, type Order, type PersonView, type Place } from "./model";
import { namesOf, whoIs } from "./names";
import type { WikiMode } from "./peoplePrefs";
import type { HoverAsk } from "./termHover";
import { pickTerm, type TermSummary } from "./terms";
import type { WikiSite, WikiSummary } from "./wiki";

type TermPeekProps = {
  ask: HoverAsk;
  /** The place being read when the pointer came to rest: the furthest point on screen. */
  here: Place;
  book: { id: string; title: string; author?: string | null; series?: string | null };
  entries: Entry[];
  order: Order;
  search: MentionSearch | null;
  chapterOf: (section: number) => string | null;
  wiki: WikiMode;
  /** The pointer is on the peek (true), or has left it. */
  onKeep: (on: boolean) => void;
  /** The full card: for someone on the sheet, or for the name. */
  onMore: (name: string, person: string | null) => void;
  onJump: (cfi: string) => void;
  onClose: () => void;
};

type Answer =
  | { status: "searching" }
  /** Not a name the book uses, or the place cannot be told: nothing is shown. */
  | { status: "none" }
  | { status: "found"; name: string; person: PersonView | null; summary: TermSummary };

type WikiState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; site: WikiSite | null; summary: WikiSummary | null }
  | { status: "failed"; message: string };

const count = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const GAP = 10;
const EDGE = 8;
/** A search that takes longer than this shows that it is looking. */
const SLOW_MS = 450;

/**
 * What the book has said of the name the pointer is resting on, as far as
 * the reader has got: the line that introduces it (or failing one, where it
 * first came up), how often it has come up since, and the reader's own note
 * if they wrote one. Nothing from after the place being read.
 *
 * Below it, when the reader asks: the opening of the name's page on the
 * book's fan wiki, which was written by people who finished the book and
 * says so.
 *
 * It is a glance, not a dialog: it takes no focus, holds nothing up, and
 * goes when the pointer does. "More" opens the card.
 */
export const TermPeek = ({ ask, here, book, entries, order, search, chapterOf, wiki, onKeep, onMore, onJump, onClose }: TermPeekProps) => {
  const [answer, setAnswer] = useState<Answer>({ status: "searching" });
  const [slow, setSlow] = useState(false);
  const [fromWiki, setFromWiki] = useState<WikiState>({ status: "idle" });
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  const node = useRef<HTMLDivElement | null>(null);

  const cast = useMemo(() => castAt(entries, here, order), [entries, here, order]);

  // What the book has said of it.
  useEffect(() => {
    setAnswer({ status: "searching" });
    setSlow(false);
    setFromWiki({ status: "idle" });
    if (!search) {
      setAnswer({ status: "none" });
      return undefined;
    }
    const stop = new AbortController();
    const slowly = window.setTimeout(() => setSlow(true), SLOW_MS);
    const names = namesOf(cast);
    void (async () => {
      // Someone the reader has written down: theirs, under every name learned so far.
      for (const candidate of ask.candidates) {
        const id = whoIs(names, candidate.text);
        const person = id ? cast.people.find((item) => item.id === id) ?? null : null;
        if (id && person) {
          const summary = await search.about(names, id, here, { signal: stop.signal });
          return summary ? ({ status: "found", name: person.name, person, summary } as Answer) : ({ status: "none" } as Answer);
        }
      }
      // A name of the book's own: the longest of those under the pointer that it really uses.
      const summaries: Array<TermSummary | null> = [];
      for (const candidate of ask.candidates) {
        summaries.push(
          await search.about([{ text: candidate.text, person: "?", exact: true }], "?", here, {
            signal: stop.signal,
            small: /\s/.test(candidate.text) ? null : candidate.text.toLocaleLowerCase()
          })
        );
      }
      const chosen = pickTerm(
        summaries.map((summary) => (summary?.named ? summary.count : 0)),
        ask.candidates.map((candidate) => Boolean(candidate.titled))
      );
      const summary = chosen >= 0 ? summaries[chosen] : null;
      return summary ? ({ status: "found", name: ask.candidates[chosen].text, person: null, summary } as Answer) : ({ status: "none" } as Answer);
    })().then(
      (next) => {
        if (!stop.signal.aborted) {
          setAnswer(next);
        }
      },
      () => {
        if (!stop.signal.aborted) {
          setAnswer({ status: "none" });
        }
      }
    );
    return () => {
      stop.abort();
      window.clearTimeout(slowly);
    };
    // `here` and the cast are the peek's own, fixed while it shows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask.key, search]);

  const found = answer.status === "found" ? answer : null;
  const name = found?.name ?? null;

  const askWiki = useCallback(() => {
    if (!name) {
      return;
    }
    setFromWiki({ status: "loading" });
    wikiService
      .siteFor(book)
      .then(async (site) => ({ site, summary: site ? await wikiService.summary(site.host, name) : null }))
      .then(
        (done) => setFromWiki({ status: "done", ...done }),
        (cause) => setFromWiki({ status: "failed", message: cause instanceof WikiFailure ? cause.message : "The wiki could not be asked." })
      );
    // The book is the reader's for as long as the peek shows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, book.id]);

  // "Show the wiki's summary straight away" (Settings): asked for with the peek.
  useEffect(() => {
    if (wiki === "auto" && name) {
      askWiki();
    }
  }, [wiki, name, askWiki]);

  // Nothing to say: the pointer was on a word, not a name.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (answer.status === "none") {
      closeRef.current();
    }
  }, [answer.status]);

  // Above the name, or below it when there is no room; inside the window.
  const showing = Boolean(found) || (answer.status === "searching" && slow);
  useLayoutEffect(() => {
    const element = node.current;
    if (!element || !showing) {
      setPlace(null);
      return;
    }
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    const centre = (ask.box.left + ask.box.right) / 2;
    const left = Math.round(Math.min(Math.max(centre - width / 2, EDGE), Math.max(EDGE, window.innerWidth - width - EDGE)));
    const above = ask.box.top - GAP - height;
    const below = ask.box.bottom + GAP;
    const top = above >= EDGE || below + height > window.innerHeight - EDGE ? Math.max(EDGE, above) : below;
    setPlace((before) => (before && before.left === left && before.top === Math.round(top) ? before : { left, top: Math.round(top) }));
  }, [showing, answer, fromWiki, ask.box.left, ask.box.right, ask.box.top, ask.box.bottom]);

  if (!showing) {
    return null;
  }

  const jump = (mention: Mention) => {
    void search?.cfiOf(mention).then((cfi) => {
      if (cfi) {
        onJump(cfi);
      }
    });
  };

  const summary = found?.summary ?? null;
  const person = found?.person ?? null;
  const about = summary?.about ?? null;
  const kind = person ? "Character" : summary?.kind === "person" ? "In this book · a person" : summary?.kind === "place" ? "In this book · a place" : "In this book";
  const lastNote = person && person.notes.length > 0 ? person.notes[person.notes.length - 1] : null;

  return (
    <div
      ref={node}
      className="reader-term-peek reader-panel reader-border"
      role="group"
      aria-label={name ? `About ${name}` : "Looking back through the book"}
      style={place ? { left: place.left, top: place.top } : { left: 0, top: 0, visibility: "hidden" }}
      onPointerEnter={() => onKeep(true)}
      onPointerLeave={() => onKeep(false)}
    >
      {!found && (
        <p className="reader-term-peek-wait reader-muted" role="status">
          Looking back through the book…
        </p>
      )}

      {found && summary && (
        <>
          <div className="reader-term-peek-head">
            <span className="reader-lookup-kicker reader-muted">{kind}</span>
            <span className="reader-term-peek-name reader-text-color">
              {found.name}
              {person?.group && (
                <span className="reader-people-group reader-muted">
                  <span className="reader-people-dot" data-color={person.color ?? undefined} aria-hidden="true" />
                  {person.group}
                </span>
              )}
            </span>
          </div>

          {lastNote && (
            <p className="reader-term-peek-note">
              <span className="reader-term-peek-label reader-muted">Your note</span>
              {lastNote.text}
            </p>
          )}

          {about ? (
            <button type="button" className="reader-term-peek-line" onClick={() => jump(about)} title="Go to this place in the book">
              <span className="reader-term-peek-label reader-muted">
                {summary.described ? "The book says" : "First appears"} · {chapterOf(about.section) ?? "earlier"}
              </span>
              <span className="reader-term-peek-quote">
                {about.before}
                <mark>{about.match}</mark>
                {about.after}
              </span>
            </button>
          ) : (
            <p className="reader-term-peek-wait reader-muted">Not mentioned before this page.</p>
          )}

          {fromWiki.status !== "idle" && (
            <div className="reader-term-peek-wiki" aria-live="polite">
              <span className="reader-term-peek-label reader-muted">
                From the wiki · may spoil
                {fromWiki.status === "done" && fromWiki.site ? ` · ${fromWiki.site.name}` : ""}
              </span>
              {fromWiki.status === "loading" && <p className="reader-muted">Asking the wiki…</p>}
              {fromWiki.status === "failed" && <p className="reader-muted">{fromWiki.message}</p>}
              {fromWiki.status === "done" && !fromWiki.site && (
                <p className="reader-muted">No wiki found for this book.</p>
              )}
              {fromWiki.status === "done" && fromWiki.site && !fromWiki.summary && (
                <p className="reader-muted">
                  {fromWiki.site.name} has no page called “{found.name}”.
                </p>
              )}
              {fromWiki.status === "done" && fromWiki.summary && (
                <>
                  <p>{fromWiki.summary.extract}</p>
                  <button type="button" className="reader-lookup-inline" onClick={() => void accountService.openLink(fromWiki.summary!.url).catch(() => undefined)}>
                    Read on {fromWiki.site?.name ?? "the wiki"}
                    <UiIcon name="external" size={11} className="ml-1 inline-block align-[-1px]" />
                  </button>
                </>
              )}
            </div>
          )}

          <div className="reader-term-peek-foot">
            <span className="reader-muted">
              {count(summary.count, "mention", "mentions")}
              {summary.sections > 1 ? ` in ${summary.sections} chapters` : ""} so far
            </span>
            <span className="reader-term-peek-actions">
              {wiki !== "off" && fromWiki.status === "idle" && (
                <button type="button" className="reader-notes-action" onClick={askWiki} title="Fetches this name's page from the book's fan wiki. It may give away what happens later.">
                  Wiki
                </button>
              )}
              <button type="button" className="reader-notes-action is-primary" onClick={() => onMore(found.name, person?.id ?? null)}>
                More
              </button>
            </span>
          </div>
        </>
      )}
    </div>
  );
};
