import { useEffect, useRef, useState } from "react";
import { UiIcon } from "../UiIcon";
import { copyPicture, savePicture } from "../pip/diary/picture";
import { CARD_HEIGHT, CARD_STYLES, CARD_WIDTH, drawQuoteCard, quoteFileName } from "./quoteCard";
import { closeQuoteCard, useShareStore } from "./shareStore";
import "./share.css";

const STYLE_KEY = "leaflet.share.quoteStyle";

const keptStyle = () => {
  try {
    const kept = localStorage.getItem(STYLE_KEY);
    return CARD_STYLES.some((style) => style.id === kept) ? (kept as string) : CARD_STYLES[0].id;
  } catch {
    return CARD_STYLES[0].id;
  }
};

/**
 * A highlighted passage as a picture: shown as it will be saved, in one of a
 * few looks, with "Save" and "Copy". Opened from a highlight's card and from
 * the list of notes, in either reader.
 */
export const QuoteCardDialog = () => {
  const quote = useShareStore((state) => state.quote);
  const [styleId, setStyleId] = useState(keptStyle);
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  const style = CARD_STYLES.find((item) => item.id === styleId) ?? CARD_STYLES[0];

  useEffect(() => {
    if (quote && canvas.current) {
      drawQuoteCard(canvas.current, quote, style);
    }
  }, [quote, style]);

  useEffect(() => {
    if (!quote) {
      return undefined;
    }
    setSaid(null);
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    const onKey = (event: KeyboardEvent) => {
      // The reader behind turns pages on these: in here they do nothing but close.
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        closeQuoteCard();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      if (opener?.isConnected) {
        opener.focus({ preventScroll: true });
      }
    };
  }, [quote]);

  if (!quote) {
    return null;
  }

  const choose = (id: string) => {
    setStyleId(id);
    try {
      localStorage.setItem(STYLE_KEY, id);
    } catch {
      // Chosen for now, then.
    }
  };

  const run = async (work: () => Promise<string | null>) => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      const done = await work();
      if (done) {
        setSaid(done);
      }
    } catch (cause) {
      setSaid(cause instanceof Error && cause.message ? cause.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  };

  const words = `“${quote.text.replace(/\s+/g, " ").trim()}”\n${quote.title}${quote.author ? `, ${quote.author}` : ""}`;

  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/55 px-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          closeQuoteCard();
        }
      }}
    >
      <div ref={panel} role="dialog" aria-modal="true" aria-label="Share this passage as a picture" className="modal-surface confirm-pop share-dialog rounded-2xl p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xs uppercase tracking-widest text-on-surface-variant">Share as a picture</h2>
          <button type="button" className="share-close" onClick={closeQuoteCard} aria-label="Close" title="Close (Esc)">
            <UiIcon name="close" size={16} />
          </button>
        </div>

        <canvas
          ref={canvas}
          className="share-canvas"
          width={CARD_WIDTH}
          height={CARD_HEIGHT}
          style={{ aspectRatio: `${CARD_WIDTH} / ${CARD_HEIGHT}` }}
          role="img"
          aria-label={`${quote.text.slice(0, 200)}. ${quote.title}`}
        />

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2" role="group" aria-label="Look">
            {CARD_STYLES.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`share-swatch ${item.id === style.id ? "is-on" : ""}`}
                style={{
                  background: item.background.length === 2 ? `linear-gradient(135deg, ${item.background[0]}, ${item.background[1]})` : item.background[0],
                  color: item.ink
                }}
                aria-pressed={item.id === style.id}
                aria-label={item.name}
                title={item.name}
                onClick={() => choose(item.id)}
              >
                Aa
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {said && (
              <span className="text-xs text-on-surface-variant" role="status">
                {said}
              </span>
            )}
            <button
              type="button"
              className="share-action"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const went = canvas.current ? await copyPicture(canvas.current, words) : "none";
                  return went === "picture" ? "Copied." : went === "words" ? "Copied as words." : "Couldn't copy.";
                })
              }
            >
              Copy
            </button>
            <button
              type="button"
              className="share-action is-primary"
              data-autofocus
              disabled={busy}
              onClick={() =>
                void run(async () => (canvas.current && (await savePicture(quoteFileName(quote.title), canvas.current)) ? "Saved." : null))
              }
            >
              Save picture
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
