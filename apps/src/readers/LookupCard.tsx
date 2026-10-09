import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement
} from "react";
import { UiIcon } from "../components/UiIcon";
import { accountService } from "../services/accountService";
import {
  LOOKUP_REFUSAL,
  LookupFailure,
  lookupService,
  lookupTerm,
  webSearchUrl,
  type LookupEntry,
  type LookupMeaning,
  type LookupResult,
  type LookupSummary
} from "../services/lookupService";
import { wordService } from "../services/wordService";
import { CARD_GAP, CARD_HEIGHT, placeCard, type Box, type CardPlace } from "./lookupPlacement";
import { keepLookup, type LookupPlace } from "./words/keep";
import type { SavedWord } from "./words/rows";
import "./lookupCard.css";

type LookupCardProps = {
  /** The selected text, as selected. */
  term: string;
  /** The book's language ("en", "fr-FR"), which decides whose words and whose Wikipedia. */
  language?: string | null;
  onClose: () => void;
  /** Where the selected text is in the window, so the card can keep off it. */
  avoid?: () => Box | null;
  /**
   * The book and the place the selection is at. With it, a word that gets an
   * answer is kept for "My words" and the quiz (unless the reader has turned
   * that off in Settings); without it nothing is kept.
   */
  place?: LookupPlace | null;
};

type State =
  | { status: "loading" }
  | { status: "refused" }
  | { status: "failed"; failure: LookupFailure }
  | { status: "done"; result: LookupResult };

const SOURCE_NAMES = { wiktionary: "Wiktionary", wikipedia: "Wikipedia" } as const;

const Entries = ({ entries }: { entries: LookupEntry[] }) => (
  <>
    {entries.map((entry, index) => (
      <div key={`${entry.partOfSpeech}-${index}`} className="reader-lookup-entry">
        <div className="reader-lookup-part reader-muted">{entry.partOfSpeech}</div>
        <ol className="reader-lookup-definitions">
          {entry.definitions.map((definition, at) => (
            <li key={at}>{definition}</li>
          ))}
        </ol>
      </div>
    ))}
  </>
);

/**
 * A selected word or name, looked up: its meaning from Wiktionary and a short
 * summary from Wikipedia, whichever suits the selection first. Opens from the
 * selection bar and sits above it, in the bar's own dock.
 *
 * Only the selected words are sent, and only because the reader pressed Look
 * up; the "i" at the foot says so when it is pressed. (The note used to be
 * open the first time the card was used, which read as small print stuck to
 * the answer.)
 *
 * A word that gets an answer is kept, with the meaning shown and the place
 * (readers/words/): the card says so, and can take it back.
 *
 * A dialog: focus moves in and stays in, and Escape or a click anywhere else
 * closes it and puts focus back where it was.
 */
export const LookupCard = ({ term, language, onClose, avoid, place: wordPlace }: LookupCardProps) => {
  const shown = lookupTerm(term);
  const [state, setState] = useState<State>({ status: shown ? "loading" : "refused" });
  const [attempt, setAttempt] = useState(0);
  const [place, setPlace] = useState<CardPlace>({ height: CARD_HEIGHT, lift: CARD_GAP, shift: 0 });
  // What looking up sends: behind the "i", until it is pressed.
  const [noteOpen, setNoteOpen] = useState(false);
  const [linkFailed, setLinkFailed] = useState(false);
  // The word as it was kept, and whether the reader then took it back.
  const [kept, setKept] = useState<SavedWord | null>(null);
  const [unkept, setUnkept] = useState(false);
  const wordPlaceRef = useRef(wordPlace);
  wordPlaceRef.current = wordPlace;
  /** The term already counted, so "Try again" is not a second look-up of it. */
  const countedRef = useRef<string | null>(null);
  const card = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const avoidRef = useRef(avoid);
  avoidRef.current = avoid;
  const titleId = useId();
  const noteId = useId();

  useEffect(() => {
    if (!shown) {
      setState({ status: "refused" });
      return;
    }
    let current = true;
    setState({ status: "loading" });
    lookupService.lookUp(shown, language).then(
      (result) => {
        if (current) {
          setState({ status: "done", result });
          if (countedRef.current !== shown) {
            countedRef.current = shown;
            setUnkept(false);
            void keepLookup(result, language, wordPlaceRef.current).then((saved) => current && setKept(saved));
          }
        }
      },
      (cause) => {
        if (current) {
          const failure =
            cause instanceof LookupFailure ? cause : new LookupFailure("unavailable", "The lookup didn't work. Try again in a moment.");
          setState(failure.kind === "refused" ? { status: "refused" } : { status: "failed", failure });
        }
      }
    );
    return () => {
      current = false;
    };
  }, [shown, language, attempt]);

  // Where it goes: above the bar, off the selected words, inside the window.
  // Measured before the first paint and again when the window changes size.
  useLayoutEffect(() => {
    const measure = () => {
      const node = card.current;
      const dock = node?.parentElement;
      if (!node || !dock) {
        return;
      }
      const bar = dock.getBoundingClientRect();
      const toolbar = node.closest(".reader-scope")?.querySelector(".reader-toolbar")?.getBoundingClientRect();
      setPlace((before) => {
        const next = placeCard({
          barTop: bar.top,
          barCentre: bar.left + bar.width / 2,
          ceiling: Math.max(toolbar?.bottom ?? 0, 0) + CARD_GAP,
          cardWidth: node.offsetWidth,
          windowWidth: window.innerWidth,
          selection: avoidRef.current?.() ?? null
        });
        return next.height === before.height && next.lift === before.lift && next.shift === before.shift ? before : next;
      });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // Focus comes in, and goes back to where it was (the Look up button) on the way out.
  useLayoutEffect(() => {
    const node = card.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    node?.focus({ preventScroll: true });

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // Ahead of the reader's own Escape, which would let the selection go as well.
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      }
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      // The Look up button closes the card itself, by being pressed again.
      if (!target || node?.contains(target) || opener?.contains(target)) {
        return;
      }
      closeRef.current();
    };
    // A click in the book lands in the book's own frame and is never seen
    // here; what is seen is this window losing focus to that frame.
    const onBlur = () => {
      window.setTimeout(() => {
        if (document.activeElement instanceof HTMLIFrameElement) {
          closeRef.current();
        }
      }, 0);
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("blur", onBlur);
      // Only if focus is still the card's to give back: a reader who clicked
      // into the book, or onto another control, has put it where they want it.
      const active = document.activeElement;
      if (opener?.isConnected && (active === document.body || active === null || node?.contains(active))) {
        opener.focus({ preventScroll: true });
      }
    };
  }, []);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    // The reader turns pages on Space and the arrows; in here they press
    // buttons and scroll the card.
    event.stopPropagation();
    if (event.key !== "Tab" || !card.current) {
      return;
    }
    const stops = Array.from(card.current.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex="0"]'));
    if (stops.length === 0) {
      event.preventDefault();
      return;
    }
    const first = stops[0];
    const last = stops[stops.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === card.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const open = (url: string) => {
    setLinkFailed(false);
    accountService.openLink(url).catch(() => setLinkFailed(true));
  };

  const unkeep = () => {
    if (!kept) {
      return;
    }
    setUnkept(true);
    wordService.remove([kept.id]).catch(() => setUnkept(false));
  };

  const more = (label: string, url: string) => (
    <button type="button" className="reader-lookup-more" onClick={() => open(url)}>
      {label}
      <UiIcon name="external" size={12} />
    </button>
  );

  const meaningSection = (meaning: LookupMeaning) => (
    <section key="meaning" className="reader-lookup-section" aria-label="Meaning, from Wiktionary">
      <div className="reader-lookup-section-head">
        <h3 className="reader-lookup-label">Meaning</h3>
        <span className="reader-lookup-source reader-muted">
          Wiktionary{meaning.language && meaning.language !== "English" ? ` · ${meaning.language}` : ""}
        </span>
      </div>
      {meaning.word !== shown && <div className="reader-lookup-word">{meaning.word}</div>}
      <Entries entries={meaning.entries} />
      {meaning.root && (
        <>
          <div className="reader-lookup-word">{meaning.root.word}</div>
          <Entries entries={meaning.root.entries} />
        </>
      )}
      {/* "The state of being sagacious" says nothing without "sagacious": that word, under it. */}
      {meaning.base && (
        <>
          <div className="reader-lookup-word">{meaning.base.word}</div>
          <Entries entries={meaning.base.entries} />
        </>
      )}
      {more("More on Wiktionary", meaning.root?.url ?? meaning.url)}
    </section>
  );

  const summarySection = (summary: LookupSummary) => (
    <section key="summary" className="reader-lookup-section" aria-label="About, from Wikipedia">
      <div className="reader-lookup-section-head">
        <h3 className="reader-lookup-label">About</h3>
        <span className="reader-lookup-source reader-muted">Wikipedia</span>
      </div>
      {summary.ambiguous ? (
        <>
          <p className="reader-lookup-text">
            Wikipedia has more than one page called “{summary.title}”, so there is no single summary to show.
          </p>
          {more("See them on Wikipedia", summary.url)}
        </>
      ) : (
        <>
          <div className="reader-lookup-word">{summary.title}</div>
          {summary.description && <div className="reader-lookup-description reader-muted">{summary.description}</div>}
          <p className="reader-lookup-text">{summary.extract}</p>
          {more("More on Wikipedia", summary.url)}
        </>
      )}
    </section>
  );

  const result = state.status === "done" ? state.result : null;
  // Meaning then About, or the other way round when the summary leads.
  const sections: ReactElement[] = [];
  if (result?.meaning) {
    sections.push(meaningSection(result.meaning));
  }
  if (result?.summary) {
    sections.push(summarySection(result.summary));
  }
  if (result?.lead === "summary") {
    sections.reverse();
  }

  return (
    <div
      ref={card}
      className="reader-lookup reader-panel reader-border pointer-events-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      style={{
        height: place.height,
        bottom: `calc(100% + ${place.lift}px)`,
        transform: `translateX(calc(-50% + ${place.shift}px))`
      }}
      onKeyDown={onKeyDown}
    >
      <div className="reader-lookup-head reader-border">
        <h2 id={titleId} className="reader-lookup-term reader-text-color">
          <span className="reader-lookup-kicker reader-muted">Look up</span>{" "}
          <span className="reader-lookup-term-text">{shown ?? "Selection"}</span>
        </h2>
        <button type="button" className="reader-mini-control" onClick={onClose} title="Close (Esc)" aria-label="Close">
          <UiIcon name="close" size={16} />
        </button>
      </div>

      <div
        className="reader-lookup-body"
        tabIndex={0}
        role="group"
        aria-label="What was found"
        aria-live="polite"
        aria-busy={state.status === "loading"}
      >
        {state.status === "loading" && (
          <div className="reader-lookup-loading" role="status">
            <span className="reader-lookup-visually-hidden">Looking up…</span>
            <span className="reader-lookup-bone is-label" />
            <span className="reader-lookup-bone" />
            <span className="reader-lookup-bone" />
            <span className="reader-lookup-bone is-short" />
            <span className="reader-lookup-bone is-label" />
            <span className="reader-lookup-bone" />
            <span className="reader-lookup-bone is-short" />
          </div>
        )}

        {state.status === "refused" && (
          <div className="reader-lookup-state">
            <p className="reader-lookup-text">{LOOKUP_REFUSAL}.</p>
            <p className="reader-lookup-hint reader-muted">A passage is too much to look up. Nothing was sent.</p>
          </div>
        )}

        {state.status === "failed" && (
          <div className="reader-lookup-state" role="alert">
            <p className="reader-lookup-text">{state.failure.message}</p>
            <button type="button" className="reader-notes-action is-primary" onClick={() => setAttempt((count) => count + 1)}>
              Try again
            </button>
          </div>
        )}

        {result && sections.length === 0 && (
          <div className="reader-lookup-state">
            <p className="reader-lookup-text">
              Nothing found for “{result.term}” in Wiktionary or Wikipedia.
            </p>
            <button type="button" className="reader-notes-action" onClick={() => open(webSearchUrl(result.term))}>
              Search the web
            </button>
          </div>
        )}

        {result?.sample && sections.length > 0 && (
          <p className="reader-lookup-sample reader-border reader-muted">Sample answer. The browser preview looks nothing up.</p>
        )}
        {sections}

        {result && result.missed.length > 0 && (
          <p className="reader-lookup-missed reader-muted">
            {result.missed.map((source) => SOURCE_NAMES[source]).join(" and ")} couldn’t be reached.{" "}
            <button type="button" className="reader-lookup-inline" onClick={() => setAttempt((count) => count + 1)}>
              Try again
            </button>
          </p>
        )}
        {linkFailed && (
          <p className="reader-lookup-missed reader-muted" role="alert">
            Couldn’t open your browser.
          </p>
        )}
      </div>

      <div className="reader-lookup-foot reader-border reader-muted">
        <div className="reader-lookup-foot-words">
          {/* In the foot, not under the answer: a long answer scrolls, and this is always in view. */}
          {kept && sections.length > 0 && (
            <p className="reader-lookup-kept" role="status">
              {unkept ? (
                "Not kept."
              ) : (
                <>
                  Kept in My words{kept.count > 1 ? `, looked up ${kept.count} times` : ""}.{" "}
                  <button type="button" className="reader-lookup-inline" onClick={unkeep}>
                    Don’t keep
                  </button>
                </>
              )}
            </p>
          )}
        </div>
        {/* Over the answer's last lines, not under them: the card keeps its size. */}
        <p id={noteId} className="reader-lookup-note reader-panel reader-border" role="note" hidden={!noteOpen}>
          Only the words you selected are sent to Wiktionary and Wikipedia, and only when you press Look up. Nothing
          about you or your book goes with them.
        </p>
        <button
          type="button"
          className="reader-lookup-info"
          onClick={() => setNoteOpen((open) => !open)}
          aria-expanded={noteOpen}
          aria-controls={noteId}
          aria-label="What looking up sends"
          title="What looking up sends"
        >
          <UiIcon name="info" size={14} />
        </button>
      </div>
    </div>
  );
};
