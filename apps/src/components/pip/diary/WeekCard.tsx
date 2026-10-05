import { useEffect, useMemo, useRef, useState } from "react";
import { UiIcon } from "../../UiIcon";
import type { DiaryEntry } from "../../../pip/diary/entry";
import type { DiaryFacts } from "../../../pip/diary/facts";
import { weekSummary } from "../../../pip/diary/week";
import { copyPicture, pictureFileName, savePicture } from "./picture";
import { CARD_H, CARD_W, cardFontsReady, cardText, drawPostcard, weekRange, type CardLook } from "./postcard";

type WeekCardProps = {
  facts: DiaryFacts;
  entries: DiaryEntry[];
  /** The weeks with anything read in them, oldest first, each by its Monday. */
  weeks: string[];
  week: string;
  onWeek: (week: string) => void;
  look: CardLook;
};

/**
 * The diary's weekly page: the week as a pixel postcard, to save as a picture
 * or copy. The picture is drawn here, on this canvas, and goes nowhere unless
 * the reader sends it.
 */
export const WeekCard = ({ facts, entries, weeks, week, onWeek, look }: WeekCardProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const summary = useMemo(() => weekSummary(facts, entries, week), [facts, entries, week]);
  const outfitKey = look.outfit.join("+");
  const at = weeks.indexOf(week);

  useEffect(() => {
    let current = true;
    const draw = () => current && canvasRef.current && drawPostcard(canvasRef.current, summary, look);
    // At once, so there is never an empty frame; again once the app's own lettering is in.
    draw();
    void cardFontsReady().then(draw);
    return () => {
      current = false;
    };
    // The outfit is compared by what it holds, not by which array it is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary, look.skin, outfitKey]);

  useEffect(() => setSaid(null), [week]);

  const save = async () => {
    const canvas = canvasRef.current;
    if (!canvas || busy) {
      return;
    }
    setBusy(true);
    try {
      setSaid((await savePicture(pictureFileName(summary.start), canvas)) ? "Saved." : null);
    } catch (cause) {
      setSaid(typeof cause === "string" ? cause : cause instanceof Error ? cause.message : "The picture couldn't be saved.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    const canvas = canvasRef.current;
    if (!canvas || busy) {
      return;
    }
    setBusy(true);
    const went = await copyPicture(canvas, cardText(summary));
    setSaid(
      went === "picture"
        ? "Copied the picture."
        : went === "words"
          ? "Copied the card's words: the clipboard here takes no pictures."
          : "Couldn't reach the clipboard. Save it as a picture instead."
    );
    setBusy(false);
  };

  return (
    <div className="pip-diary-week">
      <canvas ref={canvasRef} className="pip-diary-card" width={CARD_W} height={CARD_H} role="img" aria-label={cardText(summary)} />
      <div className="pip-diary-week-side">
        <h3 className="pip-diary-week-title">{weekRange(summary.start, summary.end)}</h3>
        <nav className="pip-diary-turn" aria-label="Turn the weeks">
          <button type="button" className="pip-key pip-key-small" onClick={() => onWeek(weeks[at - 1])} disabled={at <= 0}>
            <UiIcon name="back" size={14} />
            Earlier
          </button>
          <button type="button" className="pip-key pip-key-small" onClick={() => onWeek(weeks[at + 1])} disabled={at < 0 || at >= weeks.length - 1}>
            Later
            <span className="pip-diary-flip">
              <UiIcon name="back" size={14} />
            </span>
          </button>
        </nav>
        <div className="pip-diary-share">
          <button type="button" className="pip-key pip-key-primary" onClick={() => void save()} disabled={busy}>
            <UiIcon name="upload" size={15} />
            Save as picture
          </button>
          <button type="button" className="pip-key" onClick={() => void copy()} disabled={busy}>
            <UiIcon name="copy" size={15} />
            Copy
          </button>
        </div>
        <p className="pip-diary-said" role="status">
          {said}
        </p>
        <p className="pip-diary-note">
          A {CARD_W} by {CARD_H} picture, made on this computer. It holds what you see on it and nothing else, and it is only sent if you send it.
        </p>
      </div>
    </div>
  );
};
