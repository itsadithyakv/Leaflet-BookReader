import { useEffect, useRef, useState } from "react";
import { missedTitles, planKindleImport, planLine, type KindleMiss, type KindlePlan } from "../../library/kindleImport";
import { annotationService } from "../../services/annotationService";
import { useLibraryStore } from "../../store/libraryStore";
import { UiIcon } from "../UiIcon";
import { useHighlightsStore } from "./highlightsStore";
import { countLabel } from "./highlightsView";

/** A Kindle's clippings are a few megabytes after years of reading: far past that, it is some other file. */
const MAX_BYTES = 32 * 1024 * 1024;

const ABOUT =
  "Pick the My Clippings.txt from a Kindle (in its documents folder) and its highlights and notes join the books you have here. Nothing leaves this device.";

/** What the line at the foot says: what would be added (or was), then what was here already and what was left out. */
type Notice = { text: string; had?: number; missed?: KindleMiss[] };

/**
 * "128 highlights for 6 books · 12 already here · 3 books not found". The
 * books not found are named when that is pointed at: a list of them would be
 * a wall of text.
 */
const Line = ({ text, had = 0, missed = [] }: Notice) => (
  <>
    {text}
    {had > 0 && ` · ${had} already here`}
    {missed.length > 0 && (
      <>
        {" · "}
        <span className="cursor-help underline decoration-dotted underline-offset-2" title={missedTitles(missed)}>
          {countLabel(missed.length, "book")} not found
        </span>
      </>
    )}
  </>
);

/**
 * "Import from Kindle…", at the foot of the Library's Highlights view: a
 * Kindle's "My Clippings.txt" is picked, read here (library/kindleClippings.ts),
 * matched to the library's books (library/kindleImport.ts), and what it would
 * add is said in one line to say yes or no to.
 *
 * The file is read by the page itself (a file input and `file.text()`), so it
 * is the same in the app and in the browser preview, and goes nowhere.
 */
export const KindleImport = () => {
  const [plan, setPlan] = useState<KindlePlan | null>(null);
  const [busy, setBusy] = useState<"reading" | "importing" | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const start = useRef<HTMLButtonElement | null>(null);
  const confirm = useRef<HTMLButtonElement | null>(null);
  // The dialog can be closed while a long file is going in: nothing is said to a view that has gone.
  const here = useRef(true);
  useEffect(() => {
    here.current = true;
    return () => {
      here.current = false;
    };
  }, []);

  // The button that was pressed gives way to the question: the keyboard goes to its answer, and back after.
  const asked = plan !== null;
  const wasAsked = useRef(false);
  useEffect(() => {
    if (asked) {
      confirm.current?.focus();
    } else if (wasAsked.current) {
      start.current?.focus();
    }
    wasAsked.current = asked;
  }, [asked]);

  const read = async (file: File) => {
    setNotice(null);
    setPlan(null);
    if (file.size > MAX_BYTES) {
      setNotice({ text: "That file is too large to be a Kindle's clippings." });
      return;
    }
    setBusy("reading");
    try {
      const made = await planKindleImport(await file.text(), useLibraryStore.getState().books, async (bookId) =>
        (await annotationService.list(bookId)).map((item) => item.id)
      );
      if (!here.current) {
        return;
      }
      if (made.fresh.length > 0) {
        setPlan(made);
      } else {
        setNotice({ text: planLine(made), had: made.had, missed: made.missed });
      }
    } catch {
      if (here.current) {
        setNotice({ text: "Couldn't read that file." });
      }
    } finally {
      if (here.current) {
        setBusy(null);
      }
    }
  };

  const run = async (agreed: KindlePlan) => {
    setBusy("importing");
    let saved = 0;
    for (const item of agreed.fresh) {
      try {
        await annotationService.save(item);
        saved += 1;
      } catch {
        // Counted below; the rest still go in.
      }
    }
    // Like a highlight made in the reader: into the next backup, and the library's counts follow.
    if (saved > 0) {
      useLibraryStore.getState().requestBackup();
      void useHighlightsStore.getState().loadCounts();
    }
    if (!here.current) {
      return;
    }
    const failed = agreed.fresh.length - saved;
    setBusy(null);
    setPlan(null);
    setNotice({
      text:
        failed === 0
          ? `${countLabel(saved, "highlight")} imported`
          : `${countLabel(saved, "highlight")} imported, ${failed} couldn't be saved`,
      missed: agreed.missed
    });
  };

  const button = "tactile-button flex items-center gap-2 px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="mt-3 flex min-h-[2.25rem] flex-wrap items-center justify-end gap-x-3 gap-y-2">
      <input
        ref={input}
        type="file"
        accept=".txt"
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Emptied, so picking the same file again is still a change.
          event.target.value = "";
          if (file) {
            void read(file);
          }
        }}
      />
      {/* Always here, so a screen reader hears what is put into it. */}
      <p role="status" aria-live="polite" className="mr-auto min-w-0 text-xs text-on-surface-variant">
        {busy === "reading" ? (
          "Reading…"
        ) : busy === "importing" ? (
          "Importing…"
        ) : plan ? (
          <Line text={planLine(plan)} had={plan.had} missed={plan.missed} />
        ) : notice ? (
          <Line {...notice} />
        ) : null}
      </p>
      {plan ? (
        <span className="flex shrink-0 gap-2">
          <button type="button" className={button} disabled={busy !== null} onClick={() => setPlan(null)}>
            Cancel
          </button>
          <button
            ref={confirm}
            type="button"
            className={`${button} tactile-button-primary`}
            disabled={busy !== null}
            onClick={() => void run(plan)}
          >
            Import
          </button>
        </span>
      ) : (
        <button ref={start} type="button" className={`${button} shrink-0`} disabled={busy !== null} onClick={() => input.current?.click()} title={ABOUT}>
          <UiIcon name="upload" size={14} />
          Import from Kindle…
        </button>
      )}
    </div>
  );
};
