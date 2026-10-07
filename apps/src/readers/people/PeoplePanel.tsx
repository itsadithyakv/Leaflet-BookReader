import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { UiIcon } from "../../components/UiIcon";
import "../lookupCard.css";
import "./people.css";
import type { MentionSearch } from "./bookText";
import { addPerson, type Change, type Writing } from "./edits";
import { castAt, nameKey, type Entry, type Order, type PersonView, type Place } from "./model";
import { namesOf } from "./names";
import { RelationsGraph, WHOLE_CAST } from "./RelationsGraph";
import type { NameSuggestion } from "./suggest";
import { newId } from "./usePeople";

type Tab = "people" | "relations";

type PeoplePanelProps = {
  bookId: string;
  entries: Entry[];
  /** The place being read when the panel opened: the furthest point on screen. */
  here: Place;
  /** Where what is added is stamped: the top of the screen. */
  at: Place;
  order: Order;
  search: MentionSearch | null;
  commit: (change: Change) => Promise<boolean>;
  onOpenPerson: (person: string) => void;
  onClose: () => void;
  onToast: (message: string) => void;
  /** More to do with the sheet (bring in, send out), at the foot. */
  actions?: ReactNode;
};

const count = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/**
 * "Characters": everyone met so far, by group, and how they are tied.
 *
 * Only people met by the place being read are listed. Of the rest there is a
 * number ("12 more later in the book") and nothing else. "People so far"
 * offers names the book itself has kept using up to this place, each one tap
 * to add.
 */
export const PeoplePanel = ({
  bookId,
  entries,
  here,
  at,
  order,
  search,
  commit,
  onOpenPerson,
  onClose,
  onToast,
  actions
}: PeoplePanelProps) => {
  const [tab, setTab] = useState<Tab>("people");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [suggested, setSuggested] = useState<NameSuggestion[] | null>(null);
  const [looking, setLooking] = useState(false);
  // Whose relations are drawn: someone's, everyone's (null), or not chosen yet.
  const [focus, setFocus] = useState<string | null | undefined>(undefined);
  const panel = useRef<HTMLDivElement | null>(null);
  const input = useRef<HTMLInputElement | null>(null);

  const cast = useMemo(() => castAt(entries, here, order), [entries, here, order]);
  const names = useMemo(() => namesOf(cast), [cast]);
  const writing: Writing = useMemo(() => ({ bookId, place: at, newId }), [bookId, at]);

  // Focus comes in, and goes back to the button that opened the panel.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    input.current?.focus({ preventScroll: true });
    return () => {
      const active = document.activeElement;
      if (opener?.isConnected && (active === document.body || active === null || panel.current?.contains(active))) {
        opener.focus({ preventScroll: true });
      }
    };
  }, []);

  // "People so far", worked out once the list is looked at, and again (from
  // what was already counted) when someone is added.
  useEffect(() => {
    if (!search || tab !== "people") {
      return;
    }
    const stop = new AbortController();
    setLooking(true);
    search.namesSoFar(here, names, { signal: stop.signal, limit: 18 }).then(
      (found) => {
        if (!stop.signal.aborted) {
          setSuggested(found ?? []);
          setLooking(false);
        }
      },
      () => {
        if (!stop.signal.aborted) {
          setSuggested([]);
          setLooking(false);
        }
      }
    );
    return () => stop.abort();
  }, [search, here, names, tab]);

  const save = async (change: Change) => {
    setBusy(true);
    const saved = await commit(change);
    setBusy(false);
    if (!saved) {
      onToast("Couldn't save that.");
    }
    return saved;
  };

  const add = async (name: string) => {
    const change = addPerson(entries, order, writing, { name });
    if (change.person && (await save(change))) {
      setQuery("");
    }
  };

  const wanted = nameKey(query);
  const shown = wanted
    ? cast.people.filter((person) => person.names.some((name) => nameKey(name.text).includes(wanted)) || nameKey(person.group ?? "").includes(wanted))
    : cast.people;
  const exact = cast.people.some((person) => person.names.some((name) => nameKey(name.text) === wanted));

  // By group, in the groups' order; the ungrouped last.
  const groups: Array<{ name: string | null; color: string | null; people: PersonView[] }> = [];
  for (const group of cast.groups) {
    const people = shown.filter((person) => person.group && nameKey(person.group) === nameKey(group.name));
    if (people.length > 0) {
      groups.push({ name: group.name, color: group.color, people });
    }
  }
  const loose = shown.filter((person) => !person.group);
  if (loose.length > 0) {
    groups.push({ name: null, color: null, people: loose });
  }

  // A small cast is drawn whole. A large one starts around whoever has the
  // most ties, two steps out; everyone is there for the asking.
  const most = [...cast.people].sort((a, b) => b.links.length - a.links.length || a.name.localeCompare(b.name))[0]?.id ?? null;
  const drawn =
    focus === undefined
      ? cast.people.length > WHOLE_CAST
        ? most
        : null
      : focus && cast.people.some((person) => person.id === focus)
        ? focus
        : null;

  const tabButton = (id: Tab, label: string, icon: "people" | "relations") => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      className={`reader-notes-tab ${tab === id ? "is-active" : ""}`}
      onClick={() => setTab(id)}
    >
      <UiIcon name={icon} size={12} className="mr-1 inline-block align-[-2px]" />
      {label}
    </button>
  );

  return (
    <div
      ref={panel}
      className={`reader-people-panel reader-panel reader-border${tab === "relations" ? " is-wide" : ""}`}
      role="dialog"
      aria-label="Characters"
      onKeyDown={(event) => {
        // The reader turns pages on Space and the arrows; in here they type and scroll.
        event.stopPropagation();
        if (event.key === "Escape") {
          onClose();
        }
      }}
    >
      <div className="reader-people-panel-head">
        <div role="tablist" aria-label="Characters" className="flex gap-1">
          {tabButton("people", "People", "people")}
          {tabButton("relations", "Relations", "relations")}
        </div>
        <button type="button" className="reader-mini-control" onClick={onClose} title="Close (Esc)" aria-label="Close characters">
          <UiIcon name="close" size={16} />
        </button>
      </div>

      {tab === "people" && (
        <>
          <form
            className="reader-people-row"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              if (wanted && !exact && !busy) {
                void add(query);
              } else if (shown.length === 1) {
                onOpenPerson(shown[0].id);
              }
            }}
          >
            <input
              ref={input}
              className="reader-notes-input reader-people-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find someone, or add a name"
              aria-label="Find someone, or add a name"
              maxLength={120}
              autoComplete="off"
            />
            {wanted && !exact && (
              <button type="submit" className="reader-notes-action is-primary" disabled={busy}>
                Add
              </button>
            )}
          </form>

          <div className="reader-people-list" aria-live="polite">
            {cast.people.length === 0 && (
              <p className="reader-lookup-text reader-muted">
                No one yet.
              </p>
            )}
            {cast.people.length > 0 && shown.length === 0 && <p className="reader-lookup-text reader-muted">No one by that name so far.</p>}
            {groups.map((group) => (
              <section key={group.name ?? ""} aria-label={group.name ?? "No group"}>
                <h3 className="reader-people-group-head reader-muted">
                  {group.name && <span className="reader-people-dot" data-color={group.color ?? undefined} aria-hidden="true" />}
                  {group.name ?? (cast.groups.length > 0 ? "No group" : "Everyone so far")}
                  <span className="tabular-nums"> · {group.people.length}</span>
                </h3>
                <ul className="reader-people-rows">
                  {group.people.map((person) => (
                    <li key={person.id}>
                      <button type="button" className="reader-people-person" onClick={() => onOpenPerson(person.id)}>
                        <span className="reader-people-person-name">{person.name}</span>
                        {person.notes.length > 0 && (
                          <span className="reader-people-person-note reader-muted">{person.notes[person.notes.length - 1].text}</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}

            {cast.later > 0 && (
              <p className="reader-people-later reader-muted">{count(cast.later, "more", "more")} later in the book.</p>
            )}

            {(looking || (suggested && suggested.length > 0)) && (
              <section aria-label="People so far" className="reader-people-suggest">
                <h3 className="reader-people-group-head reader-muted">People so far</h3>
                {looking && !suggested && (
                  <p className="reader-lookup-text reader-muted" role="status">
                    Looking back through the book…
                  </p>
                )}
                <ul className="reader-people-chips">
                  {(suggested ?? []).map((item) => (
                    <li key={item.name}>
                      <button
                        type="button"
                        className="reader-people-link"
                        disabled={busy}
                        onClick={() => void add(item.name)}
                        title={`Add ${item.name}`}
                        aria-label={`Add ${item.name}, mentioned ${item.count} times so far`}
                      >
                        <UiIcon name="plus" size={11} className="mr-1 inline-block align-[-1px]" />
                        {item.name} <span className="reader-muted tabular-nums">{item.count.toLocaleString()}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </>
      )}

      {tab === "relations" && (
        <>
          {cast.people.length > 0 && (
            <div className="reader-people-row">
              <select
                className="reader-notes-input reader-people-select"
                value={drawn ?? ""}
                onChange={(event) => setFocus(event.target.value || null)}
                aria-label="Whose relations to draw"
              >
                <option value="">Everyone so far ({cast.people.length})</option>
                {cast.people.map((person) => (
                  <option key={person.id} value={person.id}>
                    Around {person.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <RelationsGraph cast={cast} focus={drawn} onOpen={onOpenPerson} />
          {cast.later > 0 && (
            <p className="reader-people-later reader-muted">{count(cast.later, "more", "more")} later in the book.</p>
          )}
        </>
      )}

      {actions && <div className="reader-people-panel-foot reader-border">{actions}</div>}
    </div>
  );
};
