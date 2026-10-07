import { UiIcon } from "../../components/UiIcon";
import { autoScrollLinesPerMinute } from "../autoScroll";
import { SMART_NUDGE } from "./constants";
import type { ReaderScope } from "./scope";

/** Auto-scroll's and Smart Read's own controls, there while they run. */
export const ReaderPaceControls = ({ reader }: { reader: ReaderScope }) => {
  const {
    autoScrollActive, autoScrollHeld, autoScrollSpeed, chromeVisible, holdReason, nudgeSmartPace, pacePillRef,
    paceTouched, pendingReadingMode, pillHeld, readingMode, readingPaused, setAutoScrollActive, smartAtPicture,
    smartWaiting, smartWpm, toggleSmartPlay, tuneAutoScroll
  } = reader;
  return (
    <>
      {/* Auto-scroll's own control while it runs: the toolbar hides itself
          while reading, and pausing should never mean hunting for a menu. */}
      {readingMode === "standard" && autoScrollActive && (
        <div
          className={`reader-autoscroll-pill reader-panel reader-border ${
            chromeVisible || autoScrollHeld || holdReason ? "is-awake" : ""
          } ${paceTouched % 2 === 1 ? "is-fresh" : ""}`}
          role="group"
          aria-label="Auto scroll"
        >
          <button
            type="button"
            className="reader-autoscroll-button reader-icon reader-hover-accent"
            onClick={() => tuneAutoScroll((value) => Math.max(0, value - 5))}
            title="Slower (-)"
            aria-label="Slower"
          >
            <UiIcon name="minus" size={16} />
          </button>
          <button
            type="button"
            className="reader-autoscroll-main reader-accent"
            onClick={() => setAutoScrollActive(false)}
            title="Pause (Space). Hold the page to make it wait."
          >
            <UiIcon name={autoScrollHeld || holdReason ? "hand" : "pause"} size={16} />
            <span className="tabular-nums">
              {autoScrollHeld ? "Holding" : holdReason ? "On hold" : `${autoScrollLinesPerMinute(autoScrollSpeed)} lines/min`}
            </span>
          </button>
          <button
            type="button"
            className="reader-autoscroll-button reader-icon reader-hover-accent"
            onClick={() => tuneAutoScroll((value) => Math.min(100, value + 5))}
            title="Faster (+)"
            aria-label="Faster"
          >
            <UiIcon name="plus" size={16} />
          </button>
          {/* Only why it is waiting: how to work it is in the buttons' own titles. */}
          {holdReason && <span className="reader-autoscroll-hint reader-muted">{holdReason}</span>}
        </div>
      )}

      {/* Smart Read's own controls, for the same reason: pausing, and Dotty's
          pace, should never mean hunting for a menu. */}
      {readingMode === "smart" && !pendingReadingMode && (
        <div
          ref={pacePillRef}
          className={`reader-autoscroll-pill reader-panel reader-border ${
            chromeVisible || autoScrollHeld || (readingPaused && !pillHeld) || smartWaiting || smartAtPicture || holdReason ? "is-awake" : ""
          } ${pillHeld ? "is-held" : ""} ${paceTouched % 2 === 1 ? "is-fresh" : ""}`}
          role="group"
          aria-label="Smart Read"
        >
          <button
            type="button"
            className="reader-autoscroll-button reader-icon reader-hover-accent"
            onClick={() => nudgeSmartPace(1 / SMART_NUDGE)}
            title="Slower (-)"
            aria-label="Slower"
          >
            <UiIcon name="minus" size={16} />
          </button>
          <button
            type="button"
            className="reader-autoscroll-main reader-accent"
            onClick={toggleSmartPlay}
            title={
              smartWaiting
                ? "Read from here (Space), or scroll down to Dotty"
                : readingPaused || smartAtPicture
                  ? "Carry on (Space)"
                  : "Pause (Space). Read ahead and Dotty catches up."
            }
          >
            <UiIcon
              name={readingPaused || smartWaiting || smartAtPicture ? "play" : autoScrollHeld || holdReason ? "hand" : "pause"}
              size={16}
            />
            <span className="tabular-nums">
              {readingPaused
                ? "Paused"
                : smartWaiting
                  ? "Waiting for you"
                  : smartAtPicture
                    ? "On hold"
                    : autoScrollHeld
                    ? "Holding"
                    : holdReason
                      ? "On hold"
                      : `${smartWpm} wpm`}
            </span>
          </button>
          <button
            type="button"
            className="reader-autoscroll-button reader-icon reader-hover-accent"
            onClick={() => nudgeSmartPace(SMART_NUDGE)}
            title="Faster (+)"
            aria-label="Faster"
          >
            <UiIcon name="plus" size={16} />
          </button>
          {/* Only what it is waiting on, and the one key that is not what it
              looks like. How to work it is in the buttons' own titles. */}
          {(smartWaiting || smartAtPicture || (!readingPaused && holdReason)) && (
            <span className="reader-autoscroll-hint reader-muted">
              {smartWaiting ? "Space reads from here" : smartAtPicture ? "A picture" : holdReason}
            </span>
          )}
        </div>
      )}
    </>
  );
};
