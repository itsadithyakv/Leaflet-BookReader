/**
 * The year in review as a picture (the figures are `yearReview.ts`'s): the
 * year, the time read, a few figures, the months as bars and the books
 * finished. The same size and looks as a passage's card (`quoteCard.ts`).
 */
import { fitLine } from "./canvasText";
import { CARD_HEIGHT, CARD_WIDTH, type CardStyle } from "./quoteCard";
import { MONTHS, dayWords, timeWords, type YearReview } from "./yearReview";

const MARGIN = 96;
const SERIF = 'Georgia, "Iowan Old Style", "Palatino Linotype", "Times New Roman", serif';
const SANS = '"Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';

export const yearFileName = (year: number) => `My ${year} in books.png`;

/** The figures under the headline, the ones there is something to say for: at most four. */
export const yearFigures = (review: YearReview): Array<{ value: string; label: string }> => {
  const figures: Array<{ value: string; label: string }> = [];
  if (review.finished.length > 0) {
    figures.push({ value: String(review.finished.length), label: review.finished.length === 1 ? "book finished" : "books finished" });
  }
  figures.push({ value: String(review.daysRead), label: review.daysRead === 1 ? "day read" : "days read" });
  if (review.longestRun >= 2) {
    figures.push({ value: String(review.longestRun), label: "days in a row" });
  }
  if (review.highlights > 0) {
    figures.push({ value: review.highlights.toLocaleString(), label: review.highlights === 1 ? "highlight" : "highlights" });
  }
  if (review.words > 0 && figures.length < 4) {
    figures.push({ value: review.words.toLocaleString(), label: review.words === 1 ? "word looked up" : "words looked up" });
  }
  if (figures.length < 4 && review.booksRead > review.finished.length) {
    figures.push({ value: String(review.booksRead), label: review.booksRead === 1 ? "book read in" : "books read in" });
  }
  return figures.slice(0, 4);
};

/** A line or two under the figures, of what there is to say; none when there is nothing. */
export const yearLines = (review: YearReview): string[] => {
  const lines: string[] = [];
  if (review.bestDay && review.bestDay.minutes >= 20) {
    lines.push(`Best day: ${dayWords(review.bestDay.dateKey)}, ${timeWords(review.bestDay.minutes)}`);
  }
  if (review.timeOfDay) {
    lines.push(`Mostly read in the ${review.timeOfDay === "night" ? "small hours" : review.timeOfDay}`);
  } else if (review.topAuthor) {
    lines.push(`Most read: ${review.topAuthor}`);
  }
  return lines.slice(0, 2);
};

/** Draws the card. The canvas is sized here. */
export const drawYearCard = (canvas: HTMLCanvasElement, review: YearReview, style: CardStyle) => {
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
  const measure = (text: string) => context.measureText(text).width;
  context.textBaseline = "alphabetic";

  // The year, and what it was a year of.
  context.fillStyle = style.accent;
  context.font = `600 26px ${SANS}`;
  context.fillText("A  Y E A R  O F  R E A D I N G", MARGIN, 150);
  context.fillStyle = style.ink;
  context.font = `190px ${SERIF}`;
  context.fillText(String(review.year), MARGIN - 8, 330);

  // The headline: the time read.
  context.font = `76px ${SERIF}`;
  context.fillText(timeWords(review.minutes), MARGIN, 460);

  // Up to four figures in a row.
  const figures = yearFigures(review);
  const column = width / Math.max(1, figures.length);
  figures.forEach((figure, at) => {
    const x = MARGIN + column * at;
    context.fillStyle = style.ink;
    context.font = `600 64px ${SANS}`;
    context.fillText(figure.value, x, 600);
    context.globalAlpha = 0.72;
    context.font = `24px ${SANS}`;
    context.fillText(fitLine(figure.label, column - 16, measure), x, 640);
    context.globalAlpha = 1;
  });

  // The months, as bars: the busiest whole, the rest paler.
  const chartTop = 720;
  const chartHeight = 190;
  const gap = 14;
  const bar = (width - gap * 11) / 12;
  const most = Math.max(1, ...review.byMonth);
  review.byMonth.forEach((minutes, month) => {
    const x = MARGIN + month * (bar + gap);
    const height = minutes > 0 ? Math.max(6, (minutes / most) * chartHeight) : 3;
    context.fillStyle = style.accent;
    context.globalAlpha = minutes === 0 ? 0.25 : month === review.busiestMonth ? 1 : 0.55;
    context.fillRect(x, chartTop + chartHeight - height, bar, height);
    context.globalAlpha = 0.7;
    context.fillStyle = style.ink;
    context.font = `22px ${SANS}`;
    context.textAlign = "center";
    context.fillText(MONTHS[month][0], x + bar / 2, chartTop + chartHeight + 36);
    context.textAlign = "left";
    context.globalAlpha = 1;
  });

  // A line or two of what stood out, then the books finished.
  let y = 1010;
  context.fillStyle = style.ink;
  context.font = `28px ${SANS}`;
  context.globalAlpha = 0.85;
  for (const line of yearLines(review)) {
    context.fillText(fitLine(line, width, measure), MARGIN, y);
    y += 42;
  }
  context.globalAlpha = 1;
  if (review.finished.length > 0) {
    y += 14;
    context.fillStyle = style.accent;
    context.fillRect(MARGIN, y - 26, 72, 4);
    y += 18;
    context.fillStyle = style.ink;
    context.font = `italic 30px ${SERIF}`;
    const room = Math.max(1, Math.floor((CARD_HEIGHT - 140 - y) / 42) + 1);
    const shown = review.finished.slice(0, review.finished.length > room ? room - 1 : room);
    for (const book of shown) {
      context.fillText(fitLine(book.title, width, measure), MARGIN, y);
      y += 42;
    }
    if (review.finished.length > shown.length) {
      context.globalAlpha = 0.7;
      context.font = `26px ${SANS}`;
      context.fillText(`and ${review.finished.length - shown.length} more`, MARGIN, y);
      context.globalAlpha = 1;
    }
  }

  context.globalAlpha = 0.5;
  context.fillStyle = style.ink;
  context.font = `600 22px ${SANS}`;
  context.textAlign = "right";
  context.fillText("L E A F L E T", CARD_WIDTH - MARGIN, CARD_HEIGHT - 72);
  context.textAlign = "left";
  context.globalAlpha = 1;
};
