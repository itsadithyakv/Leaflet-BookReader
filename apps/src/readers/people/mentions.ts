/**
 * Where a name was mentioned, up to the place being read: where it first
 * appeared, how often since, and the last few times, each as a line of the
 * book's own words. The book answering "who is this?" by itself.
 *
 * Spoiler-free by construction: nothing from a chapter after this one, and in
 * this chapter nothing after the place, not even the tail of a line that
 * starts before it.
 *
 * Pure: the chapters' text comes in as strings (`bookText.ts` reads them).
 */
import type { NameHit } from "./names";

/** How much of the book's words to keep on each side of a mention. */
export const CONTEXT = 90;

/** A mention in a chapter's text, with the words around it as the book has them. */
export type RawMention = { start: number; end: number; before: string; match: string; after: string };

export type SectionMentions = { section: number; hits: RawMention[] };

/** The place being read, in a chapter's text. */
export type Here = {
  /** The chapter (spine index). */
  section: number;
  /** How many characters of its text are at or before the place; null when that cannot be told. */
  offset: number | null;
};

export type Mention = {
  section: number;
  start: number;
  end: number;
  /** The line it is in: plain text, cut at whole words. */
  before: string;
  match: string;
  after: string;
};

export type MentionSummary = {
  count: number;
  first: Mention | null;
  /** The last few before here, the latest first. The first appearance is not repeated. */
  recent: Mention[];
};

/**
 * A contents page, by its name in the contents ("Contents", "A Clash of
 * Kings · Contents"). It is a list of the chapters' names, and where chapters
 * are named for the people who tell them it "mentions" each of them a dozen
 * times: a boxed set gave a character's first appearance as the contents
 * page of the first novel, and counted its three contents pages as mentions.
 */
export const isContentsPage = (chapter: string | null | undefined) => /(^|·\s*)(table of )?contents$/i.test((chapter ?? "").trim());

/** Every mention in a chapter's text. `person` keeps only that person's. */
export const mentionsIn = (
  text: string,
  find: (text: string) => NameHit[],
  person?: string | null
): RawMention[] =>
  find(text)
    .filter((hit) => !person || hit.person === person)
    .map((hit) => ({
      start: hit.start,
      end: hit.end,
      before: text.slice(Math.max(0, hit.start - CONTEXT), hit.start),
      match: text.slice(hit.start, hit.end),
      after: text.slice(hit.end, hit.end + CONTEXT)
    }));

const oneLine = (text: string) => text.replace(/\s+/g, " ");

/** The words before a mention: from the start of its sentence if that is near, else from a whole word. */
const lead = (text: string) => {
  const line = oneLine(text).replace(/^\s+/, "");
  let sentence = -1;
  for (const end of line.matchAll(/[.!?…]["”’)]?\s+/gu)) {
    sentence = end.index + end[0].length;
  }
  if (sentence >= 0) {
    return line.slice(sentence);
  }
  // Cut mid-word at the edge of what was kept: start at the next whole word.
  return text.length >= CONTEXT ? `…${line.replace(/^\S*\s+/, "")}` : line;
};

/** The words after: up to the end of the sentence, or a whole word. `cut` when the text was cut short. */
const tail = (text: string, cut: boolean) => {
  const line = oneLine(text).replace(/\s+$/, "");
  const sentence = /^[^.!?…]*[.!?…]["”’)]?/u.exec(line);
  if (sentence) {
    return sentence[0];
  }
  return cut ? `${line.replace(/\s+\S*$/, "")}…` : line;
};

/**
 * What may be shown of the mentions found, to a reader at `here`.
 *
 * Earlier chapters count in full. In the chapter being read only mentions
 * that end at or before the place count, and the words after one stop at the
 * place. Later chapters never count, whatever was handed in; nor does the
 * chapter being read when the place in it cannot be told.
 */
export const mentionsUpTo = (sections: SectionMentions[], here: Here, keep = 3): MentionSummary => {
  const shown: Mention[] = [];
  const inOrder = [...sections].sort((a, b) => a.section - b.section);
  for (const { section, hits } of inOrder) {
    if (section > here.section) {
      continue;
    }
    const limit = section < here.section ? Infinity : here.offset;
    if (limit === null || !Number.isFinite(section)) {
      continue;
    }
    for (const hit of [...hits].sort((a, b) => a.start - b.start)) {
      if (hit.end > limit) {
        continue;
      }
      const room = limit - hit.end;
      const after = hit.after.slice(0, Math.max(0, Math.min(hit.after.length, room)));
      shown.push({
        section,
        start: hit.start,
        end: hit.end,
        before: lead(hit.before),
        match: oneLine(hit.match),
        after: tail(after, after.length >= CONTEXT)
      });
    }
  }
  const first = shown[0] ?? null;
  return {
    count: shown.length,
    first,
    recent: shown.slice(1).slice(-keep).reverse()
  };
};
