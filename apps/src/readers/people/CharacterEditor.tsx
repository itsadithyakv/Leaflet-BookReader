import { useEffect, useId, useState, type FormEvent } from "react";
import { UiIcon } from "../../components/UiIcon";
import {
  addAlias,
  addLink,
  editNote,
  endLink,
  mergePeople,
  removePerson,
  rename,
  setGroup,
  setGroupColor,
  type Change,
  type Writing
} from "./edits";
import {
  GROUP_COLORS,
  type Alias,
  type CastView,
  type Entry,
  type Link,
  type LinkType,
  type Note,
  type Order,
  type Person,
  type PersonView,
  type Place
} from "./model";
import { linkWords } from "./relations";

type CharacterEditorProps = {
  person: PersonView;
  cast: CastView;
  entries: Entry[];
  here: Place;
  order: Order;
  writing: Writing;
  save: (change: Change) => Promise<boolean>;
  busy: boolean;
  /** The character was deleted: there is nothing left to show. */
  onRemoved: () => void;
};

/** The ways to say how two people are tied, read from the person being edited. */
const TIES: Array<{ type: LinkType; outward: boolean }> = [
  { type: "child", outward: true },
  { type: "child", outward: false },
  { type: "sibling", outward: true },
  { type: "spouse", outward: true },
  { type: "kin", outward: true },
  { type: "serves", outward: true },
  { type: "serves", outward: false },
  { type: "ward", outward: true },
  { type: "ward", outward: false },
  { type: "friend", outward: true },
  { type: "enemy", outward: true },
  { type: "killedBy", outward: true },
  { type: "killedBy", outward: false },
  { type: "other", outward: true }
];

/**
 * The card's other face: set a name right, add a name learned here, move
 * them to a group, tie them to someone, reword or remove what was written.
 * Everything added is stamped with the place being read; only what is known
 * at that place is listed, so editing gives nothing away either.
 */
export const CharacterEditor = ({ person, cast, entries, here, order, writing, save, busy, onRemoved }: CharacterEditorProps) => {
  const record = entries.find((entry): entry is Person => entry.kind === "person" && entry.id === person.id);
  const known = <T extends Entry>(entry: T) => !entry.deletedAt && order.known(entry.at, here);
  const aliases = entries.filter((entry): entry is Alias => entry.kind === "alias" && entry.person === person.id && known(entry));
  const notes = entries.filter((entry): entry is Note => entry.kind === "note" && person.notes.some((note) => note.id === entry.id));
  const links = entries.filter((entry): entry is Link => entry.kind === "link" && person.links.some((link) => link.id === entry.id));
  const others = cast.people.filter((item) => item.id !== person.id);

  const [name, setName] = useState(record?.name ?? person.name);
  const [alias, setAlias] = useState("");
  const [main, setMain] = useState(false);
  const [group, setGroupName] = useState(person.group ?? "");
  const [tie, setTie] = useState(0);
  const [other, setOther] = useState(others[0]?.id ?? "");
  const [label, setLabel] = useState("");
  const [rewording, setRewording] = useState<{ id: string; text: string } | null>(null);
  const [sure, setSure] = useState(false);
  const [same, setSame] = useState("");
  const [sureSame, setSureSame] = useState(false);
  const ids = useId();

  useEffect(() => {
    setName(record?.name ?? person.name);
    setGroupName(person.group ?? "");
    setSure(false);
    setSame("");
    setSureSame(false);
    // Only when the card turns to someone else.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [person.id]);

  const on = (run: () => Promise<unknown> | void) => (event: FormEvent) => {
    event.preventDefault();
    if (!busy) {
      void run();
    }
  };

  return (
    <div className="reader-people-edit">
      <form className="reader-people-field" onSubmit={on(async () => record && (await save(rename(record, name))))}>
        <label htmlFor={`${ids}name`} className="reader-lookup-label">
          Name
        </label>
        <div className="reader-people-row">
          <input
            id={`${ids}name`}
            className="reader-notes-input reader-people-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={120}
            autoComplete="off"
          />
          <button type="submit" className="reader-notes-action" disabled={busy || !name.trim() || name.trim() === record?.name}>
            Rename
          </button>
        </div>
      </form>

      <form
        className="reader-people-field"
        onSubmit={on(async () => {
          if (alias.trim() && (await save(addAlias(writing, person.id, alias, main)))) {
            setAlias("");
            setMain(false);
          }
        })}
      >
        <label htmlFor={`${ids}alias`} className="reader-lookup-label">
          Also called
        </label>
        {aliases.length > 0 && (
          <ul className="reader-people-chips">
            {aliases.map((item) => (
              <li key={item.id} className="reader-people-chip">
                {item.text}
                {item.main && <span className="reader-muted"> (from {item.at.chapter ?? "here"} on)</span>}
                <button
                  type="button"
                  className="reader-notes-remove"
                  onClick={() => void save({ save: [], remove: [item.id] })}
                  title={`Remove the name ${item.text}`}
                  aria-label={`Remove the name ${item.text}`}
                >
                  <UiIcon name="close" size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="reader-people-row">
          <input
            id={`${ids}alias`}
            className="reader-notes-input reader-people-input"
            value={alias}
            onChange={(event) => setAlias(event.target.value)}
            placeholder="A name learned here"
            maxLength={120}
            autoComplete="off"
          />
          <button type="submit" className="reader-notes-action" disabled={busy || !alias.trim()}>
            Add
          </button>
        </div>
        <label className="reader-people-check reader-muted">
          <input type="checkbox" checked={main} onChange={(event) => setMain(event.target.checked)} />
          Call them this from here on
        </label>
      </form>

      <form
        className="reader-people-field"
        onSubmit={on(async () => {
          if (group.trim() !== (person.group ?? "")) {
            await save(setGroup(writing, person.id, group.trim() || null));
          }
        })}
      >
        <label htmlFor={`${ids}group`} className="reader-lookup-label">
          Group
        </label>
        <div className="reader-people-row">
          <input
            id={`${ids}group`}
            className="reader-notes-input reader-people-input"
            value={group}
            onChange={(event) => setGroupName(event.target.value)}
            placeholder="A house, a family, a crew"
            list={`${ids}groups`}
            maxLength={60}
            autoComplete="off"
          />
          <datalist id={`${ids}groups`}>
            {cast.groups.map((item) => (
              <option key={item.name} value={item.name} />
            ))}
          </datalist>
          <button type="submit" className="reader-notes-action" disabled={busy || group.trim() === (person.group ?? "")}>
            {group.trim() || !person.group ? "Set" : "Leave"}
          </button>
        </div>
        {person.group && (
          <div className="reader-people-swatches" role="radiogroup" aria-label={`Colour of ${person.group}`}>
            {GROUP_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                role="radio"
                aria-checked={person.color === color}
                className="reader-people-swatch"
                data-color={color}
                onClick={() => void save(setGroupColor(writing.bookId, person.group as string, color))}
                title={color}
                aria-label={color}
              />
            ))}
          </div>
        )}
      </form>

      <form
        className="reader-people-field"
        onSubmit={on(async () => {
          const choice = TIES[tie];
          if (other && (await save(addLink(entries, order, writing, person.id, { ...choice, other, label })))) {
            setLabel("");
          }
        })}
      >
        <span className="reader-lookup-label">Relations</span>
        {links.length > 0 && (
          <ul className="reader-people-rows">
            {links.map((link) => {
              const view = person.links.find((item) => item.id === link.id);
              if (!view) {
                return null;
              }
              const words = `${linkWords(view.type, view.outward, view.label)} ${view.otherName}`;
              return (
                <li key={link.id}>
                  <span className={view.over ? "reader-muted" : undefined}>
                    {words}
                    {view.over ? " (ended)" : ""}
                  </span>
                  {!view.over && (
                    <button
                      type="button"
                      className="reader-notes-action"
                      disabled={busy}
                      onClick={() => void save(endLink(writing, link))}
                      title="No longer true from this place on"
                    >
                      Ends here
                    </button>
                  )}
                  <button
                    type="button"
                    className="reader-notes-remove"
                    onClick={() => void save({ save: [], remove: [link.id] })}
                    title={`Remove: ${words}`}
                    aria-label={`Remove: ${words}`}
                  >
                    <UiIcon name="trash" size={13} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {others.length > 0 ? (
          <>
            <div className="reader-people-row">
              <select
                className="reader-notes-input reader-people-select"
                value={tie}
                onChange={(event) => setTie(Number(event.target.value))}
                aria-label="How they are tied"
              >
                {TIES.map((choice, index) => (
                  <option key={`${choice.type}${choice.outward}`} value={index}>
                    {choice.type === "other" ? "tied to" : linkWords(choice.type, choice.outward, null)}
                  </option>
                ))}
              </select>
              <select
                className="reader-notes-input reader-people-select"
                value={other}
                onChange={(event) => setOther(event.target.value)}
                aria-label="Who to"
              >
                {others.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="reader-people-row">
              <input
                className="reader-notes-input reader-people-input"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="Your word for it (uncle, squire), if any"
                aria-label="Your word for it, if any"
                maxLength={60}
                autoComplete="off"
              />
              <button type="submit" className="reader-notes-action" disabled={busy || !other}>
                Add
              </button>
            </div>
          </>
        ) : (
          <p className="reader-lookup-text reader-muted">No one else to tie them to yet.</p>
        )}
      </form>

      {notes.length > 0 && (
        <div className="reader-people-field">
          <span className="reader-lookup-label">Notes</span>
          <ul className="reader-people-rows">
            {notes.map((note) =>
              rewording?.id === note.id ? (
                <li key={note.id} className="is-editing">
                  <textarea
                    className="reader-notes-input reader-people-input"
                    value={rewording.text}
                    onChange={(event) => setRewording({ id: note.id, text: event.target.value })}
                    rows={3}
                    maxLength={2000}
                    aria-label="Reword the note"
                    autoFocus
                  />
                  <button
                    type="button"
                    className="reader-notes-action is-primary"
                    disabled={busy}
                    onClick={() =>
                      void save(editNote(note, rewording.text)).then((saved) => {
                        if (saved) {
                          setRewording(null);
                        }
                      })
                    }
                  >
                    Save
                  </button>
                  <button type="button" className="reader-notes-action" onClick={() => setRewording(null)}>
                    Cancel
                  </button>
                </li>
              ) : (
                <li key={note.id}>
                  <span>{note.text}</span>
                  <button
                    type="button"
                    className="reader-notes-remove"
                    onClick={() => setRewording({ id: note.id, text: note.text })}
                    title="Reword this note"
                    aria-label={`Reword the note: ${note.text}`}
                  >
                    <UiIcon name="edit" size={13} />
                  </button>
                  <button
                    type="button"
                    className="reader-notes-remove"
                    onClick={() => void save({ save: [], remove: [note.id] })}
                    title="Delete this note"
                    aria-label={`Delete the note: ${note.text}`}
                  >
                    <UiIcon name="trash" size={13} />
                  </button>
                </li>
              )
            )}
          </ul>
        </div>
      )}

      {others.length > 0 && (
        <div className="reader-people-field">
          <label htmlFor={`${ids}same`} className="reader-lookup-label">
            The same person as
          </label>
          <div className="reader-people-row">
            <select
              id={`${ids}same`}
              className="reader-notes-input reader-people-select"
              value={same}
              onChange={(event) => {
                setSame(event.target.value);
                setSureSame(false);
              }}
            >
              <option value="">Someone else on the sheet…</option>
              {others.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="reader-notes-action"
              disabled={busy || !same}
              title="Moves their notes, names and links here, and removes the other entry"
              onClick={() => {
                if (!sureSame) {
                  setSureSame(true);
                  return;
                }
                // Everything about the other becomes this person's.
                void save(mergePeople(entries, order, same, person.id, writing.newId)).then((saved) => {
                  if (saved) {
                    setSame("");
                    setSureSame(false);
                  }
                });
              }}
            >
              {sureSame ? "Yes, join them" : "Join"}
            </button>
          </div>
        </div>
      )}

      <div className="reader-people-field">
        <button
          type="button"
          className="reader-notes-action"
          disabled={busy}
          onClick={() => {
            if (!sure) {
              setSure(true);
              return;
            }
            void save(removePerson(entries, person.id)).then((saved) => {
              if (saved) {
                onRemoved();
              }
            });
          }}
        >
          {sure ? `Delete ${person.name} and everything about them` : "Delete this character"}
        </button>
        {sure && (
          <button type="button" className="reader-notes-action" onClick={() => setSure(false)}>
            Keep
          </button>
        )}
      </div>
    </div>
  );
};
