/**
 * The week's postcard, drawn on a canvas: the days read, the minutes, the
 * books, and the best line Pip wrote that week, with Pip herself (the same
 * sprite code as everywhere else, in what the reader's Pip wears).
 *
 * A fixed size, so it looks the same whatever window it was made in, and
 * paper-coloured in either theme: it is a picture to send, not a panel of
 * the app. It carries nothing about the reader beyond what is on its face:
 * no name, no account, no device.
 */
import { LIB, SKINS, dress, renderFrame, type PipMove } from "../../../pip/core.js";
import { minutesText } from "../../../pip/diary/entry";
import type { WeekSummary } from "../../../pip/diary/week";

export const CARD_W = 1200;
export const CARD_H = 1500;

export type CardLook = { skin: string; outfit: readonly string[] };

const PAPER = "#f4ecd8";
const PAPER_DIM = "#e4d9bd";
const FACE = "#fffbf0";
const INK = "#1f2a22";
const INK_SOFT = "#55604f";
const GREEN = "#5f9a38";
const GREEN_DEEP = "#2e5a1c";
const GREEN_LIGHT = "#cfe6b6";
const GOLD = "#e8b43a";
const FONT = '"ZT Nature", "Segoe UI", system-ui, sans-serif';

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];

const parts = (dateKey: string) => {
  const [year, month, day] = dateKey.split("-").map(Number);
  return { year, month, day };
};

/** "28 Sep – 4 Oct 2026". */
export const weekRange = (start: string, end: string) => {
  const a = parts(start);
  const b = parts(end);
  const from = a.month === b.month ? `${a.day}` : `${a.day} ${MONTHS[a.month - 1]}${a.year === b.year ? "" : ` ${a.year}`}`;
  return `${from} – ${b.day} ${MONTHS[b.month - 1]} ${b.year}`;
};

/** The card in words: what a screen reader hears, and what "Copy" falls back to. */
export const cardText = (week: WeekSummary): string => {
  const lines = [`Pip's week, ${weekRange(week.start, week.end)}`, `${week.daysRead} of 7 days read, ${minutesText(week.minutes)}.`];
  if (week.books.length > 0) {
    lines.push(week.books.join(", "));
  }
  if (week.best) {
    lines.push(`“${week.best.text}”`);
  }
  return lines.join("\n");
};

/** A box as the HUD draws them: a hard outline with the corners notched out. */
const pixelBox = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, u: number, face: string, line = INK) => {
  ctx.fillStyle = line;
  ctx.fillRect(x + u, y, w - 2 * u, h);
  ctx.fillRect(x, y + u, w, h - 2 * u);
  ctx.fillStyle = face;
  ctx.fillRect(x + 2 * u, y + u, w - 4 * u, h - 2 * u);
  ctx.fillRect(x + u, y + 2 * u, w - 2 * u, h - 4 * u);
};

/** The text broken into lines no wider than `width`, at the font the context has. */
const wrap = (ctx: CanvasRenderingContext2D, text: string, width: number): string[] => {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > width) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) {
    lines.push(line);
  }
  return lines;
};

/** The lines, with the last one ended by "…" when there were more than `max`. */
const clamp = (ctx: CanvasRenderingContext2D, lines: string[], max: number, width: number) => {
  if (lines.length <= max) {
    return lines;
  }
  const kept = lines.slice(0, max);
  let last = kept[max - 1];
  while (last && ctx.measureText(`${last}…`).width > width) {
    last = last.slice(0, -1).trimEnd();
  }
  kept[max - 1] = `${last}…`;
  return kept;
};

let scratch: HTMLCanvasElement | null = null;

/** Pip, one frame of a move, at a whole number of card pixels per sprite pixel. */
const drawPip = (ctx: CanvasRenderingContext2D, look: CardLook, moveId: string, x: number, y: number, scale: number) => {
  const move: PipMove | undefined = LIB.find((entry) => entry.id === moveId) ?? LIB.find((entry) => entry.id === "idle");
  const skin = SKINS.find((entry) => entry.id === look.skin) ?? SKINS[0];
  if (!move || !skin) {
    return;
  }
  if (!scratch) {
    scratch = document.createElement("canvas");
    scratch.width = 32;
    scratch.height = 32;
  }
  const source = scratch.getContext("2d");
  if (!source) {
    return;
  }
  source.clearRect(0, 0, 32, 32);
  source.putImageData(renderFrame(move, move.poster, dress(skin, look.outfit)), 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(scratch, x, y, 32 * scale, 32 * scale);
};

/** The move Pip holds on the card: by the week it was. */
const cardMove = (week: WeekSummary) => (week.finished.length > 0 ? "theend" : week.daysRead >= 5 ? "cheer" : "read");

/**
 * Draws the week on the canvas, which is sized to the card. Everything is
 * placed on a 6-pixel grid and drawn with hard edges; only the letters are
 * smooth, so they stay legible when the picture is made small.
 */
export const drawPostcard = (canvas: HTMLCanvasElement, week: WeekSummary, look: CardLook) => {
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }
  const U = 6;
  ctx.textBaseline = "alphabetic";

  // The card: paper, a frame, and an inner rule like a postcard's edge.
  ctx.fillStyle = PAPER_DIM;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  pixelBox(ctx, 30, 30, CARD_W - 60, CARD_H - 60, U * 2, PAPER);
  ctx.fillStyle = PAPER_DIM;
  for (let x = 78; x < CARD_W - 78; x += U * 4) {
    ctx.fillRect(x, 72, U * 2, U);
    ctx.fillRect(x, CARD_H - 78, U * 2, U);
  }

  // The stamp: Pip, small, on green, with a perforated edge.
  const stamp = { x: CARD_W - 78 - 204, y: 108, w: 204, h: 228 };
  ctx.fillStyle = FACE;
  ctx.fillRect(stamp.x, stamp.y, stamp.w, stamp.h);
  ctx.fillStyle = PAPER;
  for (let x = stamp.x; x < stamp.x + stamp.w; x += U * 3) {
    ctx.fillRect(x + U, stamp.y, U, U);
    ctx.fillRect(x + U, stamp.y + stamp.h - U, U, U);
  }
  for (let y = stamp.y; y < stamp.y + stamp.h; y += U * 3) {
    ctx.fillRect(stamp.x, y + U, U, U);
    ctx.fillRect(stamp.x + stamp.w - U, y + U, U, U);
  }
  ctx.fillStyle = GREEN_LIGHT;
  ctx.fillRect(stamp.x + U * 3, stamp.y + U * 3, stamp.w - U * 6, stamp.h - U * 6);
  drawPip(ctx, { skin: "sprout", outfit: [] }, "idle", stamp.x + (stamp.w - 128) / 2, stamp.y + 30, 4);
  ctx.fillStyle = GREEN_DEEP;
  ctx.font = `800 22px ${FONT}`;
  ctx.textAlign = "center";
  ctx.fillText("LEAFLET", stamp.x + stamp.w / 2, stamp.y + stamp.h - 36);

  // The heading.
  ctx.textAlign = "left";
  ctx.fillStyle = INK;
  ctx.font = `800 84px ${FONT}`;
  ctx.fillText("pip's week", 96, 204);
  ctx.fillStyle = INK_SOFT;
  ctx.font = `700 34px ${FONT}`;
  ctx.fillText(weekRange(week.start, week.end), 98, 258);

  // The seven days: a square each, filled when read, gold-edged when the goal was met.
  const size = 126;
  const gap = 18;
  const rowX = 96;
  const rowY = 378;
  week.days.forEach((day, index) => {
    const x = rowX + index * (size + gap);
    pixelBox(ctx, x, rowY, size, size, U, day.read ? GREEN : PAPER_DIM, day.goalMet ? GOLD : day.read ? GREEN_DEEP : "#b8ab8a");
    ctx.textAlign = "center";
    if (day.read) {
      ctx.fillStyle = "#0f2410";
      ctx.font = `800 40px ${FONT}`;
      ctx.fillText(`${day.minutes}`, x + size / 2, rowY + 72);
      ctx.font = `700 20px ${FONT}`;
      ctx.fillText("min", x + size / 2, rowY + 100);
    }
    ctx.fillStyle = INK_SOFT;
    ctx.font = `800 26px ${FONT}`;
    ctx.fillText(DAY_LETTERS[index], x + size / 2, rowY + size + 38);
  });

  // The sums.
  const sums: Array<[string, string]> = [
    [`${week.daysRead} of 7`, week.daysRead === 1 ? "day read" : "days read"],
    [week.minutes < 60 ? `${week.minutes}` : `${Math.floor(week.minutes / 60)}h ${week.minutes % 60}m`, week.minutes < 60 ? (week.minutes === 1 ? "minute" : "minutes") : "of reading"],
    [`${week.books.length || "–"}`, week.books.length === 1 ? "book" : "books"]
  ];
  const sumW = 318;
  sums.forEach(([figure, label], index) => {
    const x = 96 + index * (sumW + 27);
    pixelBox(ctx, x, 588, sumW, 150, U, FACE);
    ctx.textAlign = "center";
    ctx.fillStyle = INK;
    ctx.font = `800 58px ${FONT}`;
    ctx.fillText(figure, x + sumW / 2, 660);
    ctx.fillStyle = INK_SOFT;
    ctx.font = `700 26px ${FONT}`;
    ctx.fillText(label, x + sumW / 2, 704);
  });

  // The books, by name.
  ctx.textAlign = "left";
  ctx.fillStyle = INK;
  ctx.font = `700 34px ${FONT}`;
  const named = week.books.map((title) => (week.finished.includes(title) ? `${title} (finished)` : title)).join("  ·  ");
  clamp(ctx, wrap(ctx, named, CARD_W - 192), 2, CARD_W - 192).forEach((line, index) => ctx.fillText(line, 96, 804 + index * 46));

  // The best line of the week, in a speech bubble, and Pip who wrote it.
  const pip = { x: 60, y: CARD_H - 96 - 320, scale: 10 };
  const bubble = { x: 390, y: 900, w: CARD_W - 390 - 96, h: 438 };
  pixelBox(ctx, bubble.x, bubble.y, bubble.w, bubble.h, U, FACE);
  // The tail: three steps out of the bubble's side, towards Pip.
  const tail = bubble.y + 282;
  ctx.fillStyle = INK;
  ctx.fillRect(bubble.x - U * 2, tail, U * 3, U * 8);
  ctx.fillRect(bubble.x - U * 4, tail + U * 2, U * 2, U * 6);
  ctx.fillRect(bubble.x - U * 6, tail + U * 4, U * 2, U * 4);
  ctx.fillStyle = FACE;
  ctx.fillRect(bubble.x - U, tail + U, U * 3, U * 6);
  ctx.fillRect(bubble.x - U * 3, tail + U * 3, U * 2, U * 4);
  ctx.fillRect(bubble.x - U * 5, tail + U * 5, U * 2, U * 2);

  const words = week.best?.text ?? "a quiet week. the book kept its place.";
  const inner = bubble.w - 84;
  /** The bubble's height, less its padding and the line under the words that says whose they are. */
  const room = bubble.h - 132;
  let fontSize = 46;
  let lines: string[] = [];
  // The largest letters at which the line fits the bubble.
  const fits = () => {
    ctx.font = `700 ${fontSize}px ${FONT}`;
    lines = wrap(ctx, words, inner);
    return lines.length * fontSize * 1.28 <= room;
  };
  while (!fits() && fontSize > 28) {
    fontSize -= 2;
  }
  lines = clamp(ctx, lines, Math.max(1, Math.floor(room / (fontSize * 1.28))), inner);
  ctx.fillStyle = INK;
  ctx.textAlign = "left";
  lines.forEach((line, index) => ctx.fillText(line, bubble.x + 42, bubble.y + 42 + fontSize + index * fontSize * 1.28));
  if (week.best) {
    const index = week.days.findIndex((day) => day.dateKey === week.best?.dateKey);
    ctx.fillStyle = INK_SOFT;
    ctx.font = `700 26px ${FONT}`;
    ctx.textAlign = "right";
    ctx.fillText(`pip's diary, ${(WEEKDAYS[index] ?? "").toLowerCase()}`, bubble.x + bubble.w - 42, bubble.y + bubble.h - 36);
  }
  drawPip(ctx, look, cardMove(week), pip.x, pip.y, pip.scale);
};

/** The app's own lettering, loaded before the card is drawn (a canvas does not wait for a font). */
export const cardFontsReady = async (): Promise<void> => {
  try {
    await Promise.race([
      Promise.all([document.fonts.load(`800 84px ${FONT}`), document.fonts.load(`700 34px ${FONT}`)]),
      new Promise((resolve) => window.setTimeout(resolve, 1500))
    ]);
  } catch {
    // The fallback face is drawn instead.
  }
};
