/**
 * Links suggested from what the reader wrote: "Son of Ned, the bastard boy"
 * names Ned, and says how. A suggestion is only ever offered; the reader
 * confirms it with a tap.
 *
 * Only people met by the place being read can be suggested: the names looked
 * for are the cast's as seen from there.
 *
 * Pure.
 */
import type { LinkType } from "./model";
import { nameMatcher, type NameEntry } from "./names";

export type LinkSuggestion = {
  type: LinkType;
  /** The person written about is the link's `person` ("child of other"); else its `to`. */
  outward: boolean;
  other: string;
  /** The reader's word, where the type alone says less ("uncle", "squire"). */
  label: string | null;
};

type Rule = { words: string; type: LinkType; outward: boolean; keep?: boolean };

/** "<words> of|to X" and "X's <words>". The first that fits wins. */
const RULES: Rule[] = [
  { words: "grandson|granddaughter|grandchild|grandfather|grandmother|uncle|aunt|cousin|nephew|niece", type: "kin", outward: true, keep: true },
  { words: "half-brother|half-sister|half brother|half sister|twin|stepbrother|stepsister", type: "sibling", outward: true, keep: true },
  { words: "brother|sister|sibling", type: "sibling", outward: true },
  { words: "stepson|stepdaughter", type: "child", outward: true, keep: true },
  { words: "son|daughter|child|heir|bastard", type: "child", outward: true },
  { words: "stepfather|stepmother", type: "child", outward: false, keep: true },
  { words: "father|mother|parent", type: "child", outward: false },
  { words: "betrothed|widow|widower|fiance|fiancee|fiancé|fiancée", type: "spouse", outward: true, keep: true },
  { words: "wife|husband|spouse", type: "spouse", outward: true },
  { words: "squire|apprentice|steward|maid|guard|bodyguard|vassal|bannerman|student|pupil", type: "serves", outward: true, keep: true },
  { words: "servant", type: "serves", outward: true },
  { words: "ward", type: "ward", outward: true },
  { words: "rival", type: "enemy", outward: true, keep: true },
  { words: "enemy|foe", type: "enemy", outward: true },
  { words: "ally|lover", type: "friend", outward: true, keep: true },
  { words: "friend", type: "friend", outward: true },
  { words: "killer|murderer", type: "killedBy", outward: false }
];

/** Phrases that lead straight to a name: "serves X", "killed by X". */
const LEADS: Array<{ phrase: string; type: LinkType; outward: boolean; label?: string }> = [
  { phrase: "sworn to|serves|serving|works for|in service to", type: "serves", outward: true },
  { phrase: "married to|wed to|marries", type: "spouse", outward: true },
  { phrase: "betrothed to|engaged to|promised to", type: "spouse", outward: true, label: "betrothed" },
  { phrase: "friends with|befriends", type: "friend", outward: true },
  { phrase: "in love with|lover of", type: "friend", outward: true, label: "lover" },
  { phrase: "hates|enemies with", type: "enemy", outward: true },
  { phrase: "killed by|murdered by|slain by|executed by", type: "killedBy", outward: true },
  { phrase: "kills|killed|murdered|slew", type: "killedBy", outward: false },
  { phrase: "raised by|fostered by", type: "ward", outward: true }
];

const flex = (words: string) => words.replace(/[ -]/g, "[\\s-]?");
const BEFORE = RULES.map((rule) => ({
  rule,
  test: new RegExp(`(?:^|[^\\p{L}])(${flex(rule.words)})\\s+(?:of|to)\\s+(?:the\\s+)?$`, "iu")
}));
const AFTER = RULES.map((rule) => ({
  rule,
  test: new RegExp(`^['’]s?\\s+(?:\\p{L}+\\s+){0,2}?(${flex(rule.words)})(?![\\p{L}])`, "iu")
}));
const LEADING = LEADS.map((lead) => ({
  lead,
  test: new RegExp(`(?:^|[^\\p{L}])(?:${lead.phrase.replace(/ /g, "\\s+")})\\s+(?:the\\s+)?$`, "iu")
}));

const labelOf = (rule: Rule, word: string) => (rule.keep ? word.toLowerCase().replace(/\s+/g, " ") : null);

/**
 * The links a note suggests about `subject`. Each other person once, the first
 * way they are named. "Son of Ned and Catelyn" suggests both.
 */
export const suggestLinks = (text: string, names: NameEntry[], subject: string): LinkSuggestion[] => {
  const hits = nameMatcher(names)(text, 40);
  const found: LinkSuggestion[] = [];
  let last = null as { suggestion: LinkSuggestion; end: number } | null;
  for (const hit of hits) {
    const before = text.slice(Math.max(0, hit.start - 60), hit.start);
    const after = text.slice(hit.end, hit.end + 40);
    let suggestion = null as LinkSuggestion | null;

    const lead = LEADING.find((item) => item.test.test(before));
    if (lead) {
      suggestion = { type: lead.lead.type, outward: lead.lead.outward, other: hit.person, label: lead.lead.label ?? null };
    }
    if (!suggestion) {
      for (const { rule, test } of BEFORE) {
        const match = test.exec(before);
        if (match) {
          suggestion = { type: rule.type, outward: rule.outward, other: hit.person, label: labelOf(rule, match[1]) };
          break;
        }
      }
    }
    if (!suggestion) {
      for (const { rule, test } of AFTER) {
        const match = test.exec(after);
        if (match) {
          suggestion = { type: rule.type, outward: rule.outward, other: hit.person, label: labelOf(rule, match[1]) };
          break;
        }
      }
    }
    // "… of Ned and Catelyn": the second name is tied the same way.
    if (!suggestion && last && /^\s*(?:,|and|&|,\s*and)\s*$/iu.test(text.slice(last.end, hit.start))) {
      const tied: LinkSuggestion = last.suggestion;
      suggestion = { type: tied.type, outward: tied.outward, label: tied.label, other: hit.person };
    }
    if (suggestion) {
      last = { suggestion, end: hit.end };
      if (hit.person !== subject && !found.some((item) => item.other === hit.person)) {
        found.push(suggestion);
      }
    } else {
      last = null;
    }
  }
  return found;
};

/**
 * A link in words, read from one end, to go before the other person's name:
 * "child of", "parent of", "serves", and with the reader's own word "uncle of"
 * from the uncle's end and "uncle:" from the other.
 */
export const linkWords = (type: LinkType, outward: boolean, label: string | null): string => {
  const words: Record<LinkType, [string, string]> = {
    child: ["child of", "parent of"],
    spouse: ["married to", "married to"],
    sibling: ["sibling of", "sibling of"],
    kin: ["kin of", "kin of"],
    serves: ["serves", "served by"],
    ward: ["ward of", "guardian of"],
    friend: ["friend of", "friend of"],
    enemy: ["enemy of", "enemy of"],
    killedBy: ["killed by", "killed"],
    other: ["tied to", "tied to"]
  };
  if (!label) {
    return words[type][outward ? 0 : 1];
  }
  if (!outward || type === "other") {
    return `${label}:`;
  }
  return /\s(of|to|by|with|for)$/i.test(label) ? label : `${label} of`;
};
