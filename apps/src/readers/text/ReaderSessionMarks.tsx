import type { CSSProperties } from "react";
import { FocusFlower, flowerLook } from "../../components/FocusFlower";
import { SESSION_MARK_LOOK, sessionMarkSpot } from "../sessionMark";
import type { ReaderScope } from "./scope";

/**
 * A focus session's mark (the flower or the mug) and its checkpoints. The
 * mark sits where the text never is (readers/sessionMark.ts): on a phone in
 * the footer's strip, with pages in the room under the page's text.
 */
export const ReaderSessionMarks = ({ reader }: { reader: ReaderScope }) => {
  const {
    activeSession, checkpointLevel, checkpointOpen, checkpointTimerRef, coffeeProgress, handleCheckpointContinue,
    handleCheckpointEnd, layout, setCheckpointOpen, shape
  } = reader;
  const spot = sessionMarkSpot(shape, layout);
  const look = SESSION_MARK_LOOK[spot];
  const place = {
    "--session-mark-scale": look.scale,
    "--session-mark-bottom": `${look.bottom}px`,
    "--session-mark-opacity": look.opacity
  } as CSSProperties;
  return (
    <>
      {activeSession?.flower ? (
        // A session started in full screen grows its flower here instead.
        <div className="leaflet-flower" data-spot={spot} style={place}>
          <FocusFlower kind={activeSession.flower.kind} {...flowerLook(activeSession.flower, coffeeProgress)} box={72} />
        </div>
      ) : activeSession && (
        <div className={`leaflet-mug ${coffeeProgress >= 0.99 ? "leaflet-mug-done" : ""}`} data-spot={spot} style={place}>
          <div className="leaflet-mug-cup">
            <div
              className="leaflet-mug-coffee"
              style={{ height: `${Math.min(100, Math.round(coffeeProgress * 100))}%` }}
            />
            <div className="leaflet-mug-handle" />
          </div>
          {coffeeProgress > 0.2 && (
            <div className="leaflet-mug-steam" />
          )}
          {coffeeProgress > 0.5 && (
            <div className="leaflet-mug-steam" />
          )}
          {coffeeProgress > 0.75 && (
            <div className="leaflet-mug-steam" />
          )}
        </div>
      )}

      {checkpointOpen && checkpointLevel && (
        <div className="reader-checkpoint fixed bottom-6 right-6 z-[70] w-full max-w-xs">
          <div
            className="rounded-xl border p-4 text-left shadow-2xl reader-panel reader-border"
            onMouseEnter={() => {
              if (checkpointTimerRef.current) {
                window.clearTimeout(checkpointTimerRef.current);
                checkpointTimerRef.current = null;
              }
            }}
            onMouseLeave={() => {
              if (!checkpointTimerRef.current) {
                checkpointTimerRef.current = window.setTimeout(() => {
                  setCheckpointOpen(false);
                }, 6000);
              }
            }}
          >
            <div className="text-[10px] uppercase tracking-widest reader-muted">Focus Checkpoint</div>
            <h3 className="mt-2 text-sm font-headline font-bold reader-text-color">
              {checkpointLevel === 0.5
                ? "Halfway There"
                : checkpointLevel === 0.9
                  ? "Almost Done"
                  : "Session Complete"}
            </h3>
            <p className="mt-1 text-xs reader-muted">
              {checkpointLevel === 1
                ? "Great session. Continue or end and save your progress."
                : "Nice work. Keep the momentum going."}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {checkpointLevel === 1 && (
                <button
                  type="button"
                  className="rounded-md border px-3 py-1 text-[10px] uppercase tracking-widest transition reader-border reader-icon reader-hover-accent"
                  onClick={handleCheckpointContinue}
                >
                  Continue +10 min
                </button>
              )}
              {checkpointLevel === 1 ? (
                <button
                  type="button"
                  className="tactile-button tactile-button-primary rounded-md px-3 py-1 text-[10px] font-semibold"
                  onClick={handleCheckpointEnd}
                >
                  End Session
                </button>
              ) : (
                <button
                  type="button"
                  className="rounded-md border px-3 py-1 text-[10px] uppercase tracking-widest transition reader-border reader-icon reader-hover-accent"
                  onClick={() => {
                    if (checkpointTimerRef.current) {
                      window.clearTimeout(checkpointTimerRef.current);
                      checkpointTimerRef.current = null;
                    }
                    setCheckpointOpen(false);
                  }}
                >
                  Keep Reading
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
