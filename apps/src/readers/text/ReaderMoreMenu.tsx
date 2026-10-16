import { UiIcon } from "../../components/UiIcon";
import { type ReaderDisplayMode, type ReadingMode } from "../readerTypes";
import { autoScrollLinesPerMinute } from "../autoScroll";
import { ReaderAmbienceRow } from "../../ambience";
import { SMART_NUDGE } from "./constants";
import type { ReaderScope } from "./scope";
import { ReaderMoreRows } from "./ReaderTouchRows";
import { isPhoneShape } from "../touchLayout";
import { useTouchInput } from "../../platform/device";

/** The ··· menu: layout, page colour, auto-scroll, Smart Read and SpeedRead, and the rest. */
export const ReaderMoreMenu = ({ reader }: { reader: ReaderScope }) => {
  const {
    autoScrollActive, autoScrollSpeed, chooseLayout, displayMode, layout, morePanelCloseRef, morePanelOpen,
    morePanelRef, nudgeSmartPace, paged, readerDotEnabled, readerTheme, readingMode, readingPaused, requestReadingMode,
    setAutoScrollActive, setDisplayMode, setMorePanelOpen, setReaderDotEnabled, setReadingPaused, setShortcutsOpen,
    setSpeedReadWpm, setTourOpen, shape, smartAtPicture, smartWaiting, smartWpm, speedReadWpm, toggleSmartPlay, toggleTheme,
    tuneAutoScroll
  } = reader;
  // A phone: the toolbar's other buttons are rows here, and the layout and the finish are in the Aa sheet.
  const phone = isPhoneShape(shape);
  const touch = useTouchInput();
  // The menu opens as the mouse reaches it, and shuts a moment after it
  // leaves. Only a mouse: a finger's tap sends the enter just before the
  // click, and the click then shut what the enter had opened.
  const holdOpen = () => {
    if (morePanelCloseRef.current) {
      window.clearTimeout(morePanelCloseRef.current);
      morePanelCloseRef.current = null;
    }
  };
  const closeSoon = () => {
    holdOpen();
    morePanelCloseRef.current = window.setTimeout(() => {
      setMorePanelOpen(false);
    }, 180);
  };
  return (
    <div
      className="relative"
      ref={morePanelRef}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") {
          holdOpen();
          setMorePanelOpen(true);
        }
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse") {
          closeSoon();
        }
      }}
    >
      <button
        className="reader-icon transition-colors reader-hover-accent"
        type="button"
        onClick={() => setMorePanelOpen((prev) => !prev)}
        aria-label="More: reading mode, Dotty and the rest"
        aria-haspopup="dialog"
        aria-expanded={morePanelOpen}
        title="More"
      >
        <span className="material-symbols-outlined">more_horiz</span>
      </button>
      {morePanelOpen && (
        <div
          className="reader-menu absolute right-0 mt-3 w-72 rounded-xl border p-4 text-xs shadow-2xl reader-panel reader-border"
          role="dialog"
          aria-label="More"
          onPointerEnter={(event) => {
            if (event.pointerType === "mouse") {
              holdOpen();
            }
          }}
          onPointerLeave={(event) => {
            if (event.pointerType === "mouse") {
              closeSoon();
            }
          }}
        >
          {phone && <ReaderMoreRows reader={reader} close={() => setMorePanelOpen(false)} />}
          {!phone && <div className="text-xs uppercase tracking-widest reader-muted">Reader</div>}
          {!phone && (
          <div className="mt-3">
            <span className="text-[10px] uppercase tracking-widest reader-muted">Layout</span>
            <div className="mt-1.5 grid grid-cols-2 gap-1" role="radiogroup" aria-label="Layout">
              {(["scroll", "pages"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={layout === option}
                  className={`reader-notes-tab ${layout === option ? "is-active" : ""}`}
                  onClick={() => chooseLayout(option)}
                >
                  {option === "scroll" ? "Scroll" : "Pages"}
                </button>
              ))}
            </div>
          </div>
          )}
          {!phone && (
          <label className="mt-3 block">
            <span className="text-[10px] uppercase tracking-widest reader-muted">Page finish</span>
            <select
              className="reader-select mt-1.5 w-full"
              value={displayMode}
              onChange={(event) => setDisplayMode(event.target.value as ReaderDisplayMode)}
            >
              <option value="paper">Warm paper</option>
              <option value="dark-paper">Dark paper</option>
              <option value="true-white">True white</option>
              <option value="true-black">True black</option>
              <option value="app">Match app theme</option>
            </select>
          </label>
          )}
          <label className="mt-3 block">
            <span className="text-[10px] uppercase tracking-widest reader-muted">Reading mode</span>
            <select
              className="reader-select mt-1.5 w-full"
              value={readingMode}
              onChange={(event) => requestReadingMode(event.target.value as ReadingMode)}
            >
              <option value="standard">Standard</option>
              <option value="smart" disabled={paged}>
                Smart Read{paged ? " (scroll layout)" : ""}
              </option>
              <option value="speed" disabled={paged}>
                SpeedRead (RSVP){paged ? " (scroll layout)" : ""}
              </option>
            </select>
          </label>
          {/* Read aloud, from the first sentence on screen (readers/readAloud). */}
          <button
            type="button"
            className="mt-3 flex w-full items-center justify-between rounded-lg border px-3 py-2 text-xs uppercase tracking-widest transition reader-border reader-pill reader-icon"
            onClick={() => {
              setMorePanelOpen(false);
              if (reader.readAloud.active) reader.readAloud.stop();
              else reader.readAloud.start();
            }}
            title={touch ? undefined : "Read aloud (R)"}
          >
            <span>Read aloud</span>
            <span className="reader-toggle" data-on={reader.readAloud.active} />
          </button>
          <button
            type="button"
            className="mt-3 flex w-full items-center justify-between rounded-lg border px-3 py-2 text-xs uppercase tracking-widest transition reader-border reader-pill reader-icon"
            onClick={toggleTheme}
          >
            <span>App theme</span>
            <span className="reader-toggle" data-on={readerTheme === "light"} />
          </button>
          {!phone && <ReaderAmbienceRow onOpen={() => setMorePanelOpen(false)} />}
          {readingMode === "standard" && !paged && (
          <div className="mt-3 rounded-lg border px-3 py-2 reader-border reader-pill">
            <div className="text-[10px] uppercase tracking-widest reader-muted">Auto scroll</div>
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                className="flex h-7 w-7 items-center justify-center rounded-full border transition reader-border reader-icon reader-hover-accent"
                onClick={() => setAutoScrollActive((prev) => !prev)}
                title={autoScrollActive ? "Pause auto scroll" : "Start auto scroll"}
              >
                <span className="material-symbols-outlined text-sm">
                  {autoScrollActive ? "pause" : "play_arrow"}
                </span>
              </button>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={autoScrollSpeed}
                onChange={(event) => tuneAutoScroll(Number(event.target.value))}
                className="h-1 w-24 cursor-pointer accent-current"
                title={`Auto scroll: ${autoScrollLinesPerMinute(autoScrollSpeed)} lines a minute (+ and - to adjust)`}
              />
              <span className="ml-auto tabular-nums reader-muted">
                {autoScrollLinesPerMinute(autoScrollSpeed)} lines/min
              </span>
            </div>
          </div>
          )}
          {readingMode === "smart" && (
            <div className="mt-3 rounded-lg border px-3 py-3 reader-border reader-pill">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[10px] uppercase tracking-widest reader-muted">Dotty's pace</div>
                  <div className="mt-1 text-sm font-semibold tabular-nums reader-text-color">~{smartWpm} wpm</div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="reader-mini-control"
                    onClick={() => nudgeSmartPace(1 / SMART_NUDGE)}
                    title="Slower (-)"
                    aria-label="Slower"
                  >
                    <UiIcon name="minus" size={14} />
                  </button>
                  <button
                    type="button"
                    className="reader-mini-control"
                    onClick={toggleSmartPlay}
                    title={smartWaiting ? "Read from here (Space)" : readingPaused || smartAtPicture ? "Carry on (Space)" : "Pause (Space)"}
                    aria-label={smartWaiting ? "Read from here" : readingPaused || smartAtPicture ? "Carry on" : "Pause"}
                  >
                    <span className="material-symbols-outlined text-base">
                      {readingPaused || smartWaiting || smartAtPicture ? "play_arrow" : "pause"}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="reader-mini-control"
                    onClick={() => nudgeSmartPace(SMART_NUDGE)}
                    title="Faster (+)"
                    aria-label="Faster"
                  >
                    <UiIcon name="plus" size={14} />
                  </button>
                </div>
              </div>
            </div>
          )}
          {readingMode === "speed" && (
            <div className="mt-3 rounded-lg border px-3 py-3 reader-border reader-pill">
              <div className="flex items-center justify-between">
                <div className="text-[10px] uppercase tracking-widest reader-muted">RSVP speed</div>
                <button
                  type="button"
                  className="reader-mini-control"
                  onClick={() => setReadingPaused((paused) => !paused)}
                >
                  <span className="material-symbols-outlined text-base">
                    {readingPaused ? "play_arrow" : "pause"}
                  </span>
                </button>
              </div>
              <input
                type="range"
                min={120}
                max={1000}
                step={10}
                value={speedReadWpm}
                onChange={(event) => setSpeedReadWpm(Number(event.target.value))}
                className="mt-3 h-1 w-full cursor-pointer accent-current"
                title={`SpeedRead ${speedReadWpm} words per minute`}
              />
              <div className="mt-2 text-right text-[10px] tabular-nums reader-muted">{speedReadWpm} WPM</div>
            </div>
          )}
          <button
            type="button"
            className="mt-3 flex w-full items-center justify-between rounded-lg border px-3 py-2 text-xs uppercase tracking-widest transition reader-border reader-pill reader-icon"
            onClick={() => setReaderDotEnabled((prev) => !prev)}
          >
            <span>Dotty</span>
            <span className="reader-toggle" data-on={readerDotEnabled} />
          </button>
          <button
            type="button"
            className="reader-menu-link mt-2 w-full py-1.5 text-center text-[10px] uppercase tracking-widest transition reader-muted reader-hover-accent"
            onClick={() => {
              setMorePanelOpen(false);
              reader.setRecap({ days: null });
            }}
          >
            Where was I?
          </button>
          <button
            type="button"
            className="reader-menu-link w-full py-1.5 text-center text-[10px] uppercase tracking-widest transition reader-muted reader-hover-accent"
            onClick={() => {
              setMorePanelOpen(false);
              setTourOpen(true);
            }}
          >
            How Dotty works
          </button>
          {/* A phone has no keys to list. */}
          {!touch && (
          <button
            type="button"
            className="w-full py-1.5 text-center text-[10px] uppercase tracking-widest transition reader-muted reader-hover-accent"
            onClick={() => {
              setMorePanelOpen(false);
              setShortcutsOpen(true);
            }}
          >
            Keyboard shortcuts (?)
          </button>
          )}
        </div>
      )}
    </div>
  );
};
