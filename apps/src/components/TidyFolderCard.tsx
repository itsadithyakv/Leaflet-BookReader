import { useEffect, useId, useState } from "react";
import { nameScanned } from "../library/tidyNames";
import { planTidy, type TidyPlan } from "../library/tidyPlan";
import { getPlatform, pickTidyFolder } from "../platform";
import { errorMessage } from "../services/accountService";
import { tidyService, type TidyLast, type TidyScan, type TidySkipped } from "../services/tidyService";
import { useLibraryStore } from "../store/libraryStore";
import { UiIcon } from "./UiIcon";

type TidyFolderCardProps = {
  showToast: (message: string) => void;
};

/** How many of a list are drawn; the rest are counted. */
const MAX_MOVES_SHOWN = 300;
const MAX_SKIPPED_SHOWN = 20;

const files = (count: number) => `${count.toLocaleString()} ${count === 1 ? "file" : "files"}`;

/** A few names for a tooltip, and how many more there are. */
const some = (paths: string[]) =>
  paths.length > 8 ? `${paths.slice(0, 8).join("\n")}\n…and ${paths.length - 8} more` : paths.join("\n");

type Preview = { folder: string; scan: TidyScan; plan: TidyPlan };

/** "42 to rename · 3 already in place · 2 duplicates left alone", each part with what is behind it. */
const counts = ({ scan, plan }: Preview) => {
  const parts: Array<{ text: string; title?: string }> = [
    { text: plan.moves.length > 0 ? `${plan.moves.length.toLocaleString()} to rename` : "Nothing to rename" }
  ];
  if (plan.inPlace > 0) {
    parts.push({ text: `${plan.inPlace.toLocaleString()} already in place` });
  }
  if (plan.duplicates.length > 0) {
    parts.push({
      text: `${plan.duplicates.length.toLocaleString()} ${plan.duplicates.length === 1 ? "duplicate" : "duplicates"} left alone`,
      title: some(plan.duplicates.map((duplicate) => `${duplicate.path} (the same book as ${duplicate.sameAs})`))
    });
  }
  if (scan.leftAlone.length > 0) {
    parts.push({
      text: `${scan.leftAlone.length.toLocaleString()} couldn't be read`,
      title: some(scan.leftAlone.map((file) => `${file.path}: ${file.reason}`))
    });
  }
  if (scan.capped) {
    parts.push({ text: `only the first ${scan.files.length.toLocaleString()} looked at` });
  }
  return parts;
};

/**
 * Settings → Tidy a folder. The reader's own book files, renamed and sorted
 * into `Author/Series/NN - Title`, when they ask and not before.
 *
 * Three steps, and nothing moves until the last: choose a folder, look at
 * every change, press the button. Rust makes the moves and checks each one
 * again (`storage/tidy.rs`); it never puts one file over another and deletes
 * none. The last run can be put back, after a restart too.
 */
export const TidyFolderCard = ({ showToast }: TidyFolderCardProps) => {
  const desktopApp = tidyService.available();
  const noteId = useId();
  const [noteOpen, setNoteOpen] = useState(false);
  const [folder, setFolder] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<"looking" | "renaming" | "undoing" | null>(null);
  const [skipped, setSkipped] = useState<TidySkipped[]>([]);
  const [last, setLast] = useState<TidyLast | null>(null);

  useEffect(() => {
    let cancelled = false;
    tidyService
      .last()
      .then((run) => !cancelled && setLast(run))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // A phone's files are not folders a reader browses.
  if (getPlatform() === "mobile") {
    return null;
  }

  const chooseFolder = async () => {
    try {
      const picked = await pickTidyFolder();
      if (picked) {
        setFolder(picked);
        // The preview was of the other folder.
        setPreview(null);
        setSkipped([]);
      }
    } catch (cause) {
      showToast(errorMessage(cause, "Couldn't open the folder picker."));
    }
  };

  const look = () => {
    if (!folder) {
      return;
    }
    setBusy("looking");
    setSkipped([]);
    tidyService
      .scan(folder)
      .then((scan) => {
        // Read when asked, not subscribed to: the card has nothing to redraw
        // when a book's progress moves.
        const named = nameScanned(scan.files, useLibraryStore.getState().books);
        const folderLength = scan.folder.replace(/[\\/]+$/, "").length;
        const plan = planTidy(named, folderLength, scan.leftAlone.map((file) => file.path));
        setPreview({ folder, scan, plan });
      })
      .catch((cause) => {
        setPreview(null);
        showToast(errorMessage(cause, "Couldn't look in that folder."));
      })
      .finally(() => setBusy(null));
  };

  const refreshLast = () =>
    tidyService
      .last()
      .then(setLast)
      .catch(() => undefined);

  const rename = () => {
    if (!preview || preview.plan.moves.length === 0) {
      return;
    }
    setBusy("renaming");
    tidyService
      .apply(preview.folder, preview.plan.moves)
      .then((report) => {
        setPreview(null);
        setSkipped(report.skipped);
        const left = report.skipped.length > 0 ? ` ${files(report.skipped.length)} stayed as ${report.skipped.length === 1 ? "it was" : "they were"}.` : "";
        showToast(report.moved > 0 ? `${files(report.moved)} renamed.${left}` : `Nothing was renamed.${left}`);
      })
      .catch((cause) => showToast(errorMessage(cause, "Couldn't rename those files.")))
      .finally(() => {
        setBusy(null);
        void refreshLast();
      });
  };

  const undo = () => {
    setBusy("undoing");
    tidyService
      .undo()
      .then((report) => {
        setPreview(null);
        setSkipped(report.skipped);
        const left = report.skipped.length > 0 ? ` ${files(report.skipped.length)} had changed since and stayed.` : "";
        showToast(report.restored > 0 ? `${files(report.restored)} put back.${left}` : `Nothing was put back.${left}`);
      })
      .catch((cause) => showToast(errorMessage(cause, "Couldn't put those files back.")))
      .finally(() => {
        setBusy(null);
        void refreshLast();
      });
  };

  const moves = preview?.plan.moves ?? [];
  const button = "tactile-button px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <div className="paper-surface rounded-xl p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs uppercase tracking-widest text-on-surface-variant">Tidy a Folder</p>
        <button
          type="button"
          className="text-on-surface-variant transition hover:text-primary"
          onClick={() => setNoteOpen((open) => !open)}
          aria-expanded={noteOpen}
          aria-controls={noteId}
          aria-label="What tidying a folder does"
          title="What tidying a folder does"
        >
          <UiIcon name="info" size={14} />
        </button>
      </div>
      <p id={noteId} className="mt-2 text-xs leading-relaxed text-on-surface-variant" role="note" hidden={!noteOpen}>
        Renames the book files in a folder you choose and sorts them into folders: the author, then the series, then
        "01 - Title". A book in your library is named as it is there; any other by what its file says. You see every
        change first, no file is deleted or written over, and Undo puts the last run back. Your library is not
        affected: Leaflet reads its own copy of each book.
      </p>

      {folder && (
        <div className="mt-4">
          <p className="text-[10px] uppercase tracking-[0.2em] text-on-surface-variant">Folder</p>
          <p className="selectable mt-1 break-all text-xs text-on-surface">{folder}</p>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          className={`${button} ${folder ? "" : "tactile-button-primary"}`}
          onClick={() => void chooseFolder()}
          disabled={!desktopApp || busy !== null}
          title={desktopApp ? undefined : "Available in the desktop app."}
        >
          {folder ? "Change Folder" : "Choose Folder"}
        </button>
        {folder && (
          <button
            type="button"
            className={`${button} ${preview ? "" : "tactile-button-primary"}`}
            onClick={look}
            disabled={busy !== null}
            title="Shows every change. Nothing is renamed yet."
          >
            {busy === "looking" ? "Looking…" : "Preview"}
          </button>
        )}
        {last && (
          <button
            type="button"
            className={button}
            onClick={undo}
            disabled={busy !== null}
            title={`Puts back the ${files(last.count)} renamed in ${last.folder}`}
          >
            {busy === "undoing" ? "Putting Back…" : "Undo"}
          </button>
        )}
      </div>

      {preview && (
        <div className="section-rule mt-4 pt-4 text-xs leading-relaxed text-on-surface-variant" role="status">
          <p className="font-semibold text-on-surface">
            {counts(preview).map((part, index) => (
              <span key={part.text} title={part.title}>
                {index > 0 && " · "}
                {part.text}
              </span>
            ))}
          </p>
          {moves.length > 0 && (
            <>
              <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto pr-1">
                {moves.slice(0, MAX_MOVES_SHOWN).map((move) => (
                  <li key={move.from} className="break-all">
                    {move.from} <span aria-label="becomes">→</span> <span className="text-on-surface">{move.to}</span>
                  </li>
                ))}
                {moves.length > MAX_MOVES_SHOWN && <li>…and {(moves.length - MAX_MOVES_SHOWN).toLocaleString()} more.</li>}
              </ul>
              <button
                type="button"
                className={`${button} tactile-button-primary mt-4`}
                onClick={rename}
                disabled={busy !== null}
              >
                {busy === "renaming"
                  ? "Renaming…"
                  : `Rename ${moves.length.toLocaleString()} ${moves.length === 1 ? "File" : "Files"}`}
              </button>
            </>
          )}
        </div>
      )}

      {skipped.length > 0 && (
        <div className="section-rule mt-4 pt-4 text-xs leading-relaxed text-on-surface-variant" role="status">
          <p className="font-semibold text-on-surface">
            {files(skipped.length)} stayed where {skipped.length === 1 ? "it was" : "they were"}
          </p>
          <ul className="mt-2 space-y-1">
            {skipped.slice(0, MAX_SKIPPED_SHOWN).map((skip, index) => (
              <li key={`${skip.from}-${index}`} className="break-words">
                <span className="text-on-surface">{skip.from}:</span> {skip.reason}
              </li>
            ))}
            {skipped.length > MAX_SKIPPED_SHOWN && <li>…and {skipped.length - MAX_SKIPPED_SHOWN} more.</li>}
          </ul>
        </div>
      )}
    </div>
  );
};
