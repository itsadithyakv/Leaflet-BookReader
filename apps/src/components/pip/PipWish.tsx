import { useEffect, useRef } from "react";
import { usePipWardrobeStore, useEquippedPip } from "../../store/pipWardrobeStore";
import { catalogueItem } from "../../pip/shop";
import { renderItem } from "../../pip/home.js";
import { renderPacket } from "../../pip/garden.js";
import { grantedLine, wishView, type WishView } from "../../pip/wish";
import { cuePip } from "../../pip/life";
import { playSound } from "../../pip/sound";
import { bump, centerOf, collect, floatText, seedPixel } from "./fx";
import { PipSprite } from "../PipSprite";
import { PixelImage } from "./PixelImage";
import { shortfall } from "./shopParts";
import { UiIcon } from "../UiIcon";

/** The day whose granted wish this device has celebrated (its own record, never a claim). */
const SEEN_KEY = "leaflet.pip.wishSeen";

const readSeen = () => {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
};
const writeSeen = (day: string) => {
  try {
    localStorage.setItem(SEEN_KEY, day);
  } catch {
    // Celebrated again next time, at worst.
  }
};

const defaultCounter = () => document.querySelector(".pip-hud-seeds");
const defaultHearts = () => document.querySelector(".pip-hearts");

const ACTION_LABEL: Record<WishView["action"], string> = { give: "Give it", plant: "Plant it", shop: "Find it" };

/** The wished-for thing, small: a packet, a piece of decor, or Pip with the snack or the move. */
const WishArt = ({ wish, small = false }: { wish: WishView; small?: boolean }) => {
  const { skin, outfit } = useEquippedPip();
  const box = small ? 28 : 36;
  if (wish.kind === "plant") return <PixelImage render={() => renderPacket(wish.id, 0)} drawKey={`wish-plant-${wish.id}`} box={box} />;
  if (wish.kind === "room") return <PixelImage render={() => renderItem(wish.id, 0)} drawKey={`wish-room-${wish.id}`} box={box} />;
  const move = wish.kind === "treat" ? catalogueItem("treat", wish.id)?.move ?? "idle" : wish.id;
  return <PipSprite move={move} still size={small ? 32 : 40} skin={skin} outfit={outfit} snap="nearest" />;
};

export type PipWishProps = {
  /**
   * Grants the wish: give the snack, open the garden at a free plot, open the
   * shop at the piece or the move. Without it the wish only shows.
   */
  onGrant?: (wish: WishView) => void;
  /** The seed counter and the hearts meter the reward flies to. Default: the Pip tab's. */
  counter?: () => Element | null;
  hearts?: () => Element | null;
  /**
   * One plaque in the HUD's top bar, as tall as the resources: a smaller
   * picture, and the note (what granting gives, or what is missing) as its
   * tooltip and for screen readers.
   */
  compact?: boolean;
  className?: string;
};

/**
 * Pip's wish for today, as a small speech bubble: the thing (a snack, a seed
 * packet, a piece of decor, a move), what Pip says about it, and what
 * granting it gives. Rust chose it from the date and says when it has been
 * granted (a purchase of it today, pip/rewards.rs), which pays the seeds;
 * this shows it, and when it comes true, makes a moment of it: the bubble
 * says thanks, seeds and hearts fly home, and Pip, once free, is delighted.
 *
 * Reads the overview from the wardrobe store; needs nothing else.
 */
export const PipWish = ({ onGrant, counter = defaultCounter, hearts = defaultHearts, compact = false, className }: PipWishProps) => {
  const overview = usePipWardrobeStore((state) => state.overview);
  const view = wishView(overview?.wish, overview?.wallet.balance ?? 0, overview?.garden);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const live = useRef({ counter, hearts });
  live.current = { counter, hearts };

  // Granted: once a day, on this device. Seeds to the counter, hearts to the
  // meter, a chime; and Pip's delight once he is free (after the snack).
  const grantedDay = view?.granted ? view.day : null;
  useEffect(() => {
    if (!grantedDay || readSeen() === grantedDay) return;
    const wish = view;
    const timer = window.setTimeout(() => {
      writeSeen(grantedDay);
      playSound("chime", { pitch: 1.12 });
      cuePip({ move: "smitten", loops: 1, line: grantedLine(grantedDay) });
      const from = bubbleRef.current?.getBoundingClientRect();
      if (!from || from.width === 0 || !wish) return;
      floatText({ x: from.left + from.width / 2, y: from.top }, `+${wish.seeds}`, "gain");
      const seedTarget = live.current.counter();
      const seedBox = seedTarget?.querySelector("svg")?.getBoundingClientRect() ?? seedTarget?.getBoundingClientRect();
      if (seedBox) {
        void collect(centerOf(from), centerOf(seedBox), {
          sprite: "seed",
          count: 4,
          px: seedPixel(4),
          onLand: (index) => bump(seedTarget, index === 3 ? 1.1 : 0.5)
        });
      }
      const heartTarget = live.current.hearts();
      const heartBox = heartTarget?.getBoundingClientRect();
      if (heartBox) {
        void collect(centerOf(from), centerOf(heartBox), { sprite: "heart", count: 3, px: 3, stagger: 140, onLand: () => bump(heartTarget, 0.6) });
      }
    }, 1200);
    return () => window.clearTimeout(timer);
    // The day is what matters; the view is read as it stands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grantedDay]);

  if (!view) return null;
  const lacking = shortfall(view.price, overview?.wallet.balance ?? 0);
  const blocked = view.needsPlot || lacking !== null;
  const note = view.granted
    ? `Granted today: +${view.seeds} seeds, and a happy Pip.`
    : view.needsPlot
      ? "When a plot is free: pick what's ripe first."
      : lacking
        ? `${lacking.short} more seeds: about ${lacking.minutes} minutes of focused reading.`
        : `Grant it today: +${view.seeds} seeds, and a happy Pip.`;

  return (
    <div
      ref={bubbleRef}
      className={`pip-wish ${compact ? "is-compact" : ""} ${className ?? ""}`}
      data-granted={view.granted || undefined}
      role="group"
      aria-label="Pip's wish for today"
      title={compact ? note : undefined}
    >
      <span className="pip-wish-art" aria-hidden="true">
        <WishArt wish={view} small={compact} />
        {view.granted && (
          <span className="pip-wish-check">
            <UiIcon name="check" size={11} strokeWidth={3} />
          </span>
        )}
      </span>
      <span className="pip-wish-text">
        <span className="pip-wish-label">{view.granted ? "Wish granted" : "Pip's wish today"}</span>
        <span className="pip-wish-line">{view.granted ? grantedLine(view.day) : view.line}</span>
        <span className={compact ? "sr-only" : "pip-wish-note"}>{note}</span>
      </span>
      {!view.granted && onGrant && (
        <button
          type="button"
          className="pip-say-button pip-say-button-primary pip-wish-button"
          disabled={blocked}
          onClick={() => onGrant(view)}
          aria-label={`${ACTION_LABEL[view.action]}: ${view.name}, ${view.price} seeds`}
        >
          {ACTION_LABEL[view.action]}
          <span className="pip-wish-price">
            <UiIcon name="seed" size={11} />
            {view.price}
          </span>
        </button>
      )}
    </div>
  );
};
