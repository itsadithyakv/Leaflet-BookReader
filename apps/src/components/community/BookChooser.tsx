import { useId, useMemo, useRef, useState } from "react";
import { UiIcon } from "../UiIcon";
import { findBooks, type BookChoice } from "./bookChoices";

/**
 * Which of the reader's books a post is about: the one chosen, shown with its
 * author, and a field to find another by typing part of its title or author
 * (`findBooks`). Arrows move through what is found, Enter takes it, Escape
 * puts the field away again. With nothing typed, the books read most lately.
 *
 * The open field marks itself (`data-chooser="open"`), so that the dialog
 * round it leaves that Escape to it and does not close.
 */
export const BookChooser = ({ choices, picked, onPick }: { choices: readonly BookChoice[]; picked: number | null; onPick: (index: number) => void }) => {
  const [editing, setEditing] = useState(picked === null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const field = useRef<HTMLInputElement | null>(null);
  const listId = useId();
  const found = useMemo(() => findBooks(choices, query), [choices, query]);
  const current = picked === null ? null : choices[picked] ?? null;

  const take = (index: number) => {
    onPick(index);
    setEditing(false);
    setQuery("");
  };
  const begin = () => {
    setEditing(true);
    setQuery("");
    setActive(0);
    // (After the field is drawn.)
    window.setTimeout(() => field.current?.focus(), 0);
  };

  if (!editing && current) {
    return (
      <button
        type="button"
        className="inset-field mt-3 flex w-full items-center gap-3 px-3 py-2 text-left text-sm"
        onClick={begin}
        aria-label={`About ${current.title}. Choose another book`}
      >
        <span className="min-w-0 flex-1 truncate">
          <span className="font-semibold text-on-surface">{current.title}</span>
          {current.author && <span className="text-on-surface-variant"> by {current.author}</span>}
        </span>
        <span className="shrink-0 text-xs text-on-surface-variant">Change</span>
      </button>
    );
  }

  return (
    <div className="mt-3">
      <div className="relative">
        <UiIcon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
        <input
          ref={field}
          autoFocus
          className="inset-field w-full py-2 pl-9 pr-3 text-sm text-on-surface"
          placeholder="Find a book by its title or author"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={found.length > 0 ? `${listId}-${found[Math.min(active, found.length - 1)]}` : undefined}
          data-chooser="open"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive((at) => Math.min(found.length - 1, at + 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((at) => Math.max(0, at - 1));
            } else if (event.key === "Enter") {
              event.preventDefault();
              const index = found[Math.min(active, found.length - 1)];
              if (index !== undefined) {
                take(index);
              }
            } else if (event.key === "Escape" && current) {
              event.preventDefault();
              setEditing(false);
              setQuery("");
            }
          }}
        />
      </div>
      {found.length === 0 ? (
        <p className="mt-2 px-1 text-xs text-on-surface-variant">No book of yours matches “{query.trim()}”.</p>
      ) : (
        <ul id={listId} role="listbox" aria-label="Your books" className="mt-2 flex max-h-64 flex-col gap-0.5 overflow-y-auto">
          {found.map((index, place) => {
            const choice = choices[index];
            const on = place === Math.min(active, found.length - 1);
            return (
              <li
                key={`${choice.title}|${choice.author ?? ""}|${index}`}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={on}
                className={`cursor-pointer list-none rounded-lg px-3 py-1.5 text-sm ${on ? "bg-surface-container-high" : "hover:bg-surface-container-high/60"}`}
                // Not on mouse down: the field would lose its focus first, and the list with it.
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(place)}
                onClick={() => take(index)}
              >
                <span className="block truncate font-semibold text-on-surface">{choice.title}</span>
                {choice.author && <span className="block truncate text-xs text-on-surface-variant">{choice.author}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
