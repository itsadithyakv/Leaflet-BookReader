import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { UiIcon } from "../components/UiIcon";

/**
 * The reader's first-open walkthrough: what Dotty is, setting up Smart Read,
 * making it your pace, and pausing. Shown once, the first time a book opens on
 * this device; the reader's ··· menu and Settings bring it back.
 */

const TOUR_KEY = "leaflet.reader.tourSeen";
/** Whether books open in Smart Read (paused, ready to go). A preference of this device. */
const START_MODE_KEY = "leaflet.reader.startMode";

export const readerTourSeen = () => {
  try {
    return localStorage.getItem(TOUR_KEY) === "1";
  } catch {
    // Without storage it would show on every book; better not at all.
    return true;
  }
};

export const setReaderTourSeen = (seen: boolean) => {
  try {
    if (seen) {
      localStorage.setItem(TOUR_KEY, "1");
    } else {
      localStorage.removeItem(TOUR_KEY);
    }
  } catch {
    // This session only.
  }
};

export type StartMode = "standard" | "smart";

export const readStartMode = (): StartMode => {
  try {
    return localStorage.getItem(START_MODE_KEY) === "smart" ? "smart" : "standard";
  } catch {
    return "standard";
  }
};

export const saveStartMode = (mode: StartMode) => {
  try {
    localStorage.setItem(START_MODE_KEY, mode);
  } catch {
    // This session only.
  }
};

type Step = { title: string; body: ReactNode; art: ReactNode };

/** A few lines of a page, with Dotty beside one of them. */
const PageArt = ({ moving = false }: { moving?: boolean }) => (
  <div className={`reader-tour-page ${moving ? "is-moving" : ""}`} aria-hidden="true">
    {[92, 100, 84, 97, 70].map((width, line) => (
      <span key={line} className="reader-tour-line" style={{ width: `${width}%` }} />
    ))}
    <span className="reader-tour-dotty" />
  </div>
);

const Keycap = ({ children }: { children: ReactNode }) => <kbd className="reader-tour-key">{children}</kbd>;

type ReaderTourProps = {
  /** The book is laid out as pages, where Dotty and Smart Read are not available. */
  paged: boolean;
  /** Which step shows, so the reader can light up the real Dotty on the first one. */
  onStep: (step: number) => void;
  onClose: () => void;
  /** Starts Smart Read from the tour's last step. */
  onTrySmartRead: () => void;
};

export const ReaderTour = ({ paged, onStep, onClose, onTrySmartRead }: ReaderTourProps) => {
  const [step, setStep] = useState(0);
  const [openInSmart, setOpenInSmart] = useState(() => readStartMode() === "smart");
  const cardRef = useRef<HTMLDivElement | null>(null);

  const steps: Step[] = [
    {
      title: "Meet Dotty",
      art: <PageArt />,
      body: paged ? (
        <>
          Dotty keeps your place in the Scroll layout. Switch <strong>Layout</strong> to <strong>Scroll</strong> in
          the <strong>···</strong> menu to meet it.
        </>
      ) : (
        <>
          The glowing dot at the left of the page is Dotty. It keeps your place as you read, and you can drag it
          to any line to mark where you are.
        </>
      )
    },
    {
      title: "Smart Read",
      art: <PageArt moving />,
      body: (
        <>
          Let Dotty lead. In the <strong>···</strong> menu choose <strong>Reading mode</strong>, then{" "}
          <strong>Smart Read</strong>, and pick where to start. Dotty moves along the text at your pace, and when
          it nears the bottom the page turns up in one smooth step.
        </>
      )
    },
    {
      title: "It learns your pace",
      art: (
        <div className="reader-tour-pace" aria-hidden="true">
          <span className="reader-tour-pace-button">
            <UiIcon name="minus" size={14} />
          </span>
          <span className="reader-tour-pace-main">240 wpm</span>
          <span className="reader-tour-pace-button">
            <UiIcon name="plus" size={14} />
          </span>
        </div>
      ),
      body: (
        <>
          Reading faster than Dotty? Just scroll on ahead: it catches up and speeds up. Too fast? Press{" "}
          <Keycap>−</Keycap> or drag Dotty back a line. Leaflet learns your pace in every book, even with Smart
          Read off, and it follows you to your other devices.
        </>
      )
    },
    {
      title: "Pausing",
      art: (
        <div className="reader-tour-keys" aria-hidden="true">
          <Keycap>Space</Keycap>
          <UiIcon name="hand" size={22} />
        </div>
      ),
      body: (
        <>
          <Keycap>Space</Keycap> pauses and carries on. Hold a finger or the mouse on the text and Dotty waits
          while you think. Switch to another app and Smart Read and auto-scroll pause until you are back.
        </>
      )
    }
  ];
  const last = step === steps.length - 1;

  useEffect(() => {
    onStep(step);
  }, [step]);

  useEffect(() => {
    cardRef.current?.focus();
  }, []);

  const finish = (trySmartRead = false) => {
    setReaderTourSeen(true);
    saveStartMode(openInSmart ? "smart" : "standard");
    onClose();
    if (trySmartRead) {
      onTrySmartRead();
    }
  };

  // The reader's own keys (Space, the arrows) must not act on the book underneath.
  const onKeyDown = (event: KeyboardEvent) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      finish();
    } else if (event.key === "ArrowRight" && !last) {
      event.preventDefault();
      setStep(step + 1);
    } else if (event.key === "ArrowLeft" && step > 0) {
      event.preventDefault();
      setStep(step - 1);
    }
  };

  const current = steps[step];
  return (
    <div className="reader-tour" role="presentation" data-step={step} onKeyDown={onKeyDown}>
      <div
        ref={cardRef}
        className="reader-tour-card reader-panel reader-border"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reader-tour-title"
        tabIndex={-1}
      >
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-[0.22em] reader-muted">
            How reading works · {step + 1} of {steps.length}
          </span>
          <button type="button" className="reader-tour-skip reader-muted" onClick={() => finish()}>
            Skip
          </button>
        </div>
        <div className="reader-tour-art">{current.art}</div>
        <h2 id="reader-tour-title" className="font-headline text-xl font-bold reader-text-color">
          {current.title}
        </h2>
        <p className="mt-2 text-sm leading-relaxed reader-muted">{current.body}</p>
        {last && !paged && (
          <label className="reader-tour-option">
            <input type="checkbox" checked={openInSmart} onChange={(event) => setOpenInSmart(event.target.checked)} />
            <span>Open books in Smart Read, paused and ready</span>
          </label>
        )}
        <div className="mt-5 flex items-center gap-3">
          <div className="reader-tour-dots" aria-hidden="true">
            {steps.map((item, index) => (
              <span key={item.title} className={index === step ? "is-current" : ""} />
            ))}
          </div>
          <div className="ml-auto flex gap-2">
            {step > 0 && (
              <button type="button" className="reader-notes-action" onClick={() => setStep(step - 1)}>
                Back
              </button>
            )}
            {!last && (
              <button type="button" className="reader-notes-action is-primary" onClick={() => setStep(step + 1)}>
                Next
              </button>
            )}
            {last && !paged && (
              <button type="button" className="reader-notes-action" onClick={() => finish()}>
                Start reading
              </button>
            )}
            {last && (
              <button
                type="button"
                className="reader-notes-action is-primary"
                onClick={() => finish(!paged)}
              >
                {paged ? "Start reading" : "Try Smart Read"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
