/**
 * The Hollow as a postcard: the camp by day under a good deal of sky, and
 * under it a band of paper with whose it is and what reading built it. One
 * picture, a fixed size, to save or copy and show somebody.
 *
 * The camp is painted by the camp's own painter (`scene.ts`), on whatever
 * canvas is handed in: nothing here makes a canvas or keeps one. The paper
 * is the diary postcard's (`diary/postcard.ts`): the same colours and the
 * same lettering, and paper-coloured in either theme, as that is. It says
 * nothing of the reader beyond what is on its face.
 */
import { fitLine, type Measure } from "../../../share/canvasText";
import type { GameArt } from "../gameArt";
import { GAME_H, GAME_W } from "../games";
import { paintCamp, paintGround, paintSky, type CampExtras, type CampLook } from "./scene";

export type PostcardStats = {
  /** Shown as the camp's owner; null or empty for "A reader". */
  name: string | null;
  /** The camp's level, 1 to 5. */
  level: number;
  /** Books finished. */
  books: number;
  /** Minutes read in all. */
  minutes: number;
  /** Days. */
  streak: number;
  /** Up to three titles of books lately finished, newest first; may be empty. */
  lately: string[];
};

/** Canvas pixels to the art pixel: a whole number, so every pixel of the camp is the same size in the saved picture. */
export const POSTCARD_PX = 5;
/** More sky over the clearing and a strip of grass under it, in art pixels. */
export const POSTCARD_SKY = 36;
export const POSTCARD_GROUND = 8;
export const POSTCARD_W = GAME_W * POSTCARD_PX;
/** How tall the picture is, down to where the paper begins. */
export const POSTCARD_PICTURE_H = (POSTCARD_SKY + GAME_H + POSTCARD_GROUND) * POSTCARD_PX;

/**
 * The moment the camp is painted at: broad day, the sun well up, and a
 * second and a half into everybody's round. Pip sets out from her own door
 * when a round begins, so at that moment she is a few steps from it on the
 * open grass, whatever the camp. At the very start she is on her doorstep,
 * green on a green burrow and hard to find; much later she is wherever her
 * round has taken her, which can be indoors and out of the picture. The
 * camp's people and its guardians each keep time of their own, so they are
 * about the place all the same, and what is on the air (butterflies,
 * leaves, snow, petals) is there.
 */
export const POSTCARD_MOMENT: CampExtras = { px: POSTCARD_PX, sky: POSTCARD_SKY, dusk: 0, clock: 60, time: 1.4, pip: true, selected: null };

/** The paper under the picture, in canvas pixels: the line it begins with, its margin, and where the lettering sits. */
const RULE = POSTCARD_PX;
const MARGIN = POSTCARD_PX * 10;
const TITLE = { size: 54, weight: 900, drop: 68 };
const FIGURES = { size: 31, weight: 700, drop: 50 };
const LATELY = { size: 26, weight: 700, drop: 44 };
const MARK = { size: 24, weight: 900, text: "Leaflet" };
const FOOT = 42;
/** Room kept between the last line and the mark at its right. */
const MARK_ROOM = 30;

const PAPER = "#f4ecd8";
const PAPER_DIM = "#e4d9bd";
const INK = "#1f2a22";
const INK_SOFT = "#55604f";
const GREEN_DEEP = "#2e5a1c";
export const POSTCARD_FONT = '"ZT Nature", "Segoe UI", system-ui, sans-serif';

/** A name, and a title, are cut past this many letters before they are measured: one long one is not to push the rest off the paper. */
const NAME_MOST = 24;
const TITLE_MOST = 40;
const LATELY_MOST = 3;

const whole = (value: number) => (Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0);
const tidy = (text: string | null | undefined) => (text ?? "").replace(/\s+/g, " ").trim();
const clipped = (text: string, most: number) => (text.length > most ? `${text.slice(0, most - 1).trimEnd()}…` : text);
const count = (value: number, one: string) => `${value.toLocaleString("en-US")} ${one}${value === 1 ? "" : "s"}`;

/** Whose it is: "Mira's Hollow", or "A reader's Hollow" where there is no name to put to it. */
export const postcardTitle = (name: string | null): string => `${clipped(tidy(name), NAME_MOST) || "A reader"}'s Hollow`;

/** The time read, in whole hours; under an hour, in minutes, so that a camp just begun does not say "0 hours". */
const timeRead = (minutes: number) => (whole(minutes) < 60 ? count(whole(minutes), "minute") : count(Math.floor(whole(minutes) / 60), "hour"));

/** "Level 4 · 23 books · 310 hours · 12-day streak". No streak is said when there is none. */
export const postcardFigures = (stats: PostcardStats): string => {
  const figures = [`Level ${Math.max(1, whole(stats.level))}`, count(whole(stats.books), "book"), timeRead(stats.minutes)];
  const streak = whole(stats.streak);
  if (streak > 0) figures.push(`${streak.toLocaleString("en-US")}-day streak`);
  return figures.join(" · ");
};

/** The books lately finished that are named: the first three with a title to them, each tidied and none too long. */
const latelyTitles = (lately: readonly string[]) =>
  (Array.isArray(lately) ? lately : [])
    .map((title) => clipped(tidy(title), TITLE_MOST))
    .filter(Boolean)
    .slice(0, LATELY_MOST);

/** "Lately: Title One, Title Two"; null when nothing has been finished lately. */
export const postcardLately = (lately: readonly string[]): string | null => {
  const titles = latelyTitles(lately);
  return titles.length > 0 ? `Lately: ${titles.join(", ")}` : null;
};

/** The card in a sentence: what a screen reader hears, and what "Copy" falls back to where the clipboard takes no pictures. */
export const postcardWords = (stats: PostcardStats): string => {
  const said = [`${count(whole(stats.books), "book")} finished`, `${timeRead(stats.minutes)} read`];
  const streak = whole(stats.streak);
  if (streak > 0) said.push(`a ${streak.toLocaleString("en-US")}-day streak`);
  const titles = latelyTitles(stats.lately);
  return `${postcardTitle(stats.name)} in Leaflet, level ${Math.max(1, whole(stats.level))}: ${said.join(", ")}${titles.length > 0 ? `; lately ${titles.join(", ")}` : ""}.`;
};

/** "leaflet-hollow-2026-10-13.png": the day it was made, as the reader's own clock has it. */
export const postcardFileName = (date: Date): string => {
  const two = (value: number) => String(value).padStart(2, "0");
  return `leaflet-hollow-${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}.png`;
};

export type PostcardLine = {
  text: string;
  size: number;
  weight: number;
  /** In the softer ink: everything under the title. */
  soft: boolean;
  /** Where its baseline is, in canvas pixels from the top of the card. */
  baseline: number;
};

/** The lines on the paper, top to bottom: whose it is, the figures, and the books lately finished when there are any. */
export const postcardLines = (stats: PostcardStats): PostcardLine[] => {
  let baseline = POSTCARD_PICTURE_H + RULE;
  const line = (text: string, face: { size: number; weight: number; drop: number }, soft: boolean): PostcardLine => {
    baseline += face.drop;
    return { text, size: face.size, weight: face.weight, soft, baseline };
  };
  const lines = [line(postcardTitle(stats.name), TITLE, false), line(postcardFigures(stats), FIGURES, true)];
  const lately = postcardLately(stats.lately);
  if (lately) lines.push(line(lately, LATELY, true));
  return lines;
};

/** How big the card is, in canvas pixels: as wide as the picture always, and a line taller where books are named. */
export const postcardSize = (stats: PostcardStats): { width: number; height: number } => {
  const lines = postcardLines(stats);
  return { width: POSTCARD_W, height: lines[lines.length - 1].baseline + FOOT };
};

/**
 * Draws the whole card on a canvas that is the size `postcardSize` gives:
 * the camp, and the paper under it. Drawn again from nothing each time, so
 * it can be called once at once and once more when the lettering has loaded.
 */
export const drawPostcard = (ctx: CanvasRenderingContext2D, art: GameArt, look: CampLook, stats: PostcardStats): void => {
  const { width, height } = postcardSize(stats);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, width, height);

  // The camp, as its own page draws it: in art pixels, hard-edged, the sky first and the clearing under it.
  ctx.save();
  ctx.setTransform(POSTCARD_PX, 0, 0, POSTCARD_PX, 0, 0);
  ctx.imageSmoothingEnabled = false;
  paintSky(ctx, art, look, POSTCARD_SKY, 0);
  ctx.translate(0, POSTCARD_SKY);
  paintCamp(ctx, art, look, 0, POSTCARD_MOMENT);
  paintGround(ctx, art, look, GAME_H, POSTCARD_GROUND, 0);
  ctx.restore();

  // The paper: a hard line where the picture ends, and a row of dashes along its foot, like a postcard's edge.
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, POSTCARD_PICTURE_H, width, height - POSTCARD_PICTURE_H);
  ctx.fillStyle = INK;
  ctx.fillRect(0, POSTCARD_PICTURE_H, width, RULE);
  ctx.fillStyle = PAPER_DIM;
  for (let x = MARGIN; x + POSTCARD_PX * 2 <= width - MARGIN; x += POSTCARD_PX * 4) ctx.fillRect(x, height - POSTCARD_PX * 3, POSTCARD_PX * 2, POSTCARD_PX);

  const measure: Measure = (text) => ctx.measureText(text).width;
  ctx.textBaseline = "alphabetic";
  const lines = postcardLines(stats);
  const foot = lines[lines.length - 1].baseline;

  // The app's name, small, at the foot on the right.
  ctx.font = `${MARK.weight} ${MARK.size}px ${POSTCARD_FONT}`;
  ctx.textAlign = "right";
  ctx.fillStyle = GREEN_DEEP;
  ctx.fillText(MARK.text, width - MARGIN, foot);
  const mark = measure(MARK.text);

  ctx.textAlign = "left";
  for (const line of lines) {
    ctx.font = `${line.weight} ${line.size}px ${POSTCARD_FONT}`;
    ctx.fillStyle = line.soft ? INK_SOFT : INK;
    // The last line shares its row with the mark: it stops short of it.
    const room = width - MARGIN * 2 - (line.baseline === foot ? mark + MARK_ROOM : 0);
    ctx.fillText(fitLine(line.text, room, measure), MARGIN, line.baseline);
  }
  ctx.restore();
};
