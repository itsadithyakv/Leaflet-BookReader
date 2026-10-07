import { useEffect, useState, type FormEvent } from "react";
import { WikiFailure, wikiService } from "../../services/wikiService";
import type { WikiSite } from "./wiki";

type WikiChoiceProps = {
  book: { id: string; title: string; author?: string | null; series?: string | null };
  onToast: (message: string) => void;
};

/**
 * Which fan wiki a book's "Wiki" summaries come from: the one found for it
 * (by its series or title, the first time a summary is asked for), or the
 * one the reader names here. Sits in the Characters panel's foot.
 */
export const WikiChoice = ({ book, onToast }: WikiChoiceProps) => {
  const [site, setSite] = useState<WikiSite | null | undefined>(() => wikiService.known(book.id));
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const changed = () => setSite(wikiService.known(book.id));
    changed();
    window.addEventListener(wikiService.CHANGED, changed);
    return () => window.removeEventListener(wikiService.CHANGED, changed);
  }, [book.id]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) {
      return;
    }
    const typed = draft.trim();
    if (!typed) {
      // Nothing named: it is looked for again the next time a summary is asked for.
      wikiService.forget(book.id);
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      const chosen = await wikiService.choose(book.id, typed);
      if (chosen) {
        onToast(`Wiki summaries now come from ${chosen.name}.`);
        setEditing(false);
      } else {
        onToast("There is no wiki at that address.");
      }
    } catch (cause) {
      onToast(cause instanceof WikiFailure ? cause.message : "The wiki could not be asked.");
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <button
        type="button"
        className="reader-notes-action"
        title="The fan wiki this book's “Wiki” summaries come from. A wiki can give away what happens later; it is only asked when you ask."
        onClick={() => {
          setDraft(site?.host ?? "");
          setEditing(true);
        }}
      >
        Wiki: {site ? site.name : site === null ? "none" : "not looked for yet"}
      </button>
    );
  }

  return (
    <form className="reader-people-wiki" onSubmit={(event) => void save(event)}>
      <label className="reader-lookup-visually-hidden" htmlFor={`wiki-${book.id}`}>
        This book's wiki on fandom.com
      </label>
      <input
        id={`wiki-${book.id}`}
        className="reader-notes-input reader-people-input"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="mistborn.fandom.com"
        autoComplete="off"
        spellCheck={false}
        autoFocus
        maxLength={120}
      />
      <button type="submit" className="reader-notes-action is-primary" disabled={busy}>
        {busy ? "Asking…" : "Save"}
      </button>
      <button
        type="button"
        className="reader-notes-action"
        disabled={busy}
        title="This book has no wiki: stop looking for one"
        onClick={() => {
          wikiService.forget(book.id, true);
          setEditing(false);
        }}
      >
        None
      </button>
      <button type="button" className="reader-notes-action" disabled={busy} onClick={() => setEditing(false)}>
        Cancel
      </button>
    </form>
  );
};
