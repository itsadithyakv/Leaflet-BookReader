import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { UiIcon } from "../../../UiIcon";
import type { PictureCard, StudyCard } from "../../../../study/cards";
import { parts, type Range } from "../../../../study/fillIn";
import { maskOnImage, withinCrop, type Placed } from "../../../../study/pictureBoxes";
import { PictureMissing, type LoadedPicture, type PictureLoader } from "../../../../study/pictureSource";

/**
 * A study card's face, as review shows it (and the list of a book's cards):
 * the passage with its blanks, the question, or the picture with its box
 * covered. `shown` is after the reveal.
 */

/** The passage with each hidden run a blank as long as what it hides (its length is a clue, as on paper). */
export const FillPassage = ({ passage, hidden, shown }: { passage: string; hidden: Range[]; shown: boolean }) => (
  <p className="pip-card-passage">
    {parts(passage, hidden).map((part, index) =>
      part.hidden ? (
        <span key={index} className="pip-card-blank" data-shown={shown || undefined}>
          {shown ? (
            part.text
          ) : (
            <>
              <span className="pip-card-blank-fill" aria-hidden="true">
                {part.text}
              </span>
              <span className="sr-only">blank</span>
            </>
          )}
        </span>
      ) : (
        <span key={index}>{part.text}</span>
      )
    )}
  </p>
);

type PictureState = { status: "loading" } | { status: "ready"; picture: LoadedPicture } | { status: "missing" } | { status: "failed" };

/** A picture card's picture, from its book on this device. */
export const usePicture = (card: PictureCard | null, loader: PictureLoader | null): PictureState => {
  const [state, setState] = useState<PictureState>({ status: "loading" });
  const key = card ? `${card.bookId}|${card.picture.kind === "pdf" ? card.picture.page : card.picture.path}|${JSON.stringify(card.crop)}` : "";
  useEffect(() => {
    if (!card || !loader) return undefined;
    let live = true;
    setState({ status: "loading" });
    loader.load(card.bookId, card.picture, card.crop).then(
      (picture) => live && setState({ status: "ready", picture }),
      (failure) => live && setState({ status: failure instanceof PictureMissing ? "missing" : "failed" })
    );
    return () => {
      live = false;
    };
    // The same picture for every box of it: loaded once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, loader]);
  return state;
};

/**
 * The picture with one box covered and marked; the rest of it as drawn.
 * Revealed, the box is open and outlined, with what is under it if the
 * reader wrote it. With the book not on this device, a placeholder of the
 * same shape, the box still in its place.
 *
 * The cover is placed in pixels on the picture as drawn (where it sits in
 * the frame and how large: `maskOnImage`, the one mapping), measured once it
 * has loaded and again whenever it is drawn another size. Until then the
 * picture is not shown: no label is ever seen uncovered.
 */
export const PictureFace = ({ card, loader, shown }: { card: PictureCard; loader: PictureLoader | null; shown: boolean }) => {
  const state = usePicture(card, loader);
  const image = useRef<HTMLImageElement | null>(null);
  const [placed, setPlaced] = useState<Placed | null>(null);
  const ready = state.status === "ready";

  useLayoutEffect(() => {
    const node = image.current;
    if (!ready || !node) {
      setPlaced(null);
      return undefined;
    }
    const measure = () => {
      if (!node.complete || node.offsetWidth === 0) return;
      setPlaced((now) => {
        const next = { left: node.offsetLeft, top: node.offsetTop, width: node.offsetWidth, height: node.offsetHeight };
        return now && now.left === next.left && now.top === next.top && now.width === next.width && now.height === next.height ? now : next;
      });
    };
    measure();
    node.addEventListener("load", measure);
    const watch = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    watch?.observe(node);
    return () => {
      node.removeEventListener("load", measure);
      watch?.disconnect();
    };
  }, [ready, state.status === "ready" ? state.picture.url : ""]);

  // Before the picture is measured, the cover goes where the placeholder's box would be.
  const cover = placed ? maskOnImage(card.mask, card.crop, placed) : null;
  const unplaced = withinCrop(card.mask, card.crop);
  return (
    <figure className="pip-card-picture">
      <div className="pip-card-picture-frame" data-state={state.status}>
        {ready ? (
          <img ref={image} src={state.picture.url} alt="" draggable={false} style={placed ? undefined : { visibility: "hidden" }} />
        ) : (
          <span className="pip-card-picture-wait">
            {state.status === "loading" ? (
              "Finding the picture…"
            ) : (
              <>
                <UiIcon name="library" size={18} />
                {state.status === "missing" ? "The book isn't on this device." : "The picture couldn't be found in the book."}
              </>
            )}
          </span>
        )}
        {(cover || !ready) && (
          <span
            className="pip-card-mask"
            data-shown={shown || undefined}
            style={
              cover
                ? { left: cover.left, top: cover.top, width: cover.width, height: cover.height }
                : { left: `${unplaced.left * 100}%`, top: `${unplaced.top * 100}%`, width: `${unplaced.width * 100}%`, height: `${unplaced.height * 100}%` }
            }
            aria-hidden="true"
          >
            {!shown && "?"}
          </span>
        )}
      </div>
      {/* Opened, the box shows the picture's own words; what the reader wrote under it, too, when they did. */}
      {shown && card.label && <figcaption className="pip-card-label">{card.label}</figcaption>}
    </figure>
  );
};

/** One line saying what a card asks, for a list. */
export const cardSummary = (card: StudyCard) => {
  if (card.kind === "fill") {
    return parts(card.passage, card.hidden)
      .map((part) => (part.hidden ? "____" : part.text))
      .join("");
  }
  if (card.kind === "ask") {
    return card.question;
  }
  return card.label ? `Box over “${card.label}”` : "A box on the picture";
};

export const KIND_NAMES: Record<StudyCard["kind"], string> = { fill: "Fill in", ask: "Question", pic: "Picture" };
