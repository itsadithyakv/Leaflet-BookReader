import { hash } from "./hash";

/**
 * How a spine is dressed: its binding, and now and then a sticker or a little
 * wear. Everything is chosen from stable keys (the book, the session's seed),
 * never at random, so a spine looks the same on every render and every device.
 *
 * - The binding belongs to the book, so a run of sessions on one book stands
 *   as a matching set.
 * - A sticker always means something about the session (`stickerFor`).
 * - Wear means nothing but age: only spines from two or more weeks back show
 *   it, and only a few of them.
 */

export type Binding = "cloth" | "leather" | "paperback" | "library" | "label";
export type Sticker = "star" | "moon" | "cup";
export type Wear = "dogear" | "watermark" | "scuff" | "faded";

export type SpineLook = {
  binding: Binding;
  sticker: Sticker | null;
  wear: Wear | null;
};

/** Out of 100: most books in plain cloth, the rest spread over the others. */
const BINDINGS: Array<[Binding, number]> = [
  ["cloth", 36],
  ["leather", 18],
  ["paperback", 18],
  ["label", 16],
  ["library", 12]
];

/** A book's binding, the same wherever the book stands. */
export const bindingFor = (bookKey: string | null): Binding => {
  if (!bookKey) {
    return "cloth";
  }
  let roll = hash(`binding:${bookKey}`) % 100;
  for (const [binding, share] of BINDINGS) {
    if (roll < share) {
      return binding;
    }
    roll -= share;
  }
  return "cloth";
};

/** Small, steady differences in size between bindings: a tome stands taller than a paperback. */
export const BINDING_SIZE: Record<Binding, { h: number; w: number }> = {
  cloth: { h: 0, w: 0 },
  leather: { h: 4, w: 2 },
  paperback: { h: -6, w: -1 },
  label: { h: 2, w: 0 },
  library: { h: 0, w: 1 }
};

/** What each sticker says, for the spine's tip and its label. */
export const STICKER_TEXT: Record<Sticker, string> = {
  star: "Longest session of its week",
  moon: "A late-night read",
  cup: "An early-morning read"
};

/** Sessions a week needs before its longest earns a star: a short week has nothing much to beat. */
export const STAR_MIN_SESSIONS = 4;

/**
 * The sticker a session earns, if any (at most one): a star for the week's
 * longest, a moon for a start between 23:00 and 04:00, a coffee ring for a
 * start between 04:00 and 08:00.
 */
export const stickerFor = (start: Date, longestOfWeek: boolean): Sticker | null => {
  if (longestOfWeek) {
    return "star";
  }
  const hour = start.getHours();
  if (Number.isNaN(hour)) {
    return null;
  }
  if (hour >= 23 || hour < 4) {
    return "moon";
  }
  if (hour < 8) {
    return "cup";
  }
  return null;
};

const WEARS: Wear[] = ["dogear", "watermark", "scuff", "faded"];
/** Weeks back before a spine can show wear. */
export const WEAR_FROM_WEEKS = 2;
/** Of the spines old enough, how many in 100 show wear. */
export const WEAR_RATE = 18;

/** A little wear on an older spine, from its own seed. */
export const wearFor = (seed: string, weeksAgo: number): Wear | null => {
  if (weeksAgo < WEAR_FROM_WEEKS) {
    return null;
  }
  const roll = hash(`wear:${seed}`);
  return roll % 100 < WEAR_RATE ? WEARS[(roll >>> 8) % WEARS.length] : null;
};

// ---- A coverless book in the library --------------------------------------

/** Of 100 coverless books, how many carry a cup ring, and how many a worn corner. */
export const COVER_RING_RATE = 14;
export const COVER_WORN_RATE = 12;

const GILT_RULE = "linear-gradient(90deg, rgb(156 118 40 / 0.9), rgb(242 214 136 / 0.95) 45%, rgb(184 143 52 / 0.9))";

/**
 * The extra layers of a cover drawn in a book's cloth (`--cloth-deco`): its
 * binding's finish and, on a few books, a cup ring in the top corner or a worn
 * corner at the foot. Kept to the edges, clear of the lettering, and quiet.
 */
export const coverDeco = (key: string) => {
  const layers: string[] = [];
  const roll = hash(`cover:${key}`);
  if (roll % 100 < COVER_RING_RATE) {
    layers.push(
      // A doubled, soft-edged tide line, as a cup set down twice leaves it.
      "radial-gradient(circle 22px at calc(100% - 12px) 14px, transparent 0 15.5px, rgb(110 66 24 / 0.2) 17px, rgb(110 66 24 / 0.3) 18.5px, transparent 21px)",
      "radial-gradient(circle 21px at calc(100% - 16px) 18px, transparent 0 16.5px, rgb(226 182 116 / 0.14) 18px, transparent 20.5px)"
    );
  }
  if ((roll >>> 8) % 100 < COVER_WORN_RATE) {
    layers.push("radial-gradient(circle at 100% 100%, rgb(255 248 232 / 0.2), transparent 16px)");
  }
  switch (bindingFor(key)) {
    case "leather":
      // Gilt fillets at head and tail, outside the lettering's margins.
      layers.push(
        `${GILT_RULE} 0 5% / 100% 1px no-repeat`,
        `${GILT_RULE} 0 calc(5% + 3px) / 100% 1px no-repeat`,
        `${GILT_RULE} 0 95% / 100% 1px no-repeat`,
        `${GILT_RULE} 0 calc(95% - 3px) / 100% 1px no-repeat`
      );
      break;
    case "paperback":
      layers.push("linear-gradient(115deg, rgb(255 255 255 / 0.13), transparent 38%)");
      break;
    default:
      // Cloth: a fine weave.
      layers.push("repeating-linear-gradient(0deg, rgb(255 255 255 / 0.022) 0 1px, transparent 1px 3px)");
  }
  return layers.join(", ");
};
