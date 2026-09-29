/**
 * Pip's daily wish, as the Pip tab shows it: what Pip says about it, whether
 * it can be granted now, and what granting it takes.
 *
 * Rust chooses the wish (pip/rewards.rs: from the date, and what Pip had
 * before the day began) and says whether it was granted, because the seeds a
 * granted wish pays are worked out there, from purchases every device
 * shares. This is the wording and the arithmetic around it.
 */
import { catalogueItem } from "./shop";
import type { GardenView, WishStatus } from "../services/pipService";

export type WishKind = WishStatus["kind"];

/** What granting a wish takes, for the button beside it. */
export type WishAction = "give" | "plant" | "shop";

export type WishView = WishStatus & {
  /** The thing's own name ("Cookie", "Floor Lamp"). */
  name: string;
  /** What Pip says: short and lowercase. */
  line: string;
  price: number;
  /** Seeds still to find before it can be granted, or 0. */
  short: number;
  /** A seed packet with no empty plot to go in. */
  needsPlot: boolean;
  action: WishAction;
};

const LINES: Record<WishKind, string[]> = {
  treat: ["i could really go for {a}.", "is it {a} kind of day? it feels like one.", "i dreamt about {a}. just saying."],
  plant: ["can we plant {a} today?", "i'd love to grow {a}.", "{a} in the garden would be nice."],
  room: ["{a} would look lovely in here.", "i keep picturing {a}, right there.", "what this house needs is {a}."],
  move: ["teach me the {name}?", "i've been practising the {name}. in my head.", "one day i'll know the {name}."]
};

/** What Pip says once a wish is granted. */
export const GRANTED_LINES = ["you remembered! thank you.", "my wish came true.", "best. day. ever.", "a wish, granted. i'm floating."];

/** A small, fixed hash, so the same day gives the same line all day. */
export const dayHash = (text: string) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
};

/** "a cookie", "an apple": a name as Pip says it. */
export const withArticle = (name: string) => {
  const lower = name.toLowerCase();
  return `${/^[aeiou]/.test(lower) ? "an" : "a"} ${lower}`;
};

/** Pip's line for a wish, the same all day. */
export const wishLine = (kind: WishKind, name: string, day: string) => {
  const lines = LINES[kind] ?? LINES.treat;
  return lines[dayHash(`${day}/line`) % lines.length].replace("{a}", withArticle(name)).replace("{name}", name.toLowerCase());
};

/** Pip's thanks once it is granted, the same all day. */
export const grantedLine = (day: string) => GRANTED_LINES[dayHash(`${day}/thanks`) % GRANTED_LINES.length];

const ACTIONS: Record<WishKind, WishAction> = { treat: "give", plant: "plant", room: "shop", move: "shop" };

/**
 * Today's wish, ready to show: its line, its price and what is still in the
 * way (seeds, or a free plot). Null when there is no wish, or it names
 * something this build does not know.
 */
export const wishView = (wish: WishStatus | null | undefined, balance: number, garden?: Pick<GardenView, "plots" | "plants"> | null): WishView | null => {
  if (!wish) return null;
  const item = catalogueItem(wish.kind, wish.id);
  if (!item) return null;
  const occupied = new Set((garden?.plants ?? []).filter((plant) => !plant.harvested).map((plant) => plant.plot));
  const freePlot = garden ? Array.from({ length: garden.plots }, (_, index) => index + 1).some((plot) => !occupied.has(plot)) : true;
  return {
    ...wish,
    name: item.name,
    line: wishLine(wish.kind, item.name, wish.day),
    price: item.price,
    short: wish.granted ? 0 : Math.max(0, item.price - balance),
    needsPlot: wish.kind === "plant" && !wish.granted && !freePlot,
    action: ACTIONS[wish.kind] ?? "shop"
  };
};
