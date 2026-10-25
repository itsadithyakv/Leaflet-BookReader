/**
 * The story's scenes: which a year has, in what order, in what colours, and
 * what each says. One description, read by the scenes on screen and by the
 * pictures drawn to share (`render.ts`), so a scene and its picture always
 * say the same thing.
 *
 * Pure: a review in (`yearReview.ts`), words and colours out.
 */
import { MONTHS, dayWords, framing, timeWords, type TimeOfDay, type YearReview } from "../yearReview";

export type SceneId =
  | "opening"
  | "time"
  | "days"
  | "books"
  | "kind"
  | "faithful"
  | "when"
  | "month"
  | "lines"
  | "hollow"
  | "study"
  | "summary"
  /** A year with nothing read: one kind card and no story. */
  | "empty";

export const SCENE_ORDER: SceneId[] = ["opening", "time", "days", "books", "kind", "faithful", "when", "month", "lines", "hollow", "study", "summary"];

/** How long each scene shows before the next, in ms: long enough to read twice. */
export const SCENE_MS: Record<SceneId, number> = {
  opening: 5600,
  time: 7000,
  days: 7400,
  books: 7000,
  kind: 7000,
  faithful: 6400,
  when: 7000,
  month: 7000,
  lines: 9000,
  hollow: 7000,
  study: 6400,
  summary: 9000,
  empty: 6000
};

/**
 * A small year (a few minutes on a few days, no book finished) is told in a
 * few warm scenes: what there is, never padding.
 */
export const isSmallYear = (review: YearReview) => review.minutes < 120 && review.daysRead < 5 && review.finished.length === 0;

/** The months the calendar and the bars show: the span's, from its first. */
export const shownMonths = (review: YearReview) => {
  const months: number[] = [];
  for (let month = review.span.firstMonth; month <= review.span.lastMonth; month++) {
    months.push(month);
  }
  return months;
};

/** Whether a scene has something to say for this year: a scene with nothing is skipped. */
export const sceneHas = (id: SceneId, review: YearReview): boolean => {
  switch (id) {
    case "opening":
    case "summary":
      return !review.empty;
    case "time":
      return review.minutes > 0;
    case "days":
      return review.daysRead >= 3;
    case "books":
      return review.finished.length > 0;
    case "kind":
      return review.readerType !== null;
    case "faithful":
      return review.topAuthor !== null || review.mostReturned !== null;
    case "when":
      return review.dayShare !== null;
    case "month":
      return review.busiestMonth !== null && shownMonths(review).filter((month) => review.byMonth[month] > 0).length >= 3;
    case "lines":
      return review.highlight !== null || review.hardestWord !== null;
    case "hollow":
      return review.hollow !== null;
    case "study":
      return review.cardsMade > 0 || review.cardsLearnt > 0;
    case "empty":
      return review.empty;
  }
};

/** The year's scenes, in order. */
export const chooseScenes = (review: YearReview): SceneId[] => {
  if (review.empty) {
    return ["empty"];
  }
  const small: SceneId[] = ["opening", "time", "books", "lines", "summary"];
  return SCENE_ORDER.filter((id) => (!isSmallYear(review) || small.includes(id)) && sceneHas(id, review));
};

// ---- Colours ----------------------------------------------------------------

export type ScenePalette = {
  /** The field: a wash from the top to the bottom. */
  field: [string, string];
  ink: string;
  /** Second ink: smaller words. */
  soft: string;
  accent: string;
  /** A second accent: the gold of a longest run, a highlight's mark. */
  glow: string;
  /** The field's grain is light on a dark field, dark on a light one. */
  dark: boolean;
};

/**
 * The year's palette: Leaflet's own colours (moss, ribbon, butter, berry,
 * page), deepened into fields. Light and dark fields take turns, so each
 * scene arrives as a change of light.
 */
export const PALETTE: Record<SceneId, ScenePalette> = {
  opening: { field: ["#24452f", "#13261a"], ink: "#fffbf0", soft: "#cfe3b0", accent: "#ffd86b", glow: "#f2b84b", dark: true },
  time: { field: ["#232b52", "#141a33"], ink: "#fffbf0", soft: "#c3c9e8", accent: "#f2b84b", glow: "#ffd86b", dark: true },
  days: { field: ["#f6efdd", "#e9dfc4"], ink: "#1f2a22", soft: "#55604f", accent: "#468037", glow: "#d99a1e", dark: false },
  books: { field: ["#6e2340", "#40142a"], ink: "#fff4ec", soft: "#f0c3cf", accent: "#ffd86b", glow: "#f2b84b", dark: true },
  kind: { field: ["#4a3672", "#281c44"], ink: "#fbf4ff", soft: "#d8c8f0", accent: "#eab9c9", glow: "#ffd86b", dark: true },
  faithful: { field: ["#e5f0d4", "#c9dfae"], ink: "#18301f", soft: "#3f5a44", accent: "#2e6136", glow: "#e2557a", dark: false },
  when: { field: ["#f2b06a", "#2b2f5c"], ink: "#fffbf0", soft: "#fde7c6", accent: "#ffd86b", glow: "#fffbf0", dark: true },
  month: { field: ["#f2c35b", "#e59a3c"], ink: "#2a1a0b", soft: "#5b3a17", accent: "#fffbf0", glow: "#7a2e12", dark: false },
  lines: { field: ["#fffbf0", "#f1e8d0"], ink: "#1f2a22", soft: "#55604f", accent: "#e2557a", glow: "#468037", dark: false },
  hollow: { field: ["#1d3a28", "#0d1d14"], ink: "#fffbf0", soft: "#b5d294", accent: "#ffd86b", glow: "#e2557a", dark: true },
  study: { field: ["#d9ecef", "#b6d8dd"], ink: "#123238", soft: "#36585e", accent: "#1f6f78", glow: "#f2b84b", dark: false },
  summary: { field: ["#2e6136", "#173321"], ink: "#fffbf0", soft: "#cfe3b0", accent: "#ffd86b", glow: "#e2557a", dark: true },
  empty: { field: ["#24452f", "#13261a"], ink: "#fffbf0", soft: "#cfe3b0", accent: "#ffd86b", glow: "#f2b84b", dark: true }
};

// ---- Words ------------------------------------------------------------------

export type CopyOptions = {
  /** For a picture to share: book titles left out (the reader's switch). */
  hideTitles?: boolean;
  /** Which of the year's highlights is shown (the reader can swap it). */
  highlightAt?: number;
};

export type Figure = { value: string; label: string };

export type SceneCopy = {
  /** A small line over the big one. */
  eyebrow: string;
  /** The big figure or name, as it ends. */
  big: string;
  /** When the big figure is a number, the number it counts up to. */
  count?: number;
  /** A word or two under it, set in the serif: "hours", "in pages". */
  unit?: string;
  /** A few short lines under the picture. */
  lines: string[];
  /** The lines scene: the passage, and who it is from. */
  quote?: { text: string; by: string; note: string | null };
  word?: { word: string; meaning: string; why: string };
  /** The books scene: what is on the shelf (titles left out when hidden). */
  shelf?: Array<{ id: string; title: string; author: string }>;
  /** The faithful scene: the books in the stack, by title (blank when titles are hidden). */
  stack?: string[];
  /** The summary: the best figures. */
  figures?: Figure[];
  /** Pip: what she does in the scene, in which look. */
  pip?: { move: string; skin?: string; outfit?: string[] };
};

const BAND_SAYS: Record<TimeOfDay, { who: string; when: string }> = {
  morning: { who: "A morning reader", when: "of your session time was before noon" },
  afternoon: { who: "An afternoon reader", when: "of your session time was between noon and five" },
  evening: { who: "An evening reader", when: "of your session time was after five in the evening" },
  night: { who: "A night reader", when: "of your session time was after ten at night" }
};

const plural = (count: number, one: string, many = `${one}s`) => `${count.toLocaleString()} ${count === 1 ? one : many}`;

/** The time read as a big figure: hours from an hour and a half, minutes below. */
export const timeFigure = (minutes: number) =>
  minutes < 90 ? { count: Math.round(minutes), unit: Math.round(minutes) === 1 ? "minute" : "minutes" } : { count: Math.round(minutes / 60), unit: Math.round(minutes / 60) === 1 ? "hour" : "hours" };

/** The summary's figures: the best of the year, six at most, the ones there is something to say for. */
export const summaryFigures = (review: YearReview): Figure[] => {
  const time = timeFigure(review.minutes);
  const figures: Figure[] = [{ value: time.count.toLocaleString(), label: time.unit }];
  if (review.finished.length > 0) {
    figures.push({ value: review.finished.length.toLocaleString(), label: review.finished.length === 1 ? "book finished" : "books finished" });
  }
  figures.push({ value: review.daysRead.toLocaleString(), label: review.daysRead === 1 ? "day read" : "days read" });
  if (review.longestRun >= 2) {
    figures.push({ value: review.longestRun.toLocaleString(), label: "days in a row" });
  }
  if (review.highlights > 0) {
    figures.push({ value: review.highlights.toLocaleString(), label: review.highlights === 1 ? "highlight" : "highlights" });
  }
  if (review.words > 0) {
    figures.push({ value: review.words.toLocaleString(), label: review.words === 1 ? "word looked up" : "words looked up" });
  }
  if (review.cardsLearnt > 0) {
    figures.push({ value: review.cardsLearnt.toLocaleString(), label: review.cardsLearnt === 1 ? "card learnt" : "cards learnt" });
  }
  if (review.booksRead > review.finished.length && figures.length < 6) {
    figures.push({ value: review.booksRead.toLocaleString(), label: review.booksRead === 1 ? "book opened" : "books opened" });
  }
  return figures.slice(0, 6);
};

/** What a scene says. */
export const sceneCopy = (id: SceneId, review: YearReview, options: CopyOptions = {}): SceneCopy => {
  const frame = framing(review);
  const { span } = review;
  switch (id) {
    case "opening": {
      const line =
        span.kind === "months"
          ? `Since ${dayWords(span.from)}. What a start.`
          : span.kind === "weeks"
            ? "Every page from the very first. What a start."
          : span.soFar
            ? `Up to ${dayWords(span.to)}. The rest still counts.`
            : "Every page, gathered up.";
      return { eyebrow: frame.eyebrow, big: frame.big[0], unit: frame.big[1], lines: [line], pip: { move: "read" } };
    }
    case "time": {
      const time = timeFigure(review.minutes);
      const lines: string[] = [];
      if (review.comparison) {
        lines.push(`That's ${review.comparison.says}.`);
      } else {
        lines.push("Every page counts. These did.");
      }
      // A week's worth, over the span: only when the span is long enough to have weeks to speak of.
      if (span.days >= 14 && review.perWeek >= 20) {
        lines.push(`About ${timeWords(review.perWeek)} a week.`);
      }
      return { eyebrow: `${frame.inSpan} you read for`, big: time.count.toLocaleString(), count: time.count, unit: time.unit, lines, pip: { move: "tea" } };
    }
    case "days": {
      const lines: string[] = [];
      if (review.longestRun >= 3 && review.longestRunFrom) {
        lines.push(`Your longest run: ${review.longestRun} days in a row, from ${dayWords(review.longestRunFrom)}.`);
      } else {
        lines.push(`${review.daysRead.toLocaleString()} of ${span.days.toLocaleString()} days${span.soFar ? " so far" : ""}.`);
      }
      if (review.bestDay && review.bestDay.minutes >= 20) {
        lines.push(`Best day: ${dayWords(review.bestDay.dateKey)}, ${timeWords(review.bestDay.minutes)}.`);
      }
      return { eyebrow: "You read on", big: review.daysRead.toLocaleString(), count: review.daysRead, unit: review.daysRead === 1 ? "day" : "days", lines };
    }
    case "books": {
      const count = review.finished.length;
      const lines: string[] = [];
      if (!options.hideTitles && review.finished[0]) {
        lines.push(`The last: ${review.finished[0].title}.`);
      }
      if (review.booksRead > count) {
        lines.push(`And ${plural(review.booksRead - count, "more")} on the go.`);
      }
      return {
        eyebrow: `${frame.inSpan} you finished`,
        big: count.toLocaleString(),
        count,
        unit: count === 1 ? "book" : "books",
        lines,
        shelf: review.finished.slice(0, 9).map((book) => ({ id: book.id, title: options.hideTitles ? "" : book.title, author: options.hideTitles ? "" : (book.author ?? "") })),
        pip: { move: "cheer" }
      };
    }
    case "kind": {
      const type = review.readerType;
      const lines = [type?.line ?? ""];
      if (review.topGenre) {
        lines.push(`Mostly ${review.topGenre.toLowerCase()}.`);
      } else if (review.timeOfDay) {
        lines.push(`${BAND_SAYS[review.timeOfDay].who}, through and through.`);
      }
      return { eyebrow: "Your kind of reader", big: type?.name ?? "", lines, pip: type ? { move: type.move, skin: type.skin, outfit: type.outfit } : undefined };
    }
    case "faithful": {
      if (review.topAuthor) {
        const theirs = review.topAuthorBooks;
        return {
          eyebrow: "Faithful to",
          big: review.topAuthor,
          lines: [theirs.length >= 2 ? `${plural(theirs.length, "book")} of theirs. You kept coming back.` : "You kept coming back for more."],
          stack: theirs.slice(0, 6).map((title) => (options.hideTitles ? "" : title)),
          pip: { move: "smitten" }
        };
      }
      const returned = review.mostReturned;
      return {
        eyebrow: "The book you came back to",
        big: options.hideTitles || !returned ? "One book" : returned.title,
        lines: [returned ? `On ${returned.days} different days.` : ""],
        stack: [options.hideTitles || !returned ? "" : returned.title],
        pip: { move: "smitten" }
      };
    }
    case "when": {
      const share = review.dayShare;
      const says = BAND_SAYS[share?.band ?? "evening"];
      return {
        eyebrow: says.who,
        big: `${share?.percent ?? 0}%`,
        count: share?.percent ?? 0,
        unit: "",
        lines: [`${says.when}.`],
        pip: { move: share?.band === "night" || share?.band === "evening" ? "booknap" : "sunbathe" }
      };
    }
    case "month": {
      const month = review.busiestMonth ?? 0;
      return {
        eyebrow: "Your biggest month",
        big: MONTHS[month],
        lines: [`${timeWords(review.byMonth[month])} of reading.`]
      };
    }
    case "lines": {
      const choices = review.highlightChoices;
      const chosen = choices.length > 0 ? choices[((options.highlightAt ?? 0) % choices.length + choices.length) % choices.length] : null;
      const by = chosen ? (options.hideTitles ? (chosen.author ?? "") : [chosen.title, chosen.author].filter(Boolean).join(" · ")) : "";
      const word = review.hardestWord;
      return {
        eyebrow: chosen ? "A line you kept" : "A word you looked up",
        big: chosen ? "" : (word?.word ?? ""),
        lines: [],
        quote: chosen ? { text: chosen.text, by, note: chosen.note } : undefined,
        word: word
          ? {
              word: word.word,
              meaning: word.meaning,
              why: word.count >= 2 ? `looked up ${word.count} times` : "the longest you looked up"
            }
          : undefined,
        pip: { move: "bookmark" }
      };
    }
    case "hollow": {
      const hollow = review.hollow;
      const lines: string[] = [];
      if (hollow && hollow.chapterTo > hollow.chapterFrom) {
        lines.push(`Up from chapter ${hollow.chapterFrom}, all by reading.`);
      }
      if (hollow?.strongholds) {
        lines.push(`${plural(hollow.strongholds, "stronghold")} taken${hollow.stars ? `, ${plural(hollow.stars, "star")}` : ""}.`);
      }
      if (hollow && hollow.banners > 0) {
        lines.push(`${plural(hollow.banners, "banner")} of the Magpie King's.`);
      }
      return { eyebrow: "In the Hollow", big: `Chapter ${hollow?.chapterTo ?? 1}`, lines, pip: { move: "champ", skin: "knight" } };
    }
    case "study": {
      const learnt = review.cardsLearnt;
      return learnt > 0
        ? {
            eyebrow: "You learnt",
            big: learnt.toLocaleString(),
            count: learnt,
            unit: learnt === 1 ? "card" : "cards",
            lines: [review.cardsMade > 0 ? `From ${plural(review.cardsMade, "card")} you made.` : "And they stuck."],
            pip: { move: "idea" }
          }
        : {
            eyebrow: "You made",
            big: review.cardsMade.toLocaleString(),
            count: review.cardsMade,
            unit: review.cardsMade === 1 ? "study card" : "study cards",
            lines: ["Every one a thing worth keeping."],
            pip: { move: "idea" }
          };
    }
    case "summary":
      return {
        eyebrow: review.readerType?.name ?? frame.title,
        big: frame.big[0],
        unit: review.span.kind !== "year" ? `in pages · ${review.year}` : review.span.soFar ? "in pages, so far" : "in pages",
        lines: [],
        figures: summaryFigures(review),
        pip: review.readerType ? { move: "cheer", skin: review.readerType.skin, outfit: review.readerType.outfit } : { move: "cheer" }
      };
    case "empty":
      return {
        eyebrow: `Your ${review.year}`,
        big: "in pages",
        lines: ["It starts with the first one. Pip's saving you a seat."],
        pip: { move: "read" }
      };
  }
};

/** Whether a scene shows a book's title anywhere: the switch to hide them is offered for these. */
export const sceneHasTitles = (id: SceneId, review: YearReview) =>
  (id === "books" && review.finished.length > 0) ||
  (id === "faithful" && (review.topAuthor ? review.topAuthorBooks.length > 0 : review.mostReturned !== null)) ||
  (id === "lines" && review.highlight !== null && review.highlight.title !== "");

/** A scene in words, for a screen reader and a clipboard that takes no pictures. */
export const sceneWords = (id: SceneId, review: YearReview, options: CopyOptions = {}) => {
  const copy = sceneCopy(id, review, options);
  return [
    copy.eyebrow,
    [copy.big, copy.unit].filter(Boolean).join(" "),
    copy.quote ? `“${copy.quote.text}” ${copy.quote.by}` : "",
    copy.word ? `${copy.word.word}: ${copy.word.meaning} (${copy.word.why})` : "",
    ...copy.lines,
    ...(copy.figures ?? []).map((figure) => `${figure.value} ${figure.label}`)
  ]
    .filter(Boolean)
    .join("\n");
};
