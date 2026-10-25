import { useEffect, useRef, useState } from "react";
import { Copy, Download, Share2, X } from "lucide-react";
import { copyPicture, savePicture } from "../../pip/diary/picture";
import { onAndroid } from "../../../platform/android";
import type { YearReview } from "../yearReview";
import { SHARE_SIZES, renderScene, shareFileName, type ShareSize } from "./render";
import { sceneHasTitles, sceneWords, type SceneId } from "./scenes";

const SIZE_KEY = "leaflet.year.shareSize";
const TITLES_KEY = "leaflet.year.hideTitles";

const kept = <T,>(key: string, read: (value: string | null) => T): T => {
  try {
    return read(localStorage.getItem(key));
  } catch {
    return read(null);
  }
};
const keep = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Chosen for now, then.
  }
};

/**
 * A scene's picture, to share: the size (a Story, a post, a square), book
 * titles hidden or not, and on a phone the system's share sheet (Instagram,
 * WhatsApp, Photos and the rest); on a computer, Copy and Save. The picture
 * is drawn here, on this device, and goes only where the reader sends it.
 */
export const ShareSheet = ({
  scene,
  review,
  covers,
  highlightAt,
  onClose
}: {
  scene: SceneId;
  review: YearReview;
  covers: Map<string, CanvasImageSource>;
  highlightAt: number;
  onClose: () => void;
}) => {
  const [size, setSize] = useState<ShareSize>(() => kept(SIZE_KEY, (value) => (value && value in SHARE_SIZES ? (value as ShareSize) : "story")));
  const [hideTitles, setHideTitles] = useState(() => kept(TITLES_KEY, (value) => value === "1"));
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  const titled = sceneHasTitles(scene, review);
  const hide = titled && hideTitles;
  const words = sceneWords(scene, review, { hideTitles: hide, highlightAt });
  const phone = onAndroid();

  useEffect(() => {
    if (canvas.current) {
      renderScene(canvas.current, scene, review, { size, hideTitles: hide, highlightAt, covers });
    }
  }, [scene, review, size, hide, highlightAt, covers]);

  useEffect(() => {
    // Without scrolling: the sheet starts below the stage as it slides up, and a scroll to it would carry the scene off.
    panel.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus({ preventScroll: true });
  }, []);

  useEffect(() => setSaid(null), [size, hide]);

  const run = async (work: () => Promise<string | null>) => {
    if (busy) return;
    setBusy(true);
    try {
      const done = await work();
      if (done) setSaid(done);
    } catch (cause) {
      setSaid(cause instanceof Error && cause.message ? cause.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  };
  const name = shareFileName(review, scene, size);
  const { width, height } = SHARE_SIZES[size];

  return (
    <div className="ys-sheet-back" data-ys-control onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={panel} className="ys-sheet" role="dialog" aria-modal="true" aria-label="Share this">
        <div className="ys-sheet-preview">
          <canvas ref={canvas} width={width} height={height} style={{ aspectRatio: `${width} / ${height}` }} role="img" aria-label={words} />
        </div>
        <div className="ys-sheet-row" role="group" aria-label="Size">
          {(Object.keys(SHARE_SIZES) as ShareSize[]).map((id) => (
            <button
              key={id}
              type="button"
              className={`ys-chip ${id === size ? "is-on" : ""}`}
              aria-pressed={id === size}
              title={`${SHARE_SIZES[id].width} × ${SHARE_SIZES[id].height}`}
              onClick={() => {
                setSize(id);
                keep(SIZE_KEY, id);
              }}
            >
              <span className={`ys-chip-shape is-${id}`} aria-hidden="true" />
              {SHARE_SIZES[id].name}
            </button>
          ))}
        </div>
        {titled && (
          <label className="ys-switch">
            <input
              type="checkbox"
              checked={hideTitles}
              onChange={(event) => {
                setHideTitles(event.target.checked);
                keep(TITLES_KEY, event.target.checked ? "1" : "0");
              }}
            />
            <span className="ys-switch-track" aria-hidden="true" />
            Hide book titles
          </label>
        )}
        <div className="ys-share-actions">
          {said && (
            <span className="ys-said" role="status">
              {said}
            </span>
          )}
          <button type="button" className="ys-action" onClick={onClose} aria-label="Close" title="Close (Esc)">
            <X size={16} aria-hidden />
          </button>
          {!phone && (
            <button
              type="button"
              className="ys-action"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const went = canvas.current ? await copyPicture(canvas.current, words) : "none";
                  return went === "picture" ? "Copied." : went === "words" ? "Copied as words." : "Couldn't copy.";
                })
              }
            >
              <Copy size={16} aria-hidden />
              Copy
            </button>
          )}
          <button
            type="button"
            className="ys-action is-primary"
            data-autofocus
            disabled={busy}
            onClick={() => void run(async () => (canvas.current && (await savePicture(name, canvas.current)) && !phone ? "Saved." : null))}
          >
            {phone ? <Share2 size={16} aria-hidden /> : <Download size={16} aria-hidden />}
            {phone ? "Share" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
};
