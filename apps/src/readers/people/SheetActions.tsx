import { useEffect, useMemo, useState } from "react";
import { librarySeries } from "../../library/series";
import { peopleService } from "../../services/peopleService";
import { useLibraryStore } from "../../store/libraryStore";
import type { Change } from "./edits";
import type { Entry } from "./model";
import { carrySheet, exportSheet, importSheet, readSheet, type Arrival } from "./sheet";
import { pickSheetFile, saveSheetFile, sheetFileName } from "./sheetFile";
import { newId } from "./usePeople";

type SheetActionsProps = {
  bookId: string;
  entries: Entry[];
  commit: (change: Change) => Promise<boolean>;
  onToast: (message: string) => void;
};

const count = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** What arrived, in numbers only: names would give the book away. */
const arrived = (arrival: Arrival) =>
  [
    arrival.people > 0 ? count(arrival.people, "person", "people") : null,
    arrival.notes > 0 ? count(arrival.notes, "note", "notes") : null,
    arrival.links > 0 ? count(arrival.links, "link", "links") : null
  ]
    .filter(Boolean)
    .join(", ");

/**
 * A sheet going out and coming in: saved as a file, brought in from one, and
 * carried over from the book before this one in its series (which is offered
 * only when that book has a sheet).
 */
export const SheetActions = ({ bookId, entries, commit, onToast }: SheetActionsProps) => {
  const books = useLibraryStore((state) => state.books);
  const book = books.find((item) => item.id === bookId);
  const [busy, setBusy] = useState(false);
  const [earlier, setEarlier] = useState<Entry[] | null>(null);

  // The book before this one, by the library's own reckoning of series.
  const before = useMemo(() => {
    const info = librarySeries(books).byBook.get(bookId);
    const group = info ? librarySeries(books).groups.find((item) => item.key === info.key) : null;
    const at = group ? group.members.findIndex((member) => member.book.id === bookId) : -1;
    return at > 0 ? (group?.members[at - 1].book ?? null) : null;
  }, [books, bookId]);

  useEffect(() => {
    setEarlier(null);
    if (!before) {
      return;
    }
    let live = true;
    peopleService
      .list(before.id)
      .catch(() => [] as Entry[])
      .then((loaded) => {
        if (live && loaded.some((entry) => entry.kind === "person")) {
          setEarlier(loaded);
        }
      });
    return () => {
      live = false;
    };
  }, [before]);

  const run = async (work: () => Promise<void>) => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      await work();
    } catch (cause) {
      onToast(cause instanceof Error && cause.message ? cause.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  };

  const bring = async (arrival: Arrival, nothing: string, after: string) => {
    if (arrival.save.length === 0) {
      onToast(nothing);
      return;
    }
    if (await commit(arrival)) {
      onToast(`Brought in ${arrived(arrival) || "the sheet"}. ${after}`);
    } else {
      onToast("Couldn't save the sheet.");
    }
  };

  return (
    <>
      {before && earlier && (
        <button
          type="button"
          className="reader-notes-action"
          disabled={busy}
          title="Everyone from the earlier book, as known from the first page of this one"
          onClick={() =>
            void run(() =>
              bring(
                carrySheet(earlier, entries, { bookId, fromBookId: before.id, fromTitle: before.title }, newId),
                "Everyone from that book is already here.",
                "They are known from the first page."
              )
            )
          }
        >
          Bring from {before.title.length > 28 ? `${before.title.slice(0, 27)}…` : before.title}
        </button>
      )}
      <button
        type="button"
        className="reader-notes-action"
        disabled={busy}
        title="A sheet someone gave you. Each entry shows only once you reach its place in the book."
        onClick={() =>
          void run(async () => {
            const contents = await pickSheetFile();
            if (contents === null) {
              return;
            }
            const file = readSheet(contents);
            if (!file) {
              onToast("That file isn't a Leaflet character sheet.");
              return;
            }
            await bring(
              importSheet(file, entries, { bookId, fileHash: book?.fileHash ?? null }, newId),
              "Nothing new in that sheet.",
              "Each shows once you reach its place in the book."
            );
          })
        }
      >
        Import
      </button>
      <button
        type="button"
        className="reader-notes-action"
        disabled={busy || entries.length === 0}
        title="Saves this book's sheet as a file"
        onClick={() =>
          void run(async () => {
            const file = exportSheet(entries, { title: book?.title ?? "Book", author: book?.author, fileHash: book?.fileHash }, new Date().toISOString());
            if (await saveSheetFile(sheetFileName(file.book.title), JSON.stringify(file, null, 2))) {
              onToast("Sheet saved.");
            }
          })
        }
      >
        Export
      </button>
    </>
  );
};
