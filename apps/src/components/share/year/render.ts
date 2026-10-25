/**
 * A scene of the story as a picture to share: its held end, drawn on a canvas
 * at one of three sizes (Stories, a feed, a square), not captured from the
 * screen, so it is sharp and the same on every device. It carries the span's
 * mark at the top ("2026 in pages") and a small Leaflet mark at the foot.
 *
 * The words are `sceneCopy`'s, the pictures `draw.ts`'s at their end. The
 * fonts are the system's own (Georgia or the phone's serif, Segoe UI or
 * Roboto): Leaflet's brand face is not licensed for making pictures.
 *
 * Made on this device; nothing is sent anywhere by making one.
 */
import { wrapLines, fitLine, clipQuote } from "../canvasText";
import { framing, type YearReview } from "../yearReview";
import {
  SANS,
  SERIF,
  alpha,
  drawBars,
  drawCalendar,
  drawChapterRoad,
  drawDayArc,
  drawDeck,
  drawHourglass,
  drawMark,
  drawPip,
  drawRestingConfetti,
  drawRestingPages,
  drawRosette,
  drawShelf,
  drawStack,
  paintField,
  type Box
} from "./draw";
import { PALETTE, sceneCopy, shownMonths, type CopyOptions, type SceneCopy, type SceneId } from "./scenes";

export type ShareSize = "story" | "feed" | "square";
export const SHARE_SIZES: Record<ShareSize, { width: number; height: number; name: string }> = {
  story: { width: 1080, height: 1920, name: "Story" },
  feed: { width: 1080, height: 1350, name: "Post" },
  square: { width: 1080, height: 1080, name: "Square" }
};

export type RenderOptions = CopyOptions & { size: ShareSize; covers?: Map<string, CanvasImageSource> };

/** A file name the reader can recognise, safe on every system. */
export const shareFileName = (review: YearReview, scene: SceneId, size: ShareSize) =>
  `${framing(review).mark.replace(/·/g, "-").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim()} - ${scene}${size === "story" ? "" : ` ${size}`}.png`;

type Context = CanvasRenderingContext2D;

const setSpacing = (context: Context, value: string) => {
  // Letter-spacing on a canvas is newer than the rest; without it the words are only a little tighter.
  (context as Context & { letterSpacing?: string }).letterSpacing = value;
};

/** The largest of a font's sizes at which `text` fits `width`. */
const fitSize = (context: Context, text: string, font: (size: number) => string, width: number, largest: number, smallest: number) => {
  for (let size = largest; size > smallest; size -= 4) {
    context.font = font(size);
    if (context.measureText(text).width <= width) {
      return size;
    }
  }
  return smallest;
};

const PIP_SCENES: Partial<Record<SceneId, "big" | "small">> = {
  opening: "big",
  kind: "big",
  empty: "big",
  time: "small",
  books: "small",
  faithful: "small",
  when: "small",
  lines: "small",
  hollow: "small",
  study: "small",
  summary: "small"
};

/**
 * Draws `scene`'s held end on `canvas`, sized here. Returns the words it
 * says, for a screen reader or a clipboard that takes no pictures.
 */
export const renderScene = (canvas: HTMLCanvasElement, scene: SceneId, review: YearReview, options: RenderOptions) => {
  const { width, height } = SHARE_SIZES[options.size];
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  const copy = sceneCopy(scene, review, options);
  if (!context) {
    return copy;
  }
  const palette = PALETTE[scene];
  const frame = framing(review);
  paintField(context, width, height, palette, 1.6);
  if (scene === "summary") {
    // Confetti behind everything, as it lies at the summary's end.
    drawRestingConfetti(context, { x: 0, y: 0, width, height: 150 }, palette, 12, 18);
    drawRestingConfetti(context, { x: width * 0.74, y: 150, width: width * 0.26, height: height * 0.3 }, palette, 7, 12);
  }
  const margin = 88;
  const inner = width - margin * 2;
  const square = options.size === "square";
  // Everything is laid out for a Story, and set smaller in a shorter picture.
  const s = options.size === "story" ? 1 : options.size === "feed" ? 0.84 : 0.74;

  // The head: the span's mark.
  context.textBaseline = "alphabetic";
  context.textAlign = "left";
  context.fillStyle = alpha(palette.soft, 0.95);
  context.font = `700 ${Math.round(28 * Math.max(s, 0.86))}px ${SANS}`;
  setSpacing(context, "4px");
  if (scene !== "summary") {
    context.fillText(frame.mark.toUpperCase(), margin, margin + 20);
  }
  setSpacing(context, "0px");

  // The foot: the Leaflet mark.
  const footY = height - margin - 64;
  drawMark(context, margin, footY, 2, alpha(palette.ink, 0.8));

  const top = margin + 80 * s + 20;
  const bottom = footY - 36 * s;
  const area: Box = { x: margin, y: top, width: inner, height: bottom - top };

  // The words over the picture: the eyebrow, the big figure, its unit.
  let y = area.y;
  const text = (words: string, font: string, color: string, lineHeight: number, maxLines = 3, align: "left" | "center" = "left") => {
    context.font = font;
    context.fillStyle = color;
    context.textAlign = align;
    const lines = wrapLines(words, inner, (value) => context.measureText(value).width).slice(0, maxLines);
    for (const line of lines) {
      y += lineHeight;
      context.fillText(fitLine(line, inner, (value) => context.measureText(value).width), align === "center" ? width / 2 : margin, y);
    }
    context.textAlign = "left";
    return lines.length;
  };

  if (copy.eyebrow) {
    text(copy.eyebrow, `600 ${Math.round(40 * s)}px ${SANS}`, palette.soft, 48 * s, 2);
    y += 14 * s;
  }
  if (copy.big) {
    const numeric = copy.count !== undefined || scene === "opening" || scene === "summary" || scene === "empty";
    const largest = Math.round((numeric ? 300 : 150) * s);
    const font = (size: number) => (numeric ? `800 ${size}px ${SANS}` : `700 ${size}px ${SERIF}`);
    const size = fitSize(context, copy.big, font, inner, largest, Math.round(64 * s));
    if (!numeric && size <= Math.round(70 * s) && copy.big.length > 18) {
      // A long name (an author, a title) on two lines rather than in small type.
      y += 6;
      text(copy.big, `700 ${Math.round(96 * s)}px ${SERIF}`, palette.ink, 104 * s, 2);
    } else {
      context.font = font(size);
      context.fillStyle = palette.ink;
      setSpacing(context, numeric ? `${-Math.round(size * 0.035)}px` : "0px");
      y += size * 0.86;
      context.fillText(copy.big, margin - (numeric ? size * 0.04 : 0), y);
      setSpacing(context, "0px");
    }
    if (copy.unit) {
      y += 10 * s;
      text(copy.unit, `italic 400 ${Math.round(76 * s)}px ${SERIF}`, palette.accent, 80 * s, 1);
    }
  }

  // The lines go at the foot of the area; the picture has what is between.
  const lineFont = `500 ${Math.round(38 * s)}px ${SANS}`;
  const lineHeight = 52 * s;
  context.font = lineFont;
  // Pip stands at the foot on the right: the lines keep clear of her.
  const pipSize = copy.pip ? PIP_SCENES[scene] : undefined;
  const smallPx = square ? 4 : options.size === "feed" ? 5 : 6;
  const lineWidth = pipSize === "small" ? inner - smallPx * 30 : inner;
  const lineWraps = copy.lines.filter(Boolean).map((line) => wrapLines(line, lineWidth, (value) => context.measureText(value).width).slice(0, 3));
  const linesHeight = lineWraps.reduce((sum, lines) => sum + lines.length * lineHeight + 14 * s, 0);
  const pictureTop = y + 40 * s;
  // With no lines beside her, Pip at the foot has the corner: the picture stops above her.
  const pipTop = height - margin - smallPx * 29;
  const pictureBottom = Math.min(area.y + area.height - linesHeight - 24 * s, pipSize === "small" && lineWraps.length === 0 ? pipTop - 24 : Infinity);
  const picture: Box = { x: margin, y: pictureTop, width: inner, height: Math.max(80, pictureBottom - pictureTop) };

  drawPicture(context, scene, copy, review, picture, options, square, s);

  // Pip, at a whole number of pixels per pixel of hers.
  if (copy.pip && pipSize) {
    const rim = palette.dark ? "#fffbf0" : null;
    try {
      if (pipSize === "big") {
        const px = Math.max(3, Math.floor(Math.min(picture.height * 0.86, picture.width * 0.62) / 32));
        drawPip(context, width / 2 - px * 16, picture.y + (picture.height - px * 32) / 2 + px * 2, px, copy.pip.move, copy.pip.skin, copy.pip.outfit, rim);
      } else {
        const px = smallPx;
        drawPip(context, width - margin - px * 30, height - margin - px * 29, px, copy.pip.move, copy.pip.skin, copy.pip.outfit, rim);
      }
    } catch {
      // No picture of her to be had here (no pixels to draw her with): the picture is whole without her.
    }
  }

  // The lines.
  let ly = area.y + area.height - linesHeight;
  context.font = lineFont;
  context.fillStyle = palette.ink;
  for (const lines of lineWraps) {
    for (const line of lines) {
      ly += lineHeight;
      context.fillText(line, margin, ly);
    }
    ly += 14 * s;
  }
  return copy;
};

/** The scene's own picture, in the room left for it. */
const drawPicture = (context: Context, scene: SceneId, copy: SceneCopy, review: YearReview, box: Box, options: RenderOptions, square: boolean, s: number) => {
  const palette = PALETTE[scene];
  switch (scene) {
    case "opening":
      drawRestingPages(context, box, palette);
      return;
    case "time":
      drawHourglass(context, { ...box, width: box.width * 0.6 }, 1, palette);
      return;
    case "days":
      drawCalendar(
        context,
        box,
        { year: review.year, months: shownMonths(review), days: review.readDays, runFrom: review.longestRunFrom, runLength: review.longestRun },
        1,
        palette
      );
      return;
    case "books":
      drawShelf(context, { ...box, width: box.width, x: box.x }, copy.shelf ?? [], options.hideTitles ? new Map() : (options.covers ?? new Map()), 1, palette);
      return;
    case "kind":
      drawRosette(context, box, 1, palette);
      return;
    case "faithful":
      drawStack(context, box, copy.stack ?? [], 1, palette, copy.big);
      return;
    case "when":
      if (review.dayShare) drawDayArc(context, { ...box, width: box.width }, review.dayShare, 1, palette);
      return;
    case "month":
      drawBars(context, box, { months: shownMonths(review), byMonth: review.byMonth, busiest: review.busiestMonth }, 1, palette);
      return;
    case "lines":
      drawQuote(context, copy, box, palette, s);
      return;
    case "hollow":
      if (review.hollow) drawChapterRoad(context, box, review.hollow, 1, palette);
      return;
    case "study":
      drawDeck(context, box, review.cardsMade, review.cardsLearnt, 1, palette);
      return;
    case "summary":
      drawFigures(context, copy, box, palette, square, s);
      return;
    case "empty":
      drawRestingPages(context, box, palette, 7);
      return;
  }
};

/** The highlight set large in the serif under an opening mark, with its book, and the hard word under it. */
const drawQuote = (context: Context, copy: SceneCopy, box: Box, palette: (typeof PALETTE)[SceneId], s: number) => {
  let bottom = box.y + box.height;
  if (copy.word) {
    // The word, on a card of its own at the foot.
    const cardHeight = 150 * s;
    const y = bottom - cardHeight;
    context.fillStyle = alpha(palette.ink, 0.06);
    context.fillRect(box.x, y, box.width, cardHeight);
    context.fillStyle = palette.glow;
    context.fillRect(box.x, y, 6, cardHeight);
    context.fillStyle = palette.ink;
    context.font = `italic 700 ${Math.round(54 * s)}px ${SERIF}`;
    const word = fitLine(copy.word.word, box.width * 0.5, (value) => context.measureText(value).width);
    context.fillText(word, box.x + 34 * s, y + 66 * s);
    const wordWidth = context.measureText(word).width;
    context.fillStyle = palette.soft;
    context.font = `500 ${Math.round(28 * s)}px ${SANS}`;
    context.fillText(fitLine(copy.word.why, box.width - wordWidth - 90 * s, (value) => context.measureText(value).width), box.x + 34 * s + wordWidth + 22 * s, y + 64 * s);
    context.font = `400 ${Math.round(32 * s)}px ${SANS}`;
    context.fillText(fitLine(copy.word.meaning, box.width - 60 * s, (value) => context.measureText(value).width), box.x + 34 * s, y + 116 * s);
    bottom = y - 40 * s;
  }
  if (!copy.quote) {
    return;
  }
  const byHeight = (copy.quote.by ? 60 * s : 0) + (copy.quote.note ? 76 * s : 0);
  const room = { width: box.width, height: bottom - box.y - byHeight - 110 * s };
  const sizes = [92, 84, 76, 68, 60, 54, 48, 44, 40, 36, 32].map((size) => Math.round(size * s));
  let size = sizes[sizes.length - 1];
  let lines: string[] = [];
  const passage = clipQuote(copy.quote.text, 420);
  for (const tried of sizes) {
    context.font = `400 ${tried}px ${SERIF}`;
    const wrapped = wrapLines(passage, room.width, (value) => context.measureText(value).width);
    if (wrapped.length * tried * 1.32 <= room.height) {
      size = tried;
      lines = wrapped;
      break;
    }
  }
  if (lines.length === 0) {
    context.font = `400 ${size}px ${SERIF}`;
    lines = wrapLines(passage, room.width, (value) => context.measureText(value).width).slice(0, Math.max(1, Math.floor(room.height / (size * 1.32))));
  }
  const blockHeight = lines.length * size * 1.32;
  let y = box.y + 110 * s + Math.max(0, (room.height - blockHeight) / 2);
  context.fillStyle = palette.accent;
  context.font = `400 ${Math.round(220 * s)}px ${SERIF}`;
  context.fillText("“", box.x - 10 * s, y - 10 * s + 60 * s);
  context.fillStyle = palette.ink;
  context.font = `400 ${size}px ${SERIF}`;
  for (const line of lines) {
    y += size * 1.32;
    context.fillText(line, box.x, y - size * 0.3);
  }
  if (copy.quote.by) {
    context.fillStyle = palette.accent;
    context.fillRect(box.x, y + 20 * s, 64 * s, 4);
    context.fillStyle = palette.soft;
    context.font = `600 ${Math.round(32 * s)}px ${SANS}`;
    context.fillText(fitLine(copy.quote.by, box.width, (value) => context.measureText(value).width), box.x, y + 68 * s);
    y += 68 * s;
  }
  if (copy.quote.note) {
    // The reader's own note on it, in their words.
    context.fillStyle = palette.glow;
    context.font = `italic 400 ${Math.round(34 * s)}px ${SERIF}`;
    context.fillText(fitLine(`“${copy.quote.note}”`, box.width, (value) => context.measureText(value).width), box.x, y + 62 * s);
  }
};

/** The summary's figures, two to a row. */
const drawFigures = (context: Context, copy: SceneCopy, box: Box, palette: (typeof PALETTE)[SceneId], square: boolean, s: number) => {
  const figures = copy.figures ?? [];
  const columns = 2;
  const rows = Math.ceil(figures.length / columns);
  const rowHeight = Math.min(box.height / Math.max(1, rows), (square ? 230 : 300) * s);
  const columnWidth = box.width / columns;
  // In the middle of the room left for them.
  const top = box.y + Math.max(0, (box.height - rows * rowHeight) / 2);
  figures.forEach((figure, at) => {
    const x = box.x + (at % columns) * columnWidth;
    const y = top + Math.floor(at / columns) * rowHeight;
    context.fillStyle = alpha(palette.ink, 0.18);
    context.fillRect(x, y, columnWidth - 40 * s, 3);
    context.fillStyle = palette.ink;
    const size = Math.round(Math.min(130 * s, rowHeight * 0.48));
    context.font = `800 ${size}px ${SANS}`;
    context.fillText(fitLine(figure.value, columnWidth - 40 * s, (value) => context.measureText(value).width), x, y + 18 * s + size * 0.9);
    context.fillStyle = palette.soft;
    context.font = `500 ${Math.round(Math.min(34 * s, rowHeight * 0.17))}px ${SANS}`;
    context.fillText(fitLine(figure.label, columnWidth - 40 * s, (value) => context.measureText(value).width), x, y + 18 * s + size * 0.9 + 46 * s);
  });
};
