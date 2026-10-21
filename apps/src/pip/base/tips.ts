/**
 * Pip's tips: how the camp is learnt.
 *
 * The camp says one next thing at a time (`nextStep`), which is *what* and
 * never *how*; and a good deal of it nobody would find by looking (that
 * anything can be dragged, that fence is drawn across the grass, that a
 * signpost is where a guardian stands). A tip is Pip saying one of those,
 * once, when it first matters: when the thing it is about has just become
 * possible, and not before. They are the camp's teaching: nothing else on
 * its screen explains, beyond what a tooltip or the (i) says.
 *
 * One at a time, in her bubble. A tip is done with when the reader has
 * done the thing (most can be told from the camp itself, so a reader who
 * found it out without being told is never told), or says "Got it", or
 * says they want none. They are kept with the camp, so a second computer
 * does not begin again.
 *
 * There is no tour to sit through. A first visit is the oak, a building,
 * and moving it; the second level of the camp brings the prowlers, the
 * postcard and the fence, a tip each.
 */
import { opened } from "./chapters";
import { COUNTER, ROLES, ROLE_NAMES, type Role } from "./front";
import { WORKS } from "./guards";
import { BUILDINGS, GATE_FROM, bedsOf, gateOf, prowlersCome, residents, worksOpen, type BaseState } from "./rules";

export type Tip = {
  id: string;
  text: string;
  /** It has come to matter: the thing it is about can now be done. */
  when: (state: BaseState) => boolean;
  /** The reader has done it, as far as the camp can tell: the tip is not needed. */
  did?: (state: BaseState) => boolean;
};

const built = (state: BaseState) => BUILDINGS.filter((site) => state.levels[site] > 0).length;

export const TIPS: readonly Tip[] = [
  {
    id: "oak",
    text: "Reading runs the camp. Every ten minutes you read, the oak drops acorns: tap the oak to take them in.",
    when: () => true,
    did: (state) => state.stats.gathered > 0
  },
  {
    id: "build",
    text: "Acorns build things. Tap a building to see what its next level brings and costs, and upgrade it there.",
    when: (state) => state.stats.gathered > 0,
    // (A camp begins with its burrow and its oak: it is the third thing that is the first one built.)
    did: (state) => state.jobs.length > 0 || built(state) > 2
  },
  {
    id: "move",
    text: "Anything in the camp can be moved: hold it a moment, then drag it to where you want it.",
    when: (state) => built(state) >= 3
  },
  {
    id: "parcel",
    text: "A parcel, from your reading: a chapter read sends one up the path, and so does a day's goal met. Tap it to open it.",
    when: (state) => state.parcels > 0
  },
  {
    id: "raid",
    text: "The scouts can take a magpie stronghold: open Raids. A quarter hour of reading rests them for the next one.",
    when: (state) => state.levels.hut > 0,
    did: (state) => state.stats.raids > 0 || state.camps > 0
  },
  {
    // A camp brought onto the front (1.5.11): Pip says what she did about it, once.
    id: "front",
    text: "The prowlers found a trail through the Dark Wood. I put the fence across it, and our defences on the front!",
    when: (state) => state.front.moved && prowlersCome(state)
  },
  {
    id: "prowler",
    text: "Prowlers come down the trail from the Dark Wood. One who gets through knocks a building (tap it to fix) or grabs a few acorns, once a day.",
    when: (state) => prowlersCome(state)
  },
  {
    id: "postcard",
    text: "The camera at the top makes a postcard of your camp, to save or to send to somebody.",
    when: (state) => opened(state, undefined, "postcard")
  },
  {
    id: "fence",
    text: "The fence stands across the trail. Whoever comes on foot batters at it, under what throws. In Arrange you can slide it along the trail.",
    when: (state) => state.levels.fence > 0,
    did: (state) => state.front.set
  },
  {
    id: "works",
    text: "Traps go on the trail in front of the wall, towers on the pads behind it: the Defence shelf has them. Each beats one kind of prowler.",
    when: (state) => worksOpen(state).length > 0,
    did: (state) => state.works.length > 0
  },
  {
    id: "broken",
    text: "Knocked about. Tap the building and press Fix. At four knocks it is broken, and stops doing its work until it is put right.",
    when: (state) => Object.values(state.harm).some((knocks) => (knocks ?? 0) > 0)
  },
  {
    id: "guard",
    text: "Guardians come now: each building's card has one to post. A guardian holds the ground about a signpost: drag it to where you want them.",
    when: (state) => opened(state, undefined, "guards"),
    did: (state) => state.guards.some((rank) => rank > 0)
  },
  {
    id: "gate",
    text: "The wall has a gate now, where the trail meets it: the toughest part of it. Your own people walk through, and prowlers have to batter it down.",
    when: (state) => state.levels.fence >= GATE_FROM && gateOf(state) !== null
  },
  // The first time each kind of prowler gets through, a word about what beats it.
  ...ROLES.filter((role) => COUNTER[role] !== null).map((role): Tip => ({
    id: `through-${role}`,
    text: throughWords(role),
    when: (state) => state.front.through.includes(role)
  })),
  {
    id: "beds",
    text: "More heroes have come than the hut has beds for: the rest are away on the road. Build the hut up, and more of them are about the camp.",
    when: (state) => residents(state).length > bedsOf(state)
  }
];

/** What Pip says the first time a kind of prowler gets through: what it did, and what beats it. */
function throughWords(role: Role): string {
  const counter = WORKS[COUNTER[role] ?? 0]?.name.toLowerCase() ?? "a construct";
  const said: Record<Role, string> = {
    creeper: "",
    runner: `A runner was over the wall in a bound! A ${counter} on the trail cuts them up.`,
    flier: `A flier went straight over the wall! An ${counter} shoots them down.`,
    brute: `A brute broke the gate! A ${counter} on the trail swallows one whole.`,
    digger: `A digger came up inside the wall! A ${counter} drums them up early.`,
    bomber: `A bomber blew the wall! A ${counter} sets them off out on the trail.`
  };
  return said[role] || `The ${ROLE_NAMES[role].many} got through.`;
}

/** A camp that has been told it wants no tips keeps this, and is told nothing more. */
const NONE = "none";

/** The tip Pip has for the reader just now: the first that has come to matter and has not been seen to; null when there is none. */
export const tipNow = (state: BaseState): Tip | null =>
  // While Pip walks a new reader through the camp (`welcome.ts`), she is saying all there is to say.
  state.taught.includes(NONE) || (state.welcome?.given && !state.welcome.tutorial.done) ? null : (TIPS.find((tip) => !state.taught.includes(tip.id) && tip.when(state) && !(tip.did?.(state) ?? false)) ?? null);

/**
 * Marks kept beside the tips, for things shown once that are not Pip's tips: the camp's three pointers to its phone
 * layout (1.5.8, `mapCoach.ts`). Kept with the camp like a tip, so a second device does not show them again.
 */
export const MARKS = ["mapCoach"] as const;

/** A tip has been seen to: by the reader saying so, or by their doing the thing. (Or one of the `MARKS` was shown.) */
export const learnt = (state: BaseState, id: string): BaseState =>
  state.taught.includes(id) || !(TIPS.some((tip) => tip.id === id) || (MARKS as readonly string[]).includes(id)) ? state : { ...state, taught: [...state.taught, id] };

/** No more tips, ever. */
export const noTips = (state: BaseState): BaseState => (state.taught.includes(NONE) ? state : { ...state, taught: [...state.taught, NONE] });
