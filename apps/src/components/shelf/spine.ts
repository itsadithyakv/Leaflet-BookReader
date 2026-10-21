import { coverDeco } from "./dress";
import { hash } from "./hash";

/**
 * How a book spine looks: its bookcloth, lettering and size.
 *
 * Shared by your own session shelf and the shelf other readers see on your
 * card, so a book looks the same in both places.
 */

/** Bookcloth colours. Twelve, so a reader's regular books rarely share one. */
export const CLOTH = [
  "#6e1f24", // oxblood
  "#2f5039", // forest
  "#24345a", // navy
  "#b8842f", // ochre
  "#5a2f52", // plum
  "#1f5b5e", // teal
  "#9a4a26", // rust
  "#4d5868", // slate
  "#6b6a2e", // olive
  "#8da47e", // sage
  "#b56d78", // rose
  "#3f4046" // charcoal
];

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export { hash };

/** A book's own cloth when nothing else has claimed a colour first. */
export const clothFor = (key: string) => CLOTH[hash(key) % CLOTH.length];

/** Relative luminance, to pick spine lettering that stays legible. */
const luminance = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16);
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel((n >> 16) & 0xff) + 0.7152 * channel((n >> 8) & 0xff) + 0.0722 * channel(n & 0xff);
};
const DARK_INK = "#2a2016";
const LIGHT_INK = "#f4ead8";
const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/** Gilt lettering, for a leather binding whose cloth is dark enough to carry it. */
export const GILT = "#e6c46c";
const GILT_MIN_CONTRAST = 4.5;

/** Gilt where it reads (at least 4.5:1 against the cloth), else the plain lettering. */
export const giltOr = (hex: string) =>
  contrast(luminance(hex), luminance(GILT)) >= GILT_MIN_CONTRAST ? GILT : inkFor(hex);

/** Whichever lettering has the higher contrast ratio against the cloth. */
export const inkFor = (hex: string) => {
  const cloth = luminance(hex);
  return contrast(cloth, luminance(DARK_INK)) >= contrast(cloth, luminance(LIGHT_INK)) ? DARK_INK : LIGHT_INK;
};

/** Height and width grow with the minutes a spine stands for. */
export const spineHeight = (minutes: number) => Math.round(clamp(56 + minutes * 1.4, 64, 132));
export const spineWidth = (minutes: number) => Math.round(clamp(14 + minutes * 0.34, 18, 34));

/**
 * A cover drawn in a book's cloth where it has no picture (`--cloth` and `--ink` for
 * styles/phone-polish.css: a phone by a finger draws it; a desktop keeps its plain placeholder).
 */
export const clothStyle = (key: string) => {
  const cloth = clothFor(key);
  return { "--cloth": cloth, "--ink": inkFor(cloth), "--cloth-deco": coverDeco(key) } as Record<string, string>;
};
