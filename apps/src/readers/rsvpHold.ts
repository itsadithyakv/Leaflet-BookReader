/**
 * How much longer SpeedRead holds a word the reader has not met yet.
 *
 * A word flashed on its own cannot be looked at again, so the ones that take
 * a moment to take in need that moment given to them: a character's name when
 * they are introduced, a word that is new in this chapter, a figure. The time
 * fades as the word comes round again: a name is held nearly twice as long
 * the first time, a little the second and third, and then like any word.
 *
 * "First" is the first time in the text on the page (the chapter being read
 * and the ones loaded either side of it), in reading order. The chapter's
 * pace is scaled afterwards so it still averages the words a minute chosen
 * (`getPaceScale`): these holds move time towards new words, they do not add
 * to the total.
 */

export interface HoldWord {
  text: string;
  /** What follows the word up to the next one: spaces, punctuation, an opening quote. */
  trailing: string;
  sentenceEnd: boolean;
  paragraphEnd: boolean;
}

/** Extra hold for a name's first, second and third appearance, in words' worth of time. */
const NAME_HOLDS = [0.9, 0.45, 0.2];
/** For a long word that is not an everyday one. */
const NEW_WORD_HOLDS = [0.3, 0.12];
/** For a shorter one, the first time only. */
const NEW_SHORT_WORD_HOLD = 0.1;
/** A year, a sum, a measurement: read digit by digit, every time. */
const FIGURE_HOLD = 0.35;

const OPENS_SPEECH = /[“‘"(\[]\s*$/;

/** The word as counted: lower case, without a possessive ending, so "Vin’s" is "vin". */
export const holdKey = (text: string) =>
  text
    .toLocaleLowerCase()
    .replace(/[’']s$/u, "")
    .replace(/[^\p{L}\p{N}]/gu, "");

const startsUpper = (text: string) => /^\p{Lu}/u.test(text);
/**
 * "I’m", "I’ll", "I’d", "I’ve": capitalised wherever they stand and never
 * written small, which is all a name is known by here. They were held like
 * a character being introduced, the first three times each.
 */
const isPronounI = (text: string) => /^I(?:[’'](?:m|ll|d|ve))?$/u.test(text);
/** "CHAPTER", "PROLOGUE", an opening line set in capitals: says nothing about being a name. */
const allCapitals = (text: string) => text.length > 1 && text === text.toLocaleUpperCase() && /\p{Lu}/u.test(text);

/**
 * The words that are names: capitalised in the middle of a sentence at least
 * once and never written in lower case. A word that only ever begins
 * sentences ("Then") is not known to be one.
 */
export const findNames = (words: ReadonlyArray<HoldWord>, isCommon: (key: string) => boolean) => {
  const midSentence = new Set<string>();
  const lowerCase = new Set<string>();
  words.forEach((word, index) => {
    const key = holdKey(word.text);
    if (key.length < 2 || isCommon(key) || isPronounI(word.text)) {
      return;
    }
    if (!startsUpper(word.text)) {
      lowerCase.add(key);
      return;
    }
    if (allCapitals(word.text)) {
      return;
    }
    const before = words[index - 1];
    const startsSentence = !before || before.sentenceEnd || before.paragraphEnd || OPENS_SPEECH.test(before.trailing);
    if (!startsSentence) {
      midSentence.add(key);
    }
  });
  return new Set([...midSentence].filter((key) => !lowerCase.has(key)));
};

/** The extra hold for each word, in the order given: 0 for a word that needs none. */
export const noveltyHolds = (words: ReadonlyArray<HoldWord>, isCommon: (key: string) => boolean) => {
  const names = findNames(words, isCommon);
  const met = new Map<string, number>();
  return words.map((word) => {
    const key = holdKey(word.text);
    if (!key) {
      return 0;
    }
    if (/\d{3,}/.test(word.text) || /\d[.,]\d/.test(word.text)) {
      return FIGURE_HOLD;
    }
    if (isCommon(key)) {
      return 0;
    }
    const times = met.get(key) ?? 0;
    met.set(key, times + 1);
    if (names.has(key)) {
      return NAME_HOLDS[times] ?? 0;
    }
    if (key.length >= 7) {
      return NEW_WORD_HOLDS[times] ?? 0;
    }
    return times === 0 && key.length >= 4 ? NEW_SHORT_WORD_HOLD : 0;
  });
};

/** The longest any one word is held, in words' worth of time, before its punctuation's pause. */
export const MAX_WORD_HOLD = 2.6;

/** How many words SpeedRead takes to reach its pace after it starts or is resumed. */
export const RAMP_WORDS = 6;

/**
 * Setting off: the first words after Play are held longer, easing to the
 * chosen pace over `RAMP_WORDS`, so the eye has found the spot before words
 * go by at full speed. `shown` is how many words have been shown since the
 * start or the last pause.
 */
export const rsvpRamp = (shown: number) => {
  if (!(shown >= 0) || shown >= RAMP_WORDS) {
    return 1;
  }
  const left = 1 - shown / RAMP_WORDS;
  return 1 + 0.8 * left * left;
};
