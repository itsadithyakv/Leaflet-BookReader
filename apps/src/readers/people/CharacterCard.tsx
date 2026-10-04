import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent
} from "react";
import { UiIcon } from "../../components/UiIcon";
import { CARD_GAP, CARD_HEIGHT, placeCard, type Box, type CardPlace } from "../lookupPlacement";
import "../lookupCard.css";
import "./people.css";
import type { MentionSearch } from "./bookText";
import { CharacterEditor } from "./CharacterEditor";
import { addLink, addNote, addPerson, type Change, type Writing } from "./edits";
import type { Mention } from "./mentions";
import { castAt, laterNotesOf, type Entry, type NoteView, type Order, type Place } from "./model";
import { cleanName, namesOf, type NameEntry } from "./names";
import { linkWords, suggestLinks, type LinkSuggestion } from "./relations";
import { newId, useMentions } from "./usePeople";

/** Who the card is about: someone on the sheet, or a name that is not on it yet. */
export type CardTarget = { kind: "person"; id: string } | { kind: "name"; text: string };

type CharacterCardProps = {
  target: CardTarget;
  bookId: string;
  entries: Entry[];
  /** The place being read when the card opened: the furthest point on screen. Fixed while it is open. */
  here: Place;
  /** Where what is written is stamped: the name that was asked about, or the top of the screen. */
  at: Place;
  order: Order;
  search: MentionSearch | null;
  /** A chapter's name, for "First appears". */
  chapterOf: (section: number) => string | null;
  commit: (change: Change) => Promise<boolean>;
  onTarget: (target: CardTarget) => void;
  onJump: (cfi: string) => void;
  onClose: () => void;
  onToast: (message: string) => void;
  /** Where the selected text is in the window, so the card can keep off it. */
  avoid?: () => Box | null;
};

const count = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/**
 * Who someone in the book is, as far as the reader has got: what the reader
 * wrote about them, who they are tied to, and where the book itself last
 * spoke of them. Nothing from after the place being read is in it; later
 * notes are only counted, and shown if the reader asks.
 *
 * For a name not written down yet, the book's own mentions and one line to
 * type: "Son of Ned, the bastard boy", Enter, and the character exists.
 *
 * Sits in the selection bar's dock, like the lookup card, and behaves like
 * it: a dialog that takes focus, keeps it, and gives it back; Escape or a
 * click anywhere else closes it.
 */
export const CharacterCard = ({
  target,
  bookId,
  entries,
  here,
  at,
  order,
  search,
  chapterOf,
  commit,
  onTarget,
  onJump,
  onClose,
  onToast,
  avoid
}: CharacterCardProps) => {
  const [place, setPlace] = useState<CardPlace>({ height: CARD_HEIGHT, lift: CARD_GAP, shift: 0 });
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [suggested, setSuggested] = useState<{ person: string; links: LinkSuggestion[] } | null>(null);
  const card = useRef<HTMLDivElement | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const avoidRef = useRef(avoid);
  avoidRef.current = avoid;
  const titleId = useId();
  const inputId = useId();

  const cast = useMemo(() => castAt(entries, here, order), [entries, here, order]);
  const names = useMemo(() => namesOf(cast), [cast]);
  const person = target.kind === "person" ? cast.people.find((item) => item.id === target.id) ?? null : null;
  const asked = target.kind === "name" ? cleanName(target.text) : null;
  const writing: Writing = useMemo(() => ({ bookId, place: at, newId }), [bookId, at]);

  // The book's own mentions: of this person under every name learned so far,
  // or of the name as selected.
  const lookedFor = useMemo<NameEntry[] | null>(() => {
    if (person) {
      return names;
    }
    return asked ? [{ text: asked, person: "?", exact: /\p{Lu}/u.test(asked) }] : null;
  }, [person, names, asked]);
  const mentions = useMentions(search, lookedFor, person ? person.id : asked ? "?" : null, here);

  const targetKey = target.kind === "person" ? `p:${target.id}` : `n:${target.text}`;
  useEffect(() => {
    setDraft("");
    setEditing(false);
    setRevealed(false);
  }, [targetKey]);

  // Where it goes: above the bar, off the selected words, inside the window.
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

  // Focus comes in, and goes back to where it was on the way out.
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
      const at = event.target as Node | null;
      // The "Who is this?" button closes the card itself, by being pressed again.
      if (!at || node?.contains(at) || (opener && !(opener instanceof HTMLIFrameElement) && opener.contains(at))) {
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
      const active = document.activeElement;
      if (opener?.isConnected && (active === document.body || active === null || node?.contains(active))) {
        opener.focus({ preventScroll: true });
      }
    };
  }, []);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    // The reader turns pages on Space and the arrows; in here they type,
    // press buttons and scroll the card.
    event.stopPropagation();
    if (event.key !== "Tab" || !card.current) {
      return;
    }
    const stops = Array.from(
      card.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]'
      )
    );
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

  const save = async (change: Change) => {
    setBusy(true);
    const saved = await commit(change);
    setBusy(false);
    if (!saved) {
      onToast("Couldn't save that.");
    }
    return saved;
  };

  /** The links a line suggests, less the ones the sheet already has. */
  const suggestionsFor = (subject: string, text: string) =>
    suggestLinks(text, names, subject).filter((link) => addLink(entries, order, writing, subject, link).save.length > 0);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (busy) {
      return;
    }
    if (person) {
      if (text && (await save(addNote(writing, person.id, text)))) {
        setDraft("");
        setSuggested({ person: person.id, links: suggestionsFor(person.id, text) });
      }
      return;
    }
    if (asked) {
      const change = addPerson(entries, order, writing, { name: asked, note: text });
      if (change.person && (await save(change))) {
        setDraft("");
        setSuggested({ person: change.person, links: suggestionsFor(change.person, text) });
        onTarget({ kind: "person", id: change.person });
      }
    }
  };

  const acceptLink = async (link: LinkSuggestion) => {
    if (person && (await save(addLink(entries, order, writing, person.id, link)))) {
      setSuggested((current) => (current ? { ...current, links: current.links.filter((item) => item !== link) } : current));
    }
  };

  const jump = (mention: Mention) => {
    void search?.cfiOf(mention).then((cfi) => {
      if (cfi) {
        onJump(cfi);
      } else {
        onToast("Couldn't find that place again.");
      }
    });
  };

  const snippet = (mention: Mention, key: string) => (
    <li key={key}>
      <button
        type="button"
        className="reader-people-mention"
        onClick={() => jump(mention)}
        title="Go to this place"
        aria-label={`Go to: ${mention.before}${mention.match}${mention.after}`}
      >
        <span className="reader-people-mention-where reader-muted">{chapterOf(mention.section) ?? "Earlier"}</span>
        <span className="reader-people-mention-text">
          {mention.before}
          <mark>{mention.match}</mark>
          {mention.after}
        </span>
      </button>
    </li>
  );

  const note = (item: NoteView, later = false) => (
    <li key={item.id} className={later ? "reader-people-note is-later" : "reader-people-note"}>
      <span className="reader-people-note-text">{item.text}</span>
      {item.at.chapter &&
        (item.at.cfi ? (
          <button
            type="button"
            className="reader-people-note-where reader-muted"
            onClick={() => onJump(item.at.cfi as string)}
            title="Go to where this was written"
          >
            {item.at.chapter}
          </button>
        ) : (
          <span className="reader-people-note-where reader-muted">{item.at.chapter}</span>
        ))}
    </li>
  );

  const found = mentions.summary;
  const links = suggested && person && suggested.person === person.id ? suggested.links : [];
  const later = person && revealed ? laterNotesOf(entries, person.id, here, order) : [];
  const gone = target.kind === "person" && !person;

  const inTheBook = (
    <section className="reader-lookup-section" aria-label="In the book so far">
      <div className="reader-lookup-section-head">
        <h3 className="reader-lookup-label">In the book so far</h3>
        {mentions.status === "done" && found && found.count > 0 && (
          <span className="reader-lookup-source reader-muted">{count(found.count, "mention", "mentions")}</span>
        )}
      </div>
      {mentions.status === "unknown" && (
        <p className="reader-lookup-text reader-muted">Turn a page, then ask again: the place in the book isn't known yet.</p>
      )}
      {mentions.status === "searching" && (
        <p className="reader-lookup-text reader-muted" role="status">
          Looking back through the book…
        </p>
      )}
      {mentions.status === "done" && found && found.count === 0 && (
        <p className="reader-lookup-text reader-muted">Not mentioned before this page.</p>
      )}
      {mentions.status === "done" && found?.first && (
        <ul className="reader-people-mentions" aria-label="First appears">
          {snippet({ ...found.first }, "first")}
        </ul>
      )}
      {found && found.recent.length > 0 && (
        <>
          <div className="reader-people-sub reader-muted">{mentions.status === "done" ? "Last mentioned" : "Latest so far"}</div>
          <ul className="reader-people-mentions">
            {found.recent.map((mention) => snippet(mention, `${mention.section}:${mention.start}`))}
          </ul>
        </>
      )}
    </section>
  );

  return (
    <div
      ref={card}
      className="reader-lookup reader-people-card reader-panel reader-border pointer-events-auto"
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
          <span className="reader-lookup-kicker reader-muted">{person ? "Character" : "Who is this?"}</span>{" "}
          <span className="reader-lookup-term-text">{person?.name ?? asked ?? "Character"}</span>
          {person?.group && (
            <span className="reader-people-group reader-muted">
              <span className="reader-people-dot" data-color={person.color ?? undefined} aria-hidden="true" />
              {person.group}
            </span>
          )}
        </h2>
        <span className="reader-people-head-actions">
          {person && (
            <button
              type="button"
              className="reader-mini-control"
              style={editing ? { color: "var(--reader-accent)", borderColor: "var(--reader-accent)" } : undefined}
              onClick={() => setEditing((on) => !on)}
              title={editing ? "Done editing" : "Edit names, group and links"}
              aria-label={editing ? "Done editing" : "Edit"}
              aria-pressed={editing}
            >
              <UiIcon name={editing ? "check" : "edit"} size={15} />
            </button>
          )}
          <button type="button" className="reader-mini-control" onClick={onClose} title="Close (Esc)" aria-label="Close">
            <UiIcon name="close" size={16} />
          </button>
        </span>
      </div>

      <div className="reader-lookup-body" tabIndex={0} role="group" aria-label="What is known so far" aria-live="polite">
        {gone && (
          <div className="reader-lookup-state">
            <p className="reader-lookup-text">They are no longer in your characters.</p>
          </div>
        )}

        {person && editing && (
          <CharacterEditor
            person={person}
            cast={cast}
            entries={entries}
            here={here}
            order={order}
            writing={writing}
            save={save}
            busy={busy}
            onRemoved={onClose}
          />
        )}

        {person && !editing && (
          <>
            <section className="reader-lookup-section" aria-label="Your notes">
              {person.notes.length === 0 && links.length === 0 && (
                <p className="reader-lookup-text reader-muted">Nothing written about them yet.</p>
              )}
              {person.notes.length > 0 && <ul className="reader-people-notes">{person.notes.map((item) => note(item))}</ul>}
              {links.length > 0 && (
                <ul className="reader-people-suggested" aria-label="Suggested links">
                  {links.map((link) => {
                    const other = cast.people.find((item) => item.id === link.other);
                    const words = `${linkWords(link.type, link.outward, link.label)} ${other?.name ?? ""}`;
                    return (
                      <li key={`${link.type}:${link.other}:${link.outward}`}>
                        <span>
                          Link as <strong>{words}</strong>?
                        </span>
                        <button type="button" className="reader-notes-action is-primary" disabled={busy} onClick={() => void acceptLink(link)}>
                          Add link
                        </button>
                        <button
                          type="button"
                          className="reader-notes-action"
                          onClick={() =>
                            setSuggested((current) =>
                              current ? { ...current, links: current.links.filter((item) => item !== link) } : current
                            )
                          }
                        >
                          No
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {person.laterNotes > 0 && (
                <p className="reader-people-later reader-muted">
                  {count(person.laterNotes, "later note", "later notes")} hidden.{" "}
                  <button
                    type="button"
                    className="reader-lookup-inline"
                    onClick={() => setRevealed((on) => !on)}
                    aria-expanded={revealed}
                  >
                    {revealed ? "Hide again" : "Show anyway"}
                  </button>
                </p>
              )}
              {later.length > 0 && (
                <ul className="reader-people-notes" aria-label="From later in the book">
                  {later.map((item) => note(item, true))}
                </ul>
              )}
            </section>

            {person.links.length > 0 && (
              <section className="reader-lookup-section" aria-label="Relations">
                <div className="reader-lookup-section-head">
                  <h3 className="reader-lookup-label">Relations</h3>
                </div>
                <ul className="reader-people-links">
                  {person.links.map((link) => (
                    <li key={`${link.id}:${link.outward}`}>
                      <button
                        type="button"
                        className={link.over ? "reader-people-link is-over" : "reader-people-link"}
                        onClick={() => onTarget({ kind: "person", id: link.other })}
                        title={`Open ${link.otherName}`}
                      >
                        <span className="reader-muted">{linkWords(link.type, link.outward, link.label)}</span> {link.otherName}
                        {link.over && <span className="reader-muted"> (ended)</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {inTheBook}
          </>
        )}

        {!person && asked && (
          <>
            <p className="reader-lookup-text">
              Not in your characters yet. Write a line below to keep track of them.
            </p>
            <div className="reader-people-spacer" />
            {inTheBook}
          </>
        )}

        {!person && !asked && !gone && (
          <div className="reader-lookup-state">
            <p className="reader-lookup-text">Select a name to ask who it is.</p>
          </div>
        )}
      </div>

      {(person || asked) && !editing && (
        <form className="reader-people-foot reader-border" onSubmit={(event) => void submit(event)}>
          <label className="reader-lookup-visually-hidden" htmlFor={inputId}>
            {person ? `Add a note about ${person.name}` : `Who is ${asked}?`}
          </label>
          <input
            ref={input}
            id={inputId}
            className="reader-notes-input reader-people-input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={person ? "Add a note, stamped here" : "Who is this? e.g. Son of Ned, the bastard boy"}
            maxLength={2000}
            autoComplete="off"
          />
          <button type="submit" className="reader-notes-action is-primary" disabled={busy || (Boolean(person) && !draft.trim())}>
            {person ? "Add" : draft.trim() ? "Add" : "Track"}
          </button>
        </form>
      )}
    </div>
  );
};
