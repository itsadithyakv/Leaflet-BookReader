import { useEffect, useState, type ReactNode } from "react";
import { getPlatform, pickLibraryCopyFolder } from "../platform";
import { errorMessage } from "../services/accountService";
import {
  libraryCopyService,
  type LibraryCopyReport,
  type LibraryCopyStatus
} from "../services/libraryCopyService";

type LibraryCopyCardProps = {
  showToast: (message: string) => void;
  renderToggle: (on: boolean) => ReactNode;
};

const books = (count: number) => `${count} ${count === 1 ? "book" : "books"}`;

/** "12 copied, 30 already there." in the order a reader cares about. */
const summarise = (report: LibraryCopyReport) => {
  const parts: string[] = [];
  if (report.copied > 0) {
    parts.push(`${books(report.copied)} copied`);
  }
  if (report.alreadyThere > 0) {
    parts.push(`${report.alreadyThere} already there`);
  }
  if (report.failed > 0) {
    parts.push(`${report.failed} couldn't be copied`);
  }
  if (parts.length === 0) {
    return report.notDownloaded > 0 ? "Nothing to copy yet." : "Your library is empty, so there was nothing to copy.";
  }
  const sentence = parts.join(", ");
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
};

/**
 * Settings → Keep a copy of my books. Off until the reader turns it on.
 *
 * Leaflet's library already holds its own copy of every book, so this is not
 * what keeps a book readable; it is the copy a person can find and open
 * themselves. Nothing here can stop an import: a folder that has gone is said
 * in this card, quietly, and put right with "Copy My Library There Now".
 */
export const LibraryCopyCard = ({ showToast, renderToggle }: LibraryCopyCardProps) => {
  const desktopApp = libraryCopyService.available();
  const [status, setStatus] = useState<LibraryCopyStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [copying, setCopying] = useState(false);
  const [report, setReport] = useState<LibraryCopyReport | null>(null);

  useEffect(() => {
    let cancelled = false;
    libraryCopyService
      .status()
      .then((loaded) => !cancelled && setStatus(loaded))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // The advice for a missing folder is "plug it in", which happens outside
  // Leaflet. Coming back to the window is the moment to look again, or the
  // warning stays up over a drive that is back.
  const waitingForFolder = status !== null && status.enabled && !status.folderFound;
  useEffect(() => {
    if (!waitingForFolder) {
      return;
    }
    let cancelled = false;
    const onFocus = () =>
      void libraryCopyService
        .status()
        .then((loaded) => {
          if (!cancelled) {
            // Only whether the folder is there: anything else may be mid-change.
            setStatus((current) =>
              current && current.folder === loaded.folder ? { ...current, folderFound: loaded.folderFound } : current
            );
          }
        })
        .catch(() => undefined);
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, [waitingForFolder]);

  // A phone's files are not folders a reader browses, and there is no picker
  // for one, so the option is not offered there at all.
  if (getPlatform() === "mobile") {
    return null;
  }

  const enabled = status?.enabled ?? false;
  const folder = status?.folder ?? null;

  const apply = (next: boolean, chosen?: string) =>
    libraryCopyService.set(next, chosen).then((saved) => {
      setStatus(saved);
      setReport(null);
      return saved;
    });

  const chooseFolder = async () => {
    const picked = await pickLibraryCopyFolder();
    if (!picked) {
      return null;
    }
    return apply(true, picked);
  };

  const toggle = async () => {
    // Not before the setting has loaded: until then this reads as "off, no
    // folder", and a click on a switch that is really on asked for a new
    // folder and replaced the one in use.
    if (!desktopApp || status === null || busy || copying) {
      return;
    }
    setBusy(true);
    try {
      if (enabled) {
        await apply(false);
        showToast("Copies stopped. The ones already in the folder stay there.");
      } else if (folder) {
        await apply(true);
        showToast("New books will be copied to your folder.");
      } else if (await chooseFolder()) {
        showToast("New books will be copied there. Use the button to copy the ones you already have.");
      }
    } catch (cause) {
      showToast(errorMessage(cause, "Couldn't use that folder."));
    } finally {
      setBusy(false);
    }
  };

  const changeFolder = async () => {
    setBusy(true);
    try {
      if (await chooseFolder()) {
        showToast("Folder changed. Copies already made stay in the old one.");
      }
    } catch (cause) {
      showToast(errorMessage(cause, "Couldn't use that folder."));
    } finally {
      setBusy(false);
    }
  };

  const copyLibrary = () => {
    setCopying(true);
    setReport(null);
    libraryCopyService
      .copyLibrary()
      .then((result) => {
        setReport(result);
        setStatus(result.status);
      })
      .catch((cause) => {
        showToast(errorMessage(cause, "Couldn't copy your library."));
        // The folder may have gone since the card was opened; say so here too.
        void libraryCopyService.status().then(setStatus).catch(() => undefined);
      })
      .finally(() => setCopying(false));
  };

  const folderMissing = enabled && status !== null && !status.folderFound;
  const warning = "mt-3 rounded-lg bg-error-container/40 px-3 py-2 text-xs leading-relaxed text-on-surface";

  return (
    <div className="paper-surface rounded-xl p-5">
      <p className="text-xs uppercase tracking-widest text-on-surface-variant">Book Copies</p>
      <p className="mt-2 text-xs leading-relaxed text-on-surface-variant">
        Leaflet keeps every book you add in its own library, so deleting the file you opened never stops you
        reading it. Turn this on to also save each one, named by title and author, in a folder you choose.
      </p>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        className="inset-field mt-4 flex w-full items-center justify-between gap-4 px-4 py-3 text-xs text-on-surface-variant transition hover:text-primary disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:text-on-surface-variant"
        onClick={() => void toggle()}
        disabled={!desktopApp || status === null || busy || copying}
      >
        <span className="text-left">
          <span className="block">Keep a copy of my books in a folder</span>
          <span className="mt-0.5 block text-[11px] opacity-75">
            {desktopApp
              ? "Off unless you turn it on. Stays on this computer; it is not part of your backup."
              : "Available in the desktop app."}
          </span>
        </span>
        {renderToggle(enabled)}
      </button>

      {folder && (
        <div className="mt-4">
          <p className="text-[10px] uppercase tracking-[0.2em] text-on-surface-variant">
            {enabled ? "Copies go to" : "Last folder used"}
          </p>
          <p className="selectable mt-1 break-all text-xs text-on-surface">{folder}</p>
        </div>
      )}

      {folderMissing && (
        <p className={warning} role="status">
          Leaflet can't find this folder right now. If it is on a removable drive, plug it in. Your books are
          still added to your library and can be read as usual; copy them across later with the button below.
        </p>
      )}
      {enabled && !folderMissing && status?.problem && (
        <p className={warning} role="status">
          {status.problem.message} Your library is not affected. "Copy My Library There Now" tries again.
        </p>
      )}

      {enabled && (
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            className="tactile-button tactile-button-primary px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60"
            onClick={copyLibrary}
            disabled={busy || copying}
          >
            {copying ? "Copying…" : "Copy My Library There Now"}
          </button>
          <button
            type="button"
            className="tactile-button px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => void changeFolder()}
            disabled={busy || copying}
          >
            Change Folder
          </button>
        </div>
      )}

      {report && (
        <div className="section-rule mt-4 pt-4 text-xs leading-relaxed text-on-surface-variant" role="status">
          <p className="font-semibold text-on-surface">{summarise(report)}</p>
          {report.notDownloaded > 0 && (
            <p className="mt-1">
              {books(report.notDownloaded)} {report.notDownloaded === 1 ? "hasn't" : "haven't"} been downloaded
              to this computer yet. Open {report.notDownloaded === 1 ? "it" : "them"} once, then copy again.
            </p>
          )}
          {report.failures.length > 0 && (
            <ul className="mt-2 space-y-1">
              {report.failures.map((failure, index) => (
                <li key={`${failure.title}-${index}`} className="break-words">
                  <span className="text-on-surface">{failure.title}:</span> {failure.reason}
                </li>
              ))}
              {report.failed > report.failures.length && (
                <li>…and {report.failed - report.failures.length} more.</li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
