/**
 * What Pip writes in her diary: the lines, by the kind of day and the kind of
 * thing that happened on it.
 *
 * Her voice: lower case, dry, fond. The drama is aimed at herself, never at
 * the reader; a day with nothing read is a day off, not a failing. Titles and
 * names are kept as the reader has them.
 *
 * A line may only say what the day's facts hold (facts.ts). There are no page
 * counts anywhere in the app, so no line counts pages: it is minutes, a
 * percentage where the bookmark was left, and the things the reader marked.
 *
 * Every pool but one (`nod`) has at least three lines, which is what lets a
 * day never repeat the day before (seed.ts).
 */

/** What a line can be filled with. A lead may use any; an aside is only picked when its own are there. */
export type Slots = {
  /** "34 minutes", "1 hour 5 minutes". */
  mins: string;
  /** The book, when one is known. */
  title: string | null;
  /** " of Mistborn", or nothing. */
  of: string;
  /** "Mistborn", or "the book". */
  book: string;
  /** A character's name. */
  name: string;
  /** A few words of a highlight, without quotation marks. */
  quote: string;
  /** The chapter the highlight is in, when it has one. */
  chapter: string | null;
  /** A word looked up. */
  word: string;
  /** The streak, in days. */
  run: number;
  /** Focus sessions that day. */
  sessions: number;
  /** Where the bookmark was left. */
  percent: number;
  /** One of Pip's own lines about the book. */
  nod: string;
};

export type Line = (s: Slots) => string;

export type LeadKind = "first" | "finished" | "back" | "tiny" | "big" | "book" | "read" | "rest" | "yet";
export type AsideKind =
  | "person"
  | "highlight"
  | "word"
  | "milestone"
  | "record"
  | "streak"
  | "goal"
  | "clean"
  | "session"
  | "late"
  | "early"
  | "percent"
  | "nod"
  | "freeze"
  | "grace";

export const LEADS: Record<LeadKind, Line[]> = {
  // The first day anything was read.
  first: [
    (s) => `day one. ${s.mins}${s.of}. i've started a diary about it. this is the diary.`,
    (s) => `first entry. you read for ${s.mins}${s.of}. i watched. we both did well.`,
    (s) => `${s.mins}${s.of}, the very first. i'm writing it down so nobody can say it didn't happen.`,
    (s) => `page one of the diary: ${s.mins}${s.of}. i think i'm going to like it here.`
  ],
  finished: [
    (s) => `you finished ${s.book}. the end. i'm not crying, the leaf is just damp.`,
    (s) => `${s.book}: done. last page and everything. i clapped. quietly.`,
    (s) => `finished ${s.book} today, ${s.mins} to get there. i'm going to lie on the floor for a bit.`,
    (s) => `the last page of ${s.book}. i wasn't ready. you seemed fine.`,
    (s) => `${s.book} is finished. what do we do now. (another book. i know.)`,
    (s) => `${s.mins}, and then ${s.book} just ended. rude. good, but rude.`
  ],
  // Reading again after a few days away. Glad, never keeping count.
  back: [
    (s) => `you're back. ${s.mins}${s.of}. i kept your place. and the chair.`,
    (s) => `${s.mins}${s.of} after a little while away. the book remembered you. so did i.`,
    (s) => `back at it: ${s.mins}${s.of}. i pretended i hadn't been waiting.`,
    (s) => `${s.mins}${s.of}. i'd dusted, just in case. good thing too.`
  ],
  // Under five minutes.
  tiny: [
    (s) => `${s.mins}${s.of}. short. it still counts. i checked the rules. i wrote the rules.`,
    (s) => `${s.mins} today. a sip of a book.`,
    (s) => `just ${s.mins}${s.of}. some days are like that. the book didn't mind.`,
    (s) => `${s.mins}${s.of}. blink and i'd have missed it. i didn't blink.`,
    (s) => `a quick ${s.mins}. in and out. very stealthy.`
  ],
  // An hour or more, and at least twice the goal.
  big: [
    (s) => `${s.mins}${s.of}. it got dark outside without telling us.`,
    (s) => `${s.mins}. that's not reading, that's moving in.`,
    (s) => `${s.mins}${s.of} today. i need a lie down and i wasn't even the one reading.`,
    (s) => `${s.mins}. somebody could not put it down. i'm not naming names. it was you.`,
    (s) => `${s.mins}${s.of}. i looked up twice and it was a different time of day.`
  ],
  // An ordinary day with a book that is known.
  book: [
    (s) => `${s.mins} of ${s.book}. good day.`,
    (s) => `${s.book}, ${s.mins}. i read over your shoulder. you turn pages slower than i'd like.`,
    (s) => `${s.mins} with ${s.book} today. nobody got up for snacks. impressive.`,
    (s) => `today: ${s.book}. ${s.mins}. i only looked away once.`,
    (s) => `we did ${s.mins} of ${s.book}. i say we. i sat there.`,
    (s) => `${s.book}. ${s.mins}. it's getting good, isn't it.`,
    (s) => `${s.mins} of ${s.book}. i held the bookmark. important work.`,
    (s) => `read ${s.book} for ${s.mins}. the room was very quiet. i liked it.`,
    (s) => `${s.mins}. ${s.book}. no notes. (some notes.)`,
    (s) => `${s.book} for ${s.mins}. i'd have kept going. i don't have a bedtime.`
  ],
  // An ordinary day, and no way to tell which book.
  read: [
    (s) => `${s.mins} of reading. i didn't catch the title. i was busy being proud.`,
    (s) => `you read for ${s.mins}. i kept the chair warm.`,
    (s) => `${s.mins} today. a book was open and everything.`,
    (s) => `${s.mins} on the clock. pages turned. leaf approved.`,
    (s) => `read for ${s.mins}. i counted. it's sort of my job.`,
    (s) => `${s.mins}. no idea which book. it looked like a good one from here.`,
    (s) => `today had ${s.mins} of reading in it. better than most days i've heard of.`,
    (s) => `${s.mins}, quietly. my favourite kind.`
  ],
  // Nothing read. A day off: said plainly, and left there.
  rest: [
    () => "no reading today. i watched the window. the window was fine.",
    () => "a day off. the book kept its place. i kept mine.",
    () => "quiet day. i rearranged the bookmarks. there is one bookmark.",
    () => "nothing to report. i had a nap and it went well.",
    () => "rest day. even the lamp took it easy.",
    () => "the book stayed shut. it's allowed to. i checked."
  ],
  // Today, with nothing read so far.
  yet: [
    () => "nothing yet today. the book is where you left it. so am i.",
    () => "today's page is blank so far. no rush. i have snacks.",
    () => "no entry yet. i've sharpened the pencil just in case.",
    () => "still early, diary-wise."
  ]
};

export const ASIDES: Record<AsideKind, Line[]> = {
  // A character the reader wrote down that day.
  person: [
    (s) => `${s.name} scares me.`,
    (s) => `i don't trust ${s.name}. yet.`,
    (s) => `${s.name} seems nice. that worries me.`,
    (s) => `i've decided i like ${s.name}. don't tell them.`,
    (s) => `keeping an eye on ${s.name}.`,
    (s) => `${s.name}. hm. i have questions.`,
    (s) => `if ${s.name} turns out to be the villain i'm going to need a minute.`,
    (s) => `i wrote ${s.name} on my leaf so i'd remember.`
  ],
  highlight: [
    (s) => `you marked “${s.quote}”. i read it twice.`,
    (s) => `“${s.quote}”. that one got a highlight. fair.`,
    (s) => `a highlight today: “${s.quote}”. i'd have picked that one too.`,
    (s) => `you underlined “${s.quote}”. i nodded like i understood.`,
    (s) => `“${s.quote}”. saved. i'm keeping it next to the snacks.`,
    (s) => (s.chapter ? `a line from ${s.chapter} got marked: “${s.quote}”.` : `one line got marked: “${s.quote}”.`)
  ],
  word: [
    (s) => `you looked up “${s.word}”. i pretended i knew it.`,
    (s) => `new word: “${s.word}”. i'm going to use it wrong all week.`,
    (s) => `“${s.word}” got looked up. good. i was wondering too.`,
    (s) => `we learned “${s.word}” today. well. you did. i'm catching up.`,
    (s) => `“${s.word}”. noted. there may be a quiz.`
  ],
  milestone: [
    (s) => `day ${s.run} in a row. i made a small noise about it.`,
    (s) => `${s.run} days running. that's a real number now.`,
    (s) => `streak: ${s.run}. i'd frame it if i had a frame.`
  ],
  record: [
    (s) => `longest streak yet: ${s.run} days. i'm writing that down. i just did.`,
    (s) => `${s.run} days. a new record. the old one didn't see it coming.`,
    (s) => `that's the longest run so far, ${s.run} days.`
  ],
  streak: [
    (s) => `${s.run} days in a row now.`,
    (s) => `that's day ${s.run}.`,
    (s) => `day ${s.run}. the streak is alive and smug.`,
    (s) => `${s.run} in a row. not that i'm counting. i'm counting.`
  ],
  goal: [
    () => "goal met.",
    () => "goal met, by the way.",
    () => "the goal didn't stand a chance.",
    () => "that's today's goal done."
  ],
  // A focus session that ran to its end without leaving the book.
  clean: [
    (s) => (s.sessions > 1 ? `${s.sessions} focus sessions, start to finish. nobody wandered off.` : "one focus session, start to finish. nobody wandered off."),
    () => "the timer ran out before you did.",
    () => "a clean session. not one peek at another window. i checked.",
    () => "focus session: done properly. the garden got a drink."
  ],
  // A focus session of any other kind. The garden is watered either way.
  session: [
    () => "the timer was on for some of it. the garden noticed.",
    () => "a focus session in there too. the plants say thanks.",
    () => "there was a timer. i ignored it. you didn't."
  ],
  late: [
    () => "it was very late. neither of us mentioned it.",
    () => "night owl hours. the lamp and i kept watch.",
    () => "read well after dark. i yawned first.",
    () => "somebody was up late. i'm not judging. i was up too.",
    () => "the moon was out for most of it."
  ],
  early: [
    () => "before seven. who are you.",
    () => "an early one. the birds weren't even ready.",
    () => "up with the sun. i was not consulted.",
    () => "morning reading. suspiciously wholesome."
  ],
  percent: [
    (s) => `the bookmark is at ${s.percent}%.`,
    (s) => `${s.percent}% through ${s.book}.`,
    (s) => `left ${s.book} at ${s.percent}%.`,
    (s) => `${s.percent}% in. the rest is still a secret.`
  ],
  // One of her own lines about a book she knows (bookNods.ts), as it is. The
  // one pool with a single line: entry.ts keeps it off two days running by
  // the words themselves.
  nod: [(s) => s.nod],
  freeze: [
    () => "a freeze covered the streak. it slept right through.",
    () => "the streak used a freeze. that's what they're for.",
    () => "frozen for a day. the streak didn't feel a thing."
  ],
  grace: [
    () => "the streak got its one free pass.",
    () => "a day of grace. the streak says thanks.",
    () => "grace covered it. no harm done."
  ]
};
