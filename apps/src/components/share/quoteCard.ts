/**
 * A highlight as a picture: the passage, the book and its author on a card,
 * for the reader to post or send. Drawn on a canvas, so it is the same
 * picture on every screen and can be saved or copied as it is.
 *
 * Made on this device: nothing is sent anywhere by making one.
 */
import { clipQuote, fitLine, fitText } from "./canvasText";

export type Quote = { text: string; title: string; author: string | null };

export type CardStyle = {
  id: string;
  name: string;
  /** One colour, or two for a wash from the top left to the bottom right. */
  background: [string] | [string, string];
  ink: string;
  accent: string;
};

export const CARD_STYLES: CardStyle[] = [
  { id: "paper", name: "Paper", background: ["#f2ecdf"], ink: "#25221d", accent: "#2e6136" },
  { id: "night", name: "Night", background: ["#16181c"], ink: "#ece6d8", accent: "#8fc06a" },
  { id: "moss", name: "Moss", background: ["#35543b", "#22382a"], ink: "#f4efe1", accent: "#cfe3b0" },
  { id: "dusk", name: "Dusk", background: ["#42355a", "#1e2136"], ink: "#f2ecf6", accent: "#eab9c9" }
];

/** Four by five: the tallest picture the places people post to show whole. */
export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1350;

const MARGIN = 104;
const SERIF = 'Georgia, "Iowan Old Style", "Palatino Linotype", "Times New Roman", serif';
const SANS = '"Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';
const SIZES = [72, 64, 56, 50, 44, 40, 36, 32, 29, 26];
const LINE = 1.42;

/** A file name the reader can recognise, safe on every system. */
export const quoteFileName = (title: string) => {
  const safe = title
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  return `${safe || "Quote"} - quote.png`;
};

/** Draws the card. The canvas is sized here. */
export const drawQuoteCard = (canvas: HTMLCanvasElement, quote: Quote, style: CardStyle) => {
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }
  if (style.background.length === 2) {
    const wash = context.createLinearGradient(0, 0, CARD_WIDTH, CARD_HEIGHT);
    wash.addColorStop(0, style.background[0]);
    wash.addColorStop(1, style.background[1]);
    context.fillStyle = wash;
  } else {
    context.fillStyle = style.background[0];
  }
  context.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  const width = CARD_WIDTH - MARGIN * 2;
  // The foot first: the passage has what is left above it.
  const footTop = CARD_HEIGHT - 250;
  const top = 270;
  const box = { width, height: footTop - 70 - top };

  // The passage, as large as fits, set in the middle of its room.
  const measureAt = (size: number) => {
    context.font = `${size}px ${SERIF}`;
    return (text: string) => context.measureText(text).width;
  };
  const { size, lines } = fitText(clipQuote(quote.text), box, SIZES, LINE, measureAt);
  const height = lines.length * size * LINE;
  const start = top + Math.max(0, (box.height - height) / 2);

  // An opening mark just above it, in the card's accent. (At this size the
  // mark itself sits high in its line: from 162 to 108 above the baseline.)
  context.fillStyle = style.accent;
  context.globalAlpha = 0.9;
  context.font = `200px ${SERIF}`;
  context.textBaseline = "alphabetic";
  context.fillText("“", MARGIN - 12, start + 84);
  context.globalAlpha = 1;

  context.fillStyle = style.ink;
  context.font = `${size}px ${SERIF}`;
  context.textBaseline = "top";
  lines.forEach((line, at) => {
    context.fillText(line, MARGIN, start + at * size * LINE + (size * (LINE - 1)) / 2);
  });

  // The book and who wrote it, under a short rule.
  context.fillStyle = style.accent;
  context.fillRect(MARGIN, footTop, 72, 4);
  context.fillStyle = style.ink;
  context.font = `600 34px ${SANS}`;
  context.fillText(fitLine(quote.title, width, (text) => context.measureText(text).width), MARGIN, footTop + 34);
  if (quote.author) {
    context.globalAlpha = 0.72;
    context.font = `28px ${SANS}`;
    context.fillText(fitLine(quote.author, width, (text) => context.measureText(text).width), MARGIN, footTop + 84);
    context.globalAlpha = 1;
  }

  // Where it was read, small, in the corner.
  context.globalAlpha = 0.5;
  context.font = `600 22px ${SANS}`;
  context.textAlign = "right";
  context.fillText("L E A F L E T", CARD_WIDTH - MARGIN, CARD_HEIGHT - 96);
  context.textAlign = "left";
  context.globalAlpha = 1;
};
