import { useEffect, useId, useRef, useState, type SyntheticEvent } from "react";
import { createPortal } from "react-dom";
import { UiIcon } from "../../../UiIcon";
import { copyPicture, savePicture } from "../../diary/picture";
import { cardFontsReady } from "../../diary/postcard";
import type { GameArt } from "../gameArt";
import { drawPostcard, postcardFileName, postcardSize, postcardWords, type PostcardStats } from "./postcard";
import type { CampLook } from "./scene";
import "./postcard.css";

export type { PostcardStats } from "./postcard";

type HollowPostcardProps = {
  art: GameArt;
  look: CampLook;
  stats: PostcardStats;
  onClose: () => void;
};

const kept = (event: SyntheticEvent) => event.stopPropagation();

/**
 * The Hollow as a postcard: the camp and the reading that built it, one
 * picture, to save or to copy. It is drawn here, on this canvas, and goes
 * nowhere unless the reader sends it.
 *
 * It opens over whatever is showing, on the page itself and not inside the
 * camp's own page, so nothing that page does to its children (a transform,
 * a clip) can move it; and what is pressed or typed in it is kept from the
 * camp under it.
 */
export const HollowPostcard = ({ art, look, stats, onClose }: HollowPostcardProps) => {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const titleId = useId();
  const size = postcardSize(stats);
  const words = postcardWords(stats);
  // The figures by what they are, not by which object holds them: a parent that makes them anew each time it draws does not have the card drawn again.
  const figures = JSON.stringify([stats.name, stats.level, stats.books, stats.minutes, stats.streak, stats.lately]);
  const drawn = useRef(stats);
  drawn.current = stats;
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    let live = true;
    const draw = () => {
      const ctx = live ? canvas.current?.getContext("2d") : null;
      if (ctx) drawPostcard(ctx, art, look, drawn.current);
    };
    // At once, so there is never an empty frame; again once the app's own lettering is in.
    draw();
    void cardFontsReady().then(draw);
    return () => {
      live = false;
    };
    // A canvas is wiped when its size changes: the size is among what it is drawn again for.
  }, [art, look, figures, size.width, size.height]);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    // Capture phase, like Pip's own confirm: the camp's Escape never sees it.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        close.current();
        return;
      }
      if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) return;
      // Tab stays on the card's own buttons, and comes back to them if it has got away.
      const buttons = Array.from(panel.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
      if (buttons.length === 0) return;
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = at < 0 ? (event.shiftKey ? buttons.length - 1 : 0) : (at + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
      event.preventDefault();
      buttons[next].focus();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  const run = async (work: () => Promise<string | null>) => {
    if (busy) return;
    setBusy(true);
    try {
      const done = await work();
      if (done) setSaid(done);
    } catch (cause) {
      setSaid(typeof cause === "string" && cause ? cause : cause instanceof Error && cause.message ? cause.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div
      className="pip-confirm-backdrop"
      onMouseDown={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) onClose();
      }}
      // A portal's events still climb to the page that opened it: the camp is not to take them for its own.
      onPointerDown={kept}
      onPointerMove={kept}
      onPointerUp={kept}
      onClick={kept}
      onDoubleClick={kept}
      onContextMenu={kept}
      onWheel={kept}
      onKeyDown={kept}
      onKeyUp={kept}
    >
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} className="hollow-postcard confirm-pop">
        <div className="hollow-postcard-head">
          <h2 id={titleId} className="hollow-postcard-title">
            Postcard
          </h2>
          <button type="button" className="pip-key pip-key-quiet pip-key-small" onClick={onClose} aria-label="Close" title="Close (Esc)">
            <UiIcon name="close" size={16} />
          </button>
        </div>
        <canvas ref={canvas} className="hollow-postcard-canvas" width={size.width} height={size.height} role="img" aria-label={words} />
        <div className="hollow-postcard-foot">
          <span className="hollow-postcard-said" role="status">
            {said}
          </span>
          <button
            type="button"
            className="pip-key"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const went = canvas.current ? await copyPicture(canvas.current, words) : "none";
                return went === "picture" ? "Copied." : went === "words" ? "Copied as words." : "Couldn't copy.";
              })
            }
          >
            <UiIcon name="copy" size={15} />
            Copy
          </button>
          <button
            type="button"
            className="pip-key pip-key-primary"
            data-autofocus
            disabled={busy}
            onClick={() => void run(async () => (canvas.current && (await savePicture(postcardFileName(new Date()), canvas.current)) ? "Saved." : null))}
          >
            <UiIcon name="upload" size={15} />
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
