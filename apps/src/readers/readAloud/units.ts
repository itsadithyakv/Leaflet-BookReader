/**
 * What the voice is given at a time: a unit. Where the voice says which word
 * it is at (`boundary` events), a unit is a paragraph, or as much of one as
 * fits, cut only where a sentence ends, so the voice's tune carries from one
 * sentence to the next as a reader's does. Where it does not, a unit is a
 * sentence (a long one cut for lighting is still said whole), so the page can
 * still light the sentence being read.
 *
 * Before each unit, a silence of its own: longer after a paragraph, longer
 * again around a heading, a scene break or a new chapter, and shorter the
 * faster the reading.
 */
import type { PauseKind, Sentence } from "./chapterText";

/** A sentence, or the part of one, in a unit. */
export type UnitPart = {
  sentence: Sentence;
  /** Where the part starts and ends in the sentence's `say`. */
  from: number;
  to: number;
  /** Where it starts in the unit's text. */
  at: number;
};

export type Unit = {
  /** "section:n", and "+from" for one that starts inside its sentence. */
  id: string;
  parts: UnitPart[];
  text: string;
  /** Silence before it, in ms. */
  silence: number;
};

export type UnitMode = "paragraph" | "sentence";

/** A paragraph longer than this goes as more than one unit (cut where a sentence ends). */
export const UNIT_CHARS = 1000;
/** No unit is longer than this, even a single sentence (Android takes 4000 at most). */
export const HARD_CHARS = 3000;

/** The silence before a sentence of each kind, in ms at the voice's own pace. */
export const PAUSE_MS: Record<PauseKind, number> = {
  sentence: 0,
  line: 250,
  paragraph: 400,
  heading: 650,
  scene: 950,
  chapter: 850
};

/** A pause, shorter the faster the voice reads (and longer the slower). */
export const pauseMs = (kind: PauseKind, rate: number) => Math.round(PAUSE_MS[kind] / Math.min(2, Math.max(0.75, rate || 1)));

export const unitId = (sentence: Pick<Sentence, "section" | "n">, from = 0) => `${sentence.section}:${sentence.n}${from > 0 ? `+${from}` : ""}`;

/** Where a too-long run is cut: the last space before the limit (or the limit itself). */
const cutAt = (text: string, from: number, limit: number) => {
  if (text.length - from <= limit) return text.length;
  const space = text.lastIndexOf(" ", from + limit);
  return space > from ? space : from + limit;
};

/**
 * The unit that starts at `from` in sentence `index` of a chapter. `first`:
 * the first of a run of reading (no silence before it: the reader has just
 * pressed play).
 */
export const buildUnit = (
  sentences: readonly Sentence[],
  index: number,
  options: { from?: number; mode: UnitMode; rate: number; first?: boolean }
): Unit | null => {
  const head = sentences[index];
  if (!head) return null;
  const from = Math.max(0, Math.min(options.from ?? 0, head.say.length));
  const to = cutAt(head.say, from, HARD_CHARS);
  const parts: UnitPart[] = [{ sentence: head, from, to, at: 0 }];
  let text = head.say.slice(from, to);
  let last = head;
  if (to === head.say.length) {
    for (let next = index + 1; next < sentences.length; next += 1) {
      const sentence = sentences[next];
      const goesOn = Boolean(last.cont);
      // A new block (or a line, a heading) is a unit of its own, after its pause.
      if (sentence.lead !== "sentence" || sentence.block !== last.block) break;
      if (!goesOn && options.mode === "sentence") break;
      if (!goesOn && text.length + 1 + sentence.say.length > UNIT_CHARS) break;
      if (text.length + 1 + sentence.say.length > HARD_CHARS) break;
      parts.push({ sentence, from: 0, to: sentence.say.length, at: text.length + 1 });
      text = `${text} ${sentence.say}`;
      last = sentence;
    }
  }
  const kind: PauseKind = from > 0 ? "sentence" : head.lead;
  return { id: unitId(head, from), parts, text, silence: options.first ? 0 : pauseMs(kind, options.rate) };
};

/** The part of a unit an offset of its text is in. */
export const partAt = (unit: Unit, charIndex: number): UnitPart => {
  let found = unit.parts[0];
  for (const part of unit.parts) {
    if (part.at <= charIndex) found = part;
    else break;
  }
  return found;
};

/** Where an offset of a unit's text is: its sentence, and the offset in that sentence's `say`. */
export const placeIn = (unit: Unit, charIndex: number): { sentence: Sentence; offset: number } => {
  const part = partAt(unit, charIndex);
  const offset = Math.max(part.from, Math.min(part.to, part.from + (charIndex - part.at)));
  return { sentence: part.sentence, offset };
};

/** A span of a sentence's `say`, as offsets of its chapter's text (for lighting a word). */
export const chapterSpan = (sentence: Sentence, start: number, end: number) => {
  const at = (offset: number) => sentence.map[Math.max(0, Math.min(sentence.map.length - 1, offset))];
  const from = at(start);
  const to = at(end);
  return { start: from, end: Math.max(from, to) };
};

/** The last part of a unit, and whether the sentence it holds goes on past it (a unit cut at the hard limit). */
export const tailOf = (unit: Unit) => {
  const part = unit.parts[unit.parts.length - 1];
  return { part, cutShort: part.to < part.sentence.say.length };
};

/** How many words a text holds (to tell a voice that says nothing of where it is). */
export const wordCount = (text: string) => (text.match(/[\p{L}\p{N}]+/gu) ?? []).length;
