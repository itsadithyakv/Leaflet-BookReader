/**
 * Words laid out for a picture: a canvas draws one line of text where it is
 * told and knows nothing of wrapping, so the lines are worked out here.
 *
 * Pure: `measure` says how wide some words are (the canvas's `measureText`
 * in the app, a rule of thumb in tests).
 */

export type Measure = (text: string) => number;

/** Words wrapped to a width. A word wider than the line is broken across lines. */
export const wrapLines = (text: string, maxWidth: number, measure: Measure): string[] => {
  const lines: string[] = [];
  for (const paragraph of text.split(/\n+/)) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    let line = "";
    for (let word of words) {
      const tried = line ? `${line} ${word}` : word;
      if (measure(tried) <= maxWidth) {
        line = tried;
        continue;
      }
      if (line) {
        lines.push(line);
        line = "";
      }
      // A word (a web address, a made-up compound) too long for any line.
      while (word.length > 1 && measure(word) > maxWidth) {
        let cut = word.length - 1;
        while (cut > 1 && measure(word.slice(0, cut)) > maxWidth) {
          cut -= 1;
        }
        lines.push(word.slice(0, cut));
        word = word.slice(cut);
      }
      line = word;
    }
    if (line) {
      lines.push(line);
    }
  }
  return lines;
};

/** One line, cut with an ellipsis when it is too wide. */
export const fitLine = (text: string, maxWidth: number, measure: Measure): string => {
  if (measure(text) <= maxWidth) {
    return text;
  }
  let cut = text.length;
  while (cut > 1 && measure(`${text.slice(0, cut).trimEnd()}…`) > maxWidth) {
    cut -= 1;
  }
  return `${text.slice(0, cut).trimEnd()}…`;
};

/** A passage short enough for a picture: cut at a whole word, with an ellipsis, past `max`. */
export const clipQuote = (text: string, max = 560): string => {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) {
    return clean;
  }
  const cut = clean.slice(0, max);
  const end = cut.lastIndexOf(" ");
  return `${cut.slice(0, end > max * 0.6 ? end : max).replace(/[,;:\s]+$/, "")}…`;
};

/**
 * The largest of `sizes` at which the words fit a box, and the lines at that
 * size. The smallest is used, and the lines that fit kept, when none does.
 */
export const fitText = (
  text: string,
  box: { width: number; height: number },
  sizes: number[],
  lineHeight: number,
  measureAt: (size: number) => Measure
): { size: number; lines: string[] } => {
  const largestFirst = [...sizes].sort((a, b) => b - a);
  for (const size of largestFirst) {
    const lines = wrapLines(text, box.width, measureAt(size));
    if (lines.length * size * lineHeight <= box.height) {
      return { size, lines };
    }
  }
  const size = largestFirst[largestFirst.length - 1];
  const lines = wrapLines(text, box.width, measureAt(size));
  const room = Math.max(1, Math.floor(box.height / (size * lineHeight)));
  if (lines.length <= room) {
    return { size, lines };
  }
  const kept = lines.slice(0, room);
  kept[room - 1] = fitLine(`${kept[room - 1]} …`, box.width, measureAt(size)).replace(/\s*…+$/, "…");
  return { size, lines: kept };
};
