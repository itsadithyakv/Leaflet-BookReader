import { UiIcon } from "../../components/UiIcon";
import type { ReaderScope } from "./scope";

/** SpeedRead's stage: one word at a time, on the page's own colours. */
export const SpeedReadStage = ({ reader }: { reader: ReaderScope }) => {
  const {
    readingMode, readingPaused, readingWord, rsvpDark, rsvpMinutesLeft, rsvpPivot, rsvpProgress, rsvpStyle,
    rsvpWordStyle, setReadingPaused, setSpeedReadWpm, speedReadWpm
  } = reader;
  return (
    <>
      {readingMode === "speed" && readingWord && (
        <div
          className={`reader-rsvp-stage pointer-events-none absolute inset-0 z-20 ${
            rsvpDark ? "is-dark" : "is-light"
          } ${readingPaused ? "is-paused" : ""}`}
          style={rsvpStyle}
        >
          <div className="reader-rsvp-reticle" style={rsvpWordStyle} aria-hidden="true">
            <span className="reader-rsvp-guide" />
            <div className="reader-rsvp-line">
              <span className="reader-rsvp-pre">{readingWord.text.slice(0, rsvpPivot)}</span>
              <span className="reader-rsvp-focus">{readingWord.text[rsvpPivot]}</span>
              <span className="reader-rsvp-post">
                {readingWord.text.slice(rsvpPivot + 1)}
                <span className="reader-rsvp-punct">{readingWord.punctuation}</span>
              </span>
            </div>
            <span className="reader-rsvp-guide" />
          </div>

          {/* Keyed on the pace, so changing it shows the row again
              and restarts its fade. */}
          <div key={speedReadWpm} className="reader-rsvp-meta">
            <span className="reader-rsvp-meta-label tabular-nums">{speedReadWpm} wpm</span>
            <span className="reader-rsvp-progress" aria-hidden="true">
              <i style={{ transform: `scaleX(${rsvpProgress})` }} />
            </span>
            <span className="reader-rsvp-meta-label tabular-nums">~{rsvpMinutesLeft} min left in chapter</span>
          </div>

          <div key={readingWord.contextStart} className="reader-rsvp-context">
            {readingWord.context.map((word) => (
              <span
                key={`${word.index}-${word.text}`}
                className={
                  word.index === readingWord.index
                    ? "reader-rsvp-current"
                    : word.index < readingWord.index
                      ? "reader-rsvp-read"
                      : ""
                }
              >
                {word.text}
                {word.trailing || " "}
              </span>
            ))}
          </div>

          <div className="reader-rsvp-controls pointer-events-auto" role="group" aria-label="SpeedRead">
            <button
              type="button"
              className="reader-rsvp-button"
              onClick={() => setSpeedReadWpm((value) => Math.max(120, value - 20))}
              title="Slower (-)"
              aria-label="Slower"
            >
              <UiIcon name="minus" size={16} />
            </button>
            <button
              type="button"
              className="reader-rsvp-play"
              onClick={() => setReadingPaused((value) => !value)}
              title={readingPaused ? "Resume (Space)" : "Pause (Space)"}
              aria-label={readingPaused ? "Resume" : "Pause"}
            >
              <UiIcon name={readingPaused ? "play" : "pause"} size={18} />
            </button>
            <button
              type="button"
              className="reader-rsvp-button"
              onClick={() => setSpeedReadWpm((value) => Math.min(1000, value + 20))}
              title="Faster (+)"
              aria-label="Faster"
            >
              <UiIcon name="plus" size={16} />
            </button>
            {readingPaused && <span className="reader-rsvp-hint">Paused · Space to resume</span>}
          </div>
        </div>
      )}
    </>
  );
};
