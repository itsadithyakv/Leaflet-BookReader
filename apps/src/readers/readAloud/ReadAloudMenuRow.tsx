import type { ReadAloudControls } from "./useReadAloudCore";

/**
 * The page reader's "Read aloud" switch, in its ··· menu: from the first
 * sentence on screen, as in the text reader's. Only a PDF has words to read;
 * a comic is pictures, and has none.
 */
export const ReadAloudMenuRow = ({
  kind,
  readAloud,
  onChoose,
  touch
}: {
  kind: "pdf" | "comic";
  readAloud: Pick<ReadAloudControls, "active" | "start" | "stop">;
  /** The menu closes as the reading starts or stops. */
  onChoose: () => void;
  touch: boolean;
}) => {
  if (kind !== "pdf") return null;
  return (
    <button
      type="button"
      className="mt-3 flex w-full items-center justify-between rounded-lg border px-3 py-2 text-xs uppercase tracking-widest transition reader-border reader-pill reader-icon"
      onClick={() => {
        onChoose();
        if (readAloud.active) readAloud.stop();
        else readAloud.start();
      }}
      aria-pressed={readAloud.active}
      title={touch ? undefined : "Read aloud (R)"}
    >
      <span>Read aloud</span>
      <span className="reader-toggle" data-on={readAloud.active} />
    </button>
  );
};
